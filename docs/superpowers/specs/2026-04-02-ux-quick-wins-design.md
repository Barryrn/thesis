# UX Quick Wins: Search Excerpts + Processing Progress

**Date**: 2026-04-02
**Status**: Draft

## Context

The Thesis Paper Organizer currently has two UX gaps that slow down daily usage:

1. **No way to search across collected excerpts** — users accumulate dozens of excerpts across sections but can only browse them one section at a time. Finding a specific quote means clicking through sections manually.
2. **No processing progress visibility** — after uploading a paper, users see only a pulsing "Processing" badge with no indication of which step is running or how far along it is. This creates uncertainty, especially for large PDFs that take 30+ seconds.

Both are quick wins: high impact on daily UX, low implementation complexity.

---

## Feature 1: Global Excerpt Search

### Overview

A command-palette style search modal that searches across all excerpt texts and relevance notes. Accessible via `Cmd+K` / `Ctrl+K` keyboard shortcut **and** a search icon in the Dashboard header bar.

### User Flow

1. User presses `Cmd+K` or clicks the search icon in the header
2. A centered modal overlay appears with an auto-focused search input
3. As the user types, results filter in real-time (client-side, debounced ~200ms)
4. Each result shows:
   - Section order number + title (e.g., "2.1 Literature Review")
   - Excerpt text with the search term highlighted
   - Paper title + authors below
5. Clicking a result closes the modal and selects that section in the sidebar
6. `Escape` closes the modal

### Data Strategy

**Client-side filtering** — a single Convex query fetches all excerpts joined with paper and section metadata. The frontend filters with a case-insensitive substring match on `excerptText` and `relevanceNote`.

Rationale: A thesis organizer will typically have < 500 excerpts. Client-side search is instant, avoids schema changes, and keeps implementation simple. If scale becomes an issue later, a Convex search index can be added without changing the UI.

### New Convex Query

```
matches.getAllExcerptsWithContext → Array<{
  excerptId, excerptText, relevanceNote, pageNumber,
  paperId, paperTitle, paperAuthors,
  sectionId, sectionTitle, sectionOrderNumber
}>
```

Joins `matchExcerpts` → `paperSectionMatches` → `papers` + `outlineSections`.

### New Component

`SearchModal.tsx` — renders as a portal overlay. Contains:
- Search input with magnifying glass icon
- Scrollable results list (max ~8 visible, rest scrollable)
- Empty state: "No excerpts match your search"
- No-excerpts state: "No excerpts yet — assign papers to sections first"

### Dashboard Integration

- Header: Add a search icon button between the stat strip and "Upload Papers" button
- Register `Cmd+K` / `Ctrl+K` listener via `useEffect` on Dashboard mount
- Both trigger the same `setSearchOpen(true)` state
- Clicking a result calls `onSelectSection(...)` to navigate the sidebar

### Files to Modify

| File | Change |
|------|--------|
| `convex/convex/matches.ts` | Add `getAllExcerptsWithContext` query |
| `frontend/src/components/SearchModal.tsx` | **New** — command palette UI |
| `frontend/src/pages/Dashboard.tsx` | Add search icon, Cmd+K listener, SearchModal state |

---

## Feature 2: Processing Progress Steps

### Overview

Replace the generic "Processing" badge with step-by-step progress that updates in real time. Users see exactly what the system is doing: `Downloading → Extracting text → Detecting IDs → Summarizing → Saving`.

### Data Model Change

Add an optional `processingStep` field to the `papers` table:

```ts
processingStep: v.optional(v.union(
  v.literal("downloading"),
  v.literal("extracting"),
  v.literal("identifying"),
  v.literal("summarizing"),
  v.literal("saving")
))
```

Set to `undefined`/cleared when processing completes or fails.

### Backend Flow

The Python `main.py` `/process` endpoint already has clearly delineated steps. Before each step, call a new Convex mutation to update the paper's `processingStep`:

```
POST /process
  → update_processing_step("downloading")
  → download file
  → update_processing_step("extracting")
  → extract text
  → update_processing_step("identifying")
  → detect identifiers
  → update_processing_step("summarizing")
  → summarize
  → update_processing_step("saving")
  → save to Convex
  → clear processingStep (status → "completed")
```

On completion or failure, `processingStep` must be cleared. The existing `update_status()` call in `convex_client.py` should be updated to also patch `processingStep: undefined` whenever it sets status to `"completed"` or `"failed"`. This avoids a stale step label lingering in the UI.

### Frontend Display

The frontend already watches `papers` via `useQuery(api.papers.listPapers)`, so progress updates appear automatically via Convex's reactivity — no polling needed.

**Upload page** (`Upload.tsx` `StatusBadge`): When status is "processing" and `processingStep` exists, show the step label:

| Step value | Display |
|------------|---------|
| `downloading` | "Downloading..." |
| `extracting` | "Extracting text..." |
| `identifying` | "Detecting IDs..." |
| `summarizing` | "Summarizing..." |
| `saving` | "Saving..." |

Badge retains the yellow/pulse animation but shows the specific step.

**Library cards** (`LibraryPaperCard.tsx`): Same step-aware label when the paper is processing.

### New Convex Mutation

```ts
papers.updateProcessingStep({ paperId, step })
```

Updates `processingStep` on the paper record. Called by `convex_client.py`.

### Files to Modify

| File | Change |
|------|--------|
| `convex/convex/schema.ts` | Add `processingStep` field to `papers` table |
| `convex/convex/papers.ts` | Add `updateProcessingStep` mutation |
| `python/convex_client.py` | Add `update_processing_step()` function |
| `python/main.py` | Call `update_processing_step()` before each pipeline step |
| `frontend/src/pages/Upload.tsx` | Update `StatusBadge` to show step labels |
| `frontend/src/components/LibraryPaperCard.tsx` | Show step label when processing |

---

## Verification Plan

### Search Excerpts
1. Upload 2-3 papers and assign them to different sections (ensure excerpts exist)
2. Press `Cmd+K` — modal should open with focus on search input
3. Type a word that appears in an excerpt — results should filter in real time
4. Click a result — modal closes and the correct section is selected in the sidebar
5. Press `Escape` — modal closes without side effects
6. Click the search icon in the header — same modal opens

### Processing Progress
1. Upload a new PDF paper
2. Watch the status badge in the Upload page table — it should cycle through: "Downloading..." → "Extracting text..." → "Detecting IDs..." → "Summarizing..." → "Saving..." → "Completed"
3. Check the Dashboard library sidebar — the same paper should show step progress there too
4. Upload a deliberately invalid file — status should show "Failed" (not stuck on a step)
