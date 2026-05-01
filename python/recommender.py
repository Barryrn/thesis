"""Citation paper recommender.

Given a thesis section's input text (title + body + notes) and a list of
candidate papers (each with its structured summary), score each paper for
citation relevance and return a ranked list with reasoning in the section's
language.

The Convex action layer assembles the candidate list (filtered by scope and
with already-matched papers excluded) and calls the FastAPI
``/recommend-papers`` endpoint defined in ``main.py``. This module stays
stateless and never queries Convex directly, mirroring ``grouper.py``.
"""

import asyncio
import json
from typing import Any

from fastapi.concurrency import run_in_threadpool

import ai_client


# Combined input length (body + notes) below this falls back to a "topic only"
# prompt that scores on title + parent path. Anything above is treated as a
# real draft and the LLM is told to weigh research-question / methodology /
# findings overlap against the draft itself.
LOW_CONTEXT_CHAR_THRESHOLD = 50

# Papers per LLM call. Small enough that a 12-paper batch with full summaries
# fits inside the grouper-tier model's context window with headroom for the
# input text and the response. Parallel batches saturate the I/O.
BATCH_SIZE = 12

# Prompt strings keyed by reasoning language. The LLM produces ``reasoning``
# in the section's language so it reads naturally when shown alongside German
# or English prose.
_SYSTEM_PROMPT_EN = (
    "You are a research-paper recommender for a thesis writer. You receive "
    "the user's section (title, optional body draft, optional notes) and a "
    "batch of candidate papers, each with a structured summary "
    "(researchQuestion, methodology, keyFindings, keywords). Score each "
    "paper for citation relevance to the section.\n\n"
    "Output a JSON array. Each element must look like: "
    '{"paperId": "<id>", "score": 0.0-1.0, "reasoning": "<one or two '
    'sentences explaining why this paper fits, referencing research '
    'question, findings, or methodology overlap>"}.\n'
    "Include EVERY paper in the batch, even those that score low — the user "
    "wants to see the full ranking, not a filtered list. "
    "Output JSON only — no prose, no markdown fences."
)

_SYSTEM_PROMPT_DE = (
    "Du bist ein Empfehlungssystem für wissenschaftliche Quellen für eine "
    "Abschlussarbeit. Du erhältst den Abschnitt der Nutzer:in (Titel, "
    "optionaler Entwurf, optionale Notizen) und eine Auswahl an Papers mit "
    "strukturierter Zusammenfassung (researchQuestion, methodology, "
    "keyFindings, keywords). Bewerte jedes Paper nach seiner Relevanz für "
    "Zitationen in diesem Abschnitt.\n\n"
    "Gib ein JSON-Array zurück. Jedes Element hat die Form: "
    '{"paperId": "<id>", "score": 0.0-1.0, "reasoning": "<ein bis zwei '
    'Sätze auf Deutsch, die Überschneidungen in Forschungsfrage, '
    'Methodik oder Ergebnissen begründen>"}.\n'
    "Gib JEDES Paper aus dem Batch zurück, auch niedrig bewertete — die "
    "Nutzer:in möchte das vollständige Ranking sehen, keine gefilterte "
    "Liste. Nur JSON ausgeben — kein Fließtext, keine Markdown-Fences."
)


def _system_prompt(language: str) -> str:
    """Pick the system prompt for the section's language."""
    return _SYSTEM_PROMPT_DE if language == "de" else _SYSTEM_PROMPT_EN


def _build_user_payload(input_text: dict, papers: list[dict], low_context: bool) -> str:
    """Serialise the input text and one batch of papers as compact JSON.

    ``low_context`` is included as a hint so the LLM knows it should weigh
    title/topic fit more than draft alignment when the user has barely written
    anything yet.
    """
    payload = {
        "input": {
            "title": input_text.get("title", ""),
            "body": input_text.get("body", ""),
            "notes": input_text.get("notes", ""),
            "lowContext": low_context,
        },
        "papers": [
            {
                "paperId": p["paperId"],
                "title": p.get("title", ""),
                "authors": p.get("authors", []),
                "year": p.get("year"),
                "summary": {
                    "researchQuestion": (p.get("summary") or {}).get("researchQuestion", ""),
                    "methodology": (p.get("summary") or {}).get("methodology", ""),
                    "keyFindings": (p.get("summary") or {}).get("keyFindings", []),
                    "keywords": (p.get("summary") or {}).get("keywords", []),
                },
            }
            for p in papers
        ],
    }
    return json.dumps(payload, ensure_ascii=False)


def _parse_batch_response(raw: str, valid_paper_ids: set[str]) -> list[dict]:
    """Parse one batch's LLM response into validated recommendation rows.

    Filters out malformed rows and unknown paperIds; clamps scores to [0, 1].
    Returning an empty list for parse failures keeps a single bad batch from
    failing the whole run.
    """
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []

    out: list[dict] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        pid = item.get("paperId")
        if pid not in valid_paper_ids:
            continue
        try:
            score = float(item.get("score", 0))
        except (TypeError, ValueError):
            continue
        score = max(0.0, min(1.0, score))
        reasoning = str(item.get("reasoning", "")).strip()
        out.append({"paperId": pid, "score": score, "reasoning": reasoning})
    return out


def _chunk(seq: list[dict], size: int) -> list[list[dict]]:
    """Split ``seq`` into successive sub-lists of length ``size``."""
    return [seq[i : i + size] for i in range(0, len(seq), size)]


def is_low_context(input_text: dict) -> bool:
    """Decide whether body + notes carry enough signal to outweigh the title.

    Title alone is treated as low context. Anything above
    ``LOW_CONTEXT_CHAR_THRESHOLD`` combined chars in body+notes is enough that
    the LLM should weigh draft alignment heavily.
    """
    body = (input_text.get("body") or "").strip()
    notes = (input_text.get("notes") or "").strip()
    return len(body) + len(notes) < LOW_CONTEXT_CHAR_THRESHOLD


async def recommend(
    input_text: dict,
    papers: list[dict],
    language: str = "en",
    provider: str = "anthropic",
) -> dict:
    """Score every candidate paper for the given input text.

    Returns a dict with ``recommendations`` (list, sorted by score desc) and
    ``lowContext`` (bool). The Convex action passes both back to the client
    so the UI can render a banner explaining title-only matching.
    """
    if not papers:
        return {"recommendations": [], "lowContext": is_low_context(input_text)}

    low_context = is_low_context(input_text)
    system = _system_prompt(language)
    batches = _chunk(papers, BATCH_SIZE)

    async def _run_batch(batch: list[dict]) -> list[dict]:
        """Score one batch in a thread so the SDK call doesn't block the loop."""
        user_message = _build_user_payload(input_text, batch, low_context)
        # 256 tokens per paper is a safe upper bound for one or two short
        # reasoning sentences plus the JSON envelope.
        max_tokens = max(512, 256 * len(batch))
        raw = await run_in_threadpool(
            ai_client.chat_completion,
            provider,
            "grouper",
            system,
            user_message,
            max_tokens,
        )
        valid_ids = {p["paperId"] for p in batch}
        return _parse_batch_response(raw, valid_ids)

    results = await asyncio.gather(*(_run_batch(b) for b in batches))

    flat: list[dict] = []
    for batch_result in results:
        flat.extend(batch_result)

    # Stable sort by score desc — equal scores keep input order, which matches
    # the order the user already sees in their library.
    flat.sort(key=lambda r: r["score"], reverse=True)
    return {"recommendations": flat, "lowContext": low_context}
