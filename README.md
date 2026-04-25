# ThesisOrganizer

A full-stack AI-powered research paper organizer that helps researchers and students map academic papers to their thesis outline. Upload papers, let GPT-4o analyze them, and get intelligent suggestions for which sections each paper supports — complete with relevance scores, extracted excerpts, and an integrated writing environment.

## Features

- **Paper Upload & Processing** — Upload PDF, DOCX, or TXT files. The system extracts text, detects metadata (title, authors, year), and identifies academic identifiers (DOI, ISBN, arXiv). Real-time processing progress steps (downloading → extracting → identifying → summarizing → saving) keep you informed.
- **AI-Powered Summarization** — GPT-4o generates structured summaries including research questions, methodology, key findings, and keywords. Supports multiple languages (English, German).
- **Thesis Outline Management** — Create and manage a hierarchical thesis outline with nested sections, notes, and manual ordering. Diff-and-patch saves preserve existing citations when you edit the outline.
- **On-Demand Citation** — Drag a paper onto any outline section to trigger AI scoring. GPT-4o evaluates relevance (0.0–1.0) and extracts verbatim excerpts with page numbers — only for the sections you choose, saving tokens.
- **Section Write Mode** — Compose thesis prose directly within each section using an integrated editor. Insert inline citations via `@`-trigger, preview formatted references in APA or IEEE style, and auto-save to the cloud.
- **AI Text Optimization** — Select text in the write editor and choose from four AI-powered rewrite modes: enhance, formalize, simplify, or expand. Citations are preserved through the optimization.
- **Global Excerpt Search** — Press `Cmd+K` to open a command-palette search across all collected excerpts. Quickly find and navigate to any excerpt by keyword.
- **Paper Groups** — Organize papers into color-coded collections for easier management and filtering in the Document Library.
- **Full-Screen PDF Viewer** — Preview uploaded documents in a full-screen overlay with zoom controls and per-section citation trigger buttons.
- **Interactive Dashboard** — Three-panel layout with drag-and-drop: outline sidebar (navigation + drop targets), section detail panel (matched papers + excerpts), and document library (all papers, searchable and sortable).
- **Real-Time Sync** — Convex backend provides instant data synchronization across all views.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite 7, TailwindCSS 4, shadcn/ui |
| Backend | Convex (BaaS) — real-time database, file storage, HTTP actions |
| Processing | Python FastAPI — document extraction, summarization, citation, and text optimization |
| AI | OpenAI GPT-4o — summarization, relevance scoring, excerpt extraction, and text optimization |
| UI Libraries | DND-Kit (drag-and-drop), react-pdf (document viewer), Lucide (icons), Sonner (toasts) |

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌────────────────-─┐
│   Frontend  │◄───►│    Convex    │────►│  Python FastAPI  │
│  React/Vite │     │   Backend    │     │   (port 8000)    │
│ (port 5173) │     │  (cloud)     │     │                  │
└─────────────┘     └──────────────┘     └────────┬─────────┘
                                                   │
                                            ┌──────▼──────┐
                                            │  OpenAI API │
                                            │   (GPT-4o)  │
                                            └─────────────┘
```

1. **Frontend** sends file uploads and outline data to Convex. Also calls the Python backend directly for citation (`/cite`) and text optimization (`/optimize`).
2. **Convex** stores data, triggers an HTTP action to the Python backend for paper processing.
3. **Python FastAPI** exposes three endpoints: `/process` (extract + summarize), `/cite` (score sections + extract excerpts), and `/optimize` (AI text rewriting). Results are written back to Convex via the deploy key REST API.

## Prerequisites

- **Node.js** >= 18
- **Python** >= 3.9
- **npm** (comes with Node.js)
- An **OpenAI API key** ([get one here](https://platform.openai.com/api-keys))
- A **Convex account** ([sign up free](https://convex.dev))

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/your-username/thesis-organizer.git
cd thesis-organizer
```

### 2. Set up environment variables

Copy the example environment file in the project root and fill in your keys:

```bash
cp .env.example .env
```

Edit `.env`:

```env
VITE_CONVEX_URL=https://your-deployment.convex.cloud
CONVEX_URL=https://your-deployment.convex.cloud
CONVEX_DEPLOY_KEY=prod:your-deployment|your-deploy-key-here
OPENAI_API_KEY=sk-your-openai-api-key-here
```

> **Note:** Both the frontend and Python backend read from this single root `.env` file.

### 3. Set up the Frontend

```bash
cd frontend
npm install
```

### 4. Set up the Convex Backend

```bash
cd convex
npm install
npx convex dev
```

Running `npx convex dev` for the first time will:
- Prompt you to log in to Convex (or create an account)
- Create a new project and deployment
- Automatically generate a `.env.local` file with your deployment credentials
- Push the schema and functions to your Convex backend

> **Note:** Keep this terminal running — it watches for changes and syncs them to the cloud.

### 5. Set up the Python Backend

```bash
cd python
python3 -m venv .venv
source .venv/bin/activate   # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## API Keys & Environment Variables

### Required Keys

All variables are set in the root `.env` file:

| Variable | How to Get It |
|----------|---------------|
| `OPENAI_API_KEY` | [OpenAI Platform](https://platform.openai.com/api-keys) — create a new secret key |
| `CONVEX_URL` | [Convex Dashboard](https://dashboard.convex.dev) — your deployment URL |
| `CONVEX_DEPLOY_KEY` | Convex Dashboard → your project → Settings → Deploy Key |
| `VITE_CONVEX_URL` | Same as `CONVEX_URL` above (needed with `VITE_` prefix for the frontend) |

### Auto-Generated (by Convex CLI)

| Variable | Where | Notes |
|----------|-------|-------|
| `CONVEX_DEPLOYMENT` | `convex/.env.local` | Set automatically by `npx convex dev` |
| `CONVEX_SITE_URL` | `convex/.env.local` | HTTP actions endpoint, set automatically |

### Getting Your Convex Deploy Key

1. Go to [dashboard.convex.dev](https://dashboard.convex.dev)
2. Select your project
3. Navigate to **Settings**
4. Copy the **Deploy Key**

### Environment File Summary

```
thesis-organizer/
├── .env                    # All project secrets (OPENAI_API_KEY, CONVEX_URL, etc.)
├── .env.example            # Template with placeholders
└── convex/.env.local       # Auto-generated by Convex CLI
```

## Running the Project

You need **three terminals** running simultaneously:

### Terminal 1 — Python Backend (port 8000)

```bash
cd python
source .venv/bin/activate
python3 main.py
```

### Terminal 2 — Convex Backend

```bash
cd convex
npx convex dev
```

### Terminal 3 — Frontend (port 5173)

```bash
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Quick Start (all at once)

```bash
# Start all servers in separate background processes
(cd python && source .venv/bin/activate && python3 main.py &) && \
(cd convex && npx convex dev &) && \
(cd frontend && npm run dev &)
```

## Usage

1. **Create an Outline** — Go to the Upload page (`/upload`) and paste or type your thesis outline with numbered sections (e.g., `1. Introduction`, `1.1 Background`). The editor shows a live preview of the parsed tree.
2. **Upload Papers** — Drag and drop PDF, DOCX, or TXT files into the upload zone. Watch real-time progress as each paper moves through the pipeline.
3. **Cite Papers** — In the Dashboard, drag a paper from the Document Library onto any outline section in the sidebar. GPT-4o scores relevance and extracts supporting excerpts with page numbers.
4. **Explore Results** — Click a section to see matched papers with relevance scores, excerpt counts, and page references. Click a paper card to open the detail sheet with all assignments and the AI summary.
5. **Write** — Switch to the Write tab in the section detail panel to compose thesis prose. Type `@` to insert inline citations, then preview formatted references in APA or IEEE style.
6. **Optimize Text** — Select text in the write editor and use the AI toolbar to enhance, formalize, simplify, or expand your writing.
7. **Search Excerpts** — Press `Cmd+K` (or `Ctrl+K`) to search across all collected excerpts and jump to the relevant section.
8. **Organize** — Create paper groups (color-coded collections), reorder papers via drag-and-drop, and add notes to sections or matches.

## Project Structure

```
thesis-organizer/
├── frontend/                  # React + Vite frontend
│   ├── src/
│   │   ├── pages/             # Dashboard and Upload pages
│   │   ├── components/        # React components (outline tree, paper cards, write editor, etc.)
│   │   ├── hooks/             # Custom React hooks (useTextOptimize)
│   │   └── lib/               # Types, utilities, parsers, citation helpers
│   ├── package.json
│   └── vite.config.ts
│
├── convex/                    # Convex backend
│   └── convex/
│       ├── schema.ts          # Database schema (9 tables)
│       ├── papers.ts          # Paper CRUD operations
│       ├── summaries.ts       # Summary and identifier storage
│       ├── matches.ts         # Paper-section matching and excerpts
│       ├── outline.ts         # Outline section management (diff-and-patch upsert)
│       ├── sectionContent.ts  # Authored thesis prose per section
│       ├── groups.ts          # Paper groups and memberships
│       └── http.ts            # HTTP router for Python integration
│
├── python/                    # FastAPI processing backend
│   ├── main.py                # API server (/process, /cite, /optimize endpoints)
│   ├── extractor.py           # PDF/DOCX/TXT text extraction with page resolution
│   ├── summarizer.py          # GPT-4o paper summarization (chunked for long texts)
│   ├── mapper.py              # Section relevance scoring and excerpt extraction
│   ├── optimizer.py           # AI text optimization (enhance/formalize/simplify/expand)
│   ├── identifier.py          # DOI/ISBN/arXiv detection
│   ├── convex_client.py       # Convex REST API client
│   ├── pipeline_logger.py     # Structured pipeline logging
│   └── requirements.txt       # Python dependencies
│
├── docs/                      # Project documentation
│   ├── frontend-architecture.md
│   ├── convex-backend.md
│   ├── paper-processing.md
│   ├── outline-management.md
│   └── paper-section-matching.md
│
└── assets/                    # Static assets (sample PDFs)
```

## Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. **Create a branch** for your feature or fix:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes** and test them locally
4. **Commit** with a descriptive message:
   ```bash
   git commit -m "feat: add your feature description"
   ```
5. **Push** to your fork and open a **Pull Request**

### Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation changes
- `refactor:` — code restructuring without behavior changes
- `chore:` — maintenance tasks

### Development Tips

- The Convex dev server must be running for the frontend to work.
- The Python server must be running for document processing to work.
- Frontend uses hot module replacement — changes appear instantly.
- Convex functions auto-deploy when you save files (with `npx convex dev` running).

## License

This project is licensed under the MIT License with the Commons Clause — see the [LICENSE](LICENSE) file for details.
