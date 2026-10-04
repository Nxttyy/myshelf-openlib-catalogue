"""
Manually-created catalogue entries.

For books with no copy to hand and no Open Library record: the user types the
details in themselves. The resulting row lives in the same `books` table as
everything fetched from Open Library, so it shows up in Explore and in local
search for every other user — hence the field caps and the per-user rate limit.

Nested fields are written in the exact shapes Open Library data uses
(authors as [{"name","url"}], publishers as [{"name"}], ...) so every existing
template and API consumer works on manual books without a special case.
"""

from datetime import datetime, timedelta
from uuid import UUID

import sqlalchemy as sa
from sqlmodel import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models.book import Book
from app.schemas.book import ManualBookCreate
from app.services import storage
from app.services.openlibrary import find_book_by_isbn

# These rows are public, so every free-text field is capped.
MAX_TITLE = 300
MAX_SUBTITLE = 300
MAX_NAME = 200
MAX_DESCRIPTION = 5000
MAX_AUTHORS = 10
MAX_PUBLISHERS = 5
MAX_SUBJECTS = 15
MAX_ISBNS = 5
MAX_PAGES = 50_000

# How many manual entries one user can create per rolling day.
DAILY_CREATE_LIMIT = 20
_LIMIT_WINDOW = timedelta(days=1)


class ManualBookError(ValueError):
    """Invalid manual-book submission (message is safe to show the user)."""


def _clean(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    value = " ".join(value.split())[:limit].strip()
    return value or None


def _clean_list(values: list[str], max_items: int, limit: int) -> list[str]:
    out: list[str] = []
    for raw in values:
        name = _clean(raw, limit)
        if name and name not in out:
            out.append(name)
        if len(out) >= max_items:
            break
    return out


def normalise_isbn(raw: str) -> str | None:
    """Same shape check as the Open Library lookup path; returns None if the
    value isn't a plausible ISBN-10/13 rather than raising."""
    isbn = raw.replace("-", "").replace(" ", "").strip().upper()
    if len(isbn) not in (10, 13):
        return None
    if not isbn[:-1].isdigit() or isbn[-1] not in "0123456789X":
        return None
    return isbn


async def _rate_limit_ok(session: AsyncSession, user_id: UUID) -> bool:
    since = datetime.utcnow() - _LIMIT_WINDOW
    count = (
        await session.exec(
            select(func.count())
            .select_from(Book)
            .where(
                Book.created_by_user_id == user_id,
                Book.source == "manual",
                Book.created_at >= since,
            )
        )
    ).one()
    return count < DAILY_CREATE_LIMIT


async def _validated_cover_key(data: ManualBookCreate, user_id: UUID) -> str | None:
    """Accept a cover key only if we issued it to this user and the bytes landed.

    A bad key is not fatal — the book is created coverless and falls back to the
    typographic jacket, which beats refusing the whole submission.
    """
    key = (data.cover_key or "").strip()
    if not key:
        return None
    if not storage.storage_configured() or not storage.is_own_cover_key(key, user_id):
        return None
    return key if storage.head_object(key) else None


async def find_existing_by_isbns(session: AsyncSession, isbns: list[str]) -> Book | None:
    for isbn in isbns:
        existing = await find_book_by_isbn(session, isbn)
        if existing:
            return existing
    return None


async def search_local_books(
    session: AsyncSession, query: str, limit: int = 12
) -> list[Book]:
    """Substring search over the local catalogue by title or author name.

    Matches manual entries and Open Library records alike, so a book one user
    typed in is findable by everyone else. Casting the authors JSONB to text is
    crude but correct for substring matching; a pg_trgm GIN index on
    (title, authors::text) is the upgrade path once the table is large.
    """
    q = query.strip()
    if len(q) < 2:
        return []
    pattern = f"%{q}%"
    result = await session.exec(
        select(Book)
        .where(
            sa.or_(
                Book.title.ilike(pattern),  # type: ignore[attr-defined]
                sa.cast(Book.authors, sa.Text).ilike(pattern),
            )
        )
        # Manual entries first: they're invisible to the Open Library search
        # running alongside this one, so they're the results worth surfacing.
        .order_by(
            sa.case((Book.source == "manual", 0), else_=1),
            Book.created_at.desc(),  # type: ignore[attr-defined]
        )
        .limit(limit)
    )
    return list(result.all())


def _cleaned_isbns(raw_isbns: list[str]) -> list[str]:
    isbns: list[str] = []
    for raw in raw_isbns[:MAX_ISBNS]:
        isbn = normalise_isbn(raw)
        if isbn and isbn not in isbns:
            isbns.append(isbn)
    return isbns


def _clean_fields(data: ManualBookCreate) -> dict:
    """Validate and normalise the user-typed fields into Book column values.

    Shared by create and edit; excludes identity/provenance and the cover, which
    the callers handle.
    """
    title = _clean(data.title, MAX_TITLE)
    if not title:
        raise ManualBookError("A title is required")

    pages = data.number_of_pages
    if pages is not None and (pages <= 0 or pages > MAX_PAGES):
        pages = None

    publish_date = _clean(data.publish_date, 40)

    return {
        "title": title,
        "subtitle": _clean(data.subtitle, MAX_SUBTITLE),
        "description": _clean(data.description, MAX_DESCRIPTION),
        "authors": [
            {"name": name, "url": None}
            for name in _clean_list(data.authors, MAX_AUTHORS, MAX_NAME)
        ],
        "number_of_pages": pages,
        "by_statement": _clean(data.by_statement, MAX_NAME),
        "publishers": [
            {"name": name}
            for name in _clean_list(data.publishers, MAX_PUBLISHERS, MAX_NAME)
        ],
        "publish_date": publish_date,
        "publish_dates": [publish_date] if publish_date else [],
        "subjects": [
            {"name": name, "url": None}
            for name in _clean_list(data.subjects, MAX_SUBJECTS, MAX_NAME)
        ],
        "isbns": _cleaned_isbns(data.isbns),
    }


def _cover_urls(book_id: UUID) -> list[dict]:
    """The cover URL stored in `covers` points at our redirect endpoint, not at a
    presigned URL — a signature would expire while sitting in the column."""
    url = f"/books/{book_id}/cover"
    return [{"small": url, "medium": url, "large": url}]


async def create_manual_book(
    session: AsyncSession, user_id: UUID, data: ManualBookCreate
) -> Book:
    """Create (or reuse) a catalogue entry from user-typed details.

    If any supplied ISBN already resolves to a book we have, that book is
    returned instead of inserting a near-duplicate.
    """
    fields = _clean_fields(data)

    # Don't duplicate a record we already hold under one of these ISBNs.
    existing = await find_existing_by_isbns(session, fields["isbns"])
    if existing:
        return existing

    if not await _rate_limit_ok(session, user_id):
        raise ManualBookError(
            f"You've added {DAILY_CREATE_LIMIT} books manually today — try again tomorrow"
        )

    cover_key = await _validated_cover_key(data, user_id)

    book = Book(
        openbook_url=None,
        openbook_key=None,
        source="manual",
        created_by_user_id=user_id,
        cover_s3_key=cover_key,
        **fields,
    )
    # `id` is generated client-side (default_factory=uuid4), so the cover URL can
    # be built before the insert.
    if cover_key:
        book.covers = _cover_urls(book.id)

    session.add(book)
    await session.commit()
    await session.refresh(book)
    return book


async def apply_manual_book_edit(
    session: AsyncSession, user_id: UUID, book: Book, data: ManualBookCreate
) -> Book:
    """Overwrite a manual entry's fields with a corrected submission.

    Caller is responsible for checking that `book` is manual and owned by
    `user_id`. A new cover replaces the old object; omitting `cover_key` keeps
    the existing cover rather than clearing it.
    """
    for name, value in _clean_fields(data).items():
        setattr(book, name, value)

    new_cover_key = await _validated_cover_key(data, user_id)
    if new_cover_key and new_cover_key != book.cover_s3_key:
        old_key = book.cover_s3_key
        book.cover_s3_key = new_cover_key
        book.covers = _cover_urls(book.id)
        if old_key:
            try:
                storage.delete_object(old_key)
            except Exception:
                # An orphaned object is not worth failing the edit over.
                pass

    session.add(book)
    await session.commit()
    await session.refresh(book)
    return book
