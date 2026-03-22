"""
Structured pipeline logging for the paper processing backend.

Provides step-by-step visibility into the upload/processing pipeline
with timing, paper ID correlation, and debug mode support.

Environment variables:
    DEBUG_MODE            - "true" to enable DEBUG-level logging (default: "false")
    LOG_FORMAT            - "json" or "text" (default: "text")
    LOG_FILE              - optional file path to write logs to
    SLOW_STEP_THRESHOLD_MS - ms threshold for slow-step warnings (default: 30000)
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import time
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Request-scoped context: paperId
# ---------------------------------------------------------------------------

paper_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "paper_id", default="unknown"
)


def set_paper_context(paper_id: str) -> None:
    """Set the current paper ID for log correlation."""
    paper_id_var.set(paper_id)


# ---------------------------------------------------------------------------
# Logging filter – injects paper_id into every record
# ---------------------------------------------------------------------------


class PaperContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.paper_id = paper_id_var.get("unknown")  # type: ignore[attr-defined]
        # Ensure extra fields exist even if not supplied
        for attr in ("step", "status", "elapsed_ms", "detail"):
            if not hasattr(record, attr):
                setattr(record, attr, "")
        return True


# ---------------------------------------------------------------------------
# Formatters
# ---------------------------------------------------------------------------


class JsonFormatter(logging.Formatter):
    """Emit each log record as a single JSON line."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "paper_id": getattr(record, "paper_id", "unknown"),
            "message": record.getMessage(),
        }
        # Include optional structured fields when present
        for key in ("step", "status", "elapsed_ms", "detail",
                     "error_type", "error_message",
                     "api", "model", "max_tokens", "input_chars",
                     "mutation", "file_type", "file_size", "num_chunks"):
            val = getattr(record, key, "")
            if val != "" and val is not None:
                entry[key] = val
        return json.dumps(entry, default=str)


class TextFormatter(logging.Formatter):
    """Human-readable format for local development."""

    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        level = record.levelname.ljust(5)
        paper_id = getattr(record, "paper_id", "unknown")
        step = getattr(record, "step", "")
        step_part = f" {step} -" if step else ""
        return f"[{ts}] {level} [{paper_id}]{step_part} {record.getMessage()}"


# ---------------------------------------------------------------------------
# Logger setup
# ---------------------------------------------------------------------------

_logger_initialized = False


def get_logger(name: str = "pipeline") -> logging.Logger:
    """Return a configured logger. Idempotent – safe to call from every module."""
    global _logger_initialized
    logger = logging.getLogger(name)

    if _logger_initialized:
        return logger

    debug_mode = os.environ.get("DEBUG_MODE", "false").lower() == "true"
    logger.setLevel(logging.DEBUG if debug_mode else logging.INFO)

    # Prevent duplicate handlers on reload
    logger.handlers.clear()

    # Choose formatter
    log_format = os.environ.get("LOG_FORMAT", "text").lower()
    formatter: logging.Formatter
    if log_format == "json":
        formatter = JsonFormatter()
    else:
        formatter = TextFormatter()

    # Console handler (stdout – captured by uvicorn / docker)
    console = logging.StreamHandler()
    console.setFormatter(formatter)
    logger.addHandler(console)

    # Optional file handler
    log_file = os.environ.get("LOG_FILE")
    if log_file:
        fh = logging.FileHandler(log_file)
        fh.setFormatter(formatter)
        logger.addHandler(fh)

    # Attach context filter to inject paper_id
    logger.addFilter(PaperContextFilter())

    # Don't propagate to root logger (avoids duplicate uvicorn output)
    logger.propagate = False

    _logger_initialized = True
    return logger


# ---------------------------------------------------------------------------
# PipelineStep context manager
# ---------------------------------------------------------------------------

SLOW_THRESHOLD_MS = int(os.environ.get("SLOW_STEP_THRESHOLD_MS", "30000"))


class PipelineStep:
    """Context manager that logs start / complete / failed for a pipeline step.

    Usage::

        with PipelineStep("extract_text", detail="PDF via pdfplumber"):
            result = extractor.extract(path)
    """

    def __init__(self, step_name: str, detail: str = "") -> None:
        self.step_name = step_name
        self.detail = detail
        self.logger = get_logger()
        self.start_time: float = 0.0

    def __enter__(self) -> "PipelineStep":
        self.start_time = time.monotonic()
        msg = f"Step started: {self.step_name}"
        if self.detail:
            msg += f" ({self.detail})"
        self.logger.info(
            msg,
            extra={"step": self.step_name, "status": "started", "detail": self.detail},
        )
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> bool:  # type: ignore[override]
        elapsed_ms = round((time.monotonic() - self.start_time) * 1000, 1)

        if exc_type is None:
            slow = elapsed_ms > SLOW_THRESHOLD_MS
            level = logging.WARNING if slow else logging.INFO
            suffix = " [SLOW]" if slow else ""
            self.logger.log(
                level,
                f"Step completed: {self.step_name} ({elapsed_ms}ms){suffix}",
                extra={
                    "step": self.step_name,
                    "status": "completed",
                    "elapsed_ms": elapsed_ms,
                },
            )
        else:
            self.logger.error(
                f"Step failed: {self.step_name} ({elapsed_ms}ms) "
                f"- {exc_type.__name__}: {exc_val}",
                extra={
                    "step": self.step_name,
                    "status": "failed",
                    "elapsed_ms": elapsed_ms,
                    "error_type": exc_type.__name__,
                    "error_message": str(exc_val),
                },
            )
        return False  # Do not suppress the exception


# ---------------------------------------------------------------------------
# Helpers for AI call logging
# ---------------------------------------------------------------------------


def log_openai_call(model: str, max_tokens: int, input_chars: int) -> None:
    """Log an outgoing OpenAI API call (DEBUG level)."""
    logger = get_logger()
    logger.debug(
        f"OpenAI API call: model={model}, max_tokens={max_tokens}, "
        f"input_chars={input_chars}",
        extra={
            "step": "openai_call",
            "api": "openai",
            "model": model,
            "max_tokens": max_tokens,
            "input_chars": input_chars,
        },
    )


def log_openai_response(model: str, elapsed_ms: float, success: bool, error: str = "") -> None:
    """Log the result of an OpenAI API call."""
    logger = get_logger()
    if success:
        slow = elapsed_ms > SLOW_THRESHOLD_MS
        level = logging.WARNING if slow else logging.INFO
        suffix = " [SLOW]" if slow else ""
        logger.log(
            level,
            f"OpenAI response received: model={model} ({elapsed_ms}ms){suffix}",
            extra={
                "step": "openai_response",
                "status": "completed",
                "model": model,
                "elapsed_ms": elapsed_ms,
            },
        )
    else:
        logger.error(
            f"OpenAI call failed: model={model} ({elapsed_ms}ms) - {error}",
            extra={
                "step": "openai_response",
                "status": "failed",
                "model": model,
                "elapsed_ms": elapsed_ms,
                "error_message": error,
            },
        )
