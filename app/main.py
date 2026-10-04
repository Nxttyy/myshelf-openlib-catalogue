"""
Dora — FastAPI application entry point.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.config import settings
from app.mcp_server import mcp, rest_router, secured_mcp_app
from app.routers import auth, book, dora, pages, scan

# Import models so SQLModel metadata registers all tables
import app.models  # noqa: F401


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    async with mcp.session_manager.run():
        yield


app = FastAPI(
    title=settings.APP_NAME,
    description="Look up books by ISBN via Open Library and get cleaned metadata.",
    version="0.1.0",
    lifespan=lifespan,
)

# Compresses HTML/CSS/JS/JSON responses — the page templates ship a lot of
# text (inline-turned-external CSS/JS, book lists) that gzips down heavily.
app.add_middleware(GZipMiddleware, minimum_size=500)

app.add_middleware(
    SessionMiddleware,
    secret_key=settings.SECRET_KEY,
    same_site="lax",
    https_only=False,
    max_age=3600,
)


@app.middleware("http")
async def add_static_cache_headers(request: Request, call_next):
    """Static assets are versioned via a `?v=` query param (see
    pages.py's `static_version` template global), so it's safe to tell the
    browser to cache them for a year and never revalidate."""
    response = await call_next(request)
    if request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


app.mount("/static", StaticFiles(directory="app/static"), name="static")

app.mount("/mcp", secured_mcp_app())
app.include_router(rest_router)

app.include_router(pages.router)
app.include_router(book.router)
app.include_router(auth.router)
app.include_router(scan.router)
app.include_router(dora.router)


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok"}
