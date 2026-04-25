import re

import httpx


PATTERNS = {
    "DOI":   r'\b10\.\d{4,}/[^\s\]>,"]+',
    "ISBN":  r'97[89][- ]?\d{9}[\dXx]',
    "arXiv": r'arXiv:\s*\d{4}\.\d{4,5}(?:v\d+)?',
}

TRAILING_PUNCT = ".,)"


def detect(text: str) -> list[dict]:
    """Scan text for DOI, ISBN, and arXiv identifiers."""
    seen: set[tuple[str, str]] = set()
    results: list[dict] = []

    for id_type, pattern in PATTERNS.items():
        for match in re.finditer(pattern, text):
            value = match.group().rstrip(TRAILING_PUNCT)
            key = (id_type, value)
            if key not in seen:
                seen.add(key)
                results.append({"type": id_type, "value": value})

    return results


# CrossRef type string → our Convex sourceType enum value
_CROSSREF_TYPE_MAP = {
    "journal-article": "journalArticle",
    "book-chapter": "bookChapter",
    "book": "book",
}

# Polite User-Agent required by CrossRef's API etiquette policy
_CROSSREF_UA = "ThesisApp/1.0 (mailto:thesis-app@example.com)"


def lookup_doi_metadata(doi: str) -> dict | None:
    """Fetch bibliographic metadata from CrossRef for a given DOI.

    CrossRef is the primary metadata source because it covers the vast
    majority of DOI-registered academic publications and provides
    structured fields that map directly to our Convex sources table.

    Returns a dict with keys matching Convex source fields, or None on
    any failure (network, parse, missing DOI).
    """
    try:
        print(f"[DOI] Looking up CrossRef metadata for DOI: {doi}")
        res = httpx.get(
            f"https://api.crossref.org/works/{doi}",
            headers={"User-Agent": _CROSSREF_UA},
            timeout=10,
        )
        res.raise_for_status()
        data = res.json()["message"]

        # Map CrossRef's work type to our sourceType enum
        crossref_type = data.get("type", "")
        source_type = _CROSSREF_TYPE_MAP.get(crossref_type, "book")

        # Container-title is a list; first element is the journal/book name
        container_titles = data.get("container-title", [])
        journal_name = container_titles[0] if container_titles else None

        # Page range (e.g. "123-145") splits into start and end
        page_start = None
        page_end = None
        page_raw = data.get("page")
        if page_raw and "-" in page_raw:
            parts = page_raw.split("-", 1)
            page_start = parts[0].strip()
            page_end = parts[1].strip()
        elif page_raw:
            page_start = page_raw.strip()

        result: dict = {"sourceType": source_type}

        # Only include non-None fields to avoid overwriting existing data
        if data.get("publisher"):
            result["publisher"] = data["publisher"]
        if journal_name:
            result["journalName"] = journal_name
        if data.get("volume"):
            result["volume"] = str(data["volume"])
        if data.get("issue"):
            result["issue"] = str(data["issue"])
        if page_start:
            result["pageStart"] = page_start
        if page_end:
            result["pageEnd"] = page_end

        print(f"[DOI] CrossRef lookup succeeded: type={source_type}, publisher={result.get('publisher')}")
        return result

    except Exception as e:
        print(f"[DOI] CrossRef lookup failed for {doi}: {type(e).__name__}: {e}")
        return None


def lookup_openalex_metadata(doi: str) -> dict | None:
    """Fallback metadata lookup via OpenAlex when CrossRef fails.

    OpenAlex is a free, open catalogue of scholarly works. We use it as
    a secondary source because its DOI coverage complements CrossRef,
    especially for newer or open-access publications.

    Returns a dict with keys matching Convex source fields, or None on
    any failure.
    """
    try:
        print(f"[DOI] Falling back to OpenAlex for DOI: {doi}")
        res = httpx.get(
            f"https://api.openalex.org/works/doi:{doi}",
            timeout=10,
        )
        res.raise_for_status()
        data = res.json()

        # OpenAlex uses "type" with values like "journal-article", "book", etc.
        oa_type = data.get("type", "")
        source_type = _CROSSREF_TYPE_MAP.get(oa_type, "book")

        result: dict = {"sourceType": source_type}

        # Primary source (host venue) contains journal/publisher info
        primary = data.get("primary_location", {}) or {}
        source = primary.get("source", {}) or {}

        if source.get("display_name"):
            result["journalName"] = source["display_name"]
        if source.get("host_organization_name"):
            result["publisher"] = source["host_organization_name"]

        # Biblio block holds volume, issue, and page numbers
        biblio = data.get("biblio", {}) or {}
        if biblio.get("volume"):
            result["volume"] = str(biblio["volume"])
        if biblio.get("issue"):
            result["issue"] = str(biblio["issue"])
        if biblio.get("first_page"):
            result["pageStart"] = str(biblio["first_page"])
        if biblio.get("last_page"):
            result["pageEnd"] = str(biblio["last_page"])

        print(f"[DOI] OpenAlex lookup succeeded: type={source_type}, publisher={result.get('publisher')}")
        return result

    except Exception as e:
        print(f"[DOI] OpenAlex lookup failed for {doi}: {type(e).__name__}: {e}")
        return None
