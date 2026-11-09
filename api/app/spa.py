"""
Serves the React app (web/dist) from FastAPI in production: hashed files
under /assets, and index.html for every page path so client-side routes work
on reload. API paths never fall through to the app; an unknown one stays a
JSON 404.
"""

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db import SessionDep
from app.services.share import page_tags

# First path segments that belong to the API, not the app.
API_PREFIXES = {
    "books", "films", "auth", "profiles", "scan", "dora", "agent-api", "mcp", "static", "companions",
    "mobile-scan", "health", "docs", "redoc", "openapi.json", "assets", "og",
}


def mount_web_app(app: FastAPI) -> bool:
    """Wire up the built app if web/dist exists. Call after every router, so
    the catch-all route comes last. Returns whether the app was mounted."""
    dist = Path(settings.WEB_DIST)
    index_file = dist / "index.html"
    if not index_file.is_file():
        return False

    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")
    index = index_file.read_text()  # read once; a new build needs a restart

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def web_app(path: str, request: Request, session: SessionDep):
        first = path.split("/", 1)[0]
        if first in API_PREFIXES:
            raise HTTPException(status_code=404, detail="Not found")
        # Files at the root of dist (favicon and the like), never outside it.
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and dist.resolve() in candidate.parents:
            # Fonts are loaded cross-origin by the emails (their heading face).
            cors = {"Access-Control-Allow-Origin": "*"} if candidate.suffix == ".woff2" else None
            return FileResponse(candidate, headers=cors)
        # A real title and link-preview tags for shared profiles, books,
        # films and note photos (services/share.py).
        page = index
        tags = await page_tags(session, path, dict(request.query_params))
        if tags:
            page = page.replace("<title>Dora</title>", tags, 1)
        # Never cache the page itself, so a new deploy is picked up at once;
        # the hashed /assets it points to are cached forever instead.
        return HTMLResponse(page, headers={"Cache-Control": "no-cache"})

    return True
