from __future__ import annotations

import os
import httpx
from dotenv import load_dotenv

load_dotenv()

CONVEX_URL = os.environ["CONVEX_URL"]
CONVEX_KEY = os.environ["CONVEX_DEPLOY_KEY"]
HEADERS = {
    "Authorization": f"Convex {CONVEX_KEY}",
    "Content-Type": "application/json",
}


def _mutation(name: str, args: dict):
    """Call a Convex mutation by function name."""
    res = httpx.post(
        f"{CONVEX_URL}/api/mutation",
        headers=HEADERS,
        json={"path": name, "args": args},
        timeout=30,
    )
    res.raise_for_status()
    return res.json()


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


def save_summary(paper_id: str, summary: dict):
    """Call summaries:createSummary."""
    return _mutation("summaries:createSummary", {
        "paperId": paper_id,
        "researchQuestion": summary["researchQuestion"],
        "methodology": summary["methodology"],
        "keyFindings": summary["keyFindings"],
        "keywords": summary["keywords"],
        "rawSummary": summary["rawSummary"],
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
                all_excerpts.append({
                    "matchId": match_ids[i],
                    "sectionId": section["sectionId"],
                    "excerptText": exc["text"],
                    "relevanceNote": exc["relevanceNote"],
                    "orderIndex": order_idx,
                })

    # Step 3: Save excerpts in batch
    if all_excerpts:
        _mutation("matches:createExcerpts", {
            "paperId": paper_id,
            "excerpts": all_excerpts,
        })

    return result
