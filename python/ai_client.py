"""Unified AI provider abstraction for OpenAI and Anthropic.

Provides a single `chat_completion` function that routes to the correct
provider SDK based on a provider string, with lazy client initialization
so a missing API key for an unused provider won't crash at startup.

Anthropic auth has two backends, picked automatically:

* **Agent SDK** (``claude_agent_sdk``) — used when the
  ``CLAUDE_CODE_OAUTH_TOKEN`` env var is present. Drives Claude through
  the user's existing Claude subscription, no Anthropic API key
  required. Yields text-block-sized chunks rather than raw token
  deltas, which is identical to the user from the SSE perspective.
* **Direct Messages API** (``anthropic.Anthropic``) — used when
  ``ANTHROPIC_API_KEY`` is set. Yields raw token deltas.

Set ``ANTHROPIC_BACKEND=api_key`` to force the Messages API even when
an OAuth token is also present (useful for parity testing).
"""

import asyncio
import os
import queue
import threading
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
    ("openai", "writer"): "gpt-4o",
    ("anthropic", "mapper"): "claude-sonnet-4-20250514",
    ("anthropic", "summarizer"): "claude-sonnet-4-20250514",
    ("anthropic", "optimizer"): "claude-sonnet-4-20250514",
    ("anthropic", "extractor"): "claude-haiku-4-5-20251001",
    # Section-writer drafts long-form prose with citations — Sonnet 4.6
    # is the current best balance of academic quality, long context, and cost.
    ("anthropic", "writer"): "claude-sonnet-4-6",
}

VALID_PROVIDERS = {"openai", "anthropic"}

# ---------------------------------------------------------------------------
# Lazy client singletons
# ---------------------------------------------------------------------------

_openai_client = None
_anthropic_client = None


def _require_api_key(env_var: str, provider_label: str) -> str:
    """Read an API key env var and fail fast if it is missing or empty.

    ``python-dotenv`` populates env vars from ``.env`` even when the
    value is the empty string (``KEY=``), so plain ``os.environ[KEY]``
    silently returns ``""`` and the SDK only complains later with a
    cryptic auth error. Raising a clear ``RuntimeError`` here makes
    the misconfiguration obvious in the FastAPI response body.
    """
    value = os.environ.get(env_var, "").strip()
    if not value:
        raise RuntimeError(
            f"{provider_label} API key is not configured: set {env_var} in "
            f"your .env file or shell environment."
        )
    return value


def _get_openai():
    """Return a lazily-initialized OpenAI client."""
    global _openai_client
    if _openai_client is None:
        from openai import OpenAI
        _openai_client = OpenAI(
            api_key=_require_api_key("OPENAI_API_KEY", "OpenAI")
        )
    return _openai_client


def _anthropic_backend() -> str:
    """Pick the Anthropic backend for this process.

    ``api_key`` (raw Anthropic Messages API) is preferred when a real
    key exists, since it streams true token deltas. Otherwise we fall
    back to ``agent_sdk`` which uses the user's Claude subscription via
    ``CLAUDE_CODE_OAUTH_TOKEN``. Set ``ANTHROPIC_BACKEND`` to
    ``api_key`` or ``agent_sdk`` to override.
    """
    explicit = os.environ.get("ANTHROPIC_BACKEND", "").strip().lower()
    if explicit in {"api_key", "agent_sdk"}:
        return explicit
    if os.environ.get("ANTHROPIC_API_KEY", "").strip():
        return "api_key"
    if os.environ.get("CLAUDE_CODE_OAUTH_TOKEN", "").strip():
        return "agent_sdk"
    # Neither credential available — return ``api_key`` and let the
    # downstream require-key check produce a clear error.
    return "api_key"


def _get_anthropic():
    """Return a lazily-initialized Anthropic Messages-API client.

    Only used by the ``api_key`` backend. The Agent SDK path skips this
    entirely and goes through ``claude_agent_sdk`` instead.
    """
    global _anthropic_client
    if _anthropic_client is None:
        from anthropic import Anthropic
        _anthropic_client = Anthropic(
            api_key=_require_api_key("ANTHROPIC_API_KEY", "Anthropic"),
        )
    return _anthropic_client


# ---------------------------------------------------------------------------
# Agent SDK helpers — talks to Claude via the user's subscription token
# ---------------------------------------------------------------------------


def _build_agent_options(system: str, model: str, max_tokens: int):
    """Build a ``ClaudeAgentOptions`` for plain text-completion use.

    All built-in tools are disabled with ``allowed_tools=[]`` so the
    model never tries to read files or run shell commands — we only
    want prose back. ``permission_mode='bypassPermissions'`` keeps the
    SDK from blocking on interactive permission prompts that don't
    exist in a server context.
    """
    from claude_agent_sdk import ClaudeAgentOptions

    return ClaudeAgentOptions(
        system_prompt=system,
        allowed_tools=[],
        permission_mode="bypassPermissions",
        model=model,
        max_buffer_size=max(max_tokens * 4, 65536),
    )


async def _agent_sdk_iter_chunks(system: str, user_message: str, model: str,
                                  max_tokens: int):
    """Async generator yielding text-block chunks from claude_agent_sdk.

    The Agent SDK emits structured ``AssistantMessage`` events whose
    ``content`` lists ``TextBlock``s. From the SSE perspective, each
    block is ``one chunk of streamed text`` — the user sees it appear
    in the preview pane the same way they would with raw token deltas.
    Tool-use blocks and system events are filtered out.
    """
    from claude_agent_sdk import query, AssistantMessage, ResultMessage

    options = _build_agent_options(system, model, max_tokens)
    async for message in query(prompt=user_message, options=options):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                # ``TextBlock`` has a .text attribute; tool-use blocks
                # don't, so this duck-type check is safe.
                text = getattr(block, "text", None)
                if isinstance(text, str) and text:
                    yield text
        elif isinstance(message, ResultMessage):
            # Stream is finished. The SDK doesn't always close the
            # iterator after this, so break explicitly.
            if message.is_error:
                err = getattr(message, "result", None) or "Agent SDK error"
                raise RuntimeError(str(err))
            return


def _agent_sdk_collect(system: str, user_message: str, model: str,
                        max_tokens: int) -> str:
    """Run the Agent SDK to completion and return the assembled text.

    Used by the non-streaming ``/clarify`` path. Wraps an async
    generator with ``asyncio.run`` so callers stay sync.
    """
    async def _run() -> str:
        chunks: list[str] = []
        async for chunk in _agent_sdk_iter_chunks(
            system, user_message, model, max_tokens
        ):
            chunks.append(chunk)
        return "".join(chunks)

    return asyncio.run(_run())


def _agent_sdk_stream_sync(system: str, user_message: str, model: str,
                            max_tokens: int):
    """Bridge the async Agent SDK generator into a sync iterator.

    The streaming endpoint already drives ``chat_completion_stream``
    one chunk at a time from a threadpool, so the simplest reliable
    bridge is to spin up a dedicated thread that owns its own asyncio
    loop, runs the async generator, and pushes chunks onto a thread-
    safe queue that the calling sync iterator drains. Closing the
    iterator early signals the worker to bail.
    """
    sentinel: object = object()
    chunks_q: "queue.Queue[object]" = queue.Queue(maxsize=64)
    stop_event = threading.Event()

    def _worker() -> None:
        async def _drive() -> None:
            try:
                async for chunk in _agent_sdk_iter_chunks(
                    system, user_message, model, max_tokens
                ):
                    if stop_event.is_set():
                        return
                    chunks_q.put(chunk)
            except Exception as exc:  # noqa: BLE001 — propagate to caller
                chunks_q.put(exc)
            finally:
                chunks_q.put(sentinel)

        try:
            asyncio.run(_drive())
        except Exception as exc:  # noqa: BLE001
            chunks_q.put(exc)
            chunks_q.put(sentinel)

    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()

    try:
        while True:
            item = chunks_q.get()
            if item is sentinel:
                return
            if isinstance(item, Exception):
                raise item
            yield item  # type: ignore[misc]
    finally:
        # Tell the worker to bail on the next chunk if the consumer
        # hung up early. ``daemon=True`` ensures we don't block process
        # exit even if the SDK refuses to honour the cancellation.
        stop_event.set()


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
    """Execute a message creation against the active Anthropic backend."""
    backend = _anthropic_backend()
    if backend == "agent_sdk":
        return _agent_sdk_collect(system, user_message, model, max_tokens).strip()
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


# ---------------------------------------------------------------------------
# Streaming entry point — used by the section-writer SSE endpoint
# ---------------------------------------------------------------------------


def chat_completion_stream(
    provider: str,
    module: str,
    system: str,
    user_message: str,
    max_tokens: int,
):
    """Yield text deltas from a streaming chat completion.

    Mirrors :func:`chat_completion` but returns an iterator so callers
    can forward tokens to the browser as Server-Sent Events. Wraps the
    SDK iterator in ``try/finally`` so an aborted client closes the
    underlying network stream — otherwise we'd keep paying for tokens
    after the user navigated away.
    """
    if provider not in VALID_PROVIDERS:
        raise ValueError(
            f"Unknown provider '{provider}'. Must be one of: {VALID_PROVIDERS}"
        )

    model_key = (provider, module)
    if model_key not in PROVIDER_MODELS:
        raise ValueError(
            f"No model configured for provider='{provider}', module='{module}'"
        )

    model = PROVIDER_MODELS[model_key]
    log_ai_call(provider, model, max_tokens, len(user_message))

    t0 = time.monotonic()
    try:
        if provider == "openai":
            yield from _stream_openai(model, system, user_message, max_tokens)
        else:
            yield from _stream_anthropic(model, system, user_message, max_tokens)
        elapsed = round((time.monotonic() - t0) * 1000, 1)
        log_ai_response(provider, model, elapsed, success=True)
    except Exception as e:
        elapsed = round((time.monotonic() - t0) * 1000, 1)
        log_ai_response(provider, model, elapsed, success=False, error=str(e))
        raise


def _stream_openai(model: str, system: str, user_message: str, max_tokens: int):
    """Yield text deltas from the OpenAI streaming chat completion API."""
    client = _get_openai()
    stream = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        stream=True,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_message},
        ],
    )
    try:
        for chunk in stream:
            # OpenAI sends sentinel chunks with no choices/content; skip them.
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            content = getattr(delta, "content", None)
            if content:
                yield content
    finally:
        # ``close`` is a no-op when the stream finishes naturally, but releases
        # the connection promptly when the caller stops iterating early.
        close = getattr(stream, "close", None)
        if callable(close):
            try:
                close()
            except Exception:
                pass


def _stream_anthropic(model: str, system: str, user_message: str, max_tokens: int):
    """Yield text chunks from the active Anthropic backend.

    With the ``api_key`` backend the SDK yields raw token deltas. With
    the ``agent_sdk`` backend each yielded value is one ``TextBlock``
    from an ``AssistantMessage`` — visually equivalent from the
    streaming-preview perspective, just larger chunks.
    """
    backend = _anthropic_backend()
    if backend == "agent_sdk":
        yield from _agent_sdk_stream_sync(system, user_message, model, max_tokens)
        return

    client = _get_anthropic()
    # ``client.messages.stream`` returns a context manager that owns the
    # underlying HTTP connection. Wrapping with ``with`` guarantees the
    # connection closes whether the consumer reads to completion or
    # aborts mid-stream.
    with client.messages.stream(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user_message}],
    ) as stream:
        for text in stream.text_stream:
            if text:
                yield text
