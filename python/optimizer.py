"""AI-powered text optimization for thesis writing.

Provides four modes — enhance, formalize, simplify, expand — that rewrite
selected text while preserving [REFN] citation placeholders.
"""

import os
import time

from dotenv import load_dotenv
from openai import OpenAI

from pipeline_logger import get_logger, log_openai_call, log_openai_response

load_dotenv()

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
MODEL = "gpt-4o"

VALID_MODES = {"enhance", "formalize", "simplify", "expand"}

LANGUAGE_NAMES = {"en": "English", "de": "German (Deutsch)"}

MODE_INSTRUCTIONS = {
    "enhance": (
        "Improve the clarity, flow, and word choice of the following text. "
        "Keep the same meaning, tone, and approximate length."
    ),
    "formalize": (
        "Rewrite the following text in formal academic tone suitable for a thesis. "
        "Keep the same meaning. Use scholarly vocabulary and sentence structure."
    ),
    "simplify": (
        "Simplify the following text for clearer, more concise reading. "
        "Remove unnecessary complexity while keeping the same meaning."
    ),
    "expand": (
        "Expand the following text with more detail, depth, and supporting explanation. "
        "Elaborate on the ideas while maintaining the original meaning and direction."
    ),
}


def _build_system_prompt(mode: str, language: str = "en") -> str:
    """Build the system prompt for a given optimization mode."""
    lang_name = LANGUAGE_NAMES.get(language, "English")
    base = MODE_INSTRUCTIONS[mode]

    ref_instruction = (
        "\n\nCRITICAL: The text may contain citation placeholders like [REF1], [REF2], etc. "
        "You MUST preserve every [REFN] marker EXACTLY as it appears — same spelling, same position "
        "relative to the surrounding text. Do NOT remove, rename, reorder, or merge any [REFN] markers."
    )

    lang_line = ""
    if language != "en" and language in LANGUAGE_NAMES:
        lang_line = (
            f"\n\nCRITICAL LANGUAGE REQUIREMENT: You MUST write the output in {lang_name}. "
            f"Do NOT write in English."
        )

    output_instruction = "\n\nReturn ONLY the optimized text. No explanations, no quotes, no markdown formatting."

    return base + ref_instruction + lang_line + output_instruction


def optimize(
    text: str,
    mode: str,
    context_before: str = "",
    context_after: str = "",
    language: str = "en",
) -> str:
    """Optimize text using the specified mode.

    Args:
        text: The selected text to optimize (may contain [REFN] placeholders).
        mode: One of 'enhance', 'formalize', 'simplify', 'expand'.
        context_before: Surrounding text before the selection for flow context.
        context_after: Surrounding text after the selection for flow context.
        language: Language code (e.g., 'en', 'de').

    Returns:
        The optimized text string.

    Raises:
        ValueError: If mode is not one of the valid modes.
    """
    logger = get_logger()

    if mode not in VALID_MODES:
        raise ValueError(f"Invalid mode '{mode}'. Must be one of: {VALID_MODES}")

    system_prompt = _build_system_prompt(mode, language)

    # Build user message with optional context
    parts = []
    if context_before:
        parts.append(f'Context before: """{context_before}"""')
    parts.append(f'Text to optimize: """{text}"""')
    if context_after:
        parts.append(f'Context after: """{context_after}"""')
    parts.append("Return ONLY the optimized text. No explanations, no quotes, no markdown.")
    user_message = "\n\n".join(parts)

    log_openai_call(MODEL, 2048, len(user_message))

    t0 = time.monotonic()
    try:
        response = client.chat.completions.create(
            model=MODEL,
            max_tokens=2048,
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

    result = response.choices[0].message.content.strip()
    logger.info(
        f"Optimize ({mode}): input={len(text)} chars, output={len(result)} chars",
        extra={"step": "optimize", "mode": mode},
    )
    return result
