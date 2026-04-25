---
watched_paths:
  - "convex/convex/outline.ts"
  - "frontend/src/components/OutlineEditor.tsx"
  - "frontend/src/components/OutlineTree.tsx"
  - "frontend/src/components/OutlineSidebar.tsx"
  - "frontend/src/components/OutlineTextInput.tsx"
  - "frontend/src/components/OutlineTreePreview.tsx"
  - "frontend/src/components/EditableSectionItem.tsx"
  - "frontend/src/lib/outlineParser.ts"
  - "frontend/src/lib/treeBuilder.ts"
---

# Outline Management

Manages the user's thesis outline — a hierarchical tree of numbered sections that serves as the organizational backbone of the entire app. Users create their outline via a text-based editor with automatic numbering detection, preview the parsed tree, and save it to Convex. Sections are referenced by paper-section matching, the citation pipeline, and the Dashboard sidebar. The outline supports versioning, inline notes per section, and a diff-and-patch upsert strategy that preserves existing data relationships when sections are edited.

## User Flow

1. **Upload page → OutlineEditor** — User types or pastes their thesis outline as plain text with numbered headings (e.g., `1. Introduction`, `1.1 Background`)
2. **Live preview** — `OutlineTreePreview` renders the parsed tree in real time as the user types, showing depth and hierarchy
3. **Section notes** — Each section can have optional guidance notes (shown in parentheses) that influence AI scoring accuracy
4. **Save** — `OutlineEditor` calls `upsertOutlineSections` which diffs against existing sections: patches existing ones in place (preserving IDs and FK references), inserts new ones, and cascade-deletes removed sections along with their matches and excerpts
5. **Dashboard sidebar** — `OutlineSidebar` renders the saved tree as a navigable sidebar; clicking a section opens its detail panel

## Architecture

```
OutlineTextInput (textarea)
  → outlineParser.ts (text → ParsedSection[])
  → OutlineTreePreview (live preview)
  → OutlineEditor (save button)
    → outline.upsertOutlineSections (Convex mutation)
      → Diff-and-patch: existing sections patched, new inserted, removed cascade-deleted

OutlineSidebar (Dashboard)
  → outline.listSections (Convex query)
  → treeBuilder.ts (flat list → SectionTreeNode[])
  → SectionNode (recursive tree renderer)
```

**Key patterns:**
- Sections are stored flat in Convex with `parentId` references, built into a tree client-side via `treeBuilder.ts`
- `orderNumber` (e.g., "1.2.3") is the stable identifier used during upsert diffing — sections with the same `orderNumber` are patched in place
- The upsert sorts by depth to ensure parents are created before children, then does a second pass to resolve `parentId` references
- Outline versioning via `outlineVersion` field allows multiple outline snapshots (currently single-version)

## Key Files

| Purpose | Path |
|---------|------|
| Outline text parser | `frontend/src/lib/outlineParser.ts` |
| Flat-to-tree builder | `frontend/src/lib/treeBuilder.ts` |
| Outline text editor component | `frontend/src/components/OutlineEditor.tsx` |
| Text input area | `frontend/src/components/OutlineTextInput.tsx` |
| Live tree preview | `frontend/src/components/OutlineTreePreview.tsx` |
| Editable section item | `frontend/src/components/EditableSectionItem.tsx` |
| Dashboard sidebar tree | `frontend/src/components/OutlineSidebar.tsx` |
| Recursive tree node | `frontend/src/components/SectionNode.tsx` |
| Convex outline mutations/queries | `convex/convex/outline.ts` |
| Database schema | `convex/convex/schema.ts` |

## Data

| Table | Role |
|-------|------|
| `outlineSections` | Stores all sections with `title`, `orderNumber`, `depth`, `parentId`, `notes`, and `outlineVersion`. Indexed by version for efficient querying. |

No migration files — Convex manages schema via `convex/convex/schema.ts`.

## Related Features

| Feature | Relationship | Why |
|---------|-------------|-----|
| [Paper-Section Matching](paper-section-matching.md) | provides-to | Sections are the target of paper-section matches; deleting a section cascade-deletes its matches and excerpts |
| [Paper Processing](paper-processing.md) | provides-to | The HTTP trigger sends all outline sections to the Python `/process` endpoint; the `/cite` endpoint receives section objects for targeted scoring |
| [Frontend Architecture](frontend-architecture.md) | provides-to | The outline sidebar is one of the three main panels in the Dashboard layout |
| [Convex Backend](convex-backend.md) | depends-on | All outline persistence flows through Convex mutations and queries |

## Design Decisions

- **Diff-and-patch upsert (`upsertOutlineSections`)** — Instead of delete-all-and-reinsert, the mutation matches incoming sections to existing ones by `orderNumber`, patches titles/depth/notes in place, and only inserts truly new sections. This preserves `_id` values and all foreign key references (matches, excerpts) that point to existing sections.
- **Text-based input over visual tree editor** — Users paste their outline as numbered text (e.g., from a Word doc), which is parsed automatically. This is faster for initial setup than building a tree node-by-node.
- **Section notes as AI hints** — Notes attached to sections (shown in parentheses in the `mapper.py` prompt) guide GPT-4o's scoring. The prompt explicitly tells GPT to use these notes for accuracy.
- **Cascade delete on section removal** — When a section is removed during upsert, all its `paperSectionMatches` and `matchExcerpts` are deleted. This prevents orphaned data.
- **Duplicate orderNumber validation** — The upsert mutation rejects payloads with duplicate `orderNumber` values upfront to prevent data corruption.

## Gotchas

- **Order number is the diff key** — Changing a section's order number (e.g., renumbering "1.2" to "1.3") is treated as deleting "1.2" and creating "1.3". All matches and excerpts for the old section are lost.
- **Single version in practice** — The `outlineVersion` field supports multiple versions, but the UI always saves to version 1 and queries all sections without filtering by version. Adding multi-version support would require version selection UI.
- **Parser sensitivity** — `outlineParser.ts` expects numbered headings. Unnumbered or inconsistently formatted text may produce unexpected tree structures.
- **No undo** — Saving the outline immediately diffs and persists. There is no undo mechanism for accidentally deleted sections (and their cascade-deleted matches).
