from __future__ import annotations

import json
import os
import re

from pipeline_logger import get_logger


MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
MAX_TEXT_LENGTH = 80_000
METADATA_LENGTH = 2_000

## Regex to detect a standalone page number in a header/footer line.
HEADER_FOOTER_RE = re.compile(r"^\s*(\d+)\s*$")


def extract(file_path: str) -> dict:
    """Extract text and metadata from a PDF, DOCX, or TXT file."""
    logger = get_logger()
    file_size = os.path.getsize(file_path)
    logger.info(f"Extracting from {os.path.splitext(file_path)[1].lower()} file ({file_size} bytes)",
                extra={"step": "extract", "file_type": os.path.splitext(file_path)[1].lower(), "file_size": file_size})

    if file_size > MAX_FILE_SIZE:
        raise ValueError(f"File exceeds 50MB limit ({file_size} bytes)")

    ext = os.path.splitext(file_path)[1].lower()

    if ext == ".pdf":
        text, page_source = _extract_pdf(file_path)
    elif ext == ".docx":
        text = _extract_docx(file_path)
        page_source = "approximate"
    elif ext == ".txt":
        text = _extract_txt(file_path)
        page_source = "approximate"
    else:
        raise ValueError(f"Unsupported file type: {ext}")

    text = text[:MAX_TEXT_LENGTH]
    metadata_text = text[:METADATA_LENGTH]

    return {
        "text": text,
        "metadata_text": metadata_text,
        "title": _extract_title(text),
        "authors": _extract_authors(metadata_text),
        "year": _extract_year(metadata_text),
        "page_source": page_source,
    }


def _extract_pdf(file_path: str) -> tuple[str, str]:
    """Extract text from PDF with resolved page numbers.

    Uses a two-pass approach:
    1. Collect raw page texts (without markers).
    2. Resolve printed page labels via the resolution chain:
       PDF labels -> regex heuristic -> AI detection -> approximate fallback.
    3. Emit text with correct '--- PAGE {label} ---' markers.

    Returns (full_text, page_source) where page_source is one of
    'labels', 'regex', 'ai', or 'approximate'.
    """
    import pdfplumber

    logger = get_logger()

    # --- First pass: collect raw page texts ---
    page_texts: list[str] = []
    running_chars = 0
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text is None:
                page_texts.append("")
                continue
            page_texts.append(page_text)
            running_chars += len(page_text)
            if running_chars >= MAX_TEXT_LENGTH:
                break

    # If pdfplumber extracted almost nothing, fall back to PyMuPDF for text
    total_chars = sum(len(t) for t in page_texts)
    if total_chars < 200:
        logger.info(
            f"pdfplumber extracted only {total_chars} chars, falling back to PyMuPDF",
            extra={"step": "extract_fallback"},
        )
        import fitz

        page_texts = []
        running_chars = 0
        doc = fitz.open(file_path)
        for page in doc:
            text = page.get_text()
            page_texts.append(text)
            running_chars += len(text)
            if running_chars >= MAX_TEXT_LENGTH:
                break
        doc.close()

    # --- Resolve printed page labels ---
    label_map, page_source = _resolve_page_labels(file_path)

    if label_map is None:
        label_map, page_source = _resolve_page_regex(page_texts)

    if label_map is None:
        label_map, page_source = _resolve_page_ai(page_texts)

    if label_map is None:
        # Ultimate fallback: use 1-based physical index
        label_map = {i + 1: str(i + 1) for i in range(len(page_texts))}
        page_source = "approximate"

    logger.info(
        f"Page number resolution: source={page_source}, pages={len(page_texts)}",
        extra={"step": "page_resolution", "page_source": page_source},
    )

    # --- Second pass: emit text with resolved markers ---
    text = ""
    for i, page_text in enumerate(page_texts):
        phys = i + 1  # 1-based physical index
        label = label_map.get(phys, str(phys))
        text += f"\n--- PAGE {label} ---\n{page_text}\n"
        if len(text) >= MAX_TEXT_LENGTH:
            break

    return text, page_source


def _resolve_page_labels(file_path: str) -> tuple[dict[int, str] | None, str]:
    """Try to extract printed page labels from PDF metadata via PyMuPDF.

    Most well-formed PDFs from journals and LaTeX embed page labels that
    map physical page indices to printed page numbers (e.g., "127", "ii").

    Returns (mapping, source) where mapping is {physical_page_1based: label}
    or (None, '') if labels match the physical indices (no useful info).
    """
    import fitz

    logger = get_logger()

    try:
        doc = fitz.open(file_path)
        labels: dict[int, str] = {}
        has_custom_labels = False

        for page in doc:
            label = page.get_label()
            phys = page.number + 1  # fitz is 0-based
            labels[phys] = label
            if label != str(phys):
                has_custom_labels = True

        doc.close()

        if has_custom_labels:
            logger.info(
                f"PDF page labels found (sample: page 1 -> '{labels.get(1, '?')}')",
                extra={"step": "page_labels"},
            )
            return labels, "labels"

    except Exception as e:
        logger.debug(f"Could not read PDF page labels: {e}", extra={"step": "page_labels"})

    return None, ""


def _resolve_page_regex(page_texts: list[str]) -> tuple[dict[int, str] | None, str]:
    """Detect printed page numbers from header/footer lines using regex.

    Scans the first 2 and last 2 lines of each page for standalone numbers.
    If a consistent ascending sequence is found, returns the mapping.
    """
    logger = get_logger()
    detected: list[tuple[int, int]] = []  # (physical_1based, detected_number)

    for i, page_text in enumerate(page_texts):
        if not page_text.strip():
            continue

        lines = page_text.strip().split("\n")
        candidates = lines[:2] + lines[-2:]

        for line in candidates:
            m = HEADER_FOOTER_RE.match(line)
            if m:
                detected.append((i + 1, int(m.group(1))))
                break  # One match per page is enough

    # Need at least 3 pages with detected numbers to validate consistency
    if len(detected) < 3:
        return None, ""

    # Check that detected numbers form a consistent ascending sequence
    detected.sort(key=lambda x: x[0])
    is_consistent = True
    for j in range(1, len(detected)):
        prev_phys, prev_num = detected[j - 1]
        curr_phys, curr_num = detected[j]
        expected_gap = curr_phys - prev_phys
        actual_gap = curr_num - prev_num
        if actual_gap < 0 or abs(actual_gap - expected_gap) > 2:
            is_consistent = False
            break

    if not is_consistent:
        return None, ""

    # Calculate average offset from detected pairs
    offsets = [num - phys for phys, num in detected]
    avg_offset = round(sum(offsets) / len(offsets))

    # Guard: if the offset would produce non-positive page labels, the regex
    # probably picked up non-page-number digits from headers/footers.
    if avg_offset < 0:
        return None, ""

    label_map = {
        i + 1: str(i + 1 + avg_offset) for i in range(len(page_texts))
    }

    logger.info(
        f"Regex detected page numbers (offset={avg_offset}, samples={len(detected)})",
        extra={"step": "page_regex"},
    )
    return label_map, "regex"


def _resolve_page_ai(
    page_texts: list[str],
) -> tuple[dict[int, str] | None, str]:
    """Use GPT-4o-mini to detect printed page numbers from sample pages.

    Sends the first and last 3 lines of 5 evenly-spaced sample pages.
    Detects the printed page number for each sample, calculates a single
    integer offset, and applies it uniformly.
    """
    from openai import OpenAI
    from dotenv import load_dotenv

    load_dotenv()
    logger = get_logger()

    # Select up to 5 evenly-spaced non-empty pages
    non_empty = [(i, t) for i, t in enumerate(page_texts) if t.strip()]
    if len(non_empty) < 2:
        return None, ""

    step = max(1, len(non_empty) // 5)
    samples = non_empty[::step][:5]

    # Build a compact prompt with first/last 3 lines per sample page
    page_snippets = []
    for idx, (i, text) in enumerate(samples):
        lines = text.strip().split("\n")
        first_lines = "\n".join(lines[:3])
        last_lines = "\n".join(lines[-3:]) if len(lines) > 3 else ""
        page_snippets.append(
            f"PDF Page {i + 1} (physical index):\n"
            f"FIRST LINES:\n{first_lines}\n"
            f"LAST LINES:\n{last_lines}"
        )

    prompt = (
        "Below are snippets from several pages of an academic PDF. "
        "For each page, identify the printed page number (the number "
        "actually printed on the page, e.g., in the header or footer). "
        "Return a JSON array of objects with 'physicalPage' (the PDF page "
        "index I gave you) and 'printedPage' (the number you found, as an "
        "integer, or null if you cannot determine it).\n\n"
        + "\n\n".join(page_snippets)
    )

    try:
        client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            max_tokens=256,
            messages=[
                {"role": "system", "content": "You detect page numbers from academic PDF snippets. Return only valid JSON."},
                {"role": "user", "content": prompt},
            ],
        )

        raw = response.choices[0].message.content.strip()
        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

        results = json.loads(raw)
        if not isinstance(results, list):
            return None, ""

        # Calculate offset from valid results
        offsets = []
        for r in results:
            phys = r.get("physicalPage")
            printed = r.get("printedPage")
            if phys is not None and printed is not None:
                offsets.append(int(printed) - int(phys))

        if not offsets:
            return None, ""

        avg_offset = round(sum(offsets) / len(offsets))

        label_map = {
            i + 1: str(i + 1 + avg_offset) for i in range(len(page_texts))
        }

        logger.info(
            f"AI detected page offset={avg_offset} from {len(offsets)} samples",
            extra={"step": "page_ai"},
        )
        return label_map, "ai"

    except Exception as e:
        logger.debug(f"AI page detection failed: {e}", extra={"step": "page_ai"})
        return None, ""


def _extract_docx(file_path: str) -> str:
    """Extract text from DOCX using python-docx."""
    from docx import Document

    doc = Document(file_path)
    return "\n".join(p.text for p in doc.paragraphs)


def _extract_txt(file_path: str) -> str:
    """Read plain text file."""
    with open(file_path, encoding="utf-8", errors="ignore") as f:
        return f.read()


def _extract_title(text: str) -> str | None:
    """First non-empty, non-marker line if it's under 200 chars."""
    for line in text.split("\n"):
        line = line.strip()
        if line and not line.startswith("--- PAGE"):
            return line if len(line) < 200 else None
    return None


def _extract_authors(metadata_text: str) -> list[str]:
    """Find proper-name patterns in the first 2000 chars."""
    matches = re.findall(r"[A-Z][a-z]+\s+[A-Z][a-z]+", metadata_text)
    seen = set()
    authors = []
    for m in matches:
        if m not in seen:
            seen.add(m)
            authors.append(m)
        if len(authors) >= 5:
            break
    return authors


def _extract_year(metadata_text: str) -> int | None:
    """Find first 4-digit year (19xx or 20xx) in the first 2000 chars."""
    match = re.search(r"(19|20)\d{2}", metadata_text)
    return int(match.group()) if match else None
