# ThesisOrganizer Frontend

React 19 single-page application built with Vite, TypeScript, TailwindCSS 4, and shadcn/ui.

## Pages

- **Dashboard** (`/`) — Three-panel layout: outline sidebar, section detail panel (with Read/Write tabs), and document library. Drag-and-drop for citation, paper moves, and reordering.
- **Upload** (`/upload`) — Outline text editor with live tree preview, and file upload zone with real-time processing status.

## Key Libraries

| Library | Purpose |
|---------|---------|
| `convex` | Real-time data layer (reactive queries + mutations) |
| `@dnd-kit/core` + `@dnd-kit/sortable` | Drag-and-drop interactions |
| `react-pdf` | PDF document viewer |
| `react-router-dom` | Client-side routing |
| `sonner` | Toast notifications |
| `lucide-react` | Icons |
| `shadcn/ui` | UI primitives (Button, Card, Input, Badge, Sheet, Table, etc.) |

## Development

```bash
npm install
npm run dev
```

Runs on [http://localhost:5173](http://localhost:5173). Requires the Convex backend (`cd ../convex && npx convex dev`) and Python service (`cd ../python && python3 main.py`) to be running.

## Source Structure

```
src/
├── pages/          # Dashboard, Upload
├── components/     # UI components (outline tree, paper cards, write editor, search modal, etc.)
│   └── ui/         # shadcn/ui primitives
├── hooks/          # Custom hooks (useTextOptimize)
└── lib/            # Types, utilities, parsers, citation helpers, config
```

See [Frontend Architecture](../docs/frontend-architecture.md) for detailed documentation.
