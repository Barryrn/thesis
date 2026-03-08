# Frontend — Progress Tracking

## Deployment Info

- **Convex URL**: `https://clever-trout-235.eu-west-1.convex.cloud`
- **Convex Site URL**: `https://clever-trout-235.eu-west-1.convex.site`
- **Framework**: Vite + React 18 + TypeScript
- **Status**: Build passes, all components implemented

---

## Files Written

| File | Full Path | Purpose |
|------|-----------|---------|
| `vite.config.ts` | `frontend/vite.config.ts` | Vite config with Tailwind, path aliases, symlink support |
| `tsconfig.json` | `frontend/tsconfig.json` | Root TS config with `@/` path alias |
| `tsconfig.app.json` | `frontend/tsconfig.app.json` | App TS config including `convex` dir |
| `.env.local` | `frontend/.env.local` | `VITE_CONVEX_URL` |
| `index.css` | `frontend/src/index.css` | Tailwind + shadcn CSS variables |
| `main.tsx` | `frontend/src/main.tsx` | ConvexProvider + BrowserRouter + Routes |
| `types.ts` | `frontend/src/lib/types.ts` | Shared TypeScript interfaces |
| `outlineParser.ts` | `frontend/src/lib/outlineParser.ts` | Outline text parser |
| `treeBuilder.ts` | `frontend/src/lib/treeBuilder.ts` | Flat sections → tree builder |
| `utils.ts` | `frontend/src/lib/utils.ts` | shadcn `cn()` utility |
| `StatCard.tsx` | `frontend/src/components/StatCard.tsx` | Stat display card |
| `PaperCard.tsx` | `frontend/src/components/PaperCard.tsx` | Draggable paper card with score badge |
| `PaperDetailSheet.tsx` | `frontend/src/components/PaperDetailSheet.tsx` | Side panel with paper summary/identifiers |
| `OutlineEditor.tsx` | `frontend/src/components/OutlineEditor.tsx` | Outline textarea + save |
| `UploadZone.tsx` | `frontend/src/components/UploadZone.tsx` | Drag-and-drop file upload |
| `SectionPapers.tsx` | `frontend/src/components/SectionPapers.tsx` | Papers list within a section |
| `SectionNode.tsx` | `frontend/src/components/SectionNode.tsx` | Recursive tree node (droppable) |
| `OutlineTree.tsx` | `frontend/src/components/OutlineTree.tsx` | Full outline tree container |
| `UnassignedPanel.tsx` | `frontend/src/components/UnassignedPanel.tsx` | Unassigned papers sidebar |
| `Dashboard.tsx` | `frontend/src/pages/Dashboard.tsx` | Main page with DnD context |
| `Upload.tsx` | `frontend/src/pages/Upload.tsx` | Upload page with outline editor + upload zone |

---

## Dependencies Installed

- `convex` — Convex React SDK
- `react-router-dom` — Client-side routing
- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` — Drag and drop
- `sonner` — Toast notifications
- `tailwindcss`, `@tailwindcss/vite` — CSS framework
- `shadcn/ui` components: button, card, badge, textarea, sheet, table, separator

---

## Key Design Decisions

1. **Convex symlink**: `frontend/convex/` symlinks to `../convex/convex/` for type imports
2. **DnD architecture**: Single `DndContext` in Dashboard wraps both OutlineTree and UnassignedPanel
3. **Unassigned → Section drag**: Uses `createMatches` (replaces all matches with score 1.0)
4. **Section → Section drag**: Uses `updateMatch` (sets `isManualOverride: true`)
5. **Outline version**: Always `version: 1` (single-user app)
6. **Upload flow**: generateUploadUrl (mutation) → POST file → imperative query for fileUrl → createPaper → POST trigger-processing
7. **HTTP trigger**: Goes to `.site` URL, not `.cloud` URL

---

## Notes

- `generateUploadUrl` is a **mutation** (not action)
- `getFileUrl` is a **query** (not action), called imperatively via `useConvex().query()`
- shadcn/ui v4 uses `@base-ui/react` (not Radix) — no `asChild` prop on SheetTrigger
- Removed `verbatimModuleSyntax` and `erasableSyntaxOnly` from tsconfig to support Convex backend symlink
