"""
Serves the React app (web/dist) from FastAPI in production: hashed files
under /assets, and index.html for every page path so client-side routes work
on reload. API paths never fall through to the app; an unknown one stays a
JSON 404.
"""

import html
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import select

from app.config import settings
from app.db import SessionDep
from app.models.user import User
from app.models.user_book import UserBook

# First path segments that belong to the API, not the app.
API_PREFIXES = {
    "books", "auth", "profiles", "scan", "dora", "agent-api", "mcp", "static",
    "mobile-scan", "health", "docs", "redoc", "openapi.json", "assets",
}


async def _profile_meta(page: str, handle: str, session: SessionDep) -> str:
    """Give /u/<handle> a real title and link-preview tags, so a shared
    profile link reads well in chat apps (they don't run JavaScript)."""
    owner = (await session.exec(select(User).where(User.username == handle))).first()
    if not owner or not owner.is_profile_public:
        return page
    count = len((await session.exec(
        select(UserBook.id).where(UserBook.user_id == owner.id, UserBook.is_public == True)  # noqa: E712
    )).all())
    name = " ".join(p for p in (owner.firstname, owner.lastname) if p.strip()) or "@" + handle
    title = html.escape(f"{name} (@{handle}) on Dora")
    desc = html.escape(f"{count} {'book' if count == 1 else 'books'} on their shelf. A record of the books they own.")
    url = html.escape(f"{settings.PUBLIC_URL.rstrip('/')}/u/{handle}")
    tags = (
        f'<meta name="description" content="{desc}" />'
        f'<meta property="og:title" content="{title}" />'
        f'<meta property="og:description" content="{desc}" />'
        f'<meta property="og:url" content="{url}" />'
        '<meta property="og:site_name" content="Dora" />'
        '<meta name="twitter:card" content="summary" />'
    )
    return page.replace("<title>Dora</title>", f"<title>{title}</title>{tags}", 1)


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
            return FileResponse(candidate)
        page = index
        parts = path.split("/")
        if first == "u" and len(parts) == 2 and parts[1]:
            page = await _profile_meta(page, parts[1], session)
        # Never cache the page itself, so a new deploy is picked up at once;
        # the hashed /assets it points to are cached forever instead.
        return HTMLResponse(page, headers={"Cache-Control": "no-cache"})

    return True
