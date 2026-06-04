"""
Backfill archive.org links (and descriptions) for books already in the DB.

Books saved before the archive_id/description columns existed have them NULL.
This re-fetches each book from the Open Library Volumes API by its stored ISBN
and fills in `archive_id` (ocaid) and `description`.

Usage (from the project root, with the venv active):

    python -m scripts.backfill_archive_links              # fill books missing archive_id
    python -m scripts.backfill_archive_links --all        # re-fetch every book
    python -m scripts.backfill_archive_links --limit 50   # cap how many to process
    python -m scripts.backfill_archive_links --delay 2    # seconds between requests
    python -m scripts.backfill_archive_links --dry-run    # report only, no writes

Books with no ISBN (e.g. added via title search) are skipped — the Volumes API
is ISBN-keyed and there's nothing to look them up by.
"""

import argparse
import asyncio

# Ensure the postgresql dialect is registered before model classes are imported.
import sqlalchemy.dialects.postgresql  # noqa: F401
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db import engine
from app.models.book import Book
from app.services.openlibrary import clean_book_response, fetch_book_by_isbn

# httpx exceptions for rate-limit / network handling
from httpx import HTTPStatusError, RequestError


async def _enrich_one(book: Book) -> tuple[str | None, str | None] | None:
    """Return (archive_id, description) fetched from Open Library, or None on miss.

    Tries the book's ISBNs in order, stopping at the first that returns a record.
    """
    for isbn in book.isbns:
        try:
            raw = await fetch_book_by_isbn(isbn)
        except HTTPStatusError as exc:
            if exc.response.status_code == 429:
                raise  # let the caller back off
            continue  # 404 etc. for this ISBN — try the next
        except RequestError:
            continue
        fetched = clean_book_response(raw)
        if fetched:
            f = fetched[0]
            return f.archive_id, f.description
    return None


async def backfill(*, process_all: bool, limit: int | None, delay: float, dry_run: bool) -> None:
    async with AsyncSession(engine) as session:
        stmt = select(Book)
        if not process_all:
            stmt = stmt.where(Book.archive_id.is_(None))
        if limit:
            stmt = stmt.limit(limit)
        books = (await session.exec(stmt)).all()

    total = len(books)
    print(f"{total} book(s) to process "
          f"({'all' if process_all else 'missing archive_id'})"
          f"{' — DRY RUN' if dry_run else ''}\n")

    filled = skipped = errors = 0
    for i, book in enumerate(books, 1):
        if not book.isbns:
            skipped += 1
            print(f"[{i}/{total}] SKIP (no ISBN): {book.title[:60]}")
            continue

        try:
            result = await _enrich_one(book)
        except HTTPStatusError:
            errors += 1
            print(f"[{i}/{total}] RATE LIMITED — backing off 30s, then retrying once…")
            await asyncio.sleep(30)
            try:
                result = await _enrich_one(book)
            except Exception as exc:  # noqa: BLE001
                print(f"[{i}/{total}] FAILED after backoff: {exc}")
                continue
        except Exception as exc:  # noqa: BLE001
            errors += 1
            print(f"[{i}/{total}] ERROR: {exc}")
            continue

        if not result:
            skipped += 1
            print(f"[{i}/{total}] no Open Library record: {book.title[:60]}")
        else:
            archive_id, description = result
            tag = f"archive_id={archive_id or '—'}"
            if not dry_run:
                # Open a short-lived session per write so a mid-run crash still
                # commits earlier progress.
                async with AsyncSession(engine) as session:
                    db_book = await session.get(Book, book.id)
                    if db_book:
                        if archive_id:
                            db_book.archive_id = archive_id
                        if description and not db_book.description:
                            db_book.description = description
                        session.add(db_book)
                        await session.commit()
            filled += 1
            print(f"[{i}/{total}] OK  {tag}: {book.title[:55]}")

        await asyncio.sleep(delay)  # be polite to Open Library

    print(f"\nDone. filled={filled} skipped={skipped} errors={errors}")
    await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill archive.org links for existing books.")
    parser.add_argument("--all", action="store_true", dest="process_all",
                        help="Re-fetch every book, not just those missing archive_id.")
    parser.add_argument("--limit", type=int, default=None, help="Max books to process.")
    parser.add_argument("--delay", type=float, default=1.5,
                        help="Seconds to wait between requests (default 1.5).")
    parser.add_argument("--dry-run", action="store_true", help="Report only; write nothing.")
    args = parser.parse_args()

    asyncio.run(backfill(
        process_all=args.process_all,
        limit=args.limit,
        delay=args.delay,
        dry_run=args.dry_run,
    ))


if __name__ == "__main__":
    main()
