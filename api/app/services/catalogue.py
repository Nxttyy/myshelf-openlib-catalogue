"""
The book catalogue: finding books we already hold, asking the providers
(services/sources) about new ones, and keeping each book's merged fields in
step with its sources.

Flow for an ISBN: check book_identifiers → if not found → ask the providers
(Open Library first; Google Books alongside it or as the fallback) → save each
answer as a BookSource → merge them into the Book's columns.
"""

import asyncio
import time
from collections import OrderedDict
from datetime import datetime
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import settings
from app.models.book import Book, BookIdentifier, BookSource
from app.services.isbn import isbn_identifiers, normalize_isbn, to_isbn13
from app.services.sources import MANUAL, PROVIDERS, ProviderError, SourceRecord, normalize
from app.services.sources.base import add_identifiers
from app.services.sources.openlibrary import covers_from_url

# ── Errors ───────────────────────────────────────────────────────────────────


class BookNotFound(ValueError):
    """No provider has a record for this ISBN. A ValueError, as the old
    Open Library-only lookup raised, so callers map it to a 404."""


class CatalogueUnavailable(Exception):
    """Every provider we asked failed (down, slow, or rate-limiting us)."""

    def __init__(self, errors: list[ProviderError]):
        super().__init__("; ".join(str(e) for e in errors) or "no book source available")
        self.errors = errors
        self.rate_limited = any(e.status == 429 for e in errors)
        self.retry_after = next((e.retry_after for e in errors if e.retry_after), None)


# ── Merging ──────────────────────────────────────────────────────────────────

# Which source wins each field, best first. A hand-typed entry always wins:
# someone looked at the book. Providers not listed rank after these.
DEFAULT_ORDER = (MANUAL, "openlibrary", "google")
FIELD_PRIORITY = {
    # Google's page counts and language codes are filled in far more often.
    "number_of_pages": (MANUAL, "google", "openlibrary"),
    "language": (MANUAL, "google", "openlibrary"),
}
# Within one provider: full edition-level records over work-level summaries.
_KIND_RANK = {"work": 1}
MAX_SUBJECTS = 40


def _rank(order: tuple[str, ...], provider: str) -> int:
    return order.index(provider) if provider in order else len(order)


def _empty(value) -> bool:
    return value is None or value == "" or value == [] or value == {}


def merge_sources(book: Book, sources: list[BookSource]) -> None:
    """Rebuild a book's display columns from its sources."""
    if not sources:
        return
    rows = sorted(
        sources,
        key=lambda s: (_rank(DEFAULT_ORDER, s.provider), _KIND_RANK.get(s.kind, 0), -s.fetched_at.timestamp()),
    )
    normalized = [(row.provider, normalize(row.provider, row.kind, row.payload)) for row in rows]

    def pick(key: str):
        order = FIELD_PRIORITY.get(key, DEFAULT_ORDER)
        for _provider, fields in sorted(normalized, key=lambda n: _rank(order, n[0])):
            if not _empty(fields.get(key)):
                return fields[key]
        return None

    for key in ("subtitle", "description", "publish_date", "number_of_pages", "by_statement", "language"):
        setattr(book, key, pick(key))
    book.title = pick("title") or book.title or "Untitled"
    for key in ("authors", "publishers", "covers"):
        setattr(book, key, pick(key) or [])

    subjects: list[dict] = []
    seen: set[str] = set()
    identifiers: dict = {}
    extra: dict = {}
    for _provider, fields in normalized:
        for subject in fields["subjects"]:
            name = (subject.get("name") or "").strip()
            if name and name.lower() not in seen and len(subjects) < MAX_SUBJECTS:
                seen.add(name.lower())
                subjects.append(subject)
        for scheme, values in fields["identifiers"].items():
            add_identifiers(identifiers, scheme, values)
        for key, value in fields["extra"].items():
            extra.setdefault(key, value)
    book.subjects = subjects
    book.identifiers = identifiers
    book.isbns = identifiers.get("isbn_13", []) + identifiers.get("isbn_10", [])
    book.extra = extra

    links: list[dict] = []
    for row in rows:
        if row.url and all(link["url"] != row.url for link in links):
            links.append({"provider": row.provider, "url": row.url})
    book.source_links = links
    book.updated_at = datetime.utcnow()


async def _sync_identifiers(session: AsyncSession, book: Book) -> None:
    """Point book_identifiers at this book for each of its identifiers. An
    identifier another book already holds stays with that book."""
    await session.exec(sa.delete(BookIdentifier).where(BookIdentifier.book_id == book.id))
    rows = [
        {"scheme": scheme, "value": value, "book_id": book.id}
        for scheme, values in book.identifiers.items()
        for value in values
    ]
    if rows:
        await session.exec(pg_insert(BookIdentifier).values(rows).on_conflict_do_nothing())


async def recompute(session: AsyncSession, book: Book) -> None:
    """Merge a book's sources into its columns and re-index its identifiers.
    Flushes; the caller commits."""
    sources = (await session.exec(select(BookSource).where(BookSource.book_id == book.id))).all()
    merge_sources(book, list(sources))
    session.add(book)
    await session.flush()
    await _sync_identifiers(session, book)


# ── Finding books we hold ────────────────────────────────────────────────────

# Identifiers that pin down one book. Other schemes (OCLC, LCCN, Goodreads, ...)
# are indexed too, but aren't trusted to merge two records into one book.
MATCH_SCHEMES = ("isbn_13", "openlibrary", "google")


def own_identifier(provider: str, external_id: str) -> tuple[str, str] | None:
    """The identifier a source's own id corresponds to, e.g. an Open Library
    work key for a work-level search result."""
    if provider == "openlibrary":
        tail = external_id.rsplit("/", 1)[-1]
        return ("openlibrary_work", tail) if external_id.startswith("/works/") else ("openlibrary", tail)
    if provider == "google":
        return ("google", external_id)
    return None


async def find_book_by_identifiers(session: AsyncSession, pairs: list[tuple[str, str]]) -> Book | None:
    """The book holding the first of these (scheme, value) pairs that any book holds."""
    pairs = list(dict.fromkeys(pairs))
    if not pairs:
        return None
    rows = (await session.exec(
        select(BookIdentifier.scheme, BookIdentifier.value, BookIdentifier.book_id).where(
            sa.tuple_(BookIdentifier.scheme, BookIdentifier.value).in_(pairs)
        )
    )).all()
    held = {(scheme, value): book_id for scheme, value, book_id in rows}
    for pair in pairs:
        if pair in held:
            return await session.get(Book, held[pair])
    return None


async def find_book_by_isbn(session: AsyncSession, isbn: str) -> Book | None:
    isbn13 = to_isbn13(isbn)
    return await find_book_by_identifiers(session, [("isbn_13", isbn13)]) if isbn13 else None


async def find_book_by_isbns(session: AsyncSession, isbns: list[str]) -> Book | None:
    pairs = [("isbn_13", i) for i in isbn_identifiers(isbns).get("isbn_13", [])]
    return await find_book_by_identifiers(session, pairs)


def _match_pairs(record: SourceRecord, fields: dict) -> list[tuple[str, str]]:
    own = own_identifier(record.provider, record.external_id)
    pairs = [own] if own else []
    for scheme in MATCH_SCHEMES:
        pairs += [(scheme, value) for value in fields["identifiers"].get(scheme, [])]
    return pairs


# ── Saving ───────────────────────────────────────────────────────────────────


async def _save(session: AsyncSession, records: list[SourceRecord], book: Book | None) -> Book:
    keys = [(r.provider, r.external_id) for r in records]
    held = {
        (row.provider, row.external_id): row
        for row in (await session.exec(
            select(BookSource).where(sa.tuple_(BookSource.provider, BookSource.external_id).in_(keys))
        )).all()
    }

    if book is not None:
        session.add(book)  # may be new (a manual entry being created)
        await session.flush()
    else:
        # A record we already hold decides the book; then any shared identifier.
        for key in keys:
            if key in held:
                book = await session.get(Book, held[key].book_id)
                break
    if book is None:
        pairs = []
        for record in records:
            pairs += _match_pairs(record, normalize(record.provider, record.kind, record.payload))
        book = await find_book_by_identifiers(session, pairs)
    if book is None:
        first = normalize(records[0].provider, records[0].kind, records[0].payload)
        book = Book(title=first.get("title") or "Untitled", source=records[0].provider)
        session.add(book)
        await session.flush()

    touched = {book.id: book}
    now = datetime.utcnow()
    for record in records:
        row = held.get((record.provider, record.external_id))
        if row is None:
            row = BookSource(book_id=book.id, provider=record.provider, external_id=record.external_id)
        elif row.book_id not in touched:
            touched[row.book_id] = await session.get(Book, row.book_id)
        row.kind, row.payload, row.url, row.fetched_at = record.kind, record.payload, record.url, now
        session.add(row)
    await session.flush()

    for touched_book in touched.values():
        await recompute(session, touched_book)
    await session.commit()
    await session.refresh(book)
    return book


async def save_records(session: AsyncSession, records: list[SourceRecord], book: Book | None = None) -> Book:
    """Store provider records as sources and return the book they belong to.

    With `book`, the records are attached to it. Otherwise the book is the one
    already holding any of these records, else one sharing an identifier with
    them, else a new one. Retries once if a concurrent save of the same book
    wins the race to insert it.
    """
    if not records:
        raise BookNotFound("No records found")
    try:
        return await _save(session, records, book)
    except IntegrityError:
        await session.rollback()
        return await _save(session, records, book)


# ── Asking the providers ─────────────────────────────────────────────────────

# With enrichment off, the other providers are asked only once the first has
# failed, come back empty, or taken this long.
HEDGE_DELAY = 2.0
# With enrichment on: once one provider has answered, how long the rest get
# to add their record.
ENRICH_GRACE = 1.5


def _configured() -> list:
    return [p for p in PROVIDERS.values() if p.configured()]


async def _timed(provider, coro):
    try:
        return await asyncio.wait_for(coro, settings.BOOK_LOOKUP_TIMEOUT)
    except TimeoutError as exc:
        raise ProviderError(provider.NAME, "timed out") from exc
    except ProviderError:
        raise
    except Exception as exc:  # a parsing bug in one provider shouldn't sink the lookup
        print(f"{provider.NAME} lookup failed: {exc!r}")
        raise ProviderError(provider.NAME, f"failed ({type(exc).__name__})") from exc


async def lookup_isbn(isbn: str) -> list[SourceRecord]:
    """Every configured provider's record for an ISBN, best provider first.

    Raises BookNotFound when the providers that answered have nothing, and
    CatalogueUnavailable when none of them could answer at all.
    """
    primary, *others = _configured()
    loop = asyncio.get_running_loop()
    hedge_at = loop.time() + HEDGE_DELAY
    names: dict[asyncio.Task, str] = {}

    def launch(provider) -> asyncio.Task:
        task = asyncio.create_task(_timed(provider, provider.lookup_isbn(isbn)))
        names[task] = provider.NAME
        return task

    running = {launch(primary)}
    held = others
    if settings.GOOGLE_BOOKS_ENRICH:
        running |= {launch(p) for p in held}
        held = []

    found: list[SourceRecord] = []
    errors: list[ProviderError] = []
    answered = 0
    settle_at = None
    try:
        while running:
            now = loop.time()
            if settle_at is not None:
                timeout = settle_at - now
                if timeout <= 0:
                    break
            elif held:
                timeout = max(0.0, hedge_at - now)
            else:
                timeout = None
            done, running = await asyncio.wait(running, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                try:
                    record = task.result()
                except ProviderError as exc:
                    errors.append(exc)
                    continue
                answered += 1
                if record is not None:
                    found.append(record)
            if found:
                held = []
                if settle_at is None:
                    settle_at = loop.time() + (ENRICH_GRACE if settings.GOOGLE_BOOKS_ENRICH else 0)
            elif held and (not running or loop.time() >= hedge_at):
                running |= {launch(p) for p in held}
                held = []
    finally:
        for task in running:
            task.cancel()

    if found:
        return sorted(found, key=lambda r: _rank(tuple(PROVIDERS), r.provider))
    if answered:
        raise BookNotFound("No records found")
    raise CatalogueUnavailable(errors)


async def prefetch_isbns(isbns: list[str]) -> dict[str, list[SourceRecord] | Exception]:
    """Look up several ISBNs concurrently.

    Batch-add flows (e.g. a haul of scanned books) would otherwise make N
    sequential round trips for N cache misses. Persisting still happens one at
    a time on the shared session (see `save_records`), but that part was never
    the slow one.

    Returns isbn -> records, or the exception raised while looking it up (the
    caller decides whether/how to surface that per-entry).
    """
    unique = list(dict.fromkeys(isbns))
    if not unique:
        return {}
    results = await asyncio.gather(*(lookup_isbn(isbn) for isbn in unique), return_exceptions=True)
    return dict(zip(unique, results))


async def get_or_create_book(session: AsyncSession, isbn: str) -> Book:
    """Main entry point for an ISBN: the book we hold, else fetched and saved."""
    isbn = normalize_isbn(isbn)
    existing = await find_book_by_isbn(session, isbn)
    if existing:
        return existing
    return await save_records(session, await lookup_isbn(isbn))


# ── Search ───────────────────────────────────────────────────────────────────

# Search results, kept briefly so that adding one saves the provider's whole
# record rather than the trimmed copy the client sends back. In-process: a
# result added after a restart (or past the TTL) falls back to that copy.
_HIT_TTL = 60 * 60
_HIT_CACHE_SIZE = 2000
_hits: OrderedDict[tuple[str, str], tuple[float, SourceRecord]] = OrderedDict()


def _remember(record: SourceRecord) -> None:
    key = (record.provider, record.external_id)
    _hits[key] = (time.monotonic() + _HIT_TTL, record)
    _hits.move_to_end(key)
    while len(_hits) > _HIT_CACHE_SIZE:
        _hits.popitem(last=False)


def _recall(provider: str, external_id: str) -> SourceRecord | None:
    entry = _hits.get((provider, external_id))
    if entry is None or entry[0] < time.monotonic():
        return None
    return entry[1]


async def search(query: str, limit: int = 12) -> list[dict]:
    """Title/author search: the first provider with results answers.

    Each result carries `provider` + `external_id`, which is how the client
    asks for it to be saved (see `get_or_create_book_from_hit`).
    """
    errors: list[ProviderError] = []
    answered = False
    for provider in _configured():
        try:
            records = await _timed(provider, provider.search(query, limit))
        except ProviderError as exc:
            errors.append(exc)
            continue
        answered = True
        if not records:
            continue
        hits = []
        for record in records:
            _remember(record)
            hit = provider.hit(record)
            hits.append({
                "key": f"{record.provider}:{record.external_id}",
                "provider": record.provider,
                "external_id": record.external_id,
                "isbn": hit["isbns"][0] if hit["isbns"] else None,
                **hit,
                "isbns": hit["isbns"][:20],
            })
        return hits
    if answered:
        return []
    raise CatalogueUnavailable(errors)


def _record_from_hit(hit: dict) -> SourceRecord:
    """A search result as the client sent it back, for when the full record has
    left the cache. The same trimmed fields the old search flow saved."""
    provider, external_id = hit["provider"], hit["external_id"]
    identifiers = isbn_identifiers(hit.get("isbns") or [])
    own = own_identifier(provider, external_id)
    if own:
        add_identifiers(identifiers, *own)
    cover_url = hit.get("cover_url")
    year = hit.get("first_publish_year")
    fields = {
        "title": (hit.get("title") or "")[:300] or None,
        "authors": [{"name": name[:200], "url": None} for name in (hit.get("authors") or [])[:10] if name],
        "publish_date": str(year) if year else None,
        "covers": covers_from_url(cover_url) if provider == "openlibrary" else (
            [{"small": cover_url, "medium": cover_url, "large": cover_url}] if cover_url else []
        ),
        "identifiers": identifiers,
    }
    url = None
    if provider == "openlibrary":
        url = f"https://openlibrary.org{external_id}"
    elif provider == "google":
        url = f"https://books.google.com/books?id={external_id}"
    return SourceRecord(provider=provider, external_id=external_id, kind="fields", payload=fields, url=url)


async def get_or_create_book_from_hit(session: AsyncSession, hit: dict) -> Book:
    """Save a search result the user picked, without a second lookup.

    Reuses the book that already holds this result or shares an ISBN with it
    (adding this record to its sources), else creates one.
    """
    provider, external_id = hit.get("provider"), (hit.get("external_id") or "").strip()
    if provider not in PROVIDERS or not external_id:
        raise ValueError("Search result is missing its source")
    record = _recall(provider, external_id) or _record_from_hit({**hit, "external_id": external_id})
    return await save_records(session, [record])


# ── Hand-typed entries ───────────────────────────────────────────────────────


def manual_record(book_id: UUID, fields: dict) -> SourceRecord:
    return SourceRecord(provider=MANUAL, external_id=str(book_id), kind="fields", payload=fields)
