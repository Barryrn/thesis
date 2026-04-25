---
watched_paths:
  - "python/**"
  - "convex/convex/http.ts"
  - "convex/convex/papers.ts"
  - "convex/convex/summaries.ts"
---

# Paper Processing

The paper processing pipeline converts uploaded documents (PDF, DOCX, TXT) into structured, AI-generated summaries stored in Convex. It runs as a Python FastAPI service on port 8000, orchestrated by Convex HTTP actions. The pipeline handles text extraction, metadata detection (title, authors, year), academic identifier scanning (DOI, ISBN, arXiv), and GPT-4o-powered summarization — all triggered automatically after a file upload. The service also provides on-demand citation scoring (`/cite`) and AI text optimization (`/optimize`) endpoints called directly by the frontend.

## User Flow

1. **Upload page** — User drops files into the upload zone (`UploadZone` component)
2. **File storage** — Frontend uploads the file to Convex storage, creates a `papers` record with status `"pending"`
3. **HTTP trigger** — Frontend calls the Convex HTTP action `/trigger-processing`, which sets status to `"processing"` and forwards the request to the Python backend
4. **Pipeline execution** — Python `/process` endpoint runs the 5-step pipeline (download, extract, identify, summarize, save)
5. **Completion** — Paper status updates to `"completed"` (or `"failed"` with an error message); the Dashboard reflects changes in real time via Convex subscriptions

## Architecture

```
Frontend (UploadZone)
  → Convex storage.generateUploadUrl() + papers.createPaper
  → Convex HTTP action /trigger-processing
    → Python FastAPI /process (port 8000)
      → extractor.extract()     — PDF/DOCX/TXT → plain text + metadata
      → identifier.detect()     — regex-based DOI/ISBN/arXiv scanning
      → summarizer.summarize()  — GPT-4o structured summary
      → convex_client.*         — writes results back via Convex mutations
```

**Key design choices:**
- The Python service is a sidecar process — Convex calls it via HTTP, not the other way around
- The pipeline writes results back to Convex via the deploy key REST API (`convex_client.py`)
- Text extraction uses a two-library fallback: pdfplumber first, PyMuPDF (fitz) if pdfplumber yields < 200 chars
- Large texts (> 12,000 chars) are chunked with overlap, summarized per-chunk, then combined into a final summary
- Page number resolution uses a 4-step fallback chain: PDF labels → regex heuristic → GPT-4o-mini AI detection → approximate (1-based index)
- The `/optimize` endpoint (`optimizer.py`) supports four rewrite modes: enhance, formalize, simplify, expand. It receives surrounding context for better AI results and preserves `[REFN]` citation placeholders

## Key Files

| Purpose | Path |
|---------|------|
| FastAPI server & orchestrator | `python/main.py` |
| Text extraction (PDF, DOCX, TXT) | `python/extractor.py` |
| GPT-4o summarization | `python/summarizer.py` |
| DOI/ISBN/arXiv detection | `python/identifier.py` |
| Convex REST API client | `python/convex_client.py` |
| AI text optimization | `python/optimizer.py` |
| Structured pipeline logging | `python/pipeline_logger.py` |
| Python dependencies | `python/requirements.txt` |
| Convex HTTP trigger action | `convex/convex/http.ts` |
| Paper CRUD + file storage | `convex/convex/papers.ts` |
| Summary + identifier storage | `convex/convex/summaries.ts` |

## Data

| Table | Role |
|-------|------|
| `papers` | Stores paper metadata (title, authors, year, status, storageId, fileUrl) |
| `summaries` | Stores AI-generated structured summaries (research question, methodology, key findings, keywords, raw summary, language) |
| `paperIdentifiers` | Stores detected DOI, ISBN, and arXiv identifiers linked to papers |

No migration files — Convex manages schema via `convex/convex/schema.ts`.

## Related Features

| Feature | Relationship | Why |
|---------|-------------|-----|
| [Outline Management](outline-management.md) | provides-to | The HTTP trigger sends all outline sections to the Python service (used historically for batch scoring; now sections are scored on-demand via `/cite`) |
| [Paper-Section Matching](paper-section-matching.md) | provides-to | The `/cite` endpoint reuses `extractor.extract()` and `mapper.score_sections()` to score specific sections and save citation matches |
| [Convex Backend](convex-backend.md) | depends-on | Uses Convex mutations for all data persistence; HTTP action triggers the pipeline |
| [Frontend Architecture](frontend-architecture.md) | provides-to | Dashboard and Upload page consume paper status and summaries via Convex queries |

## Design Decisions

- **Two-endpoint split (`/process` vs `/cite`)** — `/process` runs at upload time and only generates a summary (no section scoring). `/cite` runs on-demand when the user drags a paper onto a section, scoring only the requested sections. This avoids wasting GPT tokens on sections the user hasn't mapped yet.
- **Page number resolution chain** — PDF page labels are preferred (from LaTeX/journal metadata), then regex header/footer detection, then GPT-4o-mini AI detection, then approximate fallback. The `page_source` is propagated to excerpts so the frontend can show a `~` prefix for approximate page numbers.
- **Language-aware pipeline** — Summaries and excerpts are generated in the language specified by the user (stored on the summary record). The `/cite` endpoint reads the stored language to stay consistent.
- **Chunked summarization** — Texts > 12,000 chars are split into overlapping chunks (12K each, 500 char overlap, max 5 chunks), summarized individually, then combined into a final structured summary.
- **File size guard** — Maximum 50 MB per file (`MAX_FILE_SIZE`), maximum 80,000 chars extracted (`MAX_TEXT_LENGTH`).
- **Text optimization as a separate endpoint** — `/optimize` is called directly by the frontend (not through Convex) because it needs low-latency request/response. The frontend handles citation placeholder swapping (`[REFN]`) before and after the AI call via `useTextOptimize`.

## Gotchas

- **Python service must be running** — Convex HTTP actions call `http://localhost:8000` directly. If the Python server is down, papers get stuck in `"failed"` status with "Could not reach Python service" error.
- **pdfplumber fallback** — Some PDFs (scanned, image-heavy) produce near-empty text with pdfplumber. The fallback to PyMuPDF helps but still won't handle image-only PDFs (OCR is not implemented).
- **GPT JSON parsing** — The summarizer and mapper strip markdown fences from GPT responses, but malformed JSON can still cause failures. The pipeline catches these and sets status to `"failed"`.
- **Identifier regex is conservative** — The DOI/ISBN/arXiv patterns in `identifier.py` may miss non-standard formatting. Trailing punctuation is stripped but nested parens can cause truncation.
- **No retry mechanism** — Failed pipeline runs are not automatically retried. The user must re-upload or manually re-trigger processing.
