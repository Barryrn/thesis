---
watched_paths:
  - "python/mapper.py"
  - "python/main.py"
  - "python/convex_client.py"
  - "convex/convex/matches.ts"
  - "frontend/src/components/SectionDetailPanel.tsx"
  - "frontend/src/components/SectionPapers.tsx"
  - "frontend/src/components/PaperCard.tsx"
  - "frontend/src/components/PaperSummaryCard.tsx"
  - "frontend/src/components/PaperDetailSheet.tsx"
  - "frontend/src/components/CitationPicker.tsx"
  - "frontend/src/lib/citationUtils.ts"
---

# Paper-Section Matching

The matching system connects uploaded papers to thesis outline sections through AI-powered relevance scoring and verbatim excerpt extraction. Users trigger citation by dragging a paper onto a sidebar section node, which calls the Python `/cite` endpoint. GPT-4o scores relevance (0.0-1.0), extracts 1-3 supporting excerpts per section, and identifies page numbers. Users can also manually add, move, reorder, and remove matches, as well as add custom excerpts. This is the core value proposition of the app — turning a pile of papers into an organized, evidence-linked thesis structure.

## User Flow

1. **Drag paper to sidebar section** — User drags a `LibraryPaperCard` from the Document Library onto a `SectionNode` in the Outline Sidebar
2. **Citation spinner** — The target section shows a loading spinner while the `/cite` endpoint processes
3. **AI scoring** — GPT-4o scores the paper against the target section(s), extracts verbatim excerpts with page numbers
4. **Results appear** — The `SectionDetailPanel` shows matched papers with relevance scores, excerpt counts, and user notes
5. **Manual adjustments** — User can drag papers between sections (move), add manual matches (drag to center panel), reorder matches within a section, edit/delete excerpts, or add custom excerpts
6. **Paper detail** — Clicking a paper card opens `PaperDetailSheet` showing all section assignments, excerpts, and the AI-generated summary

Alternative flows:
- **Drag to center panel** — Creates a manual match with score 1.0 (no GPT, immediate)
- **Unassigned papers** — `getUnassignedPapers` query surfaces papers with no matches or all scores < 0.5

## Architecture

```
Dashboard (DndContext)
  → Drag from DocumentLibrary to OutlineSidebar
    → triggerCitation(paperId, [sectionId])
      → Python /cite endpoint
        → extractor.extract() (re-extracts text)
        → mapper.score_sections() (GPT-4o scoring + excerpt extraction)
        → convex_client.save_citation_matches() (upsert matches + excerpts)
  → Drag from DocumentLibrary to SectionDetailPanel
    → matches.addMatch (manual, score 1.0)
  → Drag between sections
    → matches.updateMatch (move, preserves manual override flag)

SectionDetailPanel
  → matches.getMatchesBySection (Convex query, real-time)
  → matches.getExcerptsByMatch (per-match excerpt list)
  → Sortable reordering via DND-Kit
```

**Key patterns:**
- On-demand citation: scoring only happens when the user explicitly drags a paper to a section — no automatic batch scoring at upload time
- Upsert semantics: `upsertCitationMatches` preserves existing matches for other sections while overwriting only the cited sections
- Excerpts are linked to both `matchId` and `paperId`+`sectionId` (dual indexing for efficient queries from either direction)
- Page numbers carry an `approximate` flag when the source PDF lacked reliable page labels

## Key Files

| Purpose | Path |
|---------|------|
| GPT-4o scoring & excerpt extraction | `python/mapper.py` |
| Citation endpoint | `python/main.py` (`/cite` route) |
| Match/excerpt save to Convex | `python/convex_client.py` |
| Match CRUD mutations & queries | `convex/convex/matches.ts` |
| Section detail panel (center) | `frontend/src/components/SectionDetailPanel.tsx` |
| Per-section paper list | `frontend/src/components/SectionPapers.tsx` |
| Draggable paper card in sections | `frontend/src/components/PaperCard.tsx` |
| Paper summary card in library | `frontend/src/components/PaperSummaryCard.tsx` |
| Paper detail slide-over sheet | `frontend/src/components/PaperDetailSheet.tsx` |
| Citation picker component | `frontend/src/components/CitationPicker.tsx` |
| Citation utility functions | `frontend/src/lib/citationUtils.ts` |
| Type definitions | `frontend/src/lib/types.ts` |

## Data

| Table | Role |
|-------|------|
| `paperSectionMatches` | Join table linking papers to sections with `relevanceScore`, `isManualOverride`, `matchedAt`, `displayOrder`, and optional `userNotes`. Indexed by both `paperId` and `sectionId`. |
| `matchExcerpts` | Verbatim quotes from papers supporting a match, with `relevanceNote`, `orderIndex`, `pageNumber`, and `pageNumberApproximate` flag. Indexed by `matchId` and by `(paperId, sectionId)`. |

No migration files — Convex manages schema via `convex/convex/schema.ts`.

## Related Features

| Feature | Relationship | Why |
|---------|-------------|-----|
| [Paper Processing](paper-processing.md) | depends-on | Citation reuses `extractor.extract()` to re-extract text; relies on papers being in `"completed"` status |
| [Outline Management](outline-management.md) | depends-on | Matches reference `outlineSections` IDs; cascade-deleted when sections are removed |
| [Convex Backend](convex-backend.md) | depends-on | All match/excerpt CRUD flows through Convex mutations; real-time queries drive the UI |
| [Frontend Architecture](frontend-architecture.md) | provides-to | The matching system powers the center panel, drag-and-drop interactions, and paper detail views |

## Design Decisions

- **On-demand citation over batch scoring** — The original design scored all sections at upload time. This was replaced with per-section `/cite` calls triggered by drag-and-drop to save GPT tokens and give users control over which sections get scored.
- **Upsert vs delete-and-reinsert** — `upsertCitationMatches` finds existing matches by `(paperId, sectionId)` and patches them rather than deleting all matches for a paper. This preserves matches for other sections when citing a new one.
- **Section notes in scoring prompt** — The mapper prompt includes section notes (if present) in parentheses, telling GPT to use them as guidance. This lets users steer scoring accuracy.
- **sectionId fallback resolution** — GPT sometimes returns `orderNumber` instead of `_id` in its response. The mapper builds an `order_to_id` lookup to silently resolve these mismatches.
- **Approximate page numbers** — When page resolution falls back to "approximate", all excerpts are flagged with `pageNumberApproximate: true`. The frontend shows a `~` prefix to warn users the page number may not match the printed page.
- **Manual overrides** — Users can manually add matches (score 1.0, `isManualOverride: true`), move papers between sections, and add custom excerpts. These coexist with AI-generated matches.
- **Display order** — Matches within a section have an optional `displayOrder` field set via DND-Kit sortable reordering.

## Gotchas

- **Text re-extraction on cite** — The `/cite` endpoint re-downloads and re-extracts the paper text every time. There is no caching of extracted text between `/process` and `/cite` calls.
- **30,000 char limit for scoring** — `mapper.py` truncates paper text to `MAX_TEXT_CHARS = 30,000` before sending to GPT-4o. Long papers may have their later sections under-represented in scoring.
- **GPT sectionId confusion** — Despite explicit instructions, GPT-4o occasionally returns `orderNumber` instead of `_id`. The fallback resolution handles this, but entries with completely invalid IDs are silently dropped.
- **Excerpt text must be verbatim** — The scoring prompt asks for exact quotes, but GPT sometimes paraphrases. There is no post-processing to verify excerpts appear in the source text.
- **No batch re-cite** — If the user updates their outline (e.g., renames a section), existing matches are preserved but excerpts are not re-scored against the new title. Users must manually re-cite.
