import asyncio
import io
import json
import os
import tempfile
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

import ai_client
import convex_client
import docx_builder
import extractor
import grouper
import identifier
import mapper
import optimizer
import recommender
import section_writer
import summarizer
import zotero_client
from zotero_client import ZoteroConfigError, ZoteroAuthError
from pipeline_logger import get_logger, set_paper_context, PipelineStep

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))


class PipelineCancelled(Exception):
    """Raised when the user cancels a paper processing run mid-flight.

    The /process endpoint catches this at the outer try and exits the
    pipeline cleanly without flipping the paper to ``failed`` — the
    Convex `cancelPaperProcessing` mutation has already moved the row
    to ``cancelled`` and the UI typically deletes it shortly after.
    """


async def _check_cancellation(paper_id: str) -> None:
    """Probe Convex for the paper's status and raise if cancelled.

    Called between every pipeline stage so a user-clicked Stop becomes
    effective at the next stage boundary. Network errors don't block
    the pipeline — the status query is best-effort and a transient
    Convex outage shouldn't take a healthy run down.
    """
    status = await run_in_threadpool(convex_client.get_paper_status, paper_id)
    if status == "cancelled":
        raise PipelineCancelled(paper_id)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _generate_kuerzel(authors: list[str], year: int | None) -> str:
    """Generate an HKA-style Kürzel abbreviation from authors and year.

    The Kürzel serves as a short, human-readable citation key used
    throughout the thesis (e.g. "MU23" for Müller 2023, "MS23" for
    Müller & Schmidt 2023). Rules:
      - 1 author  → first 2 letters of surname (uppercased) + last 2 digits of year
      - 2+ authors → first letter of each of first 2 surnames + last 2 digits
      - No authors → "XX" + year suffix
    """
    import unicodedata

    def normalize(s: str) -> str:
        """Strip diacritics so 'Müller' becomes 'Muller' for the abbreviation."""
        return "".join(
            c
            for c in unicodedata.normalize("NFD", s)
            if unicodedata.category(c) != "Mn"
        )

    def extract_surname(name: str) -> str:
        """Extract surname from 'LastName, FirstName' or 'FirstName LastName' formats."""
        if "," in name:
            return name.split(",")[0].strip()
        parts = name.strip().split()
        return parts[-1] if parts else ""

    suffix = str(year)[-2:] if year else ""

    if not authors:
        return "XX" + suffix

    surnames = [normalize(extract_surname(a)) for a in authors]

    if len(surnames) == 1:
        prefix = surnames[0][:2].upper()
    else:
        prefix = (surnames[0][0] + surnames[1][0]).upper()

    return prefix + suffix


class ProcessRequest(BaseModel):
    paperId: str
    fileUrl: str
    sections: list[dict]
    fileName: Optional[str] = None
    language: str = "en"
    provider: str = "openai"
    ## When True, skip metadata overwrite and source creation (Zotero already filled them).
    skip_metadata_enrichment: bool = False
    ## Zotero collection key to place newly created items into.
    zotero_collection: Optional[str] = None


@app.post("/process")
async def process(req: ProcessRequest):
    set_paper_context(req.paperId)
    logger = get_logger()
    logger.info(
        f"Pipeline started: paper={req.paperId}, file={req.fileName}, language={req.language}, "
        f"provider={req.provider}, sections={len(req.sections)}",
        extra={"step": "pipeline", "status": "started"},
    )

    tmp_path = None
    try:
        # 1. Download file to temp dir
        await _check_cancellation(req.paperId)
        await run_in_threadpool(convex_client.update_processing_step, req.paperId, "downloading")
        suffix = _get_suffix(req.fileUrl)
        with PipelineStep("download_file", detail=f"suffix={suffix}"):
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                tmp_path = f.name
            _download_file(req.fileUrl, tmp_path)
            file_size = os.path.getsize(tmp_path)
            logger.debug(f"Downloaded {file_size} bytes to {tmp_path}", extra={"step": "download_file"})

        # 2. Extract text + metadata
        await _check_cancellation(req.paperId)
        await run_in_threadpool(convex_client.update_processing_step, req.paperId, "extracting")
        with PipelineStep("extract_text", detail=f"format={suffix}"):
            extracted = extractor.extract(tmp_path, provider=req.provider)
            logger.debug(
                f"Extracted {len(extracted['text'])} chars, title={extracted['title']}, "
                f"authors={len(extracted['authors'])}, year={extracted['year']}",
                extra={"step": "extract_text"},
            )

        # 3. Detect identifiers
        await _check_cancellation(req.paperId)
        await run_in_threadpool(convex_client.update_processing_step, req.paperId, "identifying")
        with PipelineStep("detect_identifiers"):
            identifiers = identifier.detect(extracted["text"])
            logger.info(
                f"Found {len(identifiers)} identifiers: {[i['type'] for i in identifiers]}",
                extra={"step": "detect_identifiers"},
            )

        # 4. Summarize
        await _check_cancellation(req.paperId)
        await run_in_threadpool(convex_client.update_processing_step, req.paperId, "summarizing")
        with PipelineStep("summarize", detail=f"text_len={len(extracted['text'])}, language={req.language}"):
            summary = summarizer.summarize(extracted["text"], language=req.language, provider=req.provider)
            logger.debug(
                f"Summary keys: {list(summary.keys())}, findings={len(summary.get('keyFindings', []))}",
                extra={"step": "summarize"},
            )

        # 5. Save to Convex (summary only — citation happens on-demand via /cite)
        # When skip_metadata_enrichment is set (Zotero import), we only save
        # the summary and identifiers — title/authors/year are already correct.
        await _check_cancellation(req.paperId)
        await run_in_threadpool(convex_client.update_processing_step, req.paperId, "saving")
        with PipelineStep("save_to_convex"):
            if not req.skip_metadata_enrichment:
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

        # 6. Create/find Zotero item + create bibliography source record.
        # Skipped when Zotero already created the source record during import.
        metadata_source = "none"
        if not req.skip_metadata_enrichment:
            with PipelineStep("create_source"):
                source_type = "book"
                source_metadata: dict = {}
                zotero_item_key: str | None = None

                doi_ids = [i for i in identifiers if i["type"] == "DOI"]
                doi_value = doi_ids[0]["value"] if doi_ids else None

                # Use the same resolved title that was saved to Convex in step 5.
                # `title` was set in step 5 from fileName or extracted title.
                resolved_title = title

                # Try Zotero first: find existing item or create a new one
                try:
                    if doi_value:
                        zotero_item = zotero_client.lookup_by_doi(doi_value)
                        if zotero_item:
                            # Found in Zotero — use its metadata
                            zotero_item_key = zotero_item.get("key")
                            if zotero_item.get("sourceType"):
                                source_type = zotero_item["sourceType"]
                            if zotero_item.get("sourceMetadata"):
                                source_metadata = zotero_item["sourceMetadata"]
                            metadata_source = "zotero_found"
                            logger.info(f"[ZOTERO] Found existing item for DOI {doi_value}")
                        else:
                            # Not in Zotero — create new item + attach PDF
                            zotero_item_key = zotero_client.create_item(
                                title=resolved_title,
                                authors=extracted.get("authors", []),
                                year=extracted.get("year"),
                                doi=doi_value,
                                collection_key=req.zotero_collection,
                            )
                            if tmp_path and zotero_item_key:
                                zotero_client.attach_pdf(
                                    zotero_item_key, tmp_path, title=req.fileName or "PDF"
                                )
                            metadata_source = "zotero_created"
                    else:
                        # No DOI — still create a Zotero item with extracted metadata
                        zotero_item_key = zotero_client.create_item(
                            title=resolved_title,
                            authors=extracted.get("authors", []),
                            year=extracted.get("year"),
                            item_type="book",
                            collection_key=req.zotero_collection,
                        )
                        if tmp_path and zotero_item_key:
                            zotero_client.attach_pdf(
                                zotero_item_key, tmp_path, title=req.fileName or "PDF"
                            )
                        metadata_source = "zotero_created"

                    # Link paper to Zotero item
                    if zotero_item_key:
                        convex_client.update_zotero_item_key(req.paperId, zotero_item_key)

                except (ZoteroConfigError, ZoteroAuthError):
                    logger.info("[ZOTERO] Skipping Zotero integration (not configured)")
                except Exception as e:
                    logger.warning(f"[ZOTERO] Zotero integration failed, falling back: {e}")

                # CrossRef/OpenAlex fallback if Zotero didn't provide metadata
                if not source_metadata and doi_value:
                    crossref = identifier.lookup_doi_metadata(doi_value)
                    if crossref:
                        source_type = crossref.pop("sourceType", "book")
                        source_metadata = crossref
                        if metadata_source == "none":
                            metadata_source = "crossref"

                kuerzel = _generate_kuerzel(
                    extracted.get("authors", []),
                    extracted.get("year"),
                )

                # Separate editorNames (array) from scalar fields
                editor_names = source_metadata.get("editorNames")
                source_kwargs = {k: v for k, v in source_metadata.items() if v and k != "editorNames"}
                if editor_names:
                    source_kwargs["editorNames"] = editor_names

                try:
                    convex_client.create_source(
                        req.paperId,
                        source_type=source_type,
                        kuerzel=kuerzel,
                        **source_kwargs,
                    )
                except Exception as e:
                    # Non-fatal — the user can always create the source manually
                    logger.warning(f"[SOURCE] Failed to create source record: {e}")

        # Mark paper as completed after all steps succeed
        with PipelineStep("finalize_status"):
            convex_client.update_status(req.paperId, "completed")

        logger.info("Pipeline completed successfully", extra={"step": "pipeline", "status": "completed"})

    except PipelineCancelled:
        # User cancelled mid-flight — Convex already shows `cancelled`
        # so we just log and exit. The paper row stays cancelled until
        # the UI deletes it (or the user retries).
        logger.info(
            "Pipeline cancelled by user",
            extra={"step": "pipeline", "status": "cancelled"},
        )
        return JSONResponse(
            status_code=499,
            content={"detail": "cancelled"},
        )

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

    return {"status": "ok", "metadataSource": metadata_source}


class ProcessManualRequest(BaseModel):
    """Request body for summarizing pasted text from a manual source."""

    paperId: str
    text: str
    language: str = "en"
    provider: str = "openai"


@app.post("/process-manual")
async def process_manual(req: ProcessManualRequest):
    """Summarize raw text pasted by the user for a manual source.

    Skips download/extract/identify — goes straight to summarization.
    Sets manualContentSummarizedAt so the frontend knows the summary is fresh.
    """
    set_paper_context(req.paperId)
    logger = get_logger()
    logger.info(
        f"Manual processing started: paper={req.paperId}, text_len={len(req.text)}",
        extra={"step": "pipeline", "status": "started"},
    )

    try:
        await run_in_threadpool(convex_client.update_status, req.paperId, "processing")
        await run_in_threadpool(convex_client.update_processing_step, req.paperId, "summarizing")

        summary = await run_in_threadpool(
            summarizer.summarize, req.text, req.language, req.provider
        )

        await run_in_threadpool(convex_client.update_processing_step, req.paperId, "saving")
        await run_in_threadpool(
            convex_client.save_summary, req.paperId, summary, req.language
        )
        await run_in_threadpool(
            convex_client.set_manual_content_summarized_at, req.paperId
        )
        await run_in_threadpool(convex_client.update_status, req.paperId, "completed")

        logger.info(
            "Manual processing completed",
            extra={"step": "pipeline", "status": "completed"},
        )
        return {"status": "ok"}

    except Exception as e:
        logger.error(
            f"Manual processing failed: {type(e).__name__}: {e}",
            extra={"step": "pipeline", "status": "failed"},
        )
        try:
            convex_client.update_status(req.paperId, "failed", str(e))
        except Exception:
            pass
        return JSONResponse(status_code=500, content={"detail": str(e)})


class CiteRequest(BaseModel):
    """Request body for on-demand per-section citation."""

    paperId: str
    fileUrl: str = ""
    # IDs of the specific outline sections to cite against.
    sectionIds: list[str]
    # Full section objects from the outline (_id, title, orderNumber, notes).
    sections: list[dict]
    language: str = "en"
    provider: str = "openai"


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

        # Get text: from PDF file or from manual content
        if req.fileUrl:
            suffix = _get_suffix(req.fileUrl)
            with PipelineStep("download_file", detail=f"suffix={suffix}"):
                with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                    tmp_path = f.name
                _download_file(req.fileUrl, tmp_path)

            with PipelineStep("extract_text", detail=f"format={suffix}"):
                extracted = extractor.extract(tmp_path, provider=req.provider)
                paper_text = extracted["text"]
                page_source = extracted.get("page_source", "approximate")
                logger.debug(
                    f"Extracted {len(paper_text)} chars for citation (page_source={page_source})",
                    extra={"step": "extract_text"},
                )
        else:
            # Manual source: fetch stored text content from Convex
            paper = await run_in_threadpool(convex_client.get_paper, req.paperId)
            paper_text = paper.get("manualContent", "") if paper else ""
            if not paper_text:
                return JSONResponse(
                    status_code=400,
                    content={"detail": "No content available for citation matching"},
                )
            page_source = "none"
            logger.debug(
                f"Using manual content: {len(paper_text)} chars (no page numbers)",
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
                paper_text,
                language=cite_language,
                provider=req.provider,
            )
            matched = [s for s in scores if s["score"] > 0.0]
            logger.info(
                f"Scored {len(scores)} sections, {len(matched)} with score > 0",
                extra={"step": "score_sections"},
            )

        # Upsert citation matches (preserves other sections' matches)
        with PipelineStep("save_citation_matches"):
            convex_client.save_citation_matches(req.paperId, scores, page_source=page_source)

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


class OptimizeRequest(BaseModel):
    """Request body for AI text optimization."""
    text: str
    mode: str  # "enhance" | "formalize" | "simplify" | "expand"
    context_before: str = ""
    context_after: str = ""
    language: str = "en"
    provider: str = "openai"
    ## User-provided mode instruction that replaces the hardcoded default.
    ## Citation/language/format rules are still appended automatically.
    custom_prompt: str | None = None


@app.get("/optimize/defaults")
async def get_optimize_defaults():
    """Return the baseline mode instructions per language for the settings UI.

    The frontend uses these to show the user what they are customizing,
    avoiding hardcoding the same prompts in two places.
    """
    return {
        "modes": {
            "en": optimizer.MODE_INSTRUCTIONS,
            "de": optimizer.MODE_INSTRUCTIONS_DE,
        }
    }


@app.post("/optimize")
async def optimize_text(req: OptimizeRequest):
    """Optimize selected thesis text using AI.

    Supports four modes: enhance, formalize, simplify, expand.
    Expects citation placeholders ([REF1], [REF2]) to be preserved by the AI.
    """
    logger = get_logger()
    logger.info(
        f"Optimize started: mode={req.mode}, text_len={len(req.text)}, language={req.language}",
        extra={"step": "optimize", "status": "started"},
    )

    try:
        result = optimizer.optimize(
            text=req.text,
            mode=req.mode,
            context_before=req.context_before,
            context_after=req.context_after,
            language=req.language,
            provider=req.provider,
            custom_prompt=req.custom_prompt,
        )
        logger.info("Optimize completed", extra={"step": "optimize", "status": "completed"})
        return {"optimized": result}
    except ValueError as e:
        return JSONResponse(status_code=422, content={"detail": str(e)})
    except Exception as e:
        logger.error(
            f"Optimize failed: {type(e).__name__}: {e}",
            extra={"step": "optimize", "status": "failed"},
        )
        return JSONResponse(status_code=500, content={"detail": str(e)})


class SuggestGroupsRequest(BaseModel):
    """Request body for /suggest-groups.

    The Convex action layer assembles ``papers`` and ``groups`` from the
    database; this endpoint stays stateless and never queries Convex
    directly, mirroring the philosophy of /clarify and /optimize.
    """
    papers: list[dict]
    groups: list[dict]
    provider: str = "anthropic"


@app.post("/suggest-groups")
async def suggest_groups(req: SuggestGroupsRequest):
    """Score each paper against the supplied groups and return matches.

    Returns ``{"suggestions": [{paperId, groupId, confidence, reason}, ...]}``
    where every entry has confidence ≥ 0.7. The Convex action persists each
    one as a ``paperGroupSuggestions`` row (subject to dedupe rules).
    """
    logger = get_logger()
    logger.info(
        f"Suggest-groups started: papers={len(req.papers)}, "
        f"groups={len(req.groups)}, provider={req.provider}",
        extra={"step": "auto_group", "status": "started"},
    )
    try:
        suggestions: list[dict] = []
        for paper in req.papers:
            matches = await run_in_threadpool(
                grouper.suggest_for_paper,
                paper,
                req.groups,
                req.provider,
            )
            for m in matches:
                suggestions.append(
                    {
                        "paperId": paper["paperId"],
                        "groupId": m["groupId"],
                        "confidence": m["confidence"],
                        "reason": m["reason"],
                    }
                )
        logger.info(
            f"Suggest-groups completed: matches={len(suggestions)}",
            extra={"step": "auto_group", "status": "completed"},
        )
        return {"suggestions": suggestions}
    except Exception as e:
        logger.error(
            f"Suggest-groups failed: {type(e).__name__}: {e}",
            extra={"step": "auto_group", "status": "failed"},
        )
        return JSONResponse(status_code=500, content={"detail": str(e)})


class RecommendPapersRequest(BaseModel):
    """Request body for /recommend-papers.

    The Convex action layer assembles the candidate list (filtered by scope
    and with already-matched papers excluded) and calls this endpoint. The
    endpoint stays stateless and never queries Convex directly.
    """

    inputText: dict
    papers: list[dict]
    language: str = "en"
    provider: str = "anthropic"


@app.post("/recommend-papers")
async def recommend_papers(req: RecommendPapersRequest):
    """Score every candidate paper for citation relevance to the section.

    Returns ``{"recommendations": [...], "lowContext": bool}``. Each
    recommendation has ``paperId``, ``score`` (0..1), and ``reasoning`` in
    the requested language. Papers that fail to parse are silently dropped;
    a fully-failed run returns an empty list so the UI can show "no matches"
    rather than an error.
    """
    logger = get_logger()
    logger.info(
        f"Recommend-papers started: papers={len(req.papers)}, "
        f"language={req.language}, provider={req.provider}",
        extra={"step": "recommend_papers", "status": "started"},
    )

    try:
        result = await recommender.recommend(
            input_text=req.inputText,
            papers=req.papers,
            language=req.language,
            provider=req.provider,
        )
        logger.info(
            f"Recommend-papers completed: scored={len(result['recommendations'])}, "
            f"lowContext={result['lowContext']}",
            extra={"step": "recommend_papers", "status": "completed"},
        )
        return result
    except Exception as e:
        logger.error(
            f"Recommend-papers failed: {type(e).__name__}: {e}",
            extra={"step": "recommend_papers", "status": "failed"},
        )
        return JSONResponse(status_code=500, content={"detail": str(e)})


class ClarifyRequest(BaseModel):
    """Request body for the section-writer clarify step."""
    sectionId: str
    guidance: str | None = None
    provider: str = "anthropic"


class AnswerPair(BaseModel):
    """One clarify question + the user's free-form answer."""
    question: str
    answer: str


class GenerateSectionRequest(BaseModel):
    """Request body for the streaming /generate-section endpoint."""
    sectionId: str
    guidance: str | None = None
    answers: list[AnswerPair] = []
    provider: str = "anthropic"


@app.post("/clarify")
async def clarify_section(req: ClarifyRequest):
    """Decide whether the AI needs the user to answer questions first.

    Cheap synchronous JSON call. Returns
    ``{"needs_clarification": false}`` when the outline notes, guidance,
    and mapped excerpts are sufficient — otherwise returns up to 4
    free-form questions for the user to answer before drafting begins.
    """
    logger = get_logger()
    logger.info(
        f"Clarify started: sectionId={req.sectionId}, provider={req.provider}",
        extra={"step": "section_clarify", "status": "started"},
    )

    try:
        ctx = await run_in_threadpool(
            convex_client.get_generation_context, req.sectionId
        )
        if not ctx:
            return JSONResponse(status_code=404, content={"detail": "Section not found"})

        # Block early when there is nothing to ground citations in. The
        # frontend already gates the button, but we double-check here so
        # a stale UI can't slip through.
        if not (ctx.get("matches") or []):
            return {
                "needs_clarification": False,
                "questions": [],
                "blocked": "no_matches",
            }

        payload = section_writer.build_context_payload(ctx)
        system, user = section_writer.build_clarify_messages(payload, req.guidance)

        raw = await run_in_threadpool(
            ai_client.chat_completion,
            req.provider,
            "writer",
            system,
            user,
            512,  # questions are short; capping cost
        )
        parsed = section_writer.parse_clarify_response(raw)
        logger.info(
            f"Clarify completed: needs={parsed['needs_clarification']}, "
            f"questions={len(parsed.get('questions', []))}",
            extra={"step": "section_clarify", "status": "completed"},
        )
        return parsed
    except Exception as e:
        logger.error(
            f"Clarify failed: {type(e).__name__}: {e}",
            extra={"step": "section_clarify", "status": "failed"},
        )
        return JSONResponse(status_code=500, content={"detail": str(e)})


@app.post("/generate-section")
async def generate_section(req: GenerateSectionRequest):
    """Stream a drafted thesis section as Server-Sent Events.

    The body of the response is a sequence of ``data: {json}\\n\\n``
    frames carrying ``token`` deltas, then a final ``done`` event with
    the full text and any citation-validator warnings. Errors arrive as
    ``error`` events. The frontend reads the stream via fetch +
    ReadableStream and can abort at any time with AbortController.
    """
    logger = get_logger()
    logger.info(
        f"Generate-section started: sectionId={req.sectionId}, provider={req.provider}",
        extra={"step": "section_generate", "status": "started"},
    )

    def emit(event_type: str, payload: dict) -> str:
        """Format a single SSE frame matching the /zotero/import convention."""
        return f"data: {json.dumps({'type': event_type, **payload})}\n\n"

    async def event_generator():
        try:
            ctx = await run_in_threadpool(
                convex_client.get_generation_context, req.sectionId
            )
            if not ctx:
                yield emit("error", {"message": "Section not found"})
                return
            if not (ctx.get("matches") or []):
                # Frontend should not let us get here, but fail safe rather
                # than producing uncited prose.
                yield emit("error", {"message": "No mapped papers for this section."})
                return

            payload = section_writer.build_context_payload(ctx)
            system, user = section_writer.build_generation_messages(
                payload,
                req.guidance,
                [a.model_dump() for a in req.answers],
            )

            allowed_ids = [m["paperId"] for m in payload.get("matches") or []]
            allowed_pages = section_writer.collect_allowed_pages_by_paper(payload)

            # Prime the stream so any reverse-proxy buffering flushes
            # before the first model token arrives.
            yield emit("ready", {})

            full_chunks: list[str] = []
            stream = ai_client.chat_completion_stream(
                provider=req.provider,
                module="writer",
                system=system,
                user_message=user,
                max_tokens=4096,
            )

            # The OpenAI/Anthropic SDKs are synchronous — running them on
            # the asyncio event loop directly would block other handlers.
            # ``iterate_in_threadpool`` would be ideal but is unavailable
            # for arbitrary generators, so we drive the iterator from a
            # threadpool one chunk at a time using a sentinel.
            sentinel = object()
            iterator = iter(stream)

            def _next_chunk():
                """Fetch the next delta from the SDK iterator (blocking)."""
                try:
                    return next(iterator)
                except StopIteration:
                    return sentinel

            while True:
                chunk = await run_in_threadpool(_next_chunk)
                if chunk is sentinel:
                    break
                full_chunks.append(chunk)
                yield emit("token", {"delta": chunk})

            full_text = "".join(full_chunks)
            cleaned, warnings = section_writer.validate_citation_markers(
                full_text, allowed_ids, allowed_pages
            )
            yield emit("done", {"fullText": cleaned, "warnings": warnings})
            logger.info(
                f"Generate-section completed: chars={len(cleaned)}, "
                f"warnings={len(warnings)}",
                extra={"step": "section_generate", "status": "completed"},
            )
        except Exception as e:
            logger.error(
                f"Generate-section failed: {type(e).__name__}: {e}",
                extra={"step": "section_generate", "status": "failed"},
            )
            yield emit("error", {"message": str(e)})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class DetectCitationsRequest(BaseModel):
    """Request body for the auto-citation detect phase.

    The frontend posts the live section body so the model marks claims
    against the prose the user is currently editing — not whatever was
    last saved to Convex. The sectionId is still required so we can
    fetch the matched-papers context for grounding.
    """
    sectionId: str
    body: str
    provider: str = "anthropic"


@app.post("/detect-citations")
async def detect_citations(req: DetectCitationsRequest):
    """Walk a section body and return the sentences that need citations.

    Synchronous (non-streaming) JSON call. The frontend cannot act on a
    partial result, so streaming would only complicate the contract.
    Long bodies are paragraph-chunked behind the scenes; results from
    each chunk are merged before validation.
    """
    logger = get_logger()
    logger.info(
        f"Detect-citations started: sectionId={req.sectionId}, provider={req.provider}, "
        f"chars={len(req.body)}",
        extra={"step": "auto_cite_detect", "status": "started"},
    )

    try:
        ctx = await run_in_threadpool(
            convex_client.get_generation_context, req.sectionId
        )
        if not ctx:
            return JSONResponse(status_code=404, content={"detail": "Section not found"})
        if not (ctx.get("matches") or []):
            # With no mapped papers there is nothing to cite. Frontend
            # should disable the button, but we return a clean empty
            # result rather than 4xx-ing so a stale UI degrades gracefully.
            return {"items": [], "warnings": ["No mapped papers for this section."]}

        payload = section_writer.build_context_payload(ctx)
        allowed_ids = [m["paperId"] for m in payload.get("matches") or []]

        chunks = section_writer.chunk_body_for_detection(req.body)
        merged_items: list[dict] = []
        merged_warnings: list[str] = []

        for chunk in chunks:
            system, user = section_writer.build_detect_messages(payload, chunk)
            raw = await run_in_threadpool(
                ai_client.chat_completion,
                req.provider,
                "writer",
                system,
                user,
                4096,
            )
            parsed = section_writer.parse_detect_response(raw, allowed_ids)
            merged_items.extend(parsed.get("items", []))
            merged_warnings.extend(parsed.get("warnings", []))

        logger.info(
            f"Detect-citations completed: items={len(merged_items)}, "
            f"chunks={len(chunks)}, warnings={len(merged_warnings)}",
            extra={"step": "auto_cite_detect", "status": "completed"},
        )
        return {"items": merged_items, "warnings": merged_warnings}
    except Exception as e:
        logger.error(
            f"Detect-citations failed: {type(e).__name__}: {e}",
            extra={"step": "auto_cite_detect", "status": "failed"},
        )
        return JSONResponse(status_code=500, content={"detail": str(e)})


class ValidateCitationItem(BaseModel):
    """One placeholder the validate phase should score."""
    placeholder_id: str
    claim_sentence: str
    candidate_paper_ids: list[str]


class ValidateCitationsRequest(BaseModel):
    """Request body for the auto-citation validate phase."""
    sectionId: str
    body: str
    items: list[ValidateCitationItem]
    provider: str = "anthropic"


@app.post("/validate-citations")
async def validate_citations(req: ValidateCitationsRequest):
    """Score each placeholder's candidate paperIds against its claim.

    Returns a per-placeholder list of candidates with score, page ref
    drawn from a real excerpt, and a one-sentence justification. The
    frontend applies the auto-insert threshold (≥0.75) and creates a
    section TODO for any unresolved placeholder.
    """
    logger = get_logger()
    logger.info(
        f"Validate-citations started: sectionId={req.sectionId}, "
        f"items={len(req.items)}, provider={req.provider}",
        extra={"step": "auto_cite_validate", "status": "started"},
    )

    try:
        if not req.items:
            return {"results": []}

        ctx = await run_in_threadpool(
            convex_client.get_generation_context, req.sectionId
        )
        if not ctx:
            return JSONResponse(status_code=404, content={"detail": "Section not found"})

        payload = section_writer.build_context_payload(ctx)
        allowed_ids = [m["paperId"] for m in payload.get("matches") or []]
        allowed_pages = section_writer.collect_allowed_pages_by_paper(payload)

        items_dicts = [item.model_dump() for item in req.items]
        batches = section_writer.chunk_validate_items(items_dicts)
        merged: list[dict] = []

        for batch in batches:
            system, user = section_writer.build_validate_messages(payload, batch)
            raw = await run_in_threadpool(
                ai_client.chat_completion,
                req.provider,
                "writer",
                system,
                user,
                4096,
            )
            parsed = section_writer.parse_validate_response(
                raw, allowed_ids, allowed_pages
            )
            merged.extend(parsed.get("results", []))

        logger.info(
            f"Validate-citations completed: results={len(merged)}, "
            f"batches={len(batches)}",
            extra={"step": "auto_cite_validate", "status": "completed"},
        )
        return {"results": merged}
    except Exception as e:
        logger.error(
            f"Validate-citations failed: {type(e).__name__}: {e}",
            extra={"step": "auto_cite_validate", "status": "failed"},
        )
        return JSONResponse(status_code=500, content={"detail": str(e)})


@app.post("/export")
async def export_docx():
    """Generate and return the complete thesis as a .docx file.

    Fetches all thesis data from Convex, downloads figure images,
    builds the document using HKADocxBuilder, and streams the result.
    """
    logger = get_logger()
    logger.info("Export started", extra={"step": "export", "status": "started"})

    try:
        # 1. Fetch all thesis data from Convex
        data = await run_in_threadpool(convex_client.get_thesis_data)

        # 2. Download all figure images
        figure_bytes: dict[str, bytes] = {}
        for fig in data.get("figures", []):
            url = fig.get("url")
            if url:
                img_data = await run_in_threadpool(convex_client.get_file_bytes, url)
                if img_data:
                    figure_bytes[fig["_id"]] = img_data

        # 3. Build .docx
        builder = docx_builder.HKADocxBuilder(data, figure_bytes)
        doc = await run_in_threadpool(builder.build)

        # 4. Save to buffer and stream back
        buffer = io.BytesIO()
        doc.save(buffer)
        buffer.seek(0)

        logger.info("Export completed", extra={"step": "export", "status": "completed"})

        return StreamingResponse(
            buffer,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": 'attachment; filename="thesis.docx"'},
        )

    except Exception as e:
        logger.error(
            f"Export failed: {type(e).__name__}: {e}",
            extra={"step": "export", "status": "failed"},
        )
        return JSONResponse(status_code=500, content={"detail": str(e)})


class LookupMetadataRequest(BaseModel):
    """Request body for on-demand DOI metadata lookup."""
    paperId: str
    doi: str


@app.post("/lookup-metadata")
async def lookup_metadata(req: LookupMetadataRequest):
    """Look up bibliographic metadata with Zotero-first fallback chain.

    Tries: Zotero library → CrossRef → OpenAlex.
    Called from the frontend when a user wants to auto-fill source fields
    from a DOI. Returns the raw metadata dict so the UI can let the user
    review and confirm before saving.
    """
    logger = get_logger()
    logger.info(
        f"Metadata lookup started: paper={req.paperId}, doi={req.doi}",
        extra={"step": "lookup_metadata", "status": "started"},
    )

    # 1. Try Zotero first — richest metadata if the paper is in the library
    result = None
    try:
        zotero_item = zotero_client.lookup_by_doi(req.doi)
        if zotero_item:
            result = {**zotero_item["sourceMetadata"], "sourceType": zotero_item["sourceType"], "source": "zotero"}
    except (ZoteroConfigError, ZoteroAuthError):
        # Zotero not configured or invalid credentials — skip silently
        pass
    except Exception as e:
        logger.warning(f"Zotero lookup failed, falling back: {e}")

    # 2. Fall back to CrossRef
    if result is None:
        result = identifier.lookup_doi_metadata(req.doi)
        if result is not None:
            result["source"] = "crossref"

    # 3. Fall back to OpenAlex
    if result is None:
        result = identifier.lookup_openalex_metadata(req.doi)
        if result is not None:
            result["source"] = "openalex"

    if result is None:
        logger.info(
            f"No metadata found for DOI: {req.doi}",
            extra={"step": "lookup_metadata", "status": "not_found"},
        )
        return JSONResponse(
            status_code=404,
            content={"detail": "No metadata found for this DOI"},
        )

    logger.info(
        f"Metadata lookup succeeded: doi={req.doi}, source={result.get('source', 'unknown')}, fields={list(result.keys())}",
        extra={"step": "lookup_metadata", "status": "completed"},
    )
    return result


# ===== ZOTERO ENDPOINTS =====


@app.get("/zotero/collections")
async def zotero_collections():
    """Return the user's Zotero collections for the import picker."""
    try:
        collections = zotero_client.list_collections()
        return {"collections": collections}
    except ZoteroConfigError as e:
        return JSONResponse(status_code=503, content={"detail": str(e)})
    except ZoteroAuthError as e:
        return JSONResponse(status_code=401, content={"detail": str(e)})
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": f"Zotero API error: {e}"})


@app.get("/zotero/items")
async def zotero_items(collection: Optional[str] = None):
    """Return Zotero items, optionally filtered to a collection.

    Includes a hasPdf flag and pdfAttachmentKey for each item so the
    frontend can show a PDF icon and the import endpoint knows which
    attachments to download.
    """
    try:
        items = zotero_client.list_items(collection)
        items = zotero_client.check_items_have_pdf(items)
        return {"items": items}
    except ZoteroConfigError as e:
        return JSONResponse(status_code=503, content={"detail": str(e)})
    except ZoteroAuthError as e:
        return JSONResponse(status_code=401, content={"detail": str(e)})
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": f"Zotero API error: {e}"})


@app.delete("/zotero/item/{item_key}")
async def zotero_delete_item(item_key: str):
    """Delete an item from the user's Zotero library."""
    try:
        zotero_client.delete_item(item_key)
        return {"status": "deleted"}
    except PermissionError as e:
        return JSONResponse(status_code=403, content={"detail": str(e)})
    except ZoteroConfigError as e:
        return JSONResponse(status_code=503, content={"detail": str(e)})
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": f"Zotero delete failed: {e}"})


class ZoteroImportRequest(BaseModel):
    """Request body for importing selected Zotero items."""
    items: list[dict]
    sections: list[dict] = []
    language: str = "en"
    provider: str = "openai"


@app.post("/zotero/import")
async def zotero_import(req: ZoteroImportRequest):
    """Import selected Zotero items as papers via SSE streaming.

    Streams per-step progress events so the frontend log panel updates in
    real-time. Each sub-operation emits a progress event; each item emits
    an item_complete event; and a final done event closes the stream.
    """
    logger = get_logger()
    logger.info(
        f"Zotero import started: {len(req.items)} items",
        extra={"step": "zotero_import", "status": "started"},
    )

    async def event_generator():
        """Yield SSE events as each import step completes."""
        success_count = 0
        total_count = len(req.items)

        def emit(event_type: str, payload: dict) -> str:
            """Format a payload as an SSE data line."""
            return f"data: {json.dumps({'type': event_type, **payload})}\n\n"

        for item in req.items:
            item_key = item.get("key", "unknown")
            try:
                title = item.get("title", "Untitled")
                authors = item.get("authors", [])
                year = item.get("year")
                doi = item.get("doi")
                isbn = item.get("isbn")
                source_type = item.get("sourceType", "book")
                source_metadata = item.get("sourceMetadata", {})
                has_pdf = item.get("hasPdf", False)
                pdf_attachment_key = item.get("pdfAttachmentKey")

                storage_id = None
                file_url = None
                file_name = None

                # Download and upload PDF if available
                if has_pdf and pdf_attachment_key:
                    yield emit("progress", {"itemKey": item_key, "title": title, "step": "downloading_pdf", "message": f"Downloading PDF for '{title}'..."})
                    await asyncio.sleep(0)

                    with PipelineStep("zotero_download_pdf", detail=title):
                        pdf_bytes = await run_in_threadpool(
                            zotero_client.download_pdf, pdf_attachment_key
                        )

                    yield emit("progress", {"itemKey": item_key, "title": title, "step": "uploading_storage", "message": f"Uploading PDF to storage ({len(pdf_bytes)} bytes)..."})
                    await asyncio.sleep(0)

                    with PipelineStep("zotero_upload_storage", detail=title):
                        storage_id, file_url = await run_in_threadpool(
                            convex_client.upload_file, pdf_bytes
                        )
                    file_name = f"{title}.pdf"

                # Create paper record with Zotero metadata
                yield emit("progress", {"itemKey": item_key, "title": title, "step": "creating_paper", "message": f"Creating paper record for '{title}'..."})
                await asyncio.sleep(0)

                with PipelineStep("zotero_create_paper", detail=title):
                    paper_id = await run_in_threadpool(
                        convex_client.create_paper_from_zotero,
                        title=title,
                        authors=authors,
                        year=year,
                        storage_id=storage_id,
                        file_url=file_url,
                        file_name=file_name,
                        zotero_item_key=item_key,
                    )
                logger.info(f"[ZOTERO] Created paper {paper_id} for '{title}'")

                # Save identifiers (DOI, ISBN)
                identifiers_to_save = []
                if doi:
                    identifiers_to_save.append({"type": "DOI", "value": doi})
                if isbn:
                    identifiers_to_save.append({"type": "ISBN", "value": isbn})
                if identifiers_to_save:
                    yield emit("progress", {"itemKey": item_key, "title": title, "step": "saving_identifiers", "message": f"Saving identifiers ({', '.join(i['type'] for i in identifiers_to_save)})..."})
                    await asyncio.sleep(0)

                    with PipelineStep("zotero_save_identifiers", detail=title):
                        await run_in_threadpool(
                            convex_client.save_identifiers, paper_id, identifiers_to_save
                        )

                # Create source record with Zotero bibliographic data
                yield emit("progress", {"itemKey": item_key, "title": title, "step": "creating_source", "message": f"Creating bibliography source for '{title}'..."})
                await asyncio.sleep(0)

                with PipelineStep("zotero_create_source", detail=title):
                    kuerzel = _generate_kuerzel(authors, year)
                    editor_names = source_metadata.get("editorNames")
                    source_kwargs = {k: v for k, v in source_metadata.items() if v and k != "editorNames"}
                    if editor_names:
                        source_kwargs["editorNames"] = editor_names

                    try:
                        await run_in_threadpool(
                            convex_client.create_source,
                            paper_id,
                            source_type=source_type,
                            kuerzel=kuerzel,
                            **source_kwargs,
                        )
                    except Exception as e:
                        logger.warning(f"[ZOTERO] Failed to create source for '{title}': {e}")

                # Trigger processing pipeline if we have a PDF
                if file_url:
                    yield emit("progress", {"itemKey": item_key, "title": title, "step": "processing", "message": f"Processing '{title}' (text extraction + AI summary)..."})
                    await asyncio.sleep(0)

                    await run_in_threadpool(
                        convex_client.update_status, paper_id, "processing"
                    )
                    process_req = ProcessRequest(
                        paperId=paper_id,
                        fileUrl=file_url,
                        sections=req.sections,
                        fileName=file_name,
                        language=req.language,
                        provider=req.provider,
                        skip_metadata_enrichment=True,
                    )
                    await process(process_req)

                success_count += 1
                yield emit("item_complete", {"itemKey": item_key, "status": "success", "paperId": paper_id})
                await asyncio.sleep(0)

            except Exception as e:
                logger.error(f"[ZOTERO] Failed to import item {item_key}: {e}")
                yield emit("item_complete", {"itemKey": item_key, "status": "error", "error": str(e)})
                await asyncio.sleep(0)

        yield emit("done", {"successCount": success_count, "totalCount": total_count})
        logger.info(
            f"Zotero import completed: {success_count}/{total_count} succeeded",
            extra={"step": "zotero_import", "status": "completed"},
        )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ===== HELPERS =====


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
