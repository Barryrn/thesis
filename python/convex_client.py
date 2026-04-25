from __future__ import annotations

import os
import time
import httpx
from dotenv import load_dotenv

from pipeline_logger import get_logger

load_dotenv()

CONVEX_URL = os.environ["CONVEX_URL"]
CONVEX_KEY = os.environ["CONVEX_DEPLOY_KEY"]
HEADERS = {
    "Authorization": f"Convex {CONVEX_KEY}",
    "Content-Type": "application/json",
}


def _query(name: str, args: dict):
    """Call a Convex query by function name."""
    logger = get_logger()
    t0 = time.monotonic()
    try:
        res = httpx.post(
            f"{CONVEX_URL}/api/query",
            headers=HEADERS,
            json={"path": name, "args": args},
            timeout=10,
        )
        res.raise_for_status()
        elapsed = round((time.monotonic() - t0) * 1000, 1)
        logger.debug(f"Convex query completed: {name} ({elapsed}ms)")
        return res.json()
    except Exception as e:
        elapsed = round((time.monotonic() - t0) * 1000, 1)
        logger.error(f"Convex query failed: {name} ({elapsed}ms) - {type(e).__name__}: {e}")
        raise


def _mutation(name: str, args: dict):
    """Call a Convex mutation by function name."""
    logger = get_logger()
    logger.debug(f"Convex mutation started: {name}", extra={"step": "convex_mutation", "mutation": name, "status": "started"})

    t0 = time.monotonic()
    try:
        res = httpx.post(
            f"{CONVEX_URL}/api/mutation",
            headers=HEADERS,
            json={"path": name, "args": args},
            timeout=30,
        )
        res.raise_for_status()
        elapsed = round((time.monotonic() - t0) * 1000, 1)
        logger.debug(f"Convex mutation completed: {name} ({elapsed}ms)",
                      extra={"step": "convex_mutation", "mutation": name, "status": "completed", "elapsed_ms": elapsed})
        return res.json()
    except Exception as e:
        elapsed = round((time.monotonic() - t0) * 1000, 1)
        logger.error(f"Convex mutation failed: {name} ({elapsed}ms) - {type(e).__name__}: {e}",
                      extra={"step": "convex_mutation", "mutation": name, "status": "failed",
                             "elapsed_ms": elapsed, "error_type": type(e).__name__, "error_message": str(e)})
        raise


def update_status(paper_id: str, status: str, error: str | None = None):
    """Call papers:updatePaperStatus."""
    args: dict = {"paperId": paper_id, "status": status}
    if error is not None:
        args["errorMessage"] = error
    return _mutation("papers:updatePaperStatus", args)


def update_processing_step(paper_id: str, step: str | None):
    """Call papers:updateProcessingStep to update the UI progress indicator."""
    args: dict = {"paperId": paper_id}
    if step is not None:
        args["step"] = step
    return _mutation("papers:updateProcessingStep", args)


def update_metadata(paper_id: str, title: str, authors: list[str], year: int | None):
    """Call papers:updatePaperMetadata."""
    args: dict = {
        "paperId": paper_id,
        "title": title,
        "authors": authors,
    }
    if year is not None:
        args["year"] = year
    return _mutation("papers:updatePaperMetadata", args)


def save_identifiers(paper_id: str, identifiers: list[dict]):
    """Call summaries:createIdentifiers.

    Maps identifier.py's {"type", "value"} to Convex's
    {"identifierType", "identifierValue"}.
    """
    mapped = [
        {"identifierType": i["type"], "identifierValue": i["value"]}
        for i in identifiers
    ]
    return _mutation("summaries:createIdentifiers", {
        "paperId": paper_id,
        "identifiers": mapped,
    })


def save_summary(paper_id: str, summary: dict, language: str = "en"):
    """Call summaries:createSummary.

    Stores the language used during generation so the /cite endpoint can
    produce excerpts in the same language as the document's summary.
    """
    return _mutation("summaries:createSummary", {
        "paperId": paper_id,
        "researchQuestion": summary["researchQuestion"],
        "methodology": summary["methodology"],
        "keyFindings": summary["keyFindings"],
        "keywords": summary["keywords"],
        "rawSummary": summary["rawSummary"],
        "language": language,
    })


def get_summary_language(paper_id: str) -> str | None:
    """Return the stored language code for this paper's summary, or None.

    Used by the /cite endpoint to produce excerpts in the document's own
    language rather than falling back to a global setting.
    """
    result = _query("summaries:getSummaryByPaper", {"paperId": paper_id})
    summary = result.get("value")
    if summary:
        return summary.get("language")
    return None


def save_citation_matches(
    paper_id: str,
    scored_sections: list[dict],
    page_source: str = "approximate",
):
    """Upsert citation matches for specific sections only.

    Unlike save_matches_with_excerpts, this preserves existing matches
    for other sections — only the scored sections are overwritten.
    Called by the /cite endpoint for on-demand per-section citation.

    When page_source is 'approximate', all excerpts are flagged with
    pageNumberApproximate=True so the frontend can show a warning.
    """
    filtered = [s for s in scored_sections if s["score"] > 0.0]
    if not filtered:
        return None

    is_approximate = page_source == "approximate"

    all_excerpts = []
    matches_payload = [
        {"sectionId": s["sectionId"], "relevanceScore": s["score"]}
        for s in filtered
    ]

    # Collect excerpts (sectionId replaces matchId — resolved server-side)
    for section in filtered:
        if section.get("excerpts"):
            for order_idx, exc in enumerate(section["excerpts"]):
                excerpt_obj: dict = {
                    "sectionId": section["sectionId"],
                    "excerptText": exc["text"],
                    "relevanceNote": exc["relevanceNote"],
                    "orderIndex": order_idx,
                }
                if exc.get("pageNumber"):
                    excerpt_obj["pageNumber"] = exc["pageNumber"]
                excerpt_obj["pageNumberApproximate"] = is_approximate
                all_excerpts.append(excerpt_obj)

    return _mutation("matches:upsertCitationMatches", {
        "paperId": paper_id,
        "matches": matches_payload,
        "excerpts": all_excerpts,
    })


# Fields that the Convex sources table accepts as optional kwargs
_SOURCE_OPTIONAL_FIELDS = {
    "publisher", "publisherLocation", "edition",
    "journalName", "volume", "issue",
    "pageStart", "pageEnd",
    "url", "accessDate",
    "newspaperName", "publishDate", "language",
    "editorBookTitle",
}


def create_source(
    paper_id: str,
    source_type: str,
    kuerzel: str,
    kuerzel_manual_override: bool = False,
    **kwargs,
):
    """Create a bibliography source record linked to a paper.

    Convex uses the source record to generate HKA-style citations,
    so we populate as many fields as possible from CrossRef/OpenAlex
    metadata during processing to reduce manual data entry later.
    """
    args: dict = {
        "paperId": paper_id,
        "sourceType": source_type,
        "kuerzel": kuerzel,
        "kuerzelManualOverride": kuerzel_manual_override,
    }

    # Forward known optional fields from kwargs
    for field in _SOURCE_OPTIONAL_FIELDS:
        if field in kwargs and kwargs[field] is not None:
            args[field] = kwargs[field]

    # editorNames is an array and needs special handling
    if "editorNames" in kwargs and kwargs["editorNames"] is not None:
        args["editorNames"] = kwargs["editorNames"]

    return _mutation("sources:createSource", args)


def update_source(source_id: str, **fields):
    """Update fields on an existing bibliography source record.

    Accepts the Convex source document ID and any fields to patch.
    Used by the /lookup-metadata flow when the user confirms enriched
    metadata from CrossRef or OpenAlex.
    """
    args: dict = {"sourceId": source_id}

    for field in _SOURCE_OPTIONAL_FIELDS:
        if field in fields and fields[field] is not None:
            args[field] = fields[field]

    if "editorNames" in fields and fields["editorNames"] is not None:
        args["editorNames"] = fields["editorNames"]
    if "sourceType" in fields and fields["sourceType"] is not None:
        args["sourceType"] = fields["sourceType"]
    if "kuerzel" in fields and fields["kuerzel"] is not None:
        args["kuerzel"] = fields["kuerzel"]

    return _mutation("sources:updateSource", args)


def upload_file(file_bytes: bytes, content_type: str = "application/pdf") -> tuple[str, str]:
    """Upload a file to Convex storage and return (storageId, fileUrl).

    Used by the Zotero import flow to store downloaded PDFs. Mirrors
    the three-step process the frontend uses: generate URL → POST bytes
    → resolve public file URL.
    """
    logger = get_logger()

    # 1. Get a one-time upload URL from Convex
    result = _mutation("papers:generateUploadUrl", {})
    upload_url = result.get("value")
    if not upload_url:
        raise RuntimeError("Failed to obtain Convex upload URL")

    # 2. POST the raw file bytes to the upload URL
    res = httpx.post(
        upload_url,
        content=file_bytes,
        headers={"Content-Type": content_type},
        timeout=60,
    )
    res.raise_for_status()
    storage_id = res.json().get("storageId")
    if not storage_id:
        raise RuntimeError("Convex upload did not return a storageId")

    # 3. Resolve the public file URL
    url_result = _query("papers:getFileUrl", {"storageId": storage_id})
    file_url = url_result.get("value")
    if not file_url:
        raise RuntimeError(f"Failed to resolve file URL for storageId={storage_id}")

    logger.info(
        f"Uploaded {len(file_bytes)} bytes to Convex storage: storageId={storage_id}",
        extra={"step": "upload_file"},
    )
    return storage_id, file_url


def create_paper_from_zotero(
    title: str,
    authors: list[str],
    year: int | None = None,
    storage_id: str | None = None,
    file_url: str | None = None,
    file_name: str | None = None,
    zotero_item_key: str | None = None,
) -> str:
    """Create a paper record from pre-filled Zotero metadata.

    Returns the new paper's Convex document ID.
    """
    args: dict = {"title": title, "authors": authors}
    if year is not None:
        args["year"] = year
    if storage_id is not None:
        args["storageId"] = storage_id
    if file_url is not None:
        args["fileUrl"] = file_url
    if file_name is not None:
        args["fileName"] = file_name
    if zotero_item_key is not None:
        args["zoteroItemKey"] = zotero_item_key

    result = _mutation("papers:createPaperFromZotero", args)
    return result.get("value")


def update_zotero_item_key(paper_id: str, zotero_item_key: str):
    """Link a paper to a Zotero library item after upload-to-Zotero."""
    return _mutation("papers:updateZoteroItemKey", {
        "paperId": paper_id,
        "zoteroItemKey": zotero_item_key,
    })


def save_matches_with_excerpts(
    paper_id: str,
    scored_sections: list[dict],
    page_source: str = "approximate",
):
    """Save matches and their supporting excerpts to Convex.

    Only saves sections with score > 0.0. After creating matches,
    saves any excerpts linked to the returned match IDs.

    When page_source is 'approximate', all excerpts are flagged with
    pageNumberApproximate=True so the frontend can show a warning.
    """
    filtered = [s for s in scored_sections if s["score"] > 0.0]
    if not filtered:
        return None

    is_approximate = page_source == "approximate"

    # Step 1: Create matches and get back match IDs
    result = _mutation("matches:createMatches", {
        "paperId": paper_id,
        "matches": [
            {"sectionId": s["sectionId"], "relevanceScore": s["score"]}
            for s in filtered
        ],
    })

    # Convex HTTP API returns {"status": "success", "value": [...]}
    match_ids = result.get("value", [])

    # Step 2: Collect all excerpts with their match IDs
    all_excerpts = []
    for i, section in enumerate(filtered):
        if i < len(match_ids) and section.get("excerpts"):
            for order_idx, exc in enumerate(section["excerpts"]):
                excerpt_obj: dict = {
                    "matchId": match_ids[i],
                    "sectionId": section["sectionId"],
                    "excerptText": exc["text"],
                    "relevanceNote": exc["relevanceNote"],
                    "orderIndex": order_idx,
                }
                if exc.get("pageNumber"):
                    excerpt_obj["pageNumber"] = exc["pageNumber"]
                excerpt_obj["pageNumberApproximate"] = is_approximate
                all_excerpts.append(excerpt_obj)

    # Step 3: Save excerpts in batch
    if all_excerpts:
        _mutation("matches:createExcerpts", {
            "paperId": paper_id,
            "excerpts": all_excerpts,
        })

    return result


# ===== THESIS EXPORT =====


def get_thesis_data() -> dict:
    """Fetch all thesis data in a single batch query for export."""
    result = _query("thesisExport:getThesisData", {})
    return result.get("value", result) if isinstance(result, dict) else result


def get_file_bytes(url: str) -> bytes:
    """Download file bytes from a Convex storage URL."""
    logger = get_logger()
    try:
        res = httpx.get(url, follow_redirects=True, timeout=30)
        res.raise_for_status()
        return res.content
    except Exception as e:
        logger.warning(f"Failed to download file from {url}: {e}")
        return b""
