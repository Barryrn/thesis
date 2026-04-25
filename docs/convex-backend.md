---
watched_paths:
  - "convex/convex/**"
---

# Convex Backend

Convex serves as the real-time Backend-as-a-Service (BaaS) for ThesisOrganizer, providing the database, file storage, server-side mutations/queries, and an HTTP router that bridges the frontend to the Python processing pipeline. All data flows through Convex — the frontend reads via reactive queries (automatic UI updates), and the Python backend writes via the deploy key REST API. The schema defines 9 tables covering papers, summaries, identifiers, outline sections, matches, excerpts, section content (authored prose), and paper groups.

## User Flow

N/A — Convex is infrastructure. Users interact with it indirectly through the frontend (real-time data updates, file uploads) and the Python pipeline (data persistence). Visible effects include instant UI updates when papers finish processing, real-time match/excerpt changes after citation, and live outline saves.

## Architecture

```
Frontend (ConvexReactClient)
  ← useQuery()  — reactive subscriptions (auto-refresh on data change)
  → useMutation() — client-side mutations (CRUD, reordering, etc.)

Python Backend (convex_client.py)
  → CONVEX_URL/api/mutation — authenticated via deploy key
  → CONVEX_URL/api/query — authenticated via deploy key

Convex Cloud
  ├── schema.ts     — 9 tables with validators and indexes
  ├── papers.ts     — Paper CRUD, file storage, library ordering
  ├── summaries.ts  — Summary and identifier storage
  ├── matches.ts    — Match/excerpt CRUD, upsert citation, reordering
  ├── outline.ts    — Outline upsert, section notes, listing
  ├── groups.ts     — Paper groups (collections) and memberships
  ├── sectionContent.ts — Section content management
  └── http.ts       — HTTP router (/trigger-processing endpoint)
```

**Key patterns:**
- No authentication — the app is single-user (thesis organizer for one researcher)
- The HTTP router (`http.ts`) is the only server-to-server bridge; it calls the Python service and handles CORS
- Python writes to Convex via the deploy key REST API, bypassing the reactive client
- Convex file storage handles paper uploads; `storageId` links to the blob, `fileUrl` is the public download URL
- All tables use Convex's built-in `_id` as primary key and `_creationTime` for ordering

## Key Files

| Purpose | Path |
|---------|------|
| Database schema (9 tables) | `convex/convex/schema.ts` |
| Paper CRUD + file storage | `convex/convex/papers.ts` |
| Summary + identifier storage | `convex/convex/summaries.ts` |
| Match + excerpt CRUD | `convex/convex/matches.ts` |
| Outline section management | `convex/convex/outline.ts` |
| Paper groups + memberships | `convex/convex/groups.ts` |
| Section content management | `convex/convex/sectionContent.ts` |
| HTTP router (Python bridge) | `convex/convex/http.ts` |
| Generated API types | `convex/convex/_generated/api.d.ts` |
| Generated data model types | `convex/convex/_generated/dataModel.d.ts` |
| Convex package config | `convex/package.json` |

## Data

| Table | Role |
|-------|------|
| `papers` | Core paper records: title, authors, year, status (`pending`/`processing`/`completed`/`failed`), storageId, fileUrl, fileName, notes, libraryDisplayOrder, processingStep (current pipeline step for UI progress display) |
| `summaries` | AI-generated structured summaries: research question, methodology, key findings, keywords, raw summary, language. Indexed by `paperId`. |
| `paperIdentifiers` | Academic identifiers (DOI, ISBN, arXiv) linked to papers. Indexed by `paperId`. |
| `outlineSections` | Hierarchical thesis sections: title, orderNumber, depth, parentId, notes, outlineVersion. Indexed by `outlineVersion`. |
| `paperSectionMatches` | Join table: paper-to-section relevance scores with manual override flag, timestamps, display order, user notes. Indexed by `paperId` and `sectionId`. |
| `matchExcerpts` | Verbatim excerpts supporting matches: text, relevance note, order index, page number, approximate flag, manual flag. Indexed by `matchId` and `(paperId, sectionId)`. |
| `sectionContent` | Authored thesis prose per section: body text with `{{cite:paperId::Label}}` markers, cached `citedPaperIds` array, and `updatedAt` timestamp. Indexed by `sectionId`. Separate from `outlineSections` so content survives outline re-imports. |
| `paperGroups` | User-defined paper collections with name and color. |
| `paperGroupMemberships` | Many-to-many join between papers and groups. Indexed by `paperId`, `groupId`, and the composite `(paperId, groupId)`. |

No migration files — Convex auto-manages schema from `schema.ts`.

## Related Features

| Feature | Relationship | Why |
|---------|-------------|-----|
| [Paper Processing](paper-processing.md) | provides-to | HTTP action triggers Python pipeline; stores paper status, summaries, and identifiers |
| [Outline Management](outline-management.md) | provides-to | Stores outline sections; `upsertOutlineSections` handles diff-and-patch saves |
| [Paper-Section Matching](paper-section-matching.md) | provides-to | Stores matches and excerpts; provides real-time queries for the section detail panel |
| [Frontend Architecture](frontend-architecture.md) | provides-to | All frontend data comes from Convex reactive queries; all writes go through Convex mutations |

## Design Decisions

- **No authentication** — ThesisOrganizer is a single-user tool. Adding auth would add complexity without value for the thesis use case. All data is accessible to anyone with the Convex URL.
- **Deploy key REST API for Python** — The Python service cannot use the Convex reactive client (JS-only). Instead, `convex_client.py` calls `CONVEX_URL/api/mutation` and `CONVEX_URL/api/query` with the deploy key in the `Authorization` header.
- **HTTP action as bridge** — The `/trigger-processing` HTTP action in Convex serves as the server-to-server bridge. It updates paper status, fetches necessary data, and calls the Python service — all in one action.
- **Cascade deletes in application code** — Convex doesn't support database-level cascading foreign keys. Deletes in `papers.ts` and `outline.ts` manually cascade through related tables (excerpts, matches, summaries, identifiers).
- **Paper groups as separate tables** — Groups use a classic many-to-many pattern (`paperGroups` + `paperGroupMemberships`) rather than embedding group IDs in the paper record. This allows efficient group-level queries and avoids document size limits.
- **Idempotent group membership** — `addPaperToGroup` checks for existing membership before inserting, making it safe to call multiple times.

## Gotchas

- **No authentication means no access control** — Anyone with the Convex deployment URL can read/write all data. Keep the URL private.
- **Manual cascade deletes** — If a new table references papers or sections, its cleanup must be manually added to the delete handlers in `papers.ts` and `outline.ts`.
- **HTTP action timeout** — Convex HTTP actions have execution limits. If the Python pipeline takes too long, the HTTP action may time out even though the Python service continues processing (the Python service writes results back independently).
- **`_generated/` files are auto-generated** — Never edit files in `convex/convex/_generated/`. They are regenerated by `npx convex dev` whenever schema or functions change.
- **Unique group names** — `createGroup` enforces unique names via a query-then-insert pattern, which has a theoretical race condition under concurrent writes (unlikely for single-user).
