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


def save_citation_matches(paper_id: str, scored_sections: list[dict]):
    """Upsert citation matches for specific sections only.

    Unlike save_matches_with_excerpts, this preserves existing matches
    for other sections — only the scored sections are overwritten.
    Called by the /cite endpoint for on-demand per-section citation.
    """
    filtered = [s for s in scored_sections if s["score"] > 0.0]
    if not filtered:
        return None

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
                all_excerpts.append(excerpt_obj)

    return _mutation("matches:upsertCitationMatches", {
        "paperId": paper_id,
        "matches": matches_payload,
        "excerpts": all_excerpts,
    })


def save_matches_with_excerpts(paper_id: str, scored_sections: list[dict]):
    """Save matches and their supporting excerpts to Convex.

    Only saves sections with score > 0.0. After creating matches,
    saves any excerpts linked to the returned match IDs.
    """
    filtered = [s for s in scored_sections if s["score"] > 0.0]
    if not filtered:
        return None

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
                all_excerpts.append(excerpt_obj)

    # Step 3: Save excerpts in batch
    if all_excerpts:
        _mutation("matches:createExcerpts", {
            "paperId": paper_id,
            "excerpts": all_excerpts,
        })

    return result
