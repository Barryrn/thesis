from __future__ import annotations

import os
import re

from pipeline_logger import get_logger


MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
MAX_TEXT_LENGTH = 80_000
METADATA_LENGTH = 2_000


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
        text = _extract_pdf(file_path)
    elif ext == ".docx":
        text = _extract_docx(file_path)
    elif ext == ".txt":
        text = _extract_txt(file_path)
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
    }


def _extract_pdf(file_path: str) -> str:
    """Extract text from PDF using pdfplumber, falling back to PyMuPDF.

    Embeds '--- PAGE N ---' markers between pages so the mapping step
    can detect on which page each excerpt appears.
    """
    import pdfplumber

    text = ""
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text is None:
                continue
            # page.page_number is 1-based in pdfplumber
            text += f"\n--- PAGE {page.page_number} ---\n{page_text}\n"
            if len(text) >= MAX_TEXT_LENGTH:
                break

    if len(text.strip()) < 200:
        logger = get_logger()
        logger.info(f"pdfplumber extracted only {len(text.strip())} chars, falling back to PyMuPDF",
                     extra={"step": "extract_fallback"})
        import fitz

        text = ""
        doc = fitz.open(file_path)
        for page in doc:
            # page.number is 0-based in PyMuPDF; add 1 for human-readable page numbers
            text += f"\n--- PAGE {page.number + 1} ---\n{page.get_text()}\n"
            if len(text) >= MAX_TEXT_LENGTH:
                break
        doc.close()

    return text


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
    """First non-empty line if it's under 200 chars."""
    for line in text.split("\n"):
        line = line.strip()
        if line:
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
