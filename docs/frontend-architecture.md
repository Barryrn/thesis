---
watched_paths:
  - "frontend/src/**"
---

# Frontend Architecture

The frontend is a React 19 single-page application built with Vite 7, TypeScript, TailwindCSS 4, and shadcn/ui components. It has two pages — Dashboard (3-panel layout with drag-and-drop, section write mode, and AI text optimization) and Upload (outline editor + file upload with processing progress). All data flows through Convex reactive queries for real-time updates. The app uses DND-Kit for drag-and-drop interactions (library-to-section citation, cross-section paper moves, and sortable reordering), react-pdf for document viewing, and Sonner for toast notifications.

## User Flow

1. **Upload page** (`/upload`) — User creates their thesis outline via the text editor, then uploads papers via the drag-and-drop upload zone. Papers are listed in a table with real-time status updates.
2. **Dashboard** (`/`) — Three-panel layout:
   - **Left: Outline Sidebar** — Navigable tree of thesis sections. Sections accept paper drops for AI citation.
   - **Center: Section Detail Panel** — Two tabs: **Read** (matched papers with relevance scores, excerpt counts, and sortable reordering) and **Write** (section prose editor with inline `@`-triggered citations, APA/IEEE preview, and AI text optimization toolbar).
   - **Right: Document Library** — All uploaded papers as draggable cards with search, group filtering, status badges, and sortable reordering.
3. **Paper detail** — Clicking a paper card opens a slide-over sheet showing all section assignments, AI summary, excerpts (with page numbers), and a "Preview document" button.
4. **Document preview** — Full-screen PDF viewer overlay with citation trigger buttons per section.
5. **Global search** — `Cmd+K` / `Ctrl+K` opens a command-palette modal that searches across all collected excerpts with debounced filtering and keyboard navigation.

## Architecture

```
main.tsx
  ├── ConvexProvider (reactive data layer)
  ├── LanguageProvider (i18n context)
  ├── BrowserRouter
  │   ├── / → Dashboard
  │   └── /upload → Upload
  └── Toaster (Sonner)

Dashboard (3-panel DndContext)
  ├── OutlineSidebar (left, 260px)
  │   └── SectionNode (recursive tree, drop targets)
  ├── SectionDetailPanel (center, flex-1)
  │   ├── Read tab → SectionPapers → PaperCard (sortable, draggable)
  │   └── Write tab → SectionWriteEditor (prose + @-citations + AI optimize toolbar)
  ├── DocumentLibrary (right, 320px)
  │   └── LibraryPaperCard (draggable, sortable)
  └── SearchModal (Cmd+K, portal overlay)

Upload
  ├── OutlineEditor → OutlineTextInput + OutlineTreePreview
  ├── UploadZone (file drop area)
  └── Papers table (real-time status with processing steps)
```

**Key patterns:**
- All data comes from `useQuery()` hooks (Convex reactive subscriptions) — no local state for server data
- Drag-and-drop uses `@dnd-kit/core` with `pointerWithin` collision detection and `PointerSensor` with 8px activation distance
- Three drag intents resolved in `handleDragEnd`: library reorder, section match reorder, and cross-panel drop (citation or manual match)
- The `DragOverlay` component renders a ghost card during drags
- `LanguageContext` provides the selected language (default "en") used for citation and summarization
- `useTextOptimize` hook manages the AI text optimization lifecycle (request → loading → preview/error → accept/discard), swapping citation markers to safe placeholders before the AI call
- `SearchModal` renders as a portal overlay with debounced client-side filtering over all excerpts fetched from Convex

## Key Files

| Purpose | Path |
|---------|------|
| App entry point + routing | `frontend/src/main.tsx` |
| Dashboard page (3-panel layout) | `frontend/src/pages/Dashboard.tsx` |
| Upload page (outline + upload) | `frontend/src/pages/Upload.tsx` |
| Outline sidebar (left panel) | `frontend/src/components/OutlineSidebar.tsx` |
| Recursive tree node | `frontend/src/components/SectionNode.tsx` |
| Section detail panel (center) | `frontend/src/components/SectionDetailPanel.tsx` |
| Section paper list | `frontend/src/components/SectionPapers.tsx` |
| Paper card in sections | `frontend/src/components/PaperCard.tsx` |
| Document library (right panel) | `frontend/src/components/DocumentLibrary.tsx` |
| Library paper card | `frontend/src/components/LibraryPaperCard.tsx` |
| Paper detail sheet | `frontend/src/components/PaperDetailSheet.tsx` |
| Paper summary card | `frontend/src/components/PaperSummaryCard.tsx` |
| PDF viewer | `frontend/src/components/PdfViewer.tsx` |
| Document preview modal | `frontend/src/components/DocumentPreviewModal.tsx` |
| Outline text editor | `frontend/src/components/OutlineEditor.tsx` |
| Upload zone | `frontend/src/components/UploadZone.tsx` |
| Groups section | `frontend/src/components/GroupsSection.tsx` |
| Citation picker | `frontend/src/components/CitationPicker.tsx` |
| Section write editor | `frontend/src/components/SectionWriteEditor.tsx` |
| Stat strip (header counts) | `frontend/src/components/StatStrip.tsx` |
| Outline text parser | `frontend/src/lib/outlineParser.ts` |
| Flat-to-tree builder | `frontend/src/lib/treeBuilder.ts` |
| TypeScript type definitions | `frontend/src/lib/types.ts` |
| Citation utilities | `frontend/src/lib/citationUtils.ts` |
| Language context provider | `frontend/src/lib/LanguageContext.tsx` |
| General utilities | `frontend/src/lib/utils.ts` |
| Outline format guide | `frontend/src/components/OutlineFormatGuide.tsx` |
| Global excerpt search modal | `frontend/src/components/SearchModal.tsx` |
| AI text optimize hook | `frontend/src/hooks/useTextOptimize.ts` |
| Language selector dropdown | `frontend/src/components/LanguageSelector.tsx` |
| App configuration (Python URL) | `frontend/src/lib/config.ts` |
| shadcn/ui components | `frontend/src/components/ui/` |

## Data

N/A — The frontend has no local database. All data is fetched from Convex via reactive queries and written via mutations. See [Convex Backend](convex-backend.md) for the data model.

## Related Features

| Feature | Relationship | Why |
|---------|-------------|-----|
| [Convex Backend](convex-backend.md) | depends-on | All data reads (useQuery) and writes (useMutation) flow through Convex |
| [Outline Management](outline-management.md) | depends-on | Outline sidebar, editor, and tree preview render and manage outline sections |
| [Paper-Section Matching](paper-section-matching.md) | depends-on | Drag-and-drop triggers citation; section detail panel displays matches and excerpts |
| [Paper Processing](paper-processing.md) | depends-on | Upload zone triggers processing; paper status is displayed in real time |

## Design Decisions

- **Three-panel Dashboard layout** — The sidebar (260px), center (flex), and library (320px) layout mirrors common research tools (e.g., reference managers). The sidebar is for navigation, center for detail, and right panel for the paper source material.
- **DND-Kit over HTML5 drag** — DND-Kit provides better control over collision detection, drag overlays, and sensor configuration. The `pointerWithin` strategy works well for the nested drop targets (sidebar sections vs center panel).
- **Three drag intents in one DndContext** — Rather than separate DndContexts per panel, a single context handles library reorder, section match reorder, and cross-panel drops. The `handleDragEnd` disambiguates by checking which ordered list contains the active/over IDs.
- **No state management library** — Convex reactive queries replace the need for Redux/Zustand. Local UI state (active section, drag state, preview paper, citing sections) lives in `useState` hooks in the Dashboard component.
- **Citation via `fetch` to localhost** — The Dashboard calls the Python `/cite` endpoint directly from the browser (not through Convex). This avoids Convex HTTP action timeouts for long-running GPT calls.
- **shadcn/ui for UI primitives** — Button, Card, Input, Badge, Sheet, Table, Separator, Textarea are all from shadcn/ui. Custom components are built on top of these.
- **react-pdf for document viewing** — `PdfViewer` renders PDFs page-by-page in a scrollable container with zoom controls. The `DocumentPreviewModal` provides a full-screen overlay.

## Gotchas

- **Single DndContext complexity** — All three drag intents (library reorder, section reorder, cross-panel) share one DndContext. Bugs in collision detection or ID overlap between panels can cause misrouted drops.
- **Python service URL hardcoded** — The Dashboard component calls `http://localhost:8000/cite` directly. This only works in local development.
- **No error boundaries** — There are no React error boundaries. A rendering error in one panel crashes the entire Dashboard.
- **Large library performance** — With many papers, the Document Library renders all cards in a flat list. There is no virtualization, which could cause performance issues at scale.
- **Convex query waterfalls** — Some components (e.g., `getMatchesBySection` then `getExcerptsByMatch` per match) create sequential query chains. Convex's reactive model handles this, but initial load can feel slow with many matches.
