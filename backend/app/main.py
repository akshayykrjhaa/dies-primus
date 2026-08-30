"""FastAPI entrypoint for Repo City.

Run from the backend/ directory:
    uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .routers import analyze, auth, chat, describe, profile

app = FastAPI(
    title="Repo City",
    description="Turns a GitHub repository into an explorable 3D city.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyze.router)
app.include_router(auth.router)
app.include_router(profile.router)
app.include_router(chat.router)
app.include_router(describe.router)

# If the frontend has been built (npm run build), serve it from the same
# origin so the whole demo runs on http://localhost:8000.
DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        return FileResponse(DIST / "index.html")

    # HEAD as well as GET: the frontend HEAD-checks /models/torii.glb to see
    # whether an optional asset was dropped in, and a GET-only route answers
    # that probe with a 405 in the console.
    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def spa(path: str):
        candidate = DIST / path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")

else:

    @app.get("/", include_in_schema=False)
    async def index_dev() -> JSONResponse:
        return JSONResponse(
            {
                "service": "Repo City API",
                "frontend": "not built - run 'npm run dev' in frontend/ "
                            "(http://localhost:5173)",
                "docs": "/docs",
                "aiEnabled": settings.has_llm,
                "provider": settings.provider,
            }
        )
