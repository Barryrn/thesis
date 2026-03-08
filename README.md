# ThesisOrganizer

A full-stack AI-powered research paper organizer that helps researchers and students map academic papers to their thesis outline. Upload papers, let GPT-4o analyze them, and get intelligent suggestions for which sections each paper supports — complete with relevance scores and extracted excerpts.

## Features

- **Paper Upload & Processing** — Upload PDF, DOCX, or TXT files. The system extracts text, detects metadata (title, authors, year), and identifies academic identifiers (DOI, ISBN, arXiv).
- **AI-Powered Summarization** — GPT-4o generates structured summaries including research questions, methodology, key findings, and keywords.
- **Thesis Outline Management** — Create and manage a hierarchical thesis outline with nested sections, notes, and manual ordering.
- **Intelligent Paper-Section Matching** — AI scores each paper's relevance (0.0–1.0) against every outline section and extracts supporting excerpts.
- **Interactive Dashboard** — Real-time UI with drag-and-drop reordering, inline editing, excerpt management, and document previews.
- **Real-Time Sync** — Convex backend provides instant data synchronization across all views.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, TailwindCSS, shadcn/ui |
| Backend | Convex (BaaS) — real-time database, file storage, HTTP actions |
| Processing | Python FastAPI — document extraction and AI pipeline |
| AI | OpenAI GPT-4o — summarization and relevance scoring |
| UI Libraries | DND-Kit (drag-and-drop), Lucide (icons), Sonner (toasts) |

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

1. **Frontend** sends file uploads and outline data to Convex.
2. **Convex** stores data, triggers an HTTP action to the Python backend.
3. **Python FastAPI** extracts text, calls OpenAI for summarization and section scoring, then writes results back to Convex.

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

1. **Create an Outline** — Go to the Upload page and paste or type your thesis outline with hierarchical sections.
2. **Upload Papers** — Drag and drop PDF, DOCX, or TXT files into the upload zone.
3. **Wait for Processing** — The system extracts text, generates summaries, and scores relevance against each section.
4. **Explore Results** — Navigate your outline in the Dashboard. Each section shows matched papers with relevance scores and excerpts.
5. **Refine** — Manually adjust matches, add/edit excerpts, reorder papers, and add notes.

## Project Structure

```
thesis-organizer/
├── frontend/                  # React + Vite frontend
│   ├── src/
│   │   ├── pages/             # Dashboard and Upload pages
│   │   ├── components/        # React components (outline tree, paper cards, etc.)
│   │   └── lib/               # Types, utilities, parsers
│   ├── package.json
│   └── vite.config.ts
│
├── convex/                    # Convex backend
│   └── convex/
│       ├── schema.ts          # Database schema (6 tables)
│       ├── papers.ts          # Paper CRUD operations
│       ├── summaries.ts       # Summary and identifier storage
│       ├── matches.ts         # Paper-section matching
│       ├── outline.ts         # Outline section management
│       └── http.ts            # HTTP endpoint for Python integration
│
├── python/                    # FastAPI processing backend
│   ├── main.py                # API server and processing orchestrator
│   ├── extractor.py           # PDF/DOCX/TXT text extraction
│   ├── summarizer.py          # GPT-4o paper summarization
│   ├── mapper.py              # Section relevance scoring
│   ├── identifier.py          # DOI/ISBN/arXiv detection
│   ├── convex_client.py       # Convex API client
│   └── requirements.txt       # Python dependencies
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

This project is licensed under the Apache License 2.0 — see the [LICENSE](LICENSE) file for details.
