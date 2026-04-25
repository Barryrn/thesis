"""Zotero Web API wrapper for importing papers into ThesisOrganizer.

Uses the pyzotero library to browse collections, fetch item metadata,
and download PDF attachments. All Zotero API communication is kept
server-side so the API key never reaches the frontend.
"""

from __future__ import annotations

import os
import re
from typing import Optional

from dotenv import load_dotenv
from pyzotero import zotero

from pipeline_logger import get_logger

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

# Zotero itemType → ThesisOrganizer sourceType mapping.
# Unmapped types default to "book".
_TYPE_MAP: dict[str, str] = {
    "journalArticle": "journalArticle",
    "book": "book",
    "bookSection": "bookChapter",
    "newspaperArticle": "newspaperArticle",
    "webpage": "internetSource",
}


class ZoteroConfigError(Exception):
    """Raised when Zotero credentials are missing from the environment."""


class ZoteroAuthError(Exception):
    """Raised when the Zotero API rejects the provided credentials."""


def _get_env() -> tuple[str, str]:
    """Return (user_id, api_key) from environment, or raise."""
    user_id = os.environ.get("ZOTERO_USER_ID")
    api_key = os.environ.get("ZOTERO_API_KEY")
    if not user_id or not api_key:
        raise ZoteroConfigError(
            "Zotero not configured. Set ZOTERO_USER_ID and ZOTERO_API_KEY in .env"
        )
    return user_id, api_key


def get_client() -> zotero.Zotero:
    """Create a pyzotero client using environment credentials."""
    user_id, api_key = _get_env()
    return zotero.Zotero(user_id, "user", api_key)


def list_collections() -> list[dict]:
    """Return all collections in the user's Zotero library.

    Each dict contains: key, name, parentCollection (str or False).
    """
    logger = get_logger()
    zot = get_client()
    try:
        raw = zot.collections()
    except Exception as e:
        if "403" in str(e) or "401" in str(e):
            raise ZoteroAuthError("Invalid Zotero credentials") from e
        raise

    collections = [
        {
            "key": c["key"],
            "name": c["data"]["name"],
            "parentCollection": c["data"].get("parentCollection", False),
        }
        for c in raw
    ]
    logger.info(f"[ZOTERO] Fetched {len(collections)} collections")
    return collections


def list_items(collection_key: str | None = None) -> list[dict]:
    """Return mapped items from a collection (or top-level if no key).

    Handles pagination internally — Zotero API returns max 100 per page.
    Filters out attachments, notes, and other non-paper item types.
    """
    logger = get_logger()
    zot = get_client()

    all_items: list[dict] = []
    start = 0
    limit = 100

    while True:
        if collection_key:
            raw = zot.collection_items_top(collection_key, start=start, limit=limit)
        else:
            raw = zot.top(start=start, limit=limit)

        # Filter to citable item types (skip attachments, notes, etc.)
        for item in raw:
            item_type = item.get("data", {}).get("itemType", "")
            if item_type in ("attachment", "note", "annotation"):
                continue
            mapped = map_item(item)
            if mapped:
                all_items.append(mapped)

        if len(raw) < limit:
            break
        start += limit

    logger.info(
        f"[ZOTERO] Fetched {len(all_items)} items"
        + (f" from collection {collection_key}" if collection_key else " (top-level)")
    )
    return all_items


def map_item(raw: dict) -> dict | None:
    """Map a raw Zotero API item to the project's internal format.

    Returns None if the item has no usable data (e.g. empty title).
    """
    data = raw.get("data", {})
    title = data.get("title", "").strip()
    if not title:
        return None

    # Extract authors from creators array (editors handled separately for bookSection)
    authors = []
    for creator in data.get("creators", []):
        if creator.get("creatorType") == "author":
            last = creator.get("lastName", "")
            first = creator.get("firstName", "")
            if last and first:
                authors.append(f"{last}, {first}")
            elif last:
                authors.append(last)
            elif creator.get("name"):
                authors.append(creator["name"])

    # Parse year from date field (e.g. "2023", "2023-01-15", "January 2023")
    year = _parse_year(data.get("date", ""))

    # Map item type
    zotero_type = data.get("itemType", "book")
    source_type = _TYPE_MAP.get(zotero_type, "book")

    # Build source metadata from available fields
    source_metadata: dict[str, str] = {}
    _set_if(source_metadata, "publisher", data.get("publisher"))
    _set_if(source_metadata, "publisherLocation", data.get("place"))
    _set_if(source_metadata, "edition", data.get("edition"))
    _set_if(source_metadata, "journalName", data.get("publicationTitle"))
    _set_if(source_metadata, "volume", data.get("volume"))
    _set_if(source_metadata, "issue", data.get("issue"))
    _set_if(source_metadata, "url", data.get("url"))
    _set_if(source_metadata, "accessDate", data.get("accessDate"))
    _set_if(source_metadata, "language", data.get("language"))

    # Parse pages "100-120" → pageStart, pageEnd
    pages = data.get("pages", "")
    if pages and "-" in pages:
        parts = pages.split("-", 1)
        source_metadata["pageStart"] = parts[0].strip()
        source_metadata["pageEnd"] = parts[1].strip()
    elif pages:
        source_metadata["pageStart"] = pages.strip()

    # Book chapter editor info
    if zotero_type == "bookSection":
        editors = [
            f"{c.get('lastName', '')}, {c.get('firstName', '')}".strip(", ")
            for c in data.get("creators", [])
            if c.get("creatorType") == "editor"
        ]
        if editors:
            source_metadata["editorNames"] = editors
        book_title = data.get("bookTitle") or data.get("publicationTitle")
        _set_if(source_metadata, "editorBookTitle", book_title)

    # Newspaper-specific fields
    if zotero_type == "newspaperArticle":
        _set_if(source_metadata, "newspaperName", data.get("publicationTitle"))
        _set_if(source_metadata, "publishDate", data.get("date"))

    return {
        "key": raw.get("key", ""),
        "title": title,
        "authors": authors,
        "year": year,
        "doi": data.get("DOI", "").strip() or None,
        "isbn": data.get("ISBN", "").strip() or None,
        "itemType": zotero_type,
        "sourceType": source_type,
        "sourceMetadata": source_metadata,
    }


def get_pdf_attachment(item_key: str) -> str | None:
    """Return the attachment key of the first PDF child of a Zotero item.

    Returns None if the item has no PDF attachments.
    """
    zot = get_client()
    children = zot.children(item_key)
    for child in children:
        data = child.get("data", {})
        if (
            data.get("itemType") == "attachment"
            and data.get("contentType") == "application/pdf"
        ):
            return child["key"]
    return None


def download_pdf(attachment_key: str) -> bytes:
    """Download a PDF attachment's file content from Zotero.

    The pyzotero library handles the AWS redirect internally.
    """
    logger = get_logger()
    zot = get_client()
    content = zot.file(attachment_key)
    logger.info(f"[ZOTERO] Downloaded PDF attachment {attachment_key} ({len(content)} bytes)")
    return content


def lookup_by_doi(doi: str) -> dict | None:
    """Search the user's Zotero library for an item matching a DOI.

    Returns a mapped item dict or None if not found.
    """
    logger = get_logger()
    zot = get_client()
    try:
        results = zot.items(q=doi, qmode="everything", limit=10)
    except Exception as e:
        logger.error(f"[ZOTERO] DOI lookup failed: {e}")
        return None

    for item in results:
        data = item.get("data", {})
        item_doi = data.get("DOI", "").strip()
        if item_doi and item_doi.lower() == doi.lower():
            logger.info(f"[ZOTERO] Found item for DOI {doi}: {data.get('title', '')}")
            return map_item(item)

    logger.info(f"[ZOTERO] No item found for DOI {doi}")
    return None


def check_items_have_pdf(items: list[dict]) -> list[dict]:
    """Enrich a list of mapped items with hasPdf flag.

    Checks each item for PDF attachments. This makes individual API calls
    per item, so it should be used judiciously.
    """
    for item in items:
        attachment_key = get_pdf_attachment(item["key"])
        item["hasPdf"] = attachment_key is not None
        item["pdfAttachmentKey"] = attachment_key
    return items


# --- Write operations ---


def create_item(
    title: str,
    authors: list[str],
    year: int | None = None,
    doi: str | None = None,
    isbn: str | None = None,
    item_type: str = "journalArticle",
    collection_key: str | None = None,
) -> str:
    """Create a new item in the user's Zotero library.

    Populates the item template with the provided metadata and returns
    the new item's key. When collection_key is provided, the item is
    placed into that collection. Raises RuntimeError if creation fails.
    """
    logger = get_logger()
    zot = get_client()

    template = zot.item_template(item_type)
    template["title"] = title
    if doi:
        template["DOI"] = doi
    if isbn:
        template["ISBN"] = isbn
    if year:
        template["date"] = str(year)
    if collection_key:
        template["collections"] = [collection_key]

    # Parse author strings into Zotero creator format
    template["creators"] = [_parse_author_for_zotero(a) for a in authors]

    result = zot.create_items([template])

    if "success" in result and result["success"]:
        item_key = list(result["success"].values())[0]
        logger.info(f"[ZOTERO] Created item {item_key}: '{title}'")
        return item_key

    failed = result.get("failed", {})
    raise RuntimeError(f"Zotero item creation failed: {failed}")


def attach_pdf(item_key: str, pdf_path: str, title: str = "Attachment") -> bool:
    """Upload a PDF as an attachment to an existing Zotero item.

    Returns True on success, False on failure (logs the error).
    """
    logger = get_logger()
    zot = get_client()
    try:
        zot.attachment_both([(title, pdf_path)], parentid=item_key)
        logger.info(f"[ZOTERO] Attached PDF to item {item_key}")
        return True
    except Exception as e:
        logger.warning(f"[ZOTERO] Failed to attach PDF to {item_key}: {e}")
        return False


def _parse_author_for_zotero(name: str) -> dict:
    """Parse an author name string into Zotero creator format.

    Handles 'LastName, FirstName' and 'FirstName LastName' formats.
    """
    if "," in name:
        parts = name.split(",", 1)
        return {
            "creatorType": "author",
            "lastName": parts[0].strip(),
            "firstName": parts[1].strip(),
        }
    parts = name.strip().split()
    if len(parts) >= 2:
        return {
            "creatorType": "author",
            "lastName": parts[-1],
            "firstName": " ".join(parts[:-1]),
        }
    return {"creatorType": "author", "lastName": name.strip(), "firstName": ""}


# --- Private helpers ---


def _parse_year(date_str: str) -> int | None:
    """Extract a 4-digit year from a Zotero date string."""
    if not date_str:
        return None
    match = re.search(r"\b(19|20)\d{2}\b", date_str)
    return int(match.group()) if match else None


def _set_if(target: dict, key: str, value: str | None) -> None:
    """Set a key on target dict only if value is truthy."""
    if value and value.strip():
        target[key] = value.strip()
