"""Unified AI provider abstraction for OpenAI and Anthropic.

Provides a single `chat_completion` function that routes to the correct
provider SDK based on a provider string, with lazy client initialization
so a missing API key for an unused provider won't crash at startup.
"""

import os
import time

from dotenv import load_dotenv

from pipeline_logger import get_logger, log_ai_call, log_ai_response

load_dotenv()

# ---------------------------------------------------------------------------
# Model mapping: (provider, module) -> model ID
# ---------------------------------------------------------------------------

PROVIDER_MODELS: dict[tuple[str, str], str] = {
    ("openai", "mapper"): "gpt-4o",
    ("openai", "summarizer"): "gpt-4o",
    ("openai", "optimizer"): "gpt-4o",
    ("openai", "extractor"): "gpt-4o-mini",
    ("anthropic", "mapper"): "claude-sonnet-4-20250514",
    ("anthropic", "summarizer"): "claude-sonnet-4-20250514",
    ("anthropic", "optimizer"): "claude-sonnet-4-20250514",
    ("anthropic", "extractor"): "claude-haiku-4-5-20251001",
}

VALID_PROVIDERS = {"openai", "anthropic"}

# ---------------------------------------------------------------------------
# Lazy client singletons
# ---------------------------------------------------------------------------

_openai_client = None
_anthropic_client = None


def _get_openai():
    """Return a lazily-initialized OpenAI client."""
    global _openai_client
    if _openai_client is None:
        from openai import OpenAI
        _openai_client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _openai_client


def _get_anthropic():
    """Return a lazily-initialized Anthropic client."""
    global _anthropic_client
    if _anthropic_client is None:
        from anthropic import Anthropic
        _anthropic_client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _anthropic_client


# ---------------------------------------------------------------------------
# Fence stripping — both providers occasionally wrap JSON in markdown fences
# ---------------------------------------------------------------------------

def _strip_fences(text: str) -> str:
    """Remove markdown code fences that LLMs sometimes add around JSON."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def chat_completion(
    provider: str,
    module: str,
    system: str,
    user_message: str,
    max_tokens: int,
) -> str:
    """Send a chat completion request to the chosen AI provider.

    Args:
        provider: "openai" or "anthropic".
        module: Caller module name (e.g. "mapper") — used to look up the model.
        system: System prompt text.
        user_message: User message text.
        max_tokens: Maximum tokens in the response.

    Returns:
        The model's text response, with markdown fences stripped.

    Raises:
        ValueError: If provider or module is unknown.
        KeyError: If the required API key env var is missing.
    """
    if provider not in VALID_PROVIDERS:
        raise ValueError(f"Unknown provider '{provider}'. Must be one of: {VALID_PROVIDERS}")

    model_key = (provider, module)
    if model_key not in PROVIDER_MODELS:
        raise ValueError(f"No model configured for provider='{provider}', module='{module}'")

    model = PROVIDER_MODELS[model_key]
    logger = get_logger()
    log_ai_call(provider, model, max_tokens, len(user_message))

    t0 = time.monotonic()
    try:
        if provider == "openai":
            raw = _call_openai(model, system, user_message, max_tokens)
        else:
            raw = _call_anthropic(model, system, user_message, max_tokens)

        elapsed = round((time.monotonic() - t0) * 1000, 1)
        log_ai_response(provider, model, elapsed, success=True)
    except Exception as e:
        elapsed = round((time.monotonic() - t0) * 1000, 1)
        log_ai_response(provider, model, elapsed, success=False, error=str(e))
        raise

    return _strip_fences(raw)


def _call_openai(model: str, system: str, user_message: str, max_tokens: int) -> str:
    """Execute a chat completion via the OpenAI SDK."""
    client = _get_openai()
    response = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_message},
        ],
    )
    return response.choices[0].message.content.strip()


def _call_anthropic(model: str, system: str, user_message: str, max_tokens: int) -> str:
    """Execute a message creation via the Anthropic SDK."""
    client = _get_anthropic()
    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[
            {"role": "user", "content": user_message},
        ],
    )
    return response.content[0].text.strip()
