"""
Service layer for fetching and cleaning Open Library data.

Flow: check local DB by ISBN → if not found → fetch from API → persist → return.
"""

import httpx
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import settings
from app.models.book import Book

# ── Open Library API ─────────────────────────────────────────────────────────


async def fetch_book_by_isbn(isbn: str) -> dict:
    """
    Fetch raw JSON from the Open Library Volumes API.

    Endpoint: GET https://openlibrary.org/api/volumes/brief/isbn/{isbn}.json
    """
    url = f"{settings.OPENLIBRARY_BASE_URL}/{isbn}.json"
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()


# ── Response cleaning helpers ────────────────────────────────────────────────


def _parse_simple_list(
    raw: list[dict] | None, keys: list[str] | None = None
) -> list[dict]:
    """Generic parser for lists of dicts — keeps only the specified keys or all."""
    if not raw:
        return []
    if keys:
        return [{k: item.get(k) for k in keys} for item in raw]
    return raw


def _parse_covers(raw: dict | None) -> list[dict]:
    """Wrap the single cover dict into a list of dicts."""
    if not raw:
        return []
    return [
        {
            "small": raw.get("small"),
            "medium": raw.get("medium"),
            "large": raw.get("large"),
        }
    ]


def clean_book_response(raw_response: dict) -> list[Book]:
    """
    Extract and clean book records from the Open Library API response.

    Returns a list of Book model instances (unsaved — no DB session needed).
    """
    records: dict = raw_response.get("records", {})
    books: list[Book] = []

    for _key, record in records.items():
        data: dict = record.get("data", {})

        book = Book(
            isbns=record.get("isbns", []),
            publish_dates=record.get("publishDates", []),
            openbook_url=data.get("url", ""),
            openbook_key=data.get("key", ""),
            title=data.get("title", ""),
            subtitle=data.get("subtitle"),
            authors=_parse_simple_list(data.get("authors"), ["name", "url"]),
            number_of_pages=data.get("number_of_pages"),
            by_statement=data.get("by_statement"),
            identifiers=data.get("identifiers", {}),
            publishers=_parse_simple_list(data.get("publishers"), ["name"]),
            publish_date=data.get("publish_date"),
            subjects=_parse_simple_list(data.get("subjects"), ["name", "url"]),
            covers=_parse_covers(data.get("cover")),
        )
        books.append(book)

    return books


# ── DB-aware lookup ──────────────────────────────────────────────────────────


async def find_book_by_isbn(session: AsyncSession, isbn: str) -> Book | None:
    """Check the local DB for a book whose isbns JSON array contains the given ISBN."""
    from sqlalchemy.dialects.postgresql import JSONB

    # PostgreSQL JSONB containment: isbns @> '["isbn"]'
    # We cast to JSONB to ensure the @> operator is available
    result = await session.exec(
        select(Book).where(Book.isbns.cast(JSONB).contains([isbn]))
    )
    return result.first()


async def get_or_create_book(session: AsyncSession, isbn: str) -> Book:
    """
    Main entry point: look up a book by ISBN.

    1. Check local DB
    2. If not found → call Open Library API → persist
    3. Return the Book instance
    """
    # 1. Check DB first
    existing = await find_book_by_isbn(session, isbn)
    if existing:
        return existing

    # 2. Fetch from Open Library
    raw = await fetch_book_by_isbn(isbn)
    books = clean_book_response(raw)
    print(books)

    if not books:
        raise ValueError(f"No records found for ISBN {isbn}")

    # 3. Handle duplicates by Open Library key
    # (Sometimes the same book is reached via a different ISBN)
    new_book = books[0]
    existing_by_key_result = await session.exec(
        select(Book).where(Book.openbook_key == new_book.openbook_key)
    )
    existing_by_key = existing_by_key_result.first()
    if existing_by_key:
        return existing_by_key

    # 4. Persist
    session.add(new_book)
    await session.commit()
    await session.refresh(new_book)

    return new_book
