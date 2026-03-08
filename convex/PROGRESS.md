# Convex Backend — Progress Tracking

## Deployment Info

- **Convex URL**: `https://necessary-dinosaur-415.eu-west-1.convex.cloud`
- **Deploy key**: `preview:barry-azihuwa:thesis|eyJ2MiI6IjIxN2Y5NjllZmZmZDQzMzY5ODA4ZDA1N2Y5ZDNlZDc0In0=`
- **Status**: Deployed successfully

---

## Files Written

| File | Full Path |
|------|-----------|
| `schema.ts` | `convex/convex/schema.ts` |
| `papers.ts` | `convex/convex/papers.ts` |
| `outline.ts` | `convex/convex/outline.ts` |
| `summaries.ts` | `convex/convex/summaries.ts` |
| `matches.ts` | `convex/convex/matches.ts` |
| `http.ts` | `convex/convex/http.ts` |
| `.env.local` | `convex/.env.local` |
| `tsconfig.json` | `convex/tsconfig.json` |

---

## All Mutations and Queries (for Prompt C imports)

### papers.ts
| Name | Type | Import Path |
|------|------|-------------|
| `createPaper` | mutation | `api.papers.createPaper` |
| `updatePaperStatus` | mutation | `api.papers.updatePaperStatus` |
| `updatePaperMetadata` | mutation | `api.papers.updatePaperMetadata` |
| `getPaper` | query | `api.papers.getPaper` |
| `listPapers` | query | `api.papers.listPapers` |
| `generateUploadUrl` | mutation | `api.papers.generateUploadUrl` |
| `getFileUrl` | query | `api.papers.getFileUrl` |

### outline.ts
| Name | Type | Import Path |
|------|------|-------------|
| `upsertOutlineSections` | mutation | `api.outline.upsertOutlineSections` |
| `listSections` | query | `api.outline.listSections` |

### summaries.ts
| Name | Type | Import Path |
|------|------|-------------|
| `createSummary` | mutation | `api.summaries.createSummary` |
| `createIdentifiers` | mutation | `api.summaries.createIdentifiers` |
| `getSummaryByPaper` | query | `api.summaries.getSummaryByPaper` |
| `getIdentifiersByPaper` | query | `api.summaries.getIdentifiersByPaper` |

### matches.ts
| Name | Type | Import Path |
|------|------|-------------|
| `createMatches` | mutation | `api.matches.createMatches` |
| `updateMatch` | mutation | `api.matches.updateMatch` |
| `getMatchesBySection` | query | `api.matches.getMatchesBySection` |
| `getUnassignedPapers` | query | `api.matches.getUnassignedPapers` |

---

## HTTP POST Body for `/trigger-processing`

**Endpoint**: `POST {CONVEX_SITE_URL}/trigger-processing`

**Request body**:
```json
{
  "paperId": "<Id<'papers'>>"
}
```

**What it does**:
1. Sets paper status to `"processing"`
2. Fetches the paper document (to get `fileUrl`)
3. Fetches all outline sections
4. Calls `POST http://localhost:8000/process` with the payload below
5. On error, sets paper status to `"failed"` with `errorMessage`

---

## Sections Array Shape (sent to Python)

The `/trigger-processing` endpoint sends this to the Python service at `POST http://localhost:8000/process`:

```json
{
  "paperId": "<Id<'papers'>>",
  "fileUrl": "https://...",
  "sections": [
    {
      "_id": "<Id<'outlineSections'>>",
      "orderNumber": "1.1",
      "title": "Introduction"
    },
    {
      "_id": "<Id<'outlineSections'>>",
      "orderNumber": "1.2",
      "title": "Literature Review"
    }
  ]
}
```

Each section object has:
- `_id`: Convex document ID (`Id<"outlineSections">`)
- `orderNumber`: String like `"1"`, `"1.1"`, `"2.3.1"`
- `title`: Section title string

---

## Notes

- `generateUploadUrl` is a **mutation** (not action) because `ctx.storage.generateUploadUrl()` is only available in mutation context
- `getFileUrl` is a **query** (not action) because `ctx.storage.getUrl()` works in query context and it's read-only
- The `listSections()` query takes **no arguments** and returns all sections across all versions, ordered by `orderNumber` ascending
- The `storageId` field on papers is `v.string()` (not `v.id("_storage")`)
- `outlineSections.orderNumber` is `v.string()` (not number) to support hierarchical numbering like `"1.2.3"`
