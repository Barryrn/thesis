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

import convex_client
import docx_builder
import extractor
import identifier
import mapper
import optimizer
import summarizer
import zotero_client
from zotero_client import ZoteroConfigError, ZoteroAuthError
from pipeline_logger import get_logger, set_paper_context, PipelineStep

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

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
        await run_in_threadpool(convex_client.update_processing_step, req.paperId, "downloading")
        suffix = _get_suffix(req.fileUrl)
        with PipelineStep("download_file", detail=f"suffix={suffix}"):
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                tmp_path = f.name
            _download_file(req.fileUrl, tmp_path)
            file_size = os.path.getsize(tmp_path)
            logger.debug(f"Downloaded {file_size} bytes to {tmp_path}", extra={"step": "download_file"})

        # 2. Extract text + metadata
        await run_in_threadpool(convex_client.update_processing_step, req.paperId, "extracting")
        with PipelineStep("extract_text", detail=f"format={suffix}"):
            extracted = extractor.extract(tmp_path, provider=req.provider)
            logger.debug(
                f"Extracted {len(extracted['text'])} chars, title={extracted['title']}, "
                f"authors={len(extracted['authors'])}, year={extracted['year']}",
                extra={"step": "extract_text"},
            )

        # 3. Detect identifiers
        await run_in_threadpool(convex_client.update_processing_step, req.paperId, "identifying")
        with PipelineStep("detect_identifiers"):
            identifiers = identifier.detect(extracted["text"])
            logger.info(
                f"Found {len(identifiers)} identifiers: {[i['type'] for i in identifiers]}",
                extra={"step": "detect_identifiers"},
            )

        # 4. Summarize
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


class CiteRequest(BaseModel):
    """Request body for on-demand per-section citation."""

    paperId: str
    fileUrl: str
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

        # Download and extract text
        suffix = _get_suffix(req.fileUrl)
        with PipelineStep("download_file", detail=f"suffix={suffix}"):
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                tmp_path = f.name
            _download_file(req.fileUrl, tmp_path)

        with PipelineStep("extract_text", detail=f"format={suffix}"):
            extracted = extractor.extract(tmp_path, provider=req.provider)
            page_source = extracted.get("page_source", "approximate")
            logger.debug(
                f"Extracted {len(extracted['text'])} chars for citation (page_source={page_source})",
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
