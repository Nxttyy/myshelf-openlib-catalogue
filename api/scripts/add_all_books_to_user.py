"""
Add every book in the catalogue to a user's shelf.

Recovers from the old batch-save bug where `Book` rows were created but their
`UserBook` link wasn't — those books show in explore but not on the profile.
This creates the missing `UserBook` rows for the given user. Idempotent: books
already on the shelf are skipped, so it's safe to re-run.

Usage (from the project root, with the venv active):

    python -m scripts.add_all_books_to_user --user you@example.com
    python -m scripts.add_all_books_to_user --user <user-uuid>
    python -m scripts.add_all_books_to_user --user you@example.com --private
    python -m scripts.add_all_books_to_user --user you@example.com --status read
    python -m scripts.add_all_books_to_user --user you@example.com --dry-run
"""

import argparse
import asyncio
from uuid import UUID

# Register the postgresql dialect before model classes import.
import sqlalchemy.dialects.postgresql  # noqa: F401
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db import engine
from app.models.book import Book
from app.models.user import User
from app.models.user_book import UserBook

VALID_STATUSES = {"unread", "reading", "read"}


async def resolve_user(session: AsyncSession, ident: str) -> User | None:
    """Look up a user by UUID or email."""
    try:
        return await session.get(User, UUID(ident))
    except ValueError:
        result = await session.exec(select(User).where(User.email == ident))
        return result.first()


async def run(*, ident: str, is_public: bool, status: str, dry_run: bool) -> None:
    async with AsyncSession(engine) as session:
        user = await resolve_user(session, ident)
        if not user:
            print(f"No user found for {ident!r}.")
            return

        # All book ids, and the ones already on this user's shelf.
        all_ids = set((await session.exec(select(Book.id))).all())
        owned_ids = set((await session.exec(
            select(UserBook.book_id).where(UserBook.user_id == user.id)
        )).all())
        missing = all_ids - owned_ids

        print(f"User {user.email} ({user.id})")
        print(f"  books in catalogue : {len(all_ids)}")
        print(f"  already on shelf   : {len(owned_ids)}")
        print(f"  to add             : {len(missing)}"
              f"  [status={status}, {'public' if is_public else 'private'}]"
              f"{'  — DRY RUN' if dry_run else ''}\n")

        if not missing or dry_run:
            print("Done (nothing written)." if dry_run or not missing else "")
            return

        for book_id in missing:
            session.add(UserBook(
                user_id=user.id,
                book_id=book_id,
                is_public=is_public,
                status=status,
            ))
        await session.commit()
        print(f"Added {len(missing)} book(s) to {user.email}'s shelf.")

    await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description="Add all catalogue books to a user's shelf.")
    parser.add_argument("--user", required=True, help="User email or UUID.")
    parser.add_argument("--status", default="unread", choices=sorted(VALID_STATUSES),
                        help="Reading status for the added books (default: unread).")
    parser.add_argument("--private", action="store_true",
                        help="Mark added books private (default: public).")
    parser.add_argument("--dry-run", action="store_true", help="Report only; write nothing.")
    args = parser.parse_args()

    asyncio.run(run(
        ident=args.user,
        is_public=not args.private,
        status=args.status,
        dry_run=args.dry_run,
    ))


if __name__ == "__main__":
    main()
