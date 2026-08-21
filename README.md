# Repo City

**Paste a GitHub URL and walk through the codebase as a 3D city**

Every folder becomes a district, every file becomes a building, and an AI agent
writes the tour: a project briefing at the city gate, a label when you point at
a building, and the file's full story when you click it.

```
                    ╔═══════════════════════════════════╗
   GitHub URL  ───▶  ║  agent: fetch → triage → explain  ║  ───▶  3D city
                    ╚═══════════════════════════════════╝
```

---

## What it does

| Feature | Detail |
| --- | --- |
| **Project briefing at the gate** | Click the sign above the portal for the briefing: what the project is, its architecture, the real runtime path through the code, and its tech stack with logos. It is opt-in — it never opens itself over a city you just arrived in. |
| **A building per file** | Modelled as a real tower: a wider street-level podium, a glazed shaft with lit window bays, and a setback crown. Height is lines of code, colour is language, and the rooftop shape encodes the file's role (spire = entry point, dome = data model, sawtooth = tests, crane = build tooling…). |
| **Hover to identify** | A small label fades in above the building — logo, file name, language. Just enough to know what you are pointing at. |
| **Click to focus** | The rest of the city fades back, a light shaft rises off the building you picked, and its contents open in the right-hand panel. The camera closes in **from wherever you already are** rather than swinging round to a fixed front. It all closes itself again when you pull away. |
| **A portal you step through** | Analysis ends at a gateway in a dark antechamber, not in the city. The city is genuinely not rendered until you press **Enter** — the camera then dives into the aperture, speed lines streak past, and a white-out covers the arrival. The same portal stands at the city gate afterwards, still humming. |
| **A glacier valley** | The city sits in a snowfield ringed by three ranges of snow-capped peaks, with a turquoise meltwater river and ice floes winding past it. All of it is generated from the city's own size, so a nine-file town gets a small valley and a large repo gets a wide one. |
| **Real time of day** | The scene follows *your* clock. Sun angle and colour, sky, fog, ambient fill and snow tint all move through a day; after dark every window lights up warm, street lamps cast pools on the pavement, road markings glow and the snow goes moonlit blue. The HUD button cycles **Auto → Day → Night**: Auto keeps following the real clock, the other two pin it. |
| **Lit windows, not stripes** | Each building carries a real grid of window panes across all four facades — one instanced mesh per building, so a tower with 400 windows is still one draw call. Which panes are lit is seeded from the file, so a given file always looks the same. |
| **Rotating tech badges** | Every rooftop carries a slowly turning 3D cube with the logo of the tech the file belongs to. |
| **Districts** | Directories become plots with clickable neon name plates; the briefing lists each district's purpose. |
| **Guided tour** | Auto-flies between the most important building in each district, choosing a fresh bearing for each stop so the sequence sweeps around the city rather than lurching. The button shows your progress through the stops. |
| **Navigation globe** | A compass in the bottom-left shows the heading you are facing and snaps you to north/east/south/west in one click, keeping whatever you were looking at as the pivot. The centre button looks straight down at the whole city. |
| **Ask the guide** | A grounded Q&A panel that answers from the analyzed city index and cites real file paths. |
| **Search + minimap** | Filter by path, language or role — non-matching buildings dim; the minimap shows a live camera cone and lets you click to travel. |

---

## Quick start (Windows)

```powershell
.\start.ps1
```

That creates the Python virtualenv, installs both dependency sets, copies
`backend/.env.example` to `backend/.env`, and opens two windows:

- API — <http://127.0.0.1:8010> (interactive docs at `/docs`)
- App — <http://localhost:5173>

> Port 8010 is the default because 8000 is often already taken. Use
> `.\start.ps1 -Port 8020` to change it — the frontend proxy follows.

### Manual start

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8010
```

```bash
cd frontend
npm install
npm run dev
```

### Single-origin build

```powershell
.\start.ps1 -BuildOnly
```

Builds the frontend and serves it from FastAPI, so everything runs on
`http://127.0.0.1:8010` — the easiest thing to demo.

---

## API keys

Put them in `backend/.env` (already gitignored):

```ini
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_...
GITHUB_TOKEN=ghp_...
```

- **`GROQ_API_KEY`** is the default narrator. Model: **`openai/gpt-oss-120b`** —
  of the chat models Groq serves it has the strongest code comprehension, a
  131k context, and strict `json_schema` structured outputs, which is what lets
  the pipeline treat every response as data instead of prose.
- **`ANTHROPIC_API_KEY`** with `LLM_PROVIDER=anthropic` switches to Claude
  Opus 5. Both paths are maintained; only the provider line changes.
- Without either, the city still builds and is fully explorable — descriptions
  just fall back to structure, and the UI says so.
- **`GITHUB_TOKEN`** is optional but recommended: 60 → 5,000 requests/hour, and
  it unlocks **private repositories** the token can read — those analyze
  exactly like public ones.

> **Where private code ends up:** finished cities are written to
> `backend/.cache/` as JSON, including the model's descriptions of private
> files. That directory is gitignored, but it is plain text on disk — delete it
> if you analyze something sensitive.

### Groq's free tier, and how the app copes

The free tier allows **8,000 tokens per minute**, and the allowance counts the
completion you *ask for*, not just the one you get. A naive implementation
fails every file batch with a 413. Three things make it work:

1. **Per-model token budgets.** Groq meters tokens per model, not per account,
   so file batches fan out across `openai/gpt-oss-120b` **and**
   `openai/gpt-oss-20b`, each with its own sliding-window budget
   (`services/ratelimit.py`). That roughly doubles throughput.
2. **File sketches, not whole files.** `services/sketch.py` reduces a source
   file to its imports, declarations and doc lines before it is sent. What
   explains a file is its shape, not its 400 lines of body.
3. **A lean per-batch preamble.** The shared context is resent with every
   batch, so it is kept to a few hundred tokens.

A 72-file repo lands in about **4 minutes** on the free tier, with zero
rate-limit errors, and cached repeats are instant. On a paid tier, raise
`GROQ_TPM` and `MAX_LLM_FILES` and it finishes in seconds.

---

## How the agent works

`backend/app/services/pipeline.py` runs five stages, streaming progress to the
browser over Server-Sent Events:

1. **Fetch** — repo metadata, the recursive file tree, language bytes and the
   README (`services/github.py`).
2. **Triage** — a repo can hold 30,000 files; a readable city holds a few
   hundred. `services/selector.py` drops vendored/binary/generated paths, scores
   what is left by name, depth, size and directory signals, then keeps every
   directory represented rather than letting one deep folder win.
3. **Read** — the top-ranked files are downloaded from `raw.githubusercontent`
   and batched.
4. **Explain** — `services/analyzer.py` calls Claude with **structured outputs**
   (JSON Schema), so the result is data, not prose to parse. The project
   briefing and the file batches run concurrently; batches are analyzed in
   parallel under a semaphore. If a call fails, only that batch falls back to
   heuristics — the run continues.
5. **Build the city** — `services/city.py` groups files into districts, sizes a
   plot for each, shelf-packs the plots into blocks separated by roads, and
   places the most important files nearest each plot's centre so every district
   gets a skyline.

Finished cities are cached to `backend/.cache/` keyed by commit SHA, so a repeat
demo of the same repo is instant.

### Budgets

Left blank in `.env`, these pick provider-aware defaults — Groq gets smaller,
more compact batches because of its per-minute budget.

| Setting | Groq | Anthropic | Meaning |
| --- | --- | --- | --- |
| `MAX_BUILDINGS` | 320 | 320 | Files placed in the city |
| `MAX_LLM_FILES` | 40 | 120 | Files the model actually reads |
| `LLM_BATCH_SIZE` | 4 | 10 | Files per request |
| `LLM_CONCURRENCY` | 3 | 6 | Requests in flight |
| `FILE_CHAR_BUDGET` | 1700 | 6000 | Sketch size per file |
| `FILE_EFFORT` | low | medium | Reasoning depth per file batch |
| `PROJECT_EFFORT` | medium | high | Reasoning depth for the briefing |

Reasoning tokens are billed as output, so on a metered tier effort is a
throughput dial, not only a quality one.

### Flat surfaces and z-fighting

`lib/layers.ts` declares the height of **every** horizontal surface in one
ordered table — snowfield, river, road, markings, plot, lawn, lamp pool,
selection ring. Chasing z-fighting surface by surface just moves it around:
two files that each pick `0.02` will find each other eventually. Neighbouring
layers stay at least `MIN_GAP` (0.06) apart, and the camera's near plane sits
at 4 rather than the default 0.1, which is what actually buys the depth
resolution those gaps rely on when looking straight down at a large city.

### Time of day

`lib/daylight.ts` holds one table of keyframes from midnight to midnight —
sun colour and intensity, sky, fog, hemisphere fill, and a `night` value from
0 to 1. Everything that needs to know how dark it is reads `night` from there
rather than deciding for itself, so the window lights, street lamps, snow tint
and water colour can never disagree. `DaylightRig` eases between values, so
crossing a keyframe is a slow shift rather than a cut.

The HUD button cycles Auto → Day → Night. `?hour=21` also pins the time from
the URL, which is handy for screenshots.

### The valley

`scene/Landscape.tsx` generates the snowfield, three ranges of peaks, conifer
stands and the river. Each peak is a tapered cone displaced along its outward
direction by **coherent ridged noise** (`lib/terrain-noise.ts`), which is what
separates a mountain from a cone: per-vertex randomness has no spatial
agreement, so it can only ever look like static or do nothing, whereas a noise
*field* lets neighbouring vertices agree on where a ridge or gully runs. The
snow line is bent by a second, slower field and speckled by a third, so rock
pokes through the snow near ridgelines and snow clings in gullies below it.
The whole range is merged into one buffer, so several hundred displaced peaks
cost one draw call.

Peaks are excluded from a 0.62-radian arc around the gate, so the approach to
the portal is always open.

The river runs out of a saddle in the western range, narrow in the gorge and
widening as it reaches the flats, and pools into a lake. Its surface scrolls a
streak texture along the channel's V axis, so it reads as flowing water rather
than a painted ribbon.

> Merging requires non-indexed geometry. `ConeGeometry` is indexed, and the
> first version of the merge copied only position/normal/colour, so the
> triangles were assembled in raw vertex order and the mountains rendered as
> flat shards. Each peak is now expanded with `toNonIndexed()` first.

### The portal

The gate is modelled in three.js from primitives — an armoured ring of plates
around a spinning vortex, coolant pipes arcing into a machine base, and a stair
up to the threshold. Sketchfab models cannot be fetched at runtime (downloads
need an account and the assets are licensed), so it is rebuilt rather than
loaded.

The vortex is a painted canvas spiral on two counter-rotating discs, which
stays readable at any zoom and costs one quad to animate. A single `intensity`
value from 0 to 1 drives the whole machine — spin rate, rim glow, canister
emission and the point light — so the spin-up is one number rather than a dozen
tweens.

Arrival is a three-beat sequence in `CityView.tsx`: `portal` → `warp` → `city`.
The city is not mounted for the first two beats, so there really is nothing
behind the gate until you step through it — and mounting several hundred
buildings happens underneath the white flash, where the hitch cannot be seen.

---

## Project layout

```
backend/
  app/
    main.py               FastAPI app; also serves the built frontend
    config.py             env-driven settings
    routers/analyze.py    POST /api/analyze, SSE progress, city + cache reads
    routers/chat.py       POST /api/chat — the streaming tour guide
    services/
      github.py           GitHub REST + raw file fetching
      selector.py         which files become buildings, and which Claude reads
      llm.py              provider abstraction: Groq and Claude behind one API
      ratelimit.py        sliding-window token budget, one per model
      sketch.py           compresses a file to imports + declarations
      analyzer.py         schema-driven prompts and heuristic fallbacks
      city.py             districts, plot packing, building geometry
      tech.py             language → colour → devicon logo
      jobs.py             job registry + disk cache
      pipeline.py         the end-to-end run
  tests/
    mock_anthropic.py     a stand-in Claude API (streams schema-shaped JSON)
    test_pipeline.py      end-to-end smoke test, no API key needed
frontend/
  src/
    App.tsx               landing → building → city
    components/
      CityView.tsx        the city screen: canvas + HUD + panels
      HoverCard.tsx       the label that tracks a hovered building
      ProjectPanel.tsx    the gate briefing
      DetailDrawer.tsx    one file, in full
      GuideChat.tsx       ask-the-city Q&A
      Minimap.tsx         live top-down map
      scene/
        CityScene.tsx     lights, environment, camera rig, proximity watcher
        Building.tsx      one file as a tower (podium, facade, crown, badge)
        Portal.tsx        the gateway machine and its vortex
        PortalChamber.tsx the antechamber, and the dive through the aperture
        Roads.tsx         instanced asphalt, kerbs and lane markings
        Props.tsx         instanced trees, lamps, vehicles, parks, stadium
        Archetypes.tsx    the building shape catalogue
        District.tsx      one directory as a plot
        Entrance.tsx      the gate and approach road
```

---

## Tests

The pipeline is verified end to end without spending a token. `tests/mock_anthropic.py`
speaks the Messages streaming protocol and answers with JSON shaped to whatever
schema the analyzer requested, so the real triage, the real GitHub fetch, the
real structured-output plumbing and the real city builder all run offline.

In one terminal:

```bash
cd backend
.venv/Scripts/python -m uvicorn tests.mock_anthropic:app --port 8099
```

In another:

```bash
cd backend
.venv/Scripts/python -m tests.test_pipeline vercel/swr
```

It checks that the job completes, that the model's descriptions land on
buildings, that token usage and call counts are recorded, and that the geometry
is sane — every building inside the bounds, no two on the same plot, every one
with a height, a logo and a headline.

---

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Whether the AI narrator and GitHub token are configured |
| `POST /api/analyze` | `{ repoUrl, force }` → `{ jobId }` |
| `GET /api/jobs/{id}` | Job status, and the city once it is done |
| `GET /api/jobs/{id}/events` | SSE progress stream |
| `GET /api/recent` | Previously built cities from the cache |
| `GET /api/cached/{key}` | Load a cached city instantly |
| `POST /api/chat` | Streaming answer from the tour guide |

---

## Controls

| Input | Action |
| --- | --- |
| Drag | Orbit · **right-drag** pan |
| Nav globe **N/E/S/W** | Snap the camera to that side of whatever you are looking at |
| **Enter** | Step through the portal into the city |
| Click the sign above the portal | Open or hide the project briefing |
| **◎ Portal** | Fly back to the portal at the city gate |
| Scroll wheel | Zoom toward the cursor (or use the on-screen **+ / −**) |
| Hover a building | A small label: logo, file name, language |
| **Click** a building | Focus mode: the city dims, a light shaft rises, contents open on the right |
| Pull the camera away | The file panel closes itself |
| Type in search, press **Enter** | Flies you to the best match and drops a pointer on it |
| Click a district plate | Fly to that directory |
| `/` | Jump to search |
| `Esc` | Close panels and clear the search |
| Languages / Map | Toggle the legend and the travel map — off by default |
| Gate / Overview / Guided tour | Camera shortcuts in the top bar |
