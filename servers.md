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
# Terminal 1: Python FastAPI (port 8000)
cd python && python3 main.py
# If missing deps: pip3 install -r requirements.txt

# Terminal 2: Convex backend
cd convex && npx convex dev

# Terminal 3: Frontend Vite (port 5173)
cd frontend && npm run dev
```

## Install Dependencies (if needed)

```bash
# Python deps
cd python && pip3 install -r requirements.txt

# Frontend deps
cd frontend && npm install
```

## One-Liner: Kill & Restart All

```bash
lsof -ti:5173 -ti:5174 -ti:8000 | xargs kill -9 2>/dev/null; pkill -f "npx convex dev" 2>/dev/null; \
  (cd python && python main.py &) && \
  (cd convex && npx convex dev &) && \
  (cd frontend && npm run dev &)
```
