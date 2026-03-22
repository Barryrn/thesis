import json
import os
import time
from openai import OpenAI
from dotenv import load_dotenv

from pipeline_logger import get_logger, log_openai_call, log_openai_response

load_dotenv()

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
MODEL = "gpt-4o"

REQUIRED_KEYS = {"researchQuestion", "methodology", "keyFindings", "keywords", "rawSummary"}

LANGUAGE_NAMES = {"en": "English", "de": "German (Deutsch)"}


def _build_summarize_prompt(language: str = "en") -> str:
    lang_name = LANGUAGE_NAMES.get(language, "English")
    lang_line = (
        f"\n\nCRITICAL LANGUAGE REQUIREMENT: You MUST write every string value in {lang_name}. "
        f"Do NOT write any string values in English. All output text must be in {lang_name}. "
        "Only JSON keys remain in English."
        if language != "en"
        else ""
    )
    return f"""You are a research paper analyst. Extract and return a JSON object with exactly
these fields:
{{
  "researchQuestion": "One sentence describing the central research question.",
  "methodology": "One to two sentences describing the methods used.",
  "keyFindings": ["Finding 1", "Finding 2", "... (three to six key findings)"],
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "rawSummary": "Three to five sentence summary of the paper."
}}
Return only valid JSON. No markdown fences, no explanation, no extra keys.{lang_line}"""


def _build_chunk_prompt(language: str = "en") -> str:
    lang_name = LANGUAGE_NAMES.get(language, "English")
    base = (
        "Summarize the following section of an academic paper in 3–5 sentences. "
        "Focus on methods, findings, and contributions. Plain text only."
    )
    if language != "en":
        base += f" You MUST write your entire summary in {lang_name}. Do NOT write in English."
    return base

CHUNK_SIZE = 12_000
CHUNK_OVERLAP = 500
MAX_CHUNKS = 5


def _strip_fences(text: str) -> str:
    """Remove markdown code fences that GPT sometimes adds."""
    text = text.strip()
    if text.startswith("```"):
        # Remove opening fence (```json or ```)
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def summarize(text: str, language: str = "en") -> dict:
    """Summarize paper text into a structured dict using OpenAI."""
    logger = get_logger()

    if len(text) > CHUNK_SIZE:
        logger.info(f"Text exceeds chunk threshold ({len(text)} > {CHUNK_SIZE}), using chunked summarization",
                     extra={"step": "summarize"})
        return summarize_large(text, language=language)

    system_prompt = _build_summarize_prompt(language)
    log_openai_call(MODEL, 2048, len(text))

    t0 = time.monotonic()
    try:
        response = client.chat.completions.create(
            model=MODEL,
            max_tokens=2048,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text},
            ],
        )
        elapsed = round((time.monotonic() - t0) * 1000, 1)
        log_openai_response(MODEL, elapsed, success=True)
    except Exception as e:
        elapsed = round((time.monotonic() - t0) * 1000, 1)
        log_openai_response(MODEL, elapsed, success=False, error=str(e))
        raise

    raw = _strip_fences(response.choices[0].message.content)
    result = json.loads(raw)

    missing = REQUIRED_KEYS - set(result.keys())
    if missing:
        raise ValueError(f"Summary missing required keys: {missing}")

    return result


def summarize_large(text: str, language: str = "en") -> dict:
    """Handle texts longer than 12,000 chars by chunking."""
    logger = get_logger()
    chunks = []
    start = 0
    while start < len(text) and len(chunks) < MAX_CHUNKS:
        end = start + CHUNK_SIZE
        chunks.append(text[start:end])
        start = end - CHUNK_OVERLAP

    logger.info(f"Splitting into {len(chunks)} chunks (chunk_size={CHUNK_SIZE}, overlap={CHUNK_OVERLAP})",
                extra={"step": "summarize_chunking", "num_chunks": len(chunks)})

    chunk_summaries = []
    for i, chunk in enumerate(chunks):
        logger.debug(f"Summarizing chunk {i + 1}/{len(chunks)} ({len(chunk)} chars)",
                      extra={"step": "summarize_chunk"})
        chunk_summaries.append(_summarize_chunk(chunk, language=language))

    combined = "\n\n".join(chunk_summaries)
    logger.info(f"All chunks summarized, combining ({len(combined)} chars) for final summary",
                extra={"step": "summarize_combine"})

    return summarize(combined, language=language)


def _summarize_chunk(chunk: str, language: str = "en") -> str:
    """Summarize a single chunk of text as plain prose."""
    system_prompt = _build_chunk_prompt(language)
    log_openai_call(MODEL, 1024, len(chunk))

    t0 = time.monotonic()
    try:
        response = client.chat.completions.create(
            model=MODEL,
            max_tokens=1024,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": chunk},
            ],
        )
        elapsed = round((time.monotonic() - t0) * 1000, 1)
        log_openai_response(MODEL, elapsed, success=True)
    except Exception as e:
        elapsed = round((time.monotonic() - t0) * 1000, 1)
        log_openai_response(MODEL, elapsed, success=False, error=str(e))
        raise

    return response.choices[0].message.content
