"""
Re-fetch books from the providers and store their full records as sources.

Books saved before book_sources existed only have a snapshot of their old
columns (kind "fields"); re-fetching replaces it with the provider's whole
response, so they gain everything the merged fields now draw on (language,
extra, Google's page counts, ...). Also the way to add Google Books data to
existing books once GOOGLE_BOOKS_API_KEY is set.

Usage (from api/, with the venv active):

    python -m scripts.refetch_books                     # books with no full provider record yet
    python -m scripts.refetch_books --provider google   # books with no Google record yet
    python -m scripts.refetch_books --all               # every book with an ISBN
    python -m scripts.refetch_books --limit 50          # cap how many to process
    python -m scripts.refetch_books --delay 2           # seconds between books
    python -m scripts.refetch_books --dry-run           # report only, no writes

Skipped: hand-typed entries, books with no ISBN, and books added from title
search (Open Library works, whose ISBNs belong to assorted editions).
"""

import argparse
import asyncio

# Ensure the postgresql dialect is registered before model classes are imported.
import sqlalchemy.dialects.postgresql  # noqa: F401
import sqlalchemy as sa
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db import engine
from app.models.book import Book, BookSource
from app.services import catalogue
from app.services.sources import MANUAL, PROVIDERS, ProviderError


async def _books_to_fetch(session: AsyncSession, provider: str | None, everything: bool) -> list[Book]:
    # Only books with an edition-level record: a book added from title search
    # is an Open Library *work*, whose ISBNs belong to assorted editions, so
    # looking one up would graft some other edition's details onto it.
    edition = select(BookSource.id).where(
        BookSource.book_id == Book.id,
        ~sa.and_(BookSource.provider == "openlibrary", BookSource.external_id.startswith("/works/")),
    )
    stmt = select(Book).where(
        Book.source != MANUAL, sa.func.jsonb_array_length(Book.isbns) > 0, edition.exists()
    )
    if not everything:
        has = select(BookSource.id).where(BookSource.book_id == Book.id)
        if provider:
            has = has.where(BookSource.provider == provider)
        else:
            has = has.where(BookSource.kind != "fields")
        stmt = stmt.where(~has.exists())
    return list((await session.exec(stmt.order_by(Book.created_at))).all())


async def _fetch(isbns: list[str], provider: str | None):
    """Records for the first of these ISBNs that any asked provider knows."""
    for isbn in isbns:
        try:
            if provider:
                record = await PROVIDERS[provider].lookup_isbn(isbn)
                records = [record] if record else []
            else:
                records = await catalogue.lookup_isbn(isbn)
        except catalogue.BookNotFound:
            continue
        if records:
            return records
    return []


async def main(provider: str | None, everything: bool, limit: int | None, delay: float, dry_run: bool) -> None:
    if provider and not PROVIDERS[provider].configured():
        raise SystemExit(f"{provider} isn't configured (see .env.example)")

    # Each save commits; without this, the books loaded up front would expire
    # and reading one afterwards would need IO outside the async context.
    async with AsyncSession(engine, expire_on_commit=False) as session:
        books = await _books_to_fetch(session, provider, everything)
        if limit:
            books = books[:limit]
        print(f"{len(books)} book(s) to fetch")

        updated = missed = failed = 0
        for i, book in enumerate(books, 1):
            label = f"[{i}/{len(books)}] {book.title}"
            try:
                records = await _fetch([v for v in book.isbns if len(v) == 13] or book.isbns, provider)
            except (ProviderError, catalogue.CatalogueUnavailable) as exc:
                failed += 1
                print(f"{label}: failed ({exc})")
                if getattr(exc, "status", None) == 429 or getattr(exc, "rate_limited", False):
                    print("Rate-limited; stopping. Run again later to continue.")
                    break
                continue
            if not records:
                missed += 1
                print(f"{label}: not found")
            elif dry_run:
                updated += 1
                print(f"{label}: would add {', '.join(f'{r.provider}:{r.kind}' for r in records)}")
            else:
                await catalogue.save_records(session, records, book=book)
                updated += 1
                print(f"{label}: added {', '.join(f'{r.provider}:{r.kind}' for r in records)}")
            if delay:
                await asyncio.sleep(delay)

    print(f"Done: {updated} updated, {missed} not found, {failed} failed{' (dry run)' if dry_run else ''}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--provider", choices=sorted(PROVIDERS), help="only ask this provider")
    parser.add_argument("--all", action="store_true", help="re-fetch every book with an ISBN")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(main(args.provider, args.all, args.limit, args.delay, args.dry_run))
