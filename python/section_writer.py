"""Pure helpers for the section-writer feature: context assembly,
prompt construction, language detection, excerpt trimming, and
post-generation citation marker validation.

The functions here intentionally do no I/O — Convex calls and AI calls
live in ``convex_client.py`` and ``ai_client.py`` respectively. This
keeps the module trivially unit-testable and reusable from both the
``/clarify`` and ``/generate-section`` endpoints.
"""

from __future__ import annotations

import json
import re
from typing import Any

# Citation marker format used throughout the editor:
#   {{cite:PAPER_ID::direct|indirect::PAGE_REF}}
# We allow the ``via:`` secondary-source extension but never produce it
# from the writer — the writer cites only mapped papers directly.
_CITE_MARKER_RE = re.compile(
    r"\{\{cite:([^:}]+)::(direct|indirect)::([^}]*)\}\}"
)

# Floor for trusting heuristic language detection. Below this length the
# signal is too noisy and we fall back to the supplied default.
_MIN_DETECT_CHARS = 80

# A handful of high-frequency German stopwords that almost never appear
# in English. Combined with umlaut/ß detection this is more than enough
# to pick between "de" and "en".
_GERMAN_STOPWORDS = {
    "der", "die", "das", "und", "ist", "nicht", "ein", "eine", "mit",
    "auch", "von", "auf", "aber", "wenn", "noch", "schon", "über",
    "werden", "wird", "wurde", "sich", "dass", "weil", "durch",
}

# A small hard limit so a section with dozens of mapped papers can't
# blow past the model's context window. Excerpts beyond this count are
# trimmed by ``trim_excerpts_to_budget``.
_MAX_EXCERPTS_PER_PAPER = 8


# ---------------------------------------------------------------------------
# Language detection
# ---------------------------------------------------------------------------


def detect_language(body: str | None, fallback: str) -> str:
    """Pick "en" or "de" for prose generation.

    The signal we care about is binary (German or English), so a
    full-blown language identifier would be overkill and would add a
    dependency. Instead we look for two strong cues that almost never
    appear in English: German diacritics and a few very common
    stopwords. If neither hits — or the body is too short to trust —
    we return the supplied ``fallback`` (typically the thesis-level
    language hint from Convex).
    """
    if not body:
        return fallback

    cleaned = body.strip()
    if len(cleaned) < _MIN_DETECT_CHARS:
        return fallback

    lowered = cleaned.lower()
    if any(ch in lowered for ch in "äöüß"):
        return "de"

    tokens = re.findall(r"[a-zäöüß]+", lowered)
    if tokens:
        hits = sum(1 for t in tokens if t in _GERMAN_STOPWORDS)
        # 3 stopword hits in even a short body is a confident German signal.
        if hits >= 3:
            return "de"

    # No German cues found — assume English when the body is long enough
    # to trust, regardless of the supplied fallback.
    return "en"


# ---------------------------------------------------------------------------
# Excerpt budget trimming
# ---------------------------------------------------------------------------


def trim_excerpts_to_budget(payload: dict[str, Any]) -> dict[str, Any]:
    """Cap the number of excerpts per mapped paper.

    A section with 15 mapped papers and many excerpts each can easily
    exceed sane prompt sizes. Since the prompt asks the AI to pick the
    *most representative* evidence, dropping the lowest-signal excerpts
    is far better than truncating mid-prompt. Excerpts without a
    ``relevanceNote`` are dropped first; the remainder keep their
    original order.
    """
    matches = payload.get("matches") or []
    for match in matches:
        excerpts = match.get("excerpts") or []
        if len(excerpts) <= _MAX_EXCERPTS_PER_PAPER:
            continue
        # Stable-sort: items with a relevanceNote first; preserves
        # original ordering within each group.
        with_note = [e for e in excerpts if (e.get("relevanceNote") or "").strip()]
        without_note = [e for e in excerpts if not (e.get("relevanceNote") or "").strip()]
        kept = (with_note + without_note)[:_MAX_EXCERPTS_PER_PAPER]
        match["excerpts"] = kept
    return payload


# ---------------------------------------------------------------------------
# Context payload (light-touch normalisation of the Convex response)
# ---------------------------------------------------------------------------


def build_context_payload(convex_data: dict[str, Any]) -> dict[str, Any]:
    """Normalise the Convex ``getGenerationContext`` response.

    The Convex query already returns nearly the shape we want for the
    prompt — this function just trims excerpts to budget and decides
    the output language up front so both clarify and generate calls
    agree. Returning a fresh dict (vs. mutating the input) makes the
    function safe to chain.
    """
    payload = json.loads(json.dumps(convex_data))  # cheap deep copy
    payload = trim_excerpts_to_budget(payload)

    body = payload.get("body")
    fallback = payload.get("thesisLanguage") or "de"
    payload["resolvedLanguage"] = detect_language(body, fallback)
    return payload


# ---------------------------------------------------------------------------
# Prompt assembly
# ---------------------------------------------------------------------------


_LANG_NAMES = {"en": "English", "de": "German (Deutsch)"}


def _format_outline_block(payload: dict[str, Any]) -> str:
    """Render the section + parent + sibling titles as a compact tree."""
    lines: list[str] = []
    section = payload["section"]
    for parent in payload.get("parents", []):
        lines.append(f"  {parent['orderNumber']} {parent['title']}")
    lines.append(f"> {section['orderNumber']} {section['title']}  (this is the section to write)")
    for sibling in payload.get("siblings", []):
        lines.append(f"  {sibling['orderNumber']} {sibling['title']}")
    return "\n".join(lines)


def _format_papers_block(payload: dict[str, Any]) -> str:
    """Render mapped papers, summaries, and excerpts as the source corpus.

    Each paper is announced with its allowed ``paperId`` so the AI can
    only emit citation markers it has been told are valid. Excerpts are
    listed verbatim with their page numbers so direct citations stay
    grounded; the structured summary lets the AI form indirect
    citations for paraphrased claims.
    """
    matches = payload.get("matches") or []
    if not matches:
        return "(no mapped papers — generation should not be attempted)"

    blocks: list[str] = []
    for m in matches:
        kuerzel = m.get("kuerzel") or "(no Kürzel)"
        authors = ", ".join(m.get("authors") or []) or "(unknown author)"
        year = m.get("year") or "n.d."
        header = f"# Paper {m['paperId']} — {kuerzel} — {authors} ({year})"
        body_parts: list[str] = [header, f"Title: {m.get('title', '')}"]

        summary = m.get("summary") or {}
        if summary:
            body_parts.append("Summary:")
            if summary.get("researchQuestion"):
                body_parts.append(f"  Research question: {summary['researchQuestion']}")
            if summary.get("methodology"):
                body_parts.append(f"  Methodology: {summary['methodology']}")
            findings = summary.get("keyFindings") or []
            if findings:
                body_parts.append("  Key findings:")
                body_parts.extend(f"    - {f}" for f in findings)
            keywords = summary.get("keywords") or []
            if keywords:
                body_parts.append(f"  Keywords: {', '.join(keywords)}")

        excerpts = m.get("excerpts") or []
        if excerpts:
            body_parts.append("Excerpts (verbatim — usable for direct quotes):")
            for i, e in enumerate(excerpts, 1):
                page = e.get("pageNumber") or "?"
                note = (e.get("relevanceNote") or "").strip()
                body_parts.append(f"  [{i}] (p.{page}) {e.get('text', '').strip()}")
                if note:
                    body_parts.append(f"      relevance: {note}")
        blocks.append("\n".join(body_parts))

    return "\n\n".join(blocks)


def _format_allowed_paper_ids(payload: dict[str, Any]) -> str:
    """Comma-list of paperIds the AI may cite. Empty list means none."""
    ids = [m["paperId"] for m in (payload.get("matches") or [])]
    return ", ".join(ids) if ids else "(none)"


def _shared_context_block(payload: dict[str, Any], guidance: str | None,
                           answers: list[dict[str, str]] | None = None) -> str:
    """Common context blob used by both /clarify and /generate-section.

    Both endpoints need to reason over the same outline + papers. The
    only difference is the output contract appended after this block.
    """
    parts: list[str] = []
    section = payload["section"]
    parts.append("<section>")
    parts.append(f"orderNumber: {section['orderNumber']}")
    parts.append(f"title: {section['title']}")
    parts.append(f"depth: {section['depth']}")
    if section.get("notes"):
        parts.append(f"notes:\n{section['notes']}")
    parts.append("</section>")

    parts.append("<outline>")
    parts.append(_format_outline_block(payload))
    parts.append("</outline>")

    if guidance and guidance.strip():
        parts.append("<user_guidance>")
        parts.append(guidance.strip())
        parts.append("</user_guidance>")

    if answers:
        parts.append("<user_answers>")
        for a in answers:
            q = (a.get("question") or "").strip()
            ans = (a.get("answer") or "").strip()
            if q:
                parts.append(f"Q: {q}")
            if ans:
                parts.append(f"A: {ans}")
        parts.append("</user_answers>")

    parts.append("<allowed_paper_ids>")
    parts.append(_format_allowed_paper_ids(payload))
    parts.append("</allowed_paper_ids>")

    parts.append("<papers>")
    parts.append(_format_papers_block(payload))
    parts.append("</papers>")

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Clarify prompts
# ---------------------------------------------------------------------------


def build_clarify_messages(
    payload: dict[str, Any], guidance: str | None
) -> tuple[str, str]:
    """Return (system_prompt, user_message) for the clarify call.

    The clarify call is the cheap "should we ask the user something
    first?" decision. It returns strict JSON so the frontend can branch
    without any natural-language parsing.
    """
    lang = payload.get("resolvedLanguage") or "en"
    lang_name = _LANG_NAMES.get(lang, "English")
    system = (
        "You are an academic thesis advisor evaluating whether enough "
        "information exists to draft a single thesis section. You will be "
        "given the section's outline notes, neighbouring section titles, "
        "any user guidance, and the corpus of mapped papers (with summaries "
        "and verbatim excerpts) the section is allowed to cite.\n\n"
        "Decide whether to ask the user 1–4 short clarifying questions "
        "before writing. Ask only when the answer would meaningfully change "
        "the draft — e.g. when the outline notes are vague, when guidance "
        "contradicts the outline, when the excerpts pull in conflicting "
        "directions, or when scope vs. neighbouring sections is ambiguous.\n\n"
        "Do NOT ask questions that are already answered by the notes, the "
        "guidance, or the excerpts. Do NOT ask questions to fill stylistic "
        "preferences. If the context is sufficient, return "
        "needs_clarification: false.\n\n"
        f"Phrase any questions in {lang_name}.\n\n"
        "Output contract — return ONLY a single JSON object, no prose, no "
        "code fences. Schema:\n"
        '  {"needs_clarification": true, "questions": ["...", "..."]}\n'
        '  {"needs_clarification": false}'
    )
    user = _shared_context_block(payload, guidance, answers=None)
    return system, user


def parse_clarify_response(raw: str) -> dict[str, Any]:
    """Parse the strict-JSON clarify response. Tolerant of stray text.

    The model is asked for pure JSON, but real-world output occasionally
    leaks a leading "Here is" line or trailing prose. We grab the first
    ``{...}`` block we can find before falling back to a strict load.
    """
    text = (raw or "").strip()
    candidate = text
    # Greedy first-to-last brace — the response should contain exactly
    # one JSON object so this is safe.
    if "{" in text and "}" in text:
        candidate = text[text.index("{"): text.rindex("}") + 1]

    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        return {"needs_clarification": False}

    needs = bool(data.get("needs_clarification"))
    questions_raw = data.get("questions") or []
    questions = [str(q).strip() for q in questions_raw if str(q).strip()]
    if needs and not questions:
        # The model said "yes ask" but provided nothing — treat as no.
        return {"needs_clarification": False}
    return {
        "needs_clarification": needs,
        "questions": questions[:4] if needs else [],
    }


# ---------------------------------------------------------------------------
# Generation prompts
# ---------------------------------------------------------------------------


def _length_guidance(depth: int, lang: str) -> str:
    """Soft length window keyed off section depth.

    These are advisory ranges in the system prompt — the AI is told not
    to pad. depth 0–1 are chapter/major sections (longer); depth 2+ are
    subsections (shorter). The wording is lang-agnostic; it lives in
    the system prompt so the model always sees it.
    """
    if depth <= 1:
        target = "approximately 600–1200 words"
    else:
        target = "approximately 200–500 words"
    return f"Length: {target}. Do not pad to reach the upper bound."


def build_generation_messages(
    payload: dict[str, Any],
    guidance: str | None,
    answers: list[dict[str, str]] | None,
    cite_inline: bool = False,
) -> tuple[str, str]:
    """Build (system, user) for the streaming /generate-section call.

    ``cite_inline`` toggles between two modes:
      • ``False`` (default, two-pass): the writer produces clean prose
        only. Citations are added in a separate pass via the existing
        detect+validate pipeline. This gives each claim a chance to be
        scored against every candidate paper rather than committing to
        whichever paper the model was thinking about mid-sentence.
      • ``True``: legacy one-pass mode. The writer emits ``{{cite:...}}``
        markers inline as it writes. Kept for backwards compat / debug.
    """
    lang = payload.get("resolvedLanguage") or "en"
    lang_name = _LANG_NAMES.get(lang, "English")
    section = payload["section"]
    depth = int(section.get("depth", 0))

    system_lines: list[str] = []
    system_lines.append(
        "You are an academic writer drafting prose for a single section of "
        "a master's thesis. You will be given the section's outline notes, "
        "neighbouring section titles, optional user guidance, and a curated "
        "corpus of mapped papers (with summaries and verbatim excerpts) "
        "to ground your writing."
    )
    system_lines.append(
        f"\nWrite the section in {lang_name}. Use a formal academic register: "
        "no first person, no rhetorical questions, no filler ('In this "
        "section we will…'), no concluding meta-summary. Write in flowing "
        "paragraphs."
    )

    if cite_inline:
        system_lines.append(
            "\nCITATION CONTRACT — non-negotiable:\n"
            "  • You may ONLY cite paperIds listed in <allowed_paper_ids>. "
            "Citing any other paperId is forbidden.\n"
            "  • You may ONLY use page numbers that appear in the supplied "
            "excerpts for that paper. Do NOT invent page numbers.\n"
            "  • If a claim cannot be grounded in the supplied summary or "
            "excerpts, omit it or rephrase it as a non-claim. Do not "
            "fabricate supporting facts.\n"
            "  • Citation marker format is exactly:\n"
            "      {{cite:PAPER_ID::direct::p.42}}    for verbatim quotations\n"
            "      {{cite:PAPER_ID::indirect::p.42}}  for paraphrased claims\n"
            "    Use 'direct' only when the prose is a verbatim excerpt; use "
            "'indirect' for paraphrases drawn from the summary or excerpts. "
            "If no precise page is available, use 'p. ?' as the page reference."
        )
    else:
        # Two-pass mode: prose only. The detect+validate phase that runs
        # after this stream is responsible for matching each claim to the
        # best-fitting paper, scored against every candidate.
        system_lines.append(
            "\nWRITING CONTRACT — non-negotiable:\n"
            "  • Write CLEAN PROSE ONLY. Do NOT produce any citation "
            "markers — no `{{cite:...}}`, no `(Author, Year)`, no footnote "
            "numbers, no bracketed references of any kind. Citations are "
            "added in a separate pass after this draft is complete.\n"
            "  • Ground every claim in the supplied summaries and excerpts. "
            "If a claim cannot be grounded, omit it or rephrase it as a "
            "non-claim. Do not fabricate supporting facts.\n"
            "  • Stay close to the topics, methodologies, and findings the "
            "supplied papers actually cover — the citation pass can only "
            "attach a paper to a claim that paper plausibly supports."
        )

    system_lines.append(f"\n{_length_guidance(depth, lang)}")

    if cite_inline:
        system_lines.append(
            "\nOutput contract: return only the prose for this section. No "
            "preamble, no leading heading, no trailing summary, no JSON, no "
            "code fences. Citation markers appear inline within the prose."
        )
    else:
        system_lines.append(
            "\nOutput contract: return only the prose for this section. No "
            "preamble, no leading heading, no trailing summary, no JSON, no "
            "code fences, no citations of any kind."
        )

    system = "\n".join(system_lines)
    user = _shared_context_block(payload, guidance, answers)
    return system, user


# ---------------------------------------------------------------------------
# Citation marker validation
# ---------------------------------------------------------------------------


def validate_citation_markers(
    text: str,
    allowed_paper_ids: list[str],
    allowed_pages_by_paper: dict[str, set[str]] | None = None,
) -> tuple[str, list[str]]:
    """Strip any citation markers the AI shouldn't have produced.

    The system prompt forbids invented paperIds and page numbers, but
    LLMs occasionally hallucinate anyway. After streaming completes we
    sweep the text and remove any ``{{cite:…}}`` whose paperId isn't in
    the allowed list. We do NOT block the insert on this — instead we
    surface a warning so the user can re-roll if they care.

    Page-number validation is intentionally soft: many real citations
    use ranges, "S. ?", or PDF-page approximations that wouldn't match
    string-equal against the supplied excerpts. Surface a warning, but
    do not strip purely on a page mismatch.
    """
    allowed = set(allowed_paper_ids)
    warnings: list[str] = []

    def _replace(match: re.Match[str]) -> str:
        paper_id = match.group(1)
        kind = match.group(2)
        page = match.group(3).strip()
        if paper_id not in allowed:
            warnings.append(
                f"Removed citation to unknown paperId '{paper_id}'."
            )
            return ""
        if allowed_pages_by_paper is not None:
            pages = allowed_pages_by_paper.get(paper_id) or set()
            if pages and page and page not in pages and not _looks_unverifiable(page):
                # Soft warn only — keep the marker; the editor displays
                # the page string verbatim and the user can fix it.
                warnings.append(
                    f"Citation for paperId '{paper_id}' references page "
                    f"'{page}' which does not appear in supplied excerpts."
                )
        # Re-emit the marker normalised to single spaces inside the page slot.
        return f"{{{{cite:{paper_id}::{kind}::{page}}}}}"

    cleaned = _CITE_MARKER_RE.sub(_replace, text)
    return cleaned, warnings


def strip_all_citation_markers(text: str) -> tuple[str, int]:
    """Scrub every ``{{cite:...}}`` marker from text.

    Used in two-pass mode: even though the prompt forbids citations,
    LLMs occasionally leak them. We strip silently and return a count
    so the caller can log a soft warning if the leakage was material.
    """
    count = 0

    def _drop(_match: re.Match[str]) -> str:
        nonlocal count
        count += 1
        return ""

    cleaned = _CITE_MARKER_RE.sub(_drop, text)
    return cleaned, count


def _looks_unverifiable(page: str) -> bool:
    """Page strings we should never warn on (placeholders / unknown)."""
    return page in {"?", "p. ?", "S. ?"} or page == ""


def collect_allowed_pages_by_paper(payload: dict[str, Any]) -> dict[str, set[str]]:
    """Build the lookup the validator needs from the context payload.

    Excerpts can have a ``pageNumber`` of ``None``; those papers contribute
    an empty set, which the validator interprets as "do not check pages."
    """
    out: dict[str, set[str]] = {}
    for m in payload.get("matches") or []:
        pages: set[str] = set()
        for e in m.get("excerpts") or []:
            p = e.get("pageNumber")
            if p:
                pages.add(str(p))
        out[m["paperId"]] = pages
    return out


# ---------------------------------------------------------------------------
# Auto-citation: detect phase
# ---------------------------------------------------------------------------
#
# The detect phase scans an already-written section body and asks the model
# to mark sentences that need citations. Each entry references one or more
# *suggested* paperIds from the section's match list — the validate phase
# downstream is responsible for actually scoring each candidate. We keep the
# two phases separate so the user can review / dismiss placeholders before
# spending tokens on validation.

# Soft cap on how many detection results we accept from one call. Sections
# with more than ~200 claims are pathological and almost certainly indicate
# the model misread the prompt and emitted noise.
_MAX_DETECT_ITEMS = 200

# Soft cap on body length per LLM round-trip. Beyond this we paragraph-chunk
# the body so each call stays inside a comfortable context window. Tuned for
# Anthropic / OpenAI standard tier (≈10k tokens of body alone leaves room for
# the corpus block).
_DETECT_BODY_CHAR_BUDGET = 40_000

# Allowed claim_type values. The model is told to use these exactly; anything
# else is normalised to "general" so the frontend has a safe enum to switch on.
_DETECT_CLAIM_TYPES = {"empirical", "theoretical", "data", "general"}


def build_detect_messages(
    payload: dict[str, Any], body: str
) -> tuple[str, str]:
    """Return ``(system, user)`` for a /detect-citations call.

    The user prompt reuses ``_shared_context_block`` so the model sees the
    same outline + papers + allowed_paper_ids it sees during /generate.
    The draft body is added in its own ``<draft>`` block. The system prompt
    asks for strict JSON so the response can be parsed without natural-
    language heuristics.
    """
    lang = payload.get("resolvedLanguage") or "en"
    lang_name = _LANG_NAMES.get(lang, "English")

    system = (
        "You are an academic citation auditor. Given a draft section of a "
        "master's thesis and the curated corpus of papers it is allowed to "
        "cite, your job is to identify each sentence in the draft that "
        "would benefit from an academic citation and propose which mapped "
        "papers could support it.\n\n"
        "Walk the draft paragraph by paragraph. Mark a sentence ONLY when "
        "it makes a verifiable claim:\n"
        "  • empirical — a specific number, study result, or measurement\n"
        "  • data — a dataset reference or quantitative observation\n"
        "  • theoretical — a definition, framework, or established model\n"
        "  • general — any other factual claim that needs grounding\n\n"
        "Do NOT mark transitional sentences, summaries of your own argument, "
        "definitions you have just introduced, or stylistic flourishes. "
        "Skip sentences that already contain a {{cite:...}} marker.\n\n"
        "You may ONLY suggest paperIds listed in <allowed_paper_ids>. "
        "Suggest 1–3 paperIds per claim, ranked by which is most likely "
        "to support that exact claim based on the supplied summary and "
        "excerpts. If no paper plausibly supports the claim, omit it.\n\n"
        f"Phrase the `reason` field in {lang_name}.\n\n"
        "Output contract — return ONLY a single JSON object, no prose, no "
        "code fences. Schema:\n"
        '  {"items": [\n'
        '    {"claim_sentence": "<exact sentence from the draft, verbatim>",\n'
        '     "claim_type": "empirical" | "theoretical" | "data" | "general",\n'
        '     "suggested_paper_ids": ["<paperId>", ...],\n'
        '     "reason": "<one short sentence>"}\n'
        '  ]}\n\n'
        "The `claim_sentence` MUST be a verbatim substring of the draft so "
        "the frontend can locate it exactly. Do not paraphrase, do not add "
        "ellipses, do not strip whitespace. If a claim spans multiple "
        "sentences, choose the one whose end is the natural insertion point "
        "for the citation."
    )

    base_context = _shared_context_block(payload, guidance=None, answers=None)
    user_lines = [base_context, "", "<draft>", body, "</draft>"]
    return system, "\n".join(user_lines)


def parse_detect_response(
    raw: str, allowed_paper_ids: list[str]
) -> dict[str, Any]:
    """Parse a /detect-citations response into ``{"items": [...], "warnings": [...]}``.

    Tolerates leading/trailing prose around the JSON object (the model
    occasionally adds a "Here is the analysis:" preamble despite the
    contract). Filters entries whose ``suggested_paper_ids`` are entirely
    outside ``allowed_paper_ids``, drops entries with empty
    ``claim_sentence``, normalises ``claim_type`` against the enum, and
    caps the result at ``_MAX_DETECT_ITEMS``.
    """
    text = (raw or "").strip()
    candidate = text
    if "{" in text and "}" in text:
        candidate = text[text.index("{"): text.rindex("}") + 1]

    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        return {"items": [], "warnings": ["Model returned non-JSON response"]}

    raw_items = data.get("items") or []
    if not isinstance(raw_items, list):
        return {"items": [], "warnings": ["`items` was not a list"]}

    allowed = set(allowed_paper_ids)
    items: list[dict[str, Any]] = []
    warnings: list[str] = []
    dropped_unknown = 0
    dropped_empty = 0

    for entry in raw_items:
        if not isinstance(entry, dict):
            continue

        claim = str(entry.get("claim_sentence") or "").strip()
        if not claim:
            dropped_empty += 1
            continue

        suggested = entry.get("suggested_paper_ids") or []
        if not isinstance(suggested, list):
            suggested = []
        # Filter to allowed ids while preserving model order.
        filtered: list[str] = []
        for pid in suggested:
            pid_str = str(pid)
            if pid_str in allowed and pid_str not in filtered:
                filtered.append(pid_str)
        if not filtered:
            dropped_unknown += 1
            continue

        claim_type = str(entry.get("claim_type") or "").strip().lower()
        if claim_type not in _DETECT_CLAIM_TYPES:
            claim_type = "general"

        reason = str(entry.get("reason") or "").strip()

        items.append({
            "claim_sentence": claim,
            "claim_type": claim_type,
            "suggested_paper_ids": filtered,
            "reason": reason,
        })

        if len(items) >= _MAX_DETECT_ITEMS:
            break

    if dropped_unknown:
        warnings.append(
            f"Dropped {dropped_unknown} entries whose suggested paperIds "
            "were not in the section match list."
        )
    if dropped_empty:
        warnings.append(
            f"Dropped {dropped_empty} entries with empty claim_sentence."
        )
    if len(raw_items) > _MAX_DETECT_ITEMS:
        warnings.append(
            f"Capped result at {_MAX_DETECT_ITEMS} items "
            f"(model returned {len(raw_items)})."
        )

    return {"items": items, "warnings": warnings}


def chunk_body_for_detection(body: str) -> list[str]:
    """Split ``body`` into paragraph-aligned chunks under the char budget.

    Keeps paragraphs whole — splitting mid-paragraph would hurt the
    model's ability to identify claim sentences. When a single paragraph
    exceeds the budget on its own (rare in thesis prose), it is included
    as its own chunk; the LLM call will fail loudly rather than silently
    truncating evidence.
    """
    if len(body) <= _DETECT_BODY_CHAR_BUDGET:
        return [body]

    paragraphs = body.split("\n\n")
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for p in paragraphs:
        p_len = len(p) + 2  # account for the joining "\n\n"
        if current_len + p_len > _DETECT_BODY_CHAR_BUDGET and current:
            chunks.append("\n\n".join(current))
            current = [p]
            current_len = p_len
        else:
            current.append(p)
            current_len += p_len
    if current:
        chunks.append("\n\n".join(current))
    return chunks


# ---------------------------------------------------------------------------
# Auto-citation: validate phase
# ---------------------------------------------------------------------------
#
# The validate phase takes a list of placeholders the user has chosen to
# resolve and scores each candidate paperId against the underlying claim.
# The frontend then promotes high-confidence resolutions to real
# {{cite:...}} markers and creates section TODOs for the rest.

# Cap on items per LLM round-trip. Larger batches degrade ranking quality
# because the model must hold many independent claims in working memory at
# once. The endpoint chunks above this and merges results.
_MAX_VALIDATE_ITEMS_PER_CALL = 25

# Score floor for clamping out unparseable / negative scores. Anything lower
# is treated as 0; the frontend's ≥0.75 threshold then trivially rejects them.
_MIN_VALIDATE_SCORE = 0.0
_MAX_VALIDATE_SCORE = 1.0


def build_validate_messages(
    payload: dict[str, Any],
    items: list[dict[str, Any]],
) -> tuple[str, str]:
    """Return ``(system, user)`` for a /validate-citations call.

    Each item supplies ``placeholder_id``, ``claim_sentence``, and
    ``candidate_paper_ids``. The model is asked to score every candidate
    using the supplied excerpts and pick a page reference verbatim from
    the excerpts (so the result clamps cleanly against
    ``collect_allowed_pages_by_paper``).
    """
    lang = payload.get("resolvedLanguage") or "en"
    lang_name = _LANG_NAMES.get(lang, "English")

    system = (
        "You are an academic citation validator. For each claim sentence "
        "you receive, you will be given one or more candidate paperIds "
        "from a curated corpus. Score how strongly each candidate paper "
        "actually supports the claim, using the supplied summary and "
        "excerpts as the only source of truth.\n\n"
        "Scoring rubric (return a number in [0,1]):\n"
        "  ≥ 0.85 — an excerpt directly states the claim or its core fact\n"
        "  0.65–0.84 — the paper covers the topic and the summary or "
        "an excerpt clearly implies the claim\n"
        "  0.40–0.64 — the paper is topically adjacent but does not "
        "establish the claim\n"
        "  < 0.40 — wrong topic, wrong methodology, or no support\n\n"
        "For ``page_ref_from_excerpt`` use the page number of the excerpt "
        "you relied on, formatted as it appears in the excerpt (e.g. "
        "\"S. 14\" or \"p. 42\"). If no excerpt has a page number, return "
        "\"S. ?\". Never invent page numbers.\n\n"
        f"Phrase the `justification` field in {lang_name}, one short "
        "sentence per candidate.\n\n"
        "Output contract — return ONLY a single JSON object, no prose, no "
        "code fences. Schema:\n"
        '  {"results": [\n'
        '    {"placeholder_id": "<id>",\n'
        '     "candidates": [\n'
        '       {"paper_id": "<paperId>",\n'
        '        "score": 0.82,\n'
        '        "page_ref_from_excerpt": "S. 14",\n'
        '        "justification": "<one short sentence>"}\n'
        '     ]}\n'
        '  ]}\n\n'
        "Return one entry per input placeholder, even when no candidate "
        "scores above the floor — let the consumer filter."
    )

    context = _shared_context_block(payload, guidance=None, answers=None)
    items_block_lines: list[str] = ["<placeholders>"]
    for item in items:
        pid = item.get("placeholder_id", "")
        claim = item.get("claim_sentence", "")
        cands = item.get("candidate_paper_ids") or []
        items_block_lines.append(f"- placeholder_id: {pid}")
        items_block_lines.append(f"  claim_sentence: {claim}")
        items_block_lines.append(
            "  candidates: " + (", ".join(cands) if cands else "(none)")
        )
    items_block_lines.append("</placeholders>")

    user = "\n".join([context, "", "\n".join(items_block_lines)])
    return system, user


def parse_validate_response(
    raw: str,
    allowed_paper_ids: list[str],
    allowed_pages_by_paper: dict[str, set[str]] | None = None,
) -> dict[str, Any]:
    """Parse a /validate-citations response into ``{"results": [...]}``.

    Drops candidates whose ``paper_id`` isn't in ``allowed_paper_ids``,
    clamps ``score`` to [0,1], and clamps ``page_ref_from_excerpt`` to
    the per-paper allowed set when provided. Out-of-set page refs are
    forced to ``"S. ?"`` rather than dropped — this matches the
    permissive policy of ``validate_citation_markers``.
    """
    text = (raw or "").strip()
    candidate = text
    if "{" in text and "}" in text:
        candidate = text[text.index("{"): text.rindex("}") + 1]

    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        return {"results": []}

    raw_results = data.get("results") or []
    if not isinstance(raw_results, list):
        return {"results": []}

    allowed = set(allowed_paper_ids)
    out: list[dict[str, Any]] = []

    for entry in raw_results:
        if not isinstance(entry, dict):
            continue
        pid = str(entry.get("placeholder_id") or "").strip()
        if not pid:
            continue
        cands_raw = entry.get("candidates") or []
        if not isinstance(cands_raw, list):
            cands_raw = []

        cands: list[dict[str, Any]] = []
        for c in cands_raw:
            if not isinstance(c, dict):
                continue
            paper_id = str(c.get("paper_id") or "").strip()
            if paper_id not in allowed:
                continue

            try:
                score = float(c.get("score", 0.0))
            except (TypeError, ValueError):
                score = 0.0
            score = max(_MIN_VALIDATE_SCORE, min(_MAX_VALIDATE_SCORE, score))

            page = str(c.get("page_ref_from_excerpt") or "").strip()
            if allowed_pages_by_paper is not None:
                pages = allowed_pages_by_paper.get(paper_id) or set()
                if pages and page and not _page_ref_matches(page, pages):
                    page = "S. ?"
            if not page:
                page = "S. ?"

            justification = str(c.get("justification") or "").strip()

            cands.append({
                "paper_id": paper_id,
                "score": score,
                "page_ref_from_excerpt": page,
                "justification": justification,
            })

        # Sort candidates highest-score-first so the frontend can simply
        # promote `candidates[0]` when the score clears the threshold.
        cands.sort(key=lambda c: c["score"], reverse=True)
        out.append({"placeholder_id": pid, "candidates": cands})

    return {"results": out}


def _page_ref_matches(page: str, allowed_pages: set[str]) -> bool:
    """Loose comparison between a page string and the allowed set.

    Accepts exact match, substring match against any allowed page (so
    "S. 14" matches "14"), and the placeholder forms ``?`` / ``S. ?``.
    Lets the model use either the verbatim "S. 14" form from the
    excerpt or the bare numeric page interchangeably.
    """
    if _looks_unverifiable(page):
        return True
    page_norm = page.strip()
    page_digits = re.sub(r"[^\d-]", "", page_norm)
    for ap in allowed_pages:
        ap_norm = ap.strip()
        if page_norm == ap_norm:
            return True
        ap_digits = re.sub(r"[^\d-]", "", ap_norm)
        if page_digits and ap_digits and page_digits == ap_digits:
            return True
    return False


def chunk_validate_items(items: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Split ``items`` into batches under ``_MAX_VALIDATE_ITEMS_PER_CALL``."""
    if len(items) <= _MAX_VALIDATE_ITEMS_PER_CALL:
        return [items]
    return [
        items[i : i + _MAX_VALIDATE_ITEMS_PER_CALL]
        for i in range(0, len(items), _MAX_VALIDATE_ITEMS_PER_CALL)
    ]
