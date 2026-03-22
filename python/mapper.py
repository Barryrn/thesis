import json
import os
import time
from openai import OpenAI
from dotenv import load_dotenv

from pipeline_logger import get_logger, log_openai_call, log_openai_response

load_dotenv()

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
MODEL = "gpt-4o"

MAX_TEXT_CHARS = 30_000

LANGUAGE_NAMES = {"en": "English", "de": "German (Deutsch)"}


def _build_score_prompt(language: str = "en") -> str:
    lang_name = LANGUAGE_NAMES.get(language, "English")
    relevance_note_lang = (
        f" The relevanceNote MUST be written in {lang_name} — do NOT write relevance notes in English."
        if language != "en"
        else ""
    )
    return f"""You are mapping a research paper to thesis outline sections.
For each section:
1. Score from 0.0 to 1.0 based on relevance to the paper. Be strict: only score above 0.5 if the paper clearly belongs in that section.
2. For sections scored >= 0.4, extract 1-3 verbatim excerpts (exact quotes) from the paper text that support the assignment. Each excerpt should be 1-3 sentences. Also provide a brief relevance note explaining why this excerpt supports the section.{relevance_note_lang}

Some sections may include guidance notes (shown after the title in parentheses). These notes describe what content belongs in that section or which aspects are particularly important. Use these notes to improve your scoring accuracy — they represent the author's intent for what each section should contain.

The paper text contains markers like "--- PAGE N ---" that indicate page boundaries. For each excerpt, identify the page it appears on and include it as "pageNumber" (e.g. "42"). If you cannot determine the page, omit "pageNumber".

Return a JSON array only. No markdown, no explanation.
Format:
[
  {{
    "sectionId": "<the exact id value provided for the section>",
    "score": <float>,
    "excerpts": [
      {{
        "text": "<verbatim quote from paper>",
        "relevanceNote": "<1-sentence explanation{' in ' + lang_name if language != 'en' else ''}>",
        "pageNumber": "<page number as a string, e.g. \\"42\\">"
      }}
    ]
  }}
]

Rules:
- Include every section in the response, even if score is 0.0.
- The sectionId MUST be the exact id string provided in the section list (e.g. "j5799ceg..."). Do NOT use the order number.
- Sections with score < 0.4 should have an empty excerpts array.
- Excerpts MUST be exact quotes from the paper text provided. Do not paraphrase.
- Maximum 3 excerpts per section.
- Each excerpt text should be 1-3 complete sentences.
- Do NOT include "--- PAGE N ---" markers in the excerpt text itself."""


def score_sections(
    summary: dict, sections: list[dict], paper_text: str = "", language: str = "en"
) -> list[dict]:
    """Score thesis sections against a paper and extract supporting excerpts."""
    # Build a lookup from orderNumber to _id for fallback resolution
    order_to_id = {s["orderNumber"]: s["_id"] for s in sections}

    def _format_section(i: int, s: dict) -> str:
        line = f'{i + 1}. [id={s["_id"]}] [{s["orderNumber"]}] {s["title"]}'
        notes = s.get("notes", "").strip()
        if notes:
            line += f" (Notes: {notes})"
        return line

    numbered = "\n".join(
        _format_section(i, s) for i, s in enumerate(sections)
    )

    user_message = (
        f"Paper summary:\n{json.dumps(summary, indent=2)}\n\n"
        f"Sections to score:\n{numbered}"
    )

    if paper_text:
        truncated = paper_text[:MAX_TEXT_CHARS]
        user_message += f"\n\nPaper full text (for excerpt extraction):\n{truncated}"

    system_prompt = _build_score_prompt(language)
    logger = get_logger()

    log_openai_call(MODEL, 8192, len(user_message))
    logger.info(f"Scoring {len(sections)} sections against paper", extra={"step": "score_sections"})

    t0 = time.monotonic()
    try:
        response = client.chat.completions.create(
            model=MODEL,
            max_tokens=8192,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
        )
        elapsed = round((time.monotonic() - t0) * 1000, 1)
        log_openai_response(MODEL, elapsed, success=True)
    except Exception as e:
        elapsed = round((time.monotonic() - t0) * 1000, 1)
        log_openai_response(MODEL, elapsed, success=False, error=str(e))
        raise

    raw = response.choices[0].message.content.strip()
    # Strip markdown fences GPT sometimes adds
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
    if raw.endswith("```"):
        raw = raw[:-3]
    raw = raw.strip()
    scores = json.loads(raw)

    if not isinstance(scores, list):
        raise ValueError("Expected a JSON array of scores")

    valid_ids = {s["_id"] for s in sections}

    for item in scores:
        if "sectionId" not in item or "score" not in item:
            raise ValueError(f"Invalid score entry: {item}")

        # Resolve sectionId: GPT might return orderNumber instead of _id
        sid = item["sectionId"]
        if sid not in valid_ids and sid in order_to_id:
            item["sectionId"] = order_to_id[sid]

        item["score"] = max(0.0, min(1.0, float(item["score"])))
        # Validate excerpts, default to empty array
        if "excerpts" not in item:
            item["excerpts"] = []
        validated_excerpts = []
        for exc in item["excerpts"]:
            if isinstance(exc, dict) and "text" in exc and "relevanceNote" in exc:
                validated_excerpts.append({
                    "text": exc["text"],
                    "relevanceNote": exc["relevanceNote"],
                    "pageNumber": exc.get("pageNumber"),
                })
        item["excerpts"] = validated_excerpts

    # Filter out entries with unresolvable sectionIds
    scores = [s for s in scores if s["sectionId"] in valid_ids]

    logger.debug(f"Mapper returned {len(scores)} scored sections", extra={"step": "score_sections"})

    return scores
