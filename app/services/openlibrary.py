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

# Identify ourselves per Open Library's API etiquette (descriptive UA + contact).
_USER_AGENT = f"Morus/0.1 (+mailto:{settings.CONTACT_EMAIL})"
_DEFAULT_HEADERS = {"User-Agent": _USER_AGENT}


def _client() -> httpx.AsyncClient:
    """An httpx client preconfigured with our identifying User-Agent."""
    return httpx.AsyncClient(timeout=15.0, headers=_DEFAULT_HEADERS)


async def fetch_book_by_isbn(isbn: str) -> dict:
    """
    Fetch raw JSON from the Open Library Volumes API.

    Endpoint: GET https://openlibrary.org/api/volumes/brief/isbn/{isbn}.json
    """
    url = f"{settings.OPENLIBRARY_BASE_URL}/{isbn}.json"
    async with _client() as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()


async def search_books(query: str, limit: int = 12) -> list[dict]:
    """
    Search Open Library by free-text query (title and/or author).

    Uses the Search API (separate from the Volumes/ISBN API): each result is a
    *work* with edition metadata. We return lightweight dicts for display; when
    the user picks one, its `isbn` is fed to the existing get_or_create_book flow
    to fetch and persist full metadata.

    Endpoint: GET https://openlibrary.org/search.json?q={query}
    """
    params = {
        "q": query,
        "fields": "key,title,author_name,first_publish_year,cover_i,isbn,edition_count",
        "limit": limit,
    }
    async with _client() as client:
        response = await client.get(settings.OPENLIBRARY_SEARCH_URL, params=params)
        response.raise_for_status()
        docs = response.json().get("docs", [])

    results: list[dict] = []
    for doc in docs:
        isbns = doc.get("isbn") or []
        cover_id = doc.get("cover_i")
        results.append(
            {
                "key": doc.get("key"),
                "title": doc.get("title", ""),
                "authors": doc.get("author_name", []),
                "first_publish_year": doc.get("first_publish_year"),
                "edition_count": doc.get("edition_count"),
                # Representative ISBN (for display) plus the full list so the book
                # can be saved directly from search data without a second lookup.
                "isbn": isbns[0] if isbns else None,
                "isbns": isbns[:20],
                "cover_url": (
                    f"{settings.OPENLIBRARY_COVERS_URL}/{cover_id}-M.jpg"
                    if cover_id
                    else None
                ),
            }
        )
    return results


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
    if not raw or not isinstance(raw, dict):
        return []
    return [
        {
            "small": raw.get("small"),
            "medium": raw.get("medium"),
            "large": raw.get("large"),
        }
    ]


def _parse_description(raw: str | dict | None) -> str | None:
    """Open Library descriptions are sometimes a plain string, sometimes
    a {"type": ..., "value": ...} dict. Normalise to a string."""
    if not raw:
        return None
    if isinstance(raw, dict):
        value = raw.get("value")
        return value if isinstance(value, str) else None
    return raw if isinstance(raw, str) else None


def clean_book_response(raw_response: dict) -> list[Book]:
    """
    Extract and clean book records from the Open Library API response.

    Returns a list of Book model instances (unsaved — no DB session needed).
    """
    # Open Library returns an empty LIST (`[]`), not a dict, when it has no
    # record for an ISBN. Guard so this doesn't raise and poison the caller.
    records: dict = raw_response.get("records", {}) if isinstance(raw_response, dict) else {}
    books: list[Book] = []

    for _key, record in records.items():
        data: dict = record.get("data", {}) if isinstance(record, dict) else {}
        # Richer fields (ocaid, description) live in the nested details block.
        _details_outer = record.get("details", {}) if isinstance(record, dict) else {}
        details: dict = _details_outer.get("details", {}) if isinstance(_details_outer, dict) else {}

        book = Book(
            isbns=record.get("isbns", []),
            publish_dates=record.get("publishDates", []),
            openbook_url=data.get("url", ""),
            openbook_key=data.get("key", ""),
            title=data.get("title", ""),
            subtitle=data.get("subtitle"),
            description=_parse_description(details.get("description")),
            archive_id=details.get("ocaid"),
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
    # 0. Normalise and sanity-check the ISBN so malformed barcodes (e.g.
    #    "08/35110745", short/long scans) don't hit Open Library and 500.
    isbn = isbn.replace("-", "").replace(" ", "").strip().upper()
    if len(isbn) not in (10, 13) or not isbn[:-1].isdigit() or isbn[-1] not in "0123456789X":
        raise ValueError(f"Invalid ISBN: {isbn}")

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


def _covers_from_url(cover_url: str | None) -> list[dict]:
    """Derive small/medium/large cover dicts from a single Open Library cover URL.

    Open Library cover URLs only differ by a size suffix (…-S.jpg/-M.jpg/-L.jpg),
    so we can reconstruct all three from the medium URL the search returned.
    """
    if not cover_url:
        return []
    base = cover_url
    for suffix in ("-S.jpg", "-M.jpg", "-L.jpg"):
        if base.endswith(suffix):
            base = base[: -len(suffix)]
            break
    return [
        {"small": f"{base}-S.jpg", "medium": f"{base}-M.jpg", "large": f"{base}-L.jpg"}
    ]


async def get_or_create_book_from_metadata(session: AsyncSession, data: dict) -> Book:
    """
    Persist a book from Open Library *search* data, without a second Volumes lookup.

    Used when a user adds a result found via title search — we save exactly what
    the search returned (which may have no ISBN at all). Dedup order:
      1. reuse an existing book matching any of the result's ISBNs
      2. reuse an existing book with the same Open Library work key
      3. otherwise insert a new record
    """
    isbns = [i for i in (data.get("isbns") or []) if i]

    # 1. Reuse by ISBN if we have any.
    for isbn in isbns:
        existing = await find_book_by_isbn(session, isbn)
        if existing:
            return existing

    key = (data.get("key") or "").strip()
    if not key:
        raise ValueError("Search result is missing an Open Library key")

    # 2. Reuse by work key.
    existing_by_key = (
        await session.exec(select(Book).where(Book.openbook_key == key))
    ).first()
    if existing_by_key:
        return existing_by_key

    # 3. Insert from the metadata we already have.
    year = data.get("first_publish_year")
    book = Book(
        isbns=isbns,
        publish_dates=[],
        openbook_url=f"https://openlibrary.org{key}",
        openbook_key=key,
        title=data.get("title", "") or "",
        authors=[{"name": name, "url": None} for name in (data.get("authors") or [])],
        publish_date=str(year) if year else None,
        covers=_covers_from_url(data.get("cover_url")),
    )
    session.add(book)
    await session.commit()
    await session.refresh(book)
    return book
