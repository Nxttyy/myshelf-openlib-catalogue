"""
Open Bookie — FastAPI application entry point.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import settings
from app.routers import book, pages

# Import models so SQLModel metadata registers all tables
import app.models  # noqa: F401


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    # Could add table creation here for dev, but we use Alembic for migrations
    yield


app = FastAPI(
    title=settings.APP_NAME,
    description="Look up books by ISBN via Open Library and get cleaned metadata.",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(pages.router)
app.include_router(book.router)


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok"}
