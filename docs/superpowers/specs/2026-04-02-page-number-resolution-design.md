# Page Number Resolution for Citation Excerpts

**Date:** 2026-04-02
**Status:** Approved

## Problem

When extracting text from PDFs, the system embeds `--- PAGE N ---` markers using the physical PDF page index (1-based). GPT then reads these markers to assign page numbers to excerpts. However, the physical PDF index does not match the printed page number in the paper:

- Journal articles start at e.g. page 127, not page 1
- Standalone papers have front matter (cover, abstract, ToC) that shifts numbering
- Some papers use roman numerals (i, ii, iii) before arabic numbering

This causes all cited page numbers to be wrong — making citations unreliable for thesis writing.

## Solution: Resolve in Extractor

Modify `_extract_pdf()` in `python/extractor.py` to resolve printed page labels before emitting `--- PAGE {label} ---` markers. Everything downstream (mapper, convex_client, frontend) continues to work unchanged since the markers already contain the correct number.

### Dual-Library Consideration

The primary extraction path uses **pdfplumber** (line 56), which does not expose PDF page labels. **PyMuPDF (fitz)** is currently only loaded as a fallback (line 70) when pdfplumber extracts < 200 chars.

**Approach:** Always open the PDF with fitz *separately* to read page labels, regardless of which library handles text extraction. This is a lightweight operation (fitz reads only the page tree metadata, not the full text). The label lookup runs before the extraction loop begins.

### Page Resolution Chain

Run once per PDF, in order:

#### 1. PDF Page Labels (PyMuPDF)

Open the PDF with `fitz.open()` and call `page.get_label()` on every page. Most well-formed PDFs from journals and LaTeX embed page labels as metadata. This handles:

- Journal articles: physical page 1 → label "127"
- Front matter: physical page 1 → label "i", physical page 5 → label "1"
- Arbitrary numbering schemes

**Detection logic:** Extract labels for all pages. If at least one label differs from the physical index string (e.g., label "127" vs physical "1"), use labels. Otherwise, fall through.

```python
import fitz

def _resolve_page_labels(file_path: str) -> tuple[dict[int, str] | None, str]:
    """Try to extract printed page labels from PDF metadata.
    
    Returns (mapping, source) where mapping is {physical_page_1based: label}
    or None if labels match physical indices. source is one of:
    'labels', 'regex', 'ai', 'approximate'.
    """
    doc = fitz.open(file_path)
    labels = {}
    has_custom_labels = False
    for page in doc:
        label = page.get_label()
        phys = page.number + 1  # 0-based → 1-based
        labels[phys] = label
        if label != str(phys):
            has_custom_labels = True
    doc.close()
    
    if has_custom_labels:
        return labels, "labels"
    return None, ""
```

#### 2. Regex Heuristic

Scan the first and last 2 lines of each page's extracted text for standalone number patterns:

```python
HEADER_FOOTER_RE = r'^\s*(\d+)\s*$'
```

Check first 2 and last 2 lines of each page. If a consistent ascending sequence is found across pages, use those numbers. Consistency check: numbers should increase monotonically with gaps ≤ 2.

**Two-pass architecture:** Since markers are emitted inline during extraction (line 62), the regex heuristic requires a two-pass approach:
1. First pass: extract all page texts into a list (without markers)
2. Run resolution chain on the collected texts
3. Second pass: emit markers with resolved labels

#### 3. AI Detection (GPT-4o-mini)

If regex fails, send a minimal prompt with the first and last 3 lines of 5 evenly-spaced sample pages to GPT-4o-mini (cheaper model). Ask it to detect the printed page number for each sample page.

From the detected numbers, calculate a single integer offset: `offset = printed_page - physical_page`. Apply this offset uniformly to all pages.

**Cost:** ~200-300 input tokens per paper. Negligible.

#### 4. Approximate Fallback

If all above methods fail, keep the physical PDF index (current behavior) and flag `page_source = "approximate"`.

### Return Value

The extractor returns a new field:

```python
{
    "text": "...",           # with correct --- PAGE {label} --- markers
    "metadata_text": "...",
    "title": "...",
    "authors": [...],
    "year": ...,
    "page_source": "labels" | "regex" | "ai" | "approximate",
}
```

## Schema Change

Add to `matchExcerpts` table in `convex/convex/schema.ts`:

```ts
pageNumberApproximate: v.optional(v.boolean()),
```

## Data Flow

1. **`python/extractor.py`** — `_extract_pdf()` resolves page labels via a two-pass approach and emits correct markers. Returns `page_source`.
2. **`python/mapper.py`** — Unchanged. GPT reads the (now-correct) `--- PAGE {label} ---` markers.
3. **`python/main.py`** — Only the `/cite` endpoint (line 138) needs changes. It calls `extractor.extract()` independently and threads `page_source` to `convex_client.save_citation_matches()`. The `/process` endpoint does NOT run citation — no changes needed there.
4. **`python/convex_client.py`** — Both excerpt-saving functions updated:
   - `save_citation_matches()` (line 133): accepts `page_source` param, sets `pageNumberApproximate: true` on all excerpts when `page_source == "approximate"`
   - `save_matches_with_excerpts()` (line 171): same change for consistency, since it's still callable code
5. **`convex/convex/matches.ts`** — Mutations that insert excerpts accept and store the new field:
   - `upsertCitationMatches` (line 38): add `pageNumberApproximate` to excerpts validator and insert
   - `createExcerpts` (line 176): add `pageNumberApproximate` to excerpts validator and insert
   - `addExcerpt` (line 294): **no change** — manual excerpts have user-specified page numbers, never approximate
   - `updateExcerpt` (line 326): when user edits `pageNumber`, also clear `pageNumberApproximate` to `false` (user has manually verified)
6. **`frontend/src/lib/types.ts`** — Add `pageNumberApproximate?: boolean` to `MatchExcerpt` type
7. **`frontend/src/components/PaperSummaryCard.tsx`** — When `pageNumberApproximate` is true, display `~p. {n}` with a tooltip: "Approximate — page number could not be verified"

## Files to Modify

| File | Change |
|------|--------|
| `python/extractor.py` | Two-pass `_extract_pdf()` with resolution chain: fitz labels → regex → AI → approximate |
| `python/main.py` | Thread `page_source` in `/cite` endpoint only |
| `python/convex_client.py` | Accept `page_source` in both `save_citation_matches()` and `save_matches_with_excerpts()` |
| `convex/convex/schema.ts` | Add `pageNumberApproximate` to `matchExcerpts` |
| `convex/convex/matches.ts` | Update `upsertCitationMatches`, `createExcerpts`, `updateExcerpt` |
| `frontend/src/lib/types.ts` | Add `pageNumberApproximate` to `MatchExcerpt` type |
| `frontend/src/components/PaperSummaryCard.tsx` | Show `~p.` with tooltip for approximate pages |

## Verification

1. **Unit test:** Mock a PDF with known page labels (e.g., starting at page 127). Verify extractor emits `--- PAGE 127 ---` markers and `page_source == "labels"`.
2. **Regex test:** Create text with footer page numbers. Verify regex heuristic detects them and `page_source == "regex"`.
3. **AI fallback test:** Use a PDF with no labels and no footer numbers. Verify AI detection calculates the correct offset.
4. **Integration test:** Upload a real journal article PDF via `/cite`. Verify the excerpt page numbers match the printed pages in the PDF.
5. **Approximate display:** Upload a PDF with no page metadata. Verify frontend shows `~p.` prefix with tooltip.
6. **Manual override clears flag:** Edit an approximate page number in the UI. Verify `pageNumberApproximate` is cleared to false.
