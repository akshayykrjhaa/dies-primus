# Dies Primus
## Stop Reading Codebases. Walk Through Them.

> **Paste a GitHub URL. Walk through the codebase as a 3D city.**  
> Every folder becomes a district, every file becomes a building, and an AI agent writes the tour.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Problem](#2-problem)
3. [Solution](#3-solution)
4. [Architecture](#4-architecture)
5. [AI Pipeline](#5-ai-pipeline)
6. [RAG + Knowledge Graph](#6-rag--knowledge-graph)
7. [3D City Generation](#7-3d-city-generation)
8. [Demo Instructions](#8-demo-instructions)
9. [Example Questions](#9-example-questions)
10. [Testing & Validation](#10-testing--validation)
11. [Team Contributions](#11-team-contributions)
12. [Known Limitations](#12-known-limitations)

---

## 1. Project Overview

**Dies Primus** (also called **Repo City**) transforms any GitHub repository into an explorable 3D city. Instead of reading files and directory trees to understand a codebase, you literally *walk through it* — districts are directories, buildings are files, and an AI agent narrates the tour.

| | |
|---|---|
| **Demo URL** | *(your live deployment URL)* |
| **GitHub** | https://github.com/akshayykrjhaa/dies-primus |
| **Demo Video** | *(your Devpost / YouTube link)* |

---

## 2. Problem

Understanding a new codebase is expensive:

- Junior developers spend **days** orienting themselves to large repos
- Code reviewers must mentally map directory trees to understand blast radius
- Hackathon judges spend hours trying to understand what a project actually does
- Open-source contributors struggle to find the right file to edit

Existing tools (GitHub UI, VS Code, grep) are text-based. They require you to hold the entire mental map in your head simultaneously.

---

## 3. Solution

**Dies Primus** converts a GitHub URL into a navigable 3D world in ~4 minutes:

- **Every directory** -> a named district with clickable neon signs
- **Every file** -> a tower whose height = lines of code, colour = language, rooftop shape = role
- **Hover** -> a floating label with logo, filename, and language
- **Click** -> camera focuses on that building, full file contents appear in a side panel
- **Ask the Guide** -> a grounded Q&A that cites real file paths from the analysed index
- **Guided tour** -> auto-flies between the most important buildings in each district
- **Real time of day** -> sun, sky, fog, window lights, and snow tint all follow your clock

The portal metaphor is deliberate: analysis ends at a gateway in a dark antechamber; the city doesn't render until you press **Enter** and dive through the aperture.

---

## 4. Architecture

```
+--------------------------------------------------------------+
|                        USER BROWSER                          |
|                                                              |
|   React + Three.js + React Three Fiber                      |
|  +---------------+  +----------------+  +-----------------+ |
|  |  Landing /    |  |  Portal +      |  |  City Scene     | |
|  |  URL Input    |->|  Antechamber   |->|  (3D Canvas)    | |
|  +---------------+  +----------------+  +-----------------+ |
|                                               |               |
|               HUD: Search, Minimap, GuideChat, Tour          |
+-------------------------------+------------------------------+
                                |  HTTP / SSE (Server-Sent Events)
+-------------------------------v------------------------------+
|                       FASTAPI BACKEND                        |
|                                                              |
|  POST /api/analyze  ->  pipeline.py (5-stage agent)         |
|  GET  /api/jobs/{id}/events  ->  SSE progress stream        |
|  POST /api/chat  ->  streaming tour guide (RAG)             |
|  GET  /api/recent  ->  cached city index                    |
|                                                              |
|  +-----------+ +----------+ +-----------+ +-------------+   |
|  | github.py | |selector.py| |analyzer.py| |  city.py   |   |
|  | (Fetch)   | | (Triage) | | (Explain) | | (Build)    |   |
|  +-----------+ +----------+ +-----------+ +-------------+   |
|                                                              |
|  LLM Abstraction (llm.py)                                   |
|  +------------+  +--------------+  +--------------------+   |
|  | Groq API   |  | Anthropic    |  | Google Gemini      |   |
|  | gpt-oss-   |  | claude-      |  | gemini-3.6-flash   |   |
|  | 120b/20b   |  | opus-5       |  |                    |   |
|  +------------+  +--------------+  +--------------------+   |
|                                                              |
|  Cache: backend/.cache/  (keyed by commit SHA)              |
+--------------------------------------------------------------+
                                |
               GitHub REST API + raw.githubusercontent.com
```

### Component Breakdown

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React 18, TypeScript, Vite | App shell, UI panels, routing |
| 3D Engine | Three.js 0.169, React Three Fiber, Drei | 3D scene, buildings, portal, landscape |
| Animation | GSAP 3 | Camera transitions, portal warp, UI animations |
| Backend | FastAPI (Python), Uvicorn | REST API, SSE streaming, file serving |
| LLM Abstraction | `llm.py` | Unified interface over Groq / Anthropic / Gemini |
| Rate Limiting | `ratelimit.py` | Sliding-window token budget per model |
| City Layout | `city.py` | District packing, shelf layout, building geometry |
| File Sketching | `sketch.py` | Compress files to imports + declarations |
| Caching | `jobs.py` | Disk cache keyed by commit SHA |

---

## 5. AI Pipeline

`backend/app/services/pipeline.py` runs **five stages**, streaming progress to the browser over Server-Sent Events:

### Stage 1 - Fetch
`services/github.py` retrieves:
- Repo metadata (name, description, language bytes, stars)
- Recursive file tree via GitHub REST API
- README content
- Raw file contents via `raw.githubusercontent.com`

Rate limit: 60 req/hr anonymous -> 5,000 req/hr with `GITHUB_TOKEN`.

### Stage 2 - Triage
`services/selector.py` filters and scores files:
- Drops vendored paths, binaries, generated files, lockfiles
- Scores remaining files by name, depth, size, directory signals
- Ensures every directory gets at least one representative building
- Prevents a single deep folder from dominating the city

A 30,000-file monorepo becomes a readable ~300-building city.

### Stage 3 - Read
Top-ranked files are downloaded and compressed by `services/sketch.py`:
- Keeps imports, class/function declarations, docstrings
- Drops implementation bodies
- Reduces a 400-line file to ~50 lines of its structural skeleton

### Stage 4 - Explain (LLM with structured outputs)
`services/analyzer.py` sends file batches to the LLM using **strict JSON Schema structured outputs**, so every response is typed data, not prose to parse.

Two concurrent tracks:
1. **Project briefing** - architecture overview, district summaries, runtime path, tech stack with logos
2. **File batches** - headline, description, role, archetype, key symbols per file

If a batch call fails, only that batch falls back to heuristics - the run continues.

### Stage 5 - Build City
`services/city.py` assembles the final city data:
- Groups files into districts (one per directory)
- Sizes a plot for each district proportional to file count
- Shelf-packs plots into blocks separated by roads
- Places the most important files nearest each plot's centre (skyline effect)
- Assigns building height (lines of code), colour (language), rooftop archetype (role)

Finished cities are cached to `backend/.cache/` keyed by commit SHA. Repeat demos are instant.

### LLM Provider Abstraction

All three providers are behind a single unified interface (`llm.py`):

| Provider | Primary Model | Secondary Model | Context |
|---|---|---|---|
| **Groq** (default) | `openai/gpt-oss-120b` | `openai/gpt-oss-20b` | 131k |
| **Anthropic** | `claude-opus-5` | - | 200k |
| **Gemini** | `gemini-3.6-flash` | - | 1M |

Groq's free tier (8,000 TPM) is handled by fanning batches across two models, each with its own sliding-window budget in `ratelimit.py`. A 72-file repo finishes in ~4 minutes with zero rate-limit errors.

---

## 6. RAG + Knowledge Graph

### How the Guide Answers Questions

The **Ask the Guide** feature (`POST /api/chat`) is a retrieval-augmented generation system:

1. **City Index** - When analysis completes, a structured index is assembled: every district's purpose, every building's headline, description, role, and file path - ordered by importance score.

2. **Context Window Sizing** - The index is truncated to `CHAT_CONTEXT_CHARS` (20,000 chars on Groq free tier, 90,000 on Anthropic) and handed to the LLM as a system prompt with every question. The guide is told how many buildings it didn't see, so it says "I don't know" rather than hallucinating.

3. **Grounded Citations** - All answers cite real file paths from the index. The guide is prompted to never invent file names that aren't in its context.

4. **Streaming** - Answers stream back token-by-token over HTTP chunked transfer, so the first words appear immediately.

### The Knowledge Graph (Implicit)

The city *is* the knowledge graph:
- **Nodes** = files (buildings)
- **Edges** = directory containment (districts), import relationships (encoded in descriptions)
- **Properties** = language, role archetype, lines of code, importance score, tech badges

The spatial layout encodes relationship: files in the same district are physically co-located; the most important files in each district are nearest the centre, making high-value targets visually prominent without any graph rendering overhead.

---

## 7. 3D City Generation

### Buildings (`scene/Building.tsx`)

Each file renders as a realistic tower:
- **Podium** - wider street-level base
- **Facade shaft** - glazed mid-section with a real instanced window grid (400 windows = 1 draw call)
- **Crown** - setback top floor
- **Rooftop archetype** - spire (entry point), dome (data model), sawtooth (tests), crane (build tooling), flat (generic)
- **Tech badge** - a slowly rotating 3D cube with the language/framework logo (devicons)
- **Height** = lines of code; **colour** = language; window pane lighting seeded from file path (deterministic)

### Landscape (`scene/Landscape.tsx`)

The valley is procedurally generated from the city's own size:
- **Snowfield** with coherent ridged noise displacement
- **Three mountain ranges** - each peak displaced with noise fields so ridges and gullies emerge naturally; merged into one draw call
- **Meltwater river** - scrolling streak texture, widens from gorge to flats, pools into a lake
- **Ice floes**, conifer stands, street lamps, parked vehicles, a stadium

### Real Time of Day (`lib/daylight.ts`)

One keyframe table from midnight to midnight drives everything:
- Sun angle, colour, intensity
- Sky and fog colour
- Hemisphere ambient fill
- `night` value 0->1 gates window lights, street lamps, snow tint, water colour

`DaylightRig` eases between keyframes so crossing midnight is a slow shift, not a cut. Add `?hour=21` to the URL to pin the time for screenshots.

### The Portal (`scene/Portal.tsx`)

Modelled entirely from Three.js primitives (no loaded assets):
- Armoured ring of plates around a spinning vortex
- Coolant pipes arcing into a machine base
- A staircase up to the threshold
- Single `intensity` value drives spin rate, rim glow, canister emission, point light

Arrival is a three-beat sequence: `portal` -> `warp` -> `city`. The city isn't mounted during the first two beats, so mounting several hundred buildings happens underneath the white-out flash.

### Z-Fighting Prevention (`lib/layers.ts`)

Every horizontal surface height is declared in one ordered table:

```
snowfield -> river -> road -> markings -> plot -> lawn -> lamp pool -> selection ring
```

Neighbouring layers are guaranteed `MIN_GAP` = 0.06 apart. The camera near plane sits at 4 (vs. default 0.1) to preserve depth resolution when looking straight down at a large city.

---

## 8. Demo Instructions

### Prerequisites

- Node.js >= 18
- Python >= 3.11
- A **Groq API key** (free at console.groq.com) - or Anthropic / Gemini key
- (Optional) A GitHub token for 5,000 req/hr and private repo access

### Quick Start (Windows)

```powershell
git clone https://github.com/akshayykrjhaa/dies-primus
cd dies-primus
.\start.ps1
```

`start.ps1` automatically:
1. Creates a Python virtualenv and installs backend dependencies
2. Installs frontend npm dependencies
3. Copies `backend/.env.example` -> `backend/.env`
4. Opens two terminals: API on `http://127.0.0.1:8010` and App on `http://localhost:5173`

### Add API Keys

Edit `backend/.env`:

```ini
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_...
GITHUB_TOKEN=ghp_...      # optional but recommended
```

### Manual Start

```bash
# Terminal 1 - backend
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8010

# Terminal 2 - frontend
cd frontend
npm install
npm run dev
```

### Single-Origin Build (Easiest to Demo)

```powershell
.\start.ps1 -BuildOnly
# Everything on http://127.0.0.1:8010 - no proxy, no two servers
```

### Walkthrough

1. Open `http://localhost:5173`
2. Paste a GitHub URL, e.g. `https://github.com/vercel/swr`
3. Press **Analyze** - watch the SSE progress stream (Fetch -> Triage -> Read -> Explain -> Build)
4. Once complete, press **Enter** to step through the portal into the city
5. Click the sign above the portal to open the **Project Briefing**
6. Hover over buildings to see language labels
7. Click any building to focus on it and read its description
8. Click **Guided Tour** to auto-fly through the most important buildings
9. Type in the search bar to filter by path, language or role
10. Open **Ask the Guide** and type a question

---

## 9. Example Questions

Try these in the **Ask the Guide** panel after analysing a repo:

| Repo | Question |
|---|---|
| `vercel/swr` | *"What is the main entry point and what does it export?"* |
| `vercel/swr` | *"Which files handle cache invalidation?"* |
| `facebook/react` | *"Walk me through how state updates are scheduled."* |
| Any repo | *"What are the top 3 most important files and why?"* |
| Any repo | *"Which directories handle authentication?"* |
| Any repo | *"What's the data flow from an HTTP request to the database?"* |

The guide will cite real file paths from the city index in its answer. If it doesn't know, it says so.

---

## 10. Testing & Validation

### Offline End-to-End Tests

The pipeline is fully testable without spending a single API token.

`tests/mock_anthropic.py` implements the Anthropic Messages streaming protocol and responds with JSON shaped to whatever schema the analyzer requested. This lets the real triage, the real GitHub fetch, the real structured-output plumbing, and the real city builder all run offline.

**Run the mock server:**
```bash
cd backend
.venv/Scripts/python -m uvicorn tests.mock_anthropic:app --port 8099
```

**Run the end-to-end test:**
```bash
cd backend
.venv/Scripts/python -m tests.test_pipeline vercel/swr
```

### What the Tests Verify

- Job completes successfully
- LLM descriptions land on buildings (not dropped or overwritten)
- Token usage and call counts are recorded
- Every building is inside the city bounds
- No two buildings on the same plot
- Every building has a height, a logo, and a headline
- Geometry sanity: no NaN coordinates, no zero-size buildings

### Rate-Limit Validation

Groq's free tier (8,000 TPM) is validated by:
1. `ratelimit.py` - sliding window per model, rejects batches before sending
2. Fan-out across two models (`gpt-oss-120b` + `gpt-oss-20b`) doubles throughput
3. `sketch.py` compression - reduces token count per file by ~80%
4. Lean shared preamble - a few hundred tokens, resent per batch

A 72-file repo completes in ~4 minutes with zero 429 errors on the free tier.

---

## 11. Team Contributions

| Contributor | Areas |
|---|---|
| *(your names here)* | *(fill in)* |

---

## 12. Known Limitations

| Limitation | Detail |
|---|---|
| **Groq free tier speed** | ~4 minutes for a 72-file repo. Larger repos take longer. Raise `GROQ_TPM` and `MAX_LLM_FILES` on a paid tier. |
| **Max buildings** | Capped at 320 buildings by default. Very large monorepos show a representative sample. |
| **LLM reads limited files** | Only 40 files get AI descriptions on Groq free tier (120 on Anthropic). Others get heuristic descriptions from structure. |
| **Private repos require token** | A GitHub token with `repo` scope is needed to analyze private repositories. |
| **No binary file previews** | Images, fonts, compiled artifacts are excluded from the city entirely. |
| **Cache is plain text** | Analyzed cities are cached as JSON in `backend/.cache/`. Gitignored but not encrypted. Delete if sensitive. |
| **No real-time updates** | The city reflects the repo at the time of analysis (keyed by commit SHA). Use the `force` flag to re-analyze. |
| **Ask the Guide context limit** | On Groq free tier, only ~20,000 chars of the city index fit per question. The guide says so when it lacks info. |
| **No explicit import graph edges** | File relationships are spatial and textual, but there are no rendered edges between buildings. |
| **Three.js performance** | Very large cities (300+ buildings) may run below 60 fps on integrated graphics. |

---

## Appendix A - API Reference

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | LLM and GitHub token status |
| `/api/analyze` | POST | `{ repoUrl, force }` -> `{ jobId }` |
| `/api/jobs/{id}` | GET | Job status + city JSON when done |
| `/api/jobs/{id}/events` | GET | SSE progress stream |
| `/api/recent` | GET | Previously built cities |
| `/api/cached/{key}` | GET | Load a cached city instantly |
| `/api/chat` | POST | Streaming tour guide (RAG) |

Interactive docs: `http://127.0.0.1:8010/docs`

---

## Appendix B - Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | auto-detect | `groq` / `anthropic` / `gemini` |
| `GROQ_API_KEY` | - | Groq API key (free tier works) |
| `ANTHROPIC_API_KEY` | - | Anthropic API key |
| `GEMINI_API_KEY` | - | Google Gemini API key |
| `GITHUB_TOKEN` | - | GitHub PAT (60 -> 5,000 req/hr) |
| `MAX_BUILDINGS` | 320 | Max files placed in the city |
| `MAX_LLM_FILES` | 40 (Groq) / 120 (Anthropic) | Files the model actually reads |
| `LLM_BATCH_SIZE` | 4 (Groq) / 10 (Anthropic) | Files per LLM request |
| `LLM_CONCURRENCY` | 3 (Groq) / 8 (Anthropic) | Concurrent LLM requests |
| `GROQ_TPM` | 8000 | Token budget per minute (raise on paid tier) |
| `EAGER_FILES` | 8 (Groq) / 14 (Anthropic) | Files described before city opens |

---

*Generated for hackathon submission - Dies Primus / Repo City*
