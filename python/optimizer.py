"""AI-powered text optimization for thesis writing.

Provides four modes — enhance, formalize, simplify, expand — that rewrite
selected text while preserving [REFN] citation placeholders.
"""

from ai_client import chat_completion
from pipeline_logger import get_logger

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


def _build_system_prompt(
    mode: str, language: str = "en", custom_prompt: str | None = None
) -> str:
    """Build the system prompt for a given optimization mode.

    When custom_prompt is provided it replaces the hardcoded mode instruction,
    but citation-preservation, language, and output-format rules are always
    appended regardless.
    """
    lang_name = LANGUAGE_NAMES.get(language, "English")
    base = custom_prompt if custom_prompt else MODE_INSTRUCTIONS[mode]

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
    provider: str = "openai",
    custom_prompt: str | None = None,
) -> str:
    """Optimize text using the specified mode.

    Args:
        text: The selected text to optimize (may contain [REFN] placeholders).
        mode: One of 'enhance', 'formalize', 'simplify', 'expand'.
        context_before: Surrounding text before the selection for flow context.
        context_after: Surrounding text after the selection for flow context.
        language: Language code (e.g., 'en', 'de').
        custom_prompt: Optional user-provided mode instruction that replaces
            the hardcoded default. Citation/language/format rules are still
            appended automatically.

    Returns:
        The optimized text string.

    Raises:
        ValueError: If mode is not one of the valid modes.
    """
    logger = get_logger()

    if mode not in VALID_MODES:
        raise ValueError(f"Invalid mode '{mode}'. Must be one of: {VALID_MODES}")

    if custom_prompt and len(custom_prompt) > 2000:
        raise ValueError("Custom prompt exceeds 2000 character limit")

    system_prompt = _build_system_prompt(mode, language, custom_prompt=custom_prompt)

    # Build user message with optional context
    parts = []
    if context_before:
        parts.append(f'Context before: """{context_before}"""')
    parts.append(f'Text to optimize: """{text}"""')
    if context_after:
        parts.append(f'Context after: """{context_after}"""')
    parts.append("Return ONLY the optimized text. No explanations, no quotes, no markdown.")
    user_message = "\n\n".join(parts)

    result = chat_completion(
        provider=provider,
        module="optimizer",
        system=system_prompt,
        user_message=user_message,
        max_tokens=2048,
    )
    logger.info(
        f"Optimize ({mode}): input={len(text)} chars, output={len(result)} chars",
        extra={"step": "optimize", "mode": mode},
    )
    return result
