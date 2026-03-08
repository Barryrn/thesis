import re


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
