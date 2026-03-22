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
from pipeline_logger import get_logger, set_paper_context, PipelineStep

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
    set_paper_context(req.paperId)
    logger = get_logger()
    logger.info(
        f"Pipeline started: paper={req.paperId}, file={req.fileName}, language={req.language}, sections={len(req.sections)}",
        extra={"step": "pipeline", "status": "started"},
    )

    tmp_path = None
    try:
        # 1. Download file to temp dir
        suffix = _get_suffix(req.fileUrl)
        with PipelineStep("download_file", detail=f"suffix={suffix}"):
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                tmp_path = f.name
            _download_file(req.fileUrl, tmp_path)
            file_size = os.path.getsize(tmp_path)
            logger.debug(f"Downloaded {file_size} bytes to {tmp_path}", extra={"step": "download_file"})

        # 2. Extract text + metadata
        with PipelineStep("extract_text", detail=f"format={suffix}"):
            extracted = extractor.extract(tmp_path)
            logger.debug(
                f"Extracted {len(extracted['text'])} chars, title={extracted['title']}, "
                f"authors={len(extracted['authors'])}, year={extracted['year']}",
                extra={"step": "extract_text"},
            )

        # 3. Detect identifiers
        with PipelineStep("detect_identifiers"):
            identifiers = identifier.detect(extracted["text"])
            logger.info(
                f"Found {len(identifiers)} identifiers: {[i['type'] for i in identifiers]}",
                extra={"step": "detect_identifiers"},
            )

        # 4. Summarize
        with PipelineStep("summarize", detail=f"text_len={len(extracted['text'])}, language={req.language}"):
            summary = summarizer.summarize(extracted["text"], language=req.language)
            logger.debug(
                f"Summary keys: {list(summary.keys())}, findings={len(summary.get('keyFindings', []))}",
                extra={"step": "summarize"},
            )

        # 5. Save to Convex (summary only — citation happens on-demand via /cite)
        with PipelineStep("save_to_convex"):
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
            convex_client.save_summary(req.paperId, summary, language=req.language)
            convex_client.update_status(req.paperId, "completed")

        logger.info("Pipeline completed successfully", extra={"step": "pipeline", "status": "completed"})

    except Exception as e:
        logger.error(
            f"Pipeline failed: {type(e).__name__}: {e}",
            extra={"step": "pipeline", "status": "failed", "error_type": type(e).__name__, "error_message": str(e)},
        )
        try:
            convex_client.update_status(req.paperId, "failed", str(e))
        except Exception:
            logger.error("Failed to update paper status to 'failed'", extra={"step": "save_to_convex", "status": "failed"})
        return JSONResponse(
            status_code=500,
            content={"detail": str(e)},
        )

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)

    return {"status": "ok"}


class CiteRequest(BaseModel):
    """Request body for on-demand per-section citation."""

    paperId: str
    fileUrl: str
    # IDs of the specific outline sections to cite against.
    sectionIds: list[str]
    # Full section objects from the outline (_id, title, orderNumber, notes).
    sections: list[dict]
    language: str = "en"


@app.post("/cite")
async def cite(req: CiteRequest):
    """Run citation (scoring + excerpt extraction) for specific sections only.

    Called when the user drags a paper onto a sidebar section node.
    Extracts text from the paper file, scores only the requested sections,
    and upserts the results — preserving existing matches for other sections.
    """
    set_paper_context(req.paperId)
    logger = get_logger()
    logger.info(
        f"Citation started: paper={req.paperId}, sectionIds={req.sectionIds}, language={req.language}",
        extra={"step": "citation", "status": "started"},
    )

    tmp_path = None
    try:
        # Filter to only the requested sections
        section_id_set = set(req.sectionIds)
        target_sections = [s for s in req.sections if s["_id"] in section_id_set]

        if not target_sections:
            logger.info("No matching sections found, skipping citation", extra={"step": "citation"})
            return {"status": "ok", "matchCount": 0}

        # Download and extract text
        suffix = _get_suffix(req.fileUrl)
        with PipelineStep("download_file", detail=f"suffix={suffix}"):
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                tmp_path = f.name
            _download_file(req.fileUrl, tmp_path)

        with PipelineStep("extract_text", detail=f"format={suffix}"):
            extracted = extractor.extract(tmp_path)
            logger.debug(
                f"Extracted {len(extracted['text'])} chars for citation",
                extra={"step": "extract_text"},
            )

        # Resolve citation language: prefer the language stored on the summary
        # (set at processing time) so excerpts match the document's own language.
        # Falls back to the language param on the request (default "en").
        cite_language = convex_client.get_summary_language(req.paperId) or req.language

        # Score only the requested sections and extract excerpts
        with PipelineStep("score_sections", detail=f"num_sections={len(target_sections)}"):
            scores = mapper.score_sections(
                {},
                target_sections,
                extracted["text"],
                language=cite_language,
            )
            matched = [s for s in scores if s["score"] > 0.0]
            logger.info(
                f"Scored {len(scores)} sections, {len(matched)} with score > 0",
                extra={"step": "score_sections"},
            )

        # Upsert citation matches (preserves other sections' matches)
        with PipelineStep("save_citation_matches"):
            convex_client.save_citation_matches(req.paperId, scores)

        logger.info(
            f"Citation completed: {len(matched)} sections matched",
            extra={"step": "citation", "status": "completed"},
        )
        return {"status": "ok", "matchCount": len(matched)}

    except Exception as e:
        logger.error(
            f"Citation failed: {type(e).__name__}: {e}",
            extra={"step": "citation", "status": "failed", "error_type": type(e).__name__, "error_message": str(e)},
        )
        return JSONResponse(status_code=500, content={"detail": str(e)})

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


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
