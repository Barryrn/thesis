# Server Commands

## Kill All Servers

```bash
# Kill by port (frontend Vite)
lsof -ti:5173 -ti:5174 | xargs kill -9 2>/dev/null

# Kill Python/Uvicorn (port 8000)
lsof -ti:8000 | xargs kill -9 2>/dev/null

# Kill Convex dev
pkill -f "npx convex dev" 2>/dev/null

# Or kill everything at once
lsof -ti:5173 -ti:5174 -ti:8000 | xargs kill -9 2>/dev/null; pkill -f "npx convex dev" 2>/dev/null
```

## Start All Servers

Run each in a separate terminal:

```bash
# Terminal 1: Python FastAPI (port 8000) — requires Python 3.10+
# Uses the project's .venv (Python 3.12) — created once with `python3.12 -m venv .venv`
cd python && .venv/bin/python -m uvicorn main:app --reload --port 8000
# First-time setup: python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt

# Terminal 2: Convex backend
cd convex && npx convex dev

# Terminal 3: Frontend Vite (port 5173)
cd frontend && npm run dev
```

## Install Dependencies (if needed)

```bash
# Python deps — install into the project venv
cd python && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt

# Frontend deps
cd frontend && npm install
```

## One-Liner: Kill & Restart All

```bash
lsof -ti:5173 -ti:5174 -ti:8000 | xargs kill -9 2>/dev/null; pkill -f "npx convex dev" 2>/dev/null; \
  (cd python && .venv/bin/python -m uvicorn main:app --reload --port 8000 &) && \
  (cd convex && npx convex dev &) && \
  (cd frontend && npm run dev &)
```

## Troubleshooting

### `TypeError: unsupported operand type(s) for |: 'type' and 'NoneType'` on Python startup

The codebase uses PEP 604 union syntax (`dict | None`), which requires **Python 3.10+**. macOS's bundled `python3` is 3.9. The project ships a `python/.venv/` built on Python 3.12 — invoke it explicitly via `.venv/bin/python main.py`. If the venv is missing, recreate it: `python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt`.

### Convex: `Schema validation failed. Document ... contains extra field ...`

A row was written under a previous schema shape and no longer validates. For local dev, the simplest fix is to open the Convex dashboard (`npx convex dashboard` from `convex/`), find the offending document in the named table, and delete it. Then re-run `npx convex dev`. Document IDs and table names are printed in the validation error.
