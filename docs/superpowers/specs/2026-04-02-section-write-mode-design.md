# Section Write Mode — Design Spec

## Context

The thesis organizer currently treats sections as organizational containers: each section has a title, notes, and linked papers with excerpts. There is no way to compose actual thesis prose. Users must write their thesis text in an external editor (Word, Google Docs) and manually manage citations.

This feature adds a **Write tab** to the section detail panel where users can compose plain-text paragraphs per section and insert inline citations from papers already linked to that section. Citations are stored as paper ID references so the display format (APA or IEEE) is configurable.

## Requirements

| Requirement | Decision |
|-------------|----------|
| Editor type | Plain textarea (no rich text) |
| Citation trigger | `@` character triggers a dropdown picker |
| Citation display | Configurable: APA `(Author, Year)` or IEEE `[N]` |
| Citation scope | Only papers linked to the current section |
| Layout | Tab toggle in center panel: "Papers" / "Write" |
| Save behavior | Debounced auto-save (~1.5s after typing stops) |

## Data Model

### New table: `sectionContent`

```typescript
sectionContent: defineTable({
  sectionId: v.id("outlineSections"),
  body: v.string(),
  citedPaperIds: v.array(v.id("papers")),
  updatedAt: v.number(),
}).index("by_section", ["sectionId"])
```

**Why a separate table?** The `upsertOutlineSections` mutation deletes and recreates all sections on every outline import. Storing body text on `outlineSections` would destroy user-authored content. A separate table decouples authored prose from outline structure.

### Citation marker format

Embedded in the `body` string:

```
{{cite:CONVEX_PAPER_ID::AuthorSurname, Year}}
```

- `CONVEX_PAPER_ID` — stable Convex document ID for the paper
- `::` delimiter — chosen over `|` to avoid conflicts with pipe characters in body text
- `AuthorSurname, Year` — human-readable label so raw text is legible in the textarea
- On render, markers are replaced by the chosen citation style
- Regex pattern: `\{\{cite:([^:]+)::([^}]+)\}\}`

### `citedPaperIds` field

An array of unique paper IDs extracted from the body string. Recomputed on every save. Purpose: fast bibliography generation, citation counting, and referential integrity checks without regex parsing the body.

## Backend

### New module: `convex/convex/sectionContent.ts`

| Function | Type | Args | Returns |
|----------|------|------|---------|
| `getSectionContent` | query | `{ sectionId }` | Content doc or `null` |
| `saveSectionContent` | mutation | `{ sectionId, body, citedPaperIds }` | Atomic upsert: queries by `sectionId` index, patches if exists, inserts if not. Enforces one-to-one relationship. |

### Outline migration: `convex/convex/outline.ts`

Modify `upsertOutlineSections` to preserve content across outline re-imports:

1. Before deleting old sections, query all `sectionContent` records and build a map: `orderNumber` -> content doc
2. After inserting new sections (using the existing `orderNumberToId` map), patch each content doc's `sectionId` to the new ID matching the same `orderNumber`
3. Content for removed sections is preserved but orphaned

## Frontend Components

### Modified: `SectionDetailPanel.tsx`

- Add tab state: `"papers" | "write"`, default `"papers"`
- Render tab toggle in the section header (same styling as existing sort pills)
- `"papers"` tab shows existing paper list; `"write"` tab renders `SectionWriteEditor`
- Tab resets to `"papers"` on section change

### New: `SectionWriteEditor.tsx`

Main editor component:

- **Queries**: `getSectionContent(sectionId)`, `getMatchesBySection(sectionId)`
- **State**: `body` (string), `saveStatus` ("idle" | "saving" | "saved"), citation picker state
- **Textarea**: Full-height, displays raw body text including `{{cite:...|Label}}` markers
- **Auto-save**: 1.5s debounce after typing. Extracts `citedPaperIds` from body, calls `saveSectionContent`. Shows status indicator.
- **Section switch**: `useEffect` cleanup flushes pending debounce timer and saves immediately. The save captures `sectionId` at invocation time (via closure or ref) so a stale save cannot write to the wrong section. Uses `lastSavedBody` ref to avoid overwriting local state from Convex reactive query push.
- **Preview**: Read-only rendered view below the textarea. Updates reactively on every keystroke (local rendering, no debounce). Replaces `{{cite:...}}` markers with formatted citations. Requires a `paperMap` built from the `getMatchesBySection` query result. APA/IEEE toggle stored in component state.

### New: `CitationPicker.tsx`

Floating dropdown triggered by `@`:

- Anchored near the textarea cursor (pixel position computed via mirror-div technique)
- Shows papers from `getMatchesBySection` filtered by the query text after `@`
- Keyboard navigation: Up/Down arrows, Enter to select, Escape to dismiss
- On select: replaces `@query` in the body with `{{cite:paperId::AuthorSurname, Year}}`

### New: `frontend/src/lib/citationUtils.ts`

Pure utility functions:

- `extractCitationIds(body)` — parse `{{cite:...}}` markers, return unique paper IDs
- `insertCitationMarker(body, cursorPos, paperId, label)` — replace `@query` with marker
- `renderCitationsApa(body, paperMap)` — format as `(Author, Year)`
- `renderCitationsIeee(body, orderMap)` — format as `[N]`
- `getAtTriggerContext(body, cursorPos)` — detect active `@` trigger, extract query
- `getCaretCoordinates(textarea, position)` — compute pixel position of cursor via mirror div

## File Map

| File | Action |
|------|--------|
| `convex/convex/schema.ts` | Add `sectionContent` table |
| `convex/convex/sectionContent.ts` | Create — query + mutation |
| `convex/convex/outline.ts` | Modify — migrate content on upsert |
| `frontend/src/lib/types.ts` | Add `CitationStyle`, `CitationMarker` types |
| `frontend/src/lib/citationUtils.ts` | Create — citation utilities |
| `frontend/src/components/CitationPicker.tsx` | Create — `@` mention picker |
| `frontend/src/components/SectionWriteEditor.tsx` | Create — write-mode editor |
| `frontend/src/components/SectionDetailPanel.tsx` | Modify — add tab toggle |

## Implementation Order

1. Schema + backend (`schema.ts`, `sectionContent.ts`)
2. Citation utilities (`citationUtils.ts`, types)
3. Tab toggle (`SectionDetailPanel.tsx`)
4. Editor with auto-save (`SectionWriteEditor.tsx` — no citation picker yet)
5. Citation picker (`CitationPicker.tsx` + wire into editor)
6. Outline migration (`outline.ts`)
7. Preview rendering with APA/IEEE toggle

## Verification

1. Create a section, switch to Write tab, type paragraphs — verify auto-save
2. Type `@`, verify dropdown shows only section-linked papers
3. Select a paper, verify marker is inserted correctly
4. Toggle APA/IEEE in preview, verify rendering changes
5. Switch sections and back — verify content persists
6. Re-import the outline — verify content survives with correct section mapping

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Textarea caret position calculation is fragile | Use well-established mirror-div technique; match fonts/padding exactly |
| Convex reactive query overwrites local typing state | Use `lastSavedBody` ref; only sync from server on mount or section change |
| Outline re-import orphans content | Migration step in `upsertOutlineSections` using `orderNumber` mapping |
| `{{cite:...}}` markers are ugly in textarea | Include human-readable `::Label` suffix; full formatting in preview |
| Section switch loses final edit | Save closure captures `sectionId` at invocation time; flush on cleanup |
| Orphaned content after section deletion | Preserved deliberately (not deleted); recoverable if outline is re-imported |
