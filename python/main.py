import os
import tempfile
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import convex_client
import extractor
import identifier
import mapper
import summarizer

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ProcessRequest(BaseModel):
    paperId: str
    fileUrl: str
    sections: list[dict]
    fileName: Optional[str] = None
    language: str = "en"


@app.post("/process")
async def process(req: ProcessRequest):
    print(f"[DEBUG] Received language={req.language!r} for paper={req.paperId}")
    tmp_path = None
    try:
        # 1. Download file to temp dir
        suffix = _get_suffix(req.fileUrl)
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            tmp_path = f.name
        _download_file(req.fileUrl, tmp_path)

        # 2. Extract text + metadata
        extracted = extractor.extract(tmp_path)

        # 3. Detect identifiers
        identifiers = identifier.detect(extracted["text"])

        # 4. Summarize
        summary = summarizer.summarize(extracted["text"], language=req.language)

        # 5. Score sections and extract supporting excerpts
        scores = mapper.score_sections(summary, req.sections, extracted["text"], language=req.language)

        # 6. Save to Convex
        # Use original filename (without extension) as title if provided
        if req.fileName:
            title = os.path.splitext(req.fileName)[0]
        else:
            title = extracted["title"] or summary.get("rawSummary", "Untitled")[:100]

        convex_client.update_metadata(
            req.paperId,
            title,
            extracted["authors"],
            extracted["year"],
        )
        if identifiers:
            convex_client.save_identifiers(req.paperId, identifiers)
        convex_client.save_summary(req.paperId, summary)
        convex_client.save_matches_with_excerpts(req.paperId, scores)
        convex_client.update_status(req.paperId, "completed")

    except Exception as e:
        try:
            convex_client.update_status(req.paperId, "failed", str(e))
        except Exception:
            pass  # Don't let status update failure mask the original error
        return JSONResponse(
            status_code=500,
            content={"detail": str(e)},
        )

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)

    return {"status": "ok"}


def _get_suffix(url: str) -> str:
    """Detect file extension from URL."""
    for ext in [".pdf", ".docx", ".txt"]:
        if ext in url.lower():
            return ext
    return ".pdf"


def _download_file(url: str, dest: str):
    """Download a file from URL to local path."""
    with httpx.stream("GET", url, follow_redirects=True) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_bytes(chunk_size=8192):
                f.write(chunk)
