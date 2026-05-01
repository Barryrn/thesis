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
) -> tuple[str, str]:
    """Build (system, user) for the streaming /generate-section call."""
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
        "that this section is allowed to cite."
    )
    system_lines.append(
        f"\nWrite the section in {lang_name}. Use a formal academic register: "
        "no first person, no rhetorical questions, no filler ('In this "
        "section we will…'), no concluding meta-summary. Write in flowing "
        "paragraphs."
    )
    system_lines.append(
        "\nCITATION CONTRACT — non-negotiable:\n"
        "  • You may ONLY cite paperIds listed in <allowed_paper_ids>. "
        "Citing any other paperId is forbidden.\n"
        "  • You may ONLY use page numbers that appear in the supplied "
        "excerpts for that paper. Do NOT invent page numbers.\n"
        "  • If a claim cannot be grounded in the supplied summary or "
        "excerpts, omit it or rephrase it as a non-claim. Do not fabricate "
        "supporting facts.\n"
        "  • Citation marker format is exactly:\n"
        "      {{cite:PAPER_ID::direct::p.42}}    for verbatim quotations\n"
        "      {{cite:PAPER_ID::indirect::p.42}}  for paraphrased claims\n"
        "    Use 'direct' only when the prose is a verbatim excerpt; use "
        "'indirect' for paraphrases drawn from the summary or excerpts. "
        "If no precise page is available, use 'p. ?' as the page reference."
    )
    system_lines.append(f"\n{_length_guidance(depth, lang)}")
    system_lines.append(
        "\nOutput contract: return only the prose for this section. No "
        "preamble, no leading heading, no trailing summary, no JSON, no "
        "code fences. Citation markers appear inline within the prose."
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
