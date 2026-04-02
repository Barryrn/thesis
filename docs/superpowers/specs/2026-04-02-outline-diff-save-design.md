# Outline Diff-and-Patch Save

## Problem

`upsertOutlineSections` deletes all existing `outlineSections` rows and re-inserts them with new Convex IDs every time the user saves. `paperSectionMatches` and `matchExcerpts` both reference section IDs as foreign keys. When sections get new IDs, all paper assignments, excerpts, and citations become orphaned — the data effectively vanishes.

This makes it impossible to safely rename sections, add new ones, or remove sections without losing all citation work.

## Solution

Replace the delete-all/reinsert pattern with a **diff-and-patch** approach that matches incoming sections to existing ones by `orderNumber`, preserving Convex `_id`s and all dependent data.

## Design

### Backend: `upsertOutlineSections` mutation (`convex/convex/outline.ts`)

Replace the current handler with:

**Step 0 — Validate incoming sections**
- Reject duplicate `orderNumber` values (throw an error if the incoming array has two sections with the same orderNumber).
- Sort incoming sections by depth (ascending) to guarantee parents are processed before children.

**Step 1 — Load & index existing sections**
```
const existing = query outlineSections where outlineVersion = args.version
const existingByOrder = Map<orderNumber, section>
```

**Step 2 — Walk incoming sections (sorted by depth), classify each**
- **Update** (orderNumber exists in `existingByOrder`):
  `ctx.db.patch(existingId, { title, depth, notes })` — ID preserved
- **Insert** (orderNumber not in existing):
  `ctx.db.insert(...)` — new section, new ID
- Build `orderNumber → _id` map as we go (including both patched and inserted IDs)

**Step 3 — Resolve parentIds**
Second pass over all sections to set `parentId` using the `orderNumber → _id` map. This is safe because parents were processed first (depth-sorted) and all IDs are now known.

**Step 4 — Remove deleted sections**
For each existing `orderNumber` not present in the incoming list:
1. Delete all `matchExcerpts` where `sectionId` = removed section's `_id` (direct FK cleanup — covers both the match-indirect and direct `sectionId` reference)
2. Delete all `paperSectionMatches` where `sectionId` = removed section's `_id`
3. Delete the `outlineSections` row

Papers from deleted sections naturally return to the "unassigned" pool (since `getUnassignedPapers` checks for papers with zero matches).

**Atomicity:** Convex mutations are transactional — if any step throws, the entire mutation rolls back. No partial state.

### Frontend: No changes required

`OutlineEditor.tsx` already sends the full section list with `orderNumber` and `title` to the mutation. The tree editor already supports rename, add, remove, and reorder. Only the backend logic changes.

### Schema: No changes required

The `outlineSections` table schema remains identical. No migration needed.

## Known limitation

**Reordering sections loses assignments.** If a section moves from `2.3` to `2.4`, the old `2.3` is treated as removed and `2.4` as new. Papers go to the unassigned pool. This is an accepted trade-off of matching by `orderNumber`. A future enhancement could add title-based fallback matching.

## Behavior Matrix

| User Action | Before (broken) | After (fixed) |
|-------------|-----------------|---------------|
| Rename section title | All section IDs regenerated, all matches/excerpts orphaned | Section patched in-place, ID preserved, all data intact |
| Add new section | All data lost for every section | Only new section inserted, existing sections untouched |
| Remove a section | All data lost for every section | Only removed section's matches/excerpts deleted, papers go to unassigned |
| Reorder (e.g. 2.3 → 2.4) | All data lost | Section at old orderNumber treated as removed, new orderNumber treated as new — data goes to unassigned |

## Files to modify

| File | Change |
|------|--------|
| `convex/convex/outline.ts` | Rewrite `upsertOutlineSections` handler with diff-and-patch logic |

## Verification

1. Create an outline with 3+ sections, save it
2. Assign papers to sections via drag-and-drop, add excerpts
3. Rename a section title → save → verify papers and excerpts are still assigned
4. Add a new section → save → verify existing sections keep their data
5. Remove a section that has papers → save → verify those papers appear in the unassigned pool
6. Reorder sections → save → verify moved sections' papers appear in unassigned pool
7. Check that the outline sidebar displays correctly after each operation
