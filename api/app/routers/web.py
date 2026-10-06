"""
JSON reads for the React app (web/): the catalogue, your shelf, one book's
record, and public profiles.

Included before routers/book.py in main.py: these share its /books prefix,
and /books/{book_id} would otherwise swallow /books/recent.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import select

from app.auth import get_current_user, require_user
from app.db import SessionDep
from app.models.book import Book
from app.models.user import User
from app.models.user_book import UserBook
from app.schemas.book import BookRead
from app.schemas.web import (
    BookEntryRead,
    CatalogEntry,
    Haul,
    PublicShelfRead,
    RecentPage,
    ShelfCounts,
    ShelfEntry,
    ShelfOwner,
    ShelfRead,
)
from app.services.shelf import attach_images, build_hauls, contributor_handles

router = APIRouter(tags=["Web app"])

RECENT_PAGE_SIZE = 50


def _handle(user: User) -> str:
    return user.username or user.email.split("@")[0]


async def _viewer_book_ids(session: SessionDep, viewer: User | None) -> set[UUID]:
    if viewer is None:
        return set()
    rows = await session.exec(select(UserBook.book_id).where(UserBook.user_id == viewer.id))
    return set(rows.all())


def _can_edit(book: Book, viewer: User | None) -> bool:
    return viewer is not None and book.source == "manual" and book.created_by_user_id == viewer.id


async def _shelf_for(
    session: SessionDep, owner: User, viewer: User | None, public_only: bool
) -> tuple[ShelfCounts, list[ShelfEntry], list[Haul]]:
    stmt = (
        select(UserBook, Book)
        .join(Book, UserBook.book_id == Book.id)
        .where(UserBook.user_id == owner.id)
        .order_by(UserBook.is_pinned.desc(), UserBook.created_at.desc())
    )
    if public_only:
        stmt = stmt.where(UserBook.is_public == True)  # noqa: E712
    items = [{"user_book": ub, "book": b} for ub, b in (await session.exec(stmt)).all()]
    await attach_images(session, items)
    handles = await contributor_handles(session, [item["book"] for item in items])

    entries = [
        ShelfEntry(
            id=item["user_book"].id,
            status=item["user_book"].status,
            is_public=item["user_book"].is_public,
            is_pinned=item["user_book"].is_pinned,
            comment=item["user_book"].comment,
            created_at=item["user_book"].created_at,
            images=item["images"],
            book=BookRead.model_validate(item["book"]),
            added_by=handles.get(item["book"].created_by_user_id),
            can_edit=_can_edit(item["book"], viewer),
        )
        for item in items
    ]
    hauls = [Haul(**{k: h[k] for k in Haul.model_fields}) for h in build_hauls(items)]
    n_reading = sum(1 for e in entries if e.status == "reading")
    n_read = sum(1 for e in entries if e.status == "read")
    counts = ShelfCounts(
        all=len(entries), reading=n_reading, read=n_read, unread=len(entries) - n_reading - n_read
    )
    return counts, entries, hauls


def _owner(user: User) -> ShelfOwner:
    return ShelfOwner(
        handle=_handle(user),
        firstname=user.firstname,
        lastname=user.lastname,
        is_profile_public=user.is_profile_public,
    )


@router.get("/books/recent", response_model=RecentPage)
async def recent_books(
    session: SessionDep,
    offset: int = Query(0, ge=0),
    viewer: User | None = Depends(get_current_user),
):
    """Newest books across Dora, a page at a time (Explore, and the home page)."""
    books = (await session.exec(
        select(Book)
        .order_by(Book.created_at.desc())  # type: ignore[attr-defined]
        .offset(offset)
        .limit(RECENT_PAGE_SIZE + 1)  # one extra tells us whether another page exists
    )).all()
    has_more = len(books) > RECENT_PAGE_SIZE
    books = books[:RECENT_PAGE_SIZE]

    on_shelf = await _viewer_book_ids(session, viewer)
    handles = await contributor_handles(session, books)
    return RecentPage(
        entries=[
            CatalogEntry(
                book=BookRead.model_validate(b),
                added_by=handles.get(b.created_by_user_id),
                can_edit=_can_edit(b, viewer),
                on_shelf=b.id in on_shelf,
            )
            for b in books
        ],
        next_offset=offset + RECENT_PAGE_SIZE if has_more else None,
    )


@router.get("/books/user_books", response_model=ShelfRead)
async def my_shelf(session: SessionDep, me: User = Depends(require_user)):
    """The signed-in user's whole shelf, including private books."""
    counts, entries, hauls = await _shelf_for(session, me, me, public_only=False)
    return ShelfRead(owner=_owner(me), counts=counts, entries=entries, hauls=hauls)


@router.get("/books/{book_id}/entry", response_model=BookEntryRead)
async def book_entry(
    book_id: UUID,
    session: SessionDep,
    viewer: User | None = Depends(get_current_user),
):
    """One book with the viewer's context, so a shared ?book= link can open
    its record directly instead of waiting for a whole list to load."""
    book = await session.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    shelf = None
    if viewer is not None:
        ub = (await session.exec(
            select(UserBook).where(UserBook.user_id == viewer.id, UserBook.book_id == book_id)
        )).first()
        if ub is not None:
            item = {"user_book": ub, "book": book}
            await attach_images(session, [item])
            shelf = ShelfEntry(
                id=ub.id, status=ub.status, is_public=ub.is_public, is_pinned=ub.is_pinned,
                comment=ub.comment, created_at=ub.created_at, images=item["images"],
                book=BookRead.model_validate(book),
            )

    handles = await contributor_handles(session, [book])
    added_by = handles.get(book.created_by_user_id)
    if shelf is not None:
        shelf.added_by = added_by
        shelf.can_edit = _can_edit(book, viewer)
    return BookEntryRead(
        book=BookRead.model_validate(book),
        added_by=added_by,
        can_edit=_can_edit(book, viewer),
        on_shelf=shelf is not None,
        shelf=shelf,
    )


@router.get("/profiles/{handle}", response_model=PublicShelfRead)
async def public_profile(
    handle: str,
    session: SessionDep,
    viewer: User | None = Depends(get_current_user),
):
    """Someone's public shelf. 404 when the handle doesn't exist or the
    profile is private, same as the /u/{handle} page."""
    owner = (await session.exec(select(User).where(User.username == handle))).first()
    if not owner or not owner.is_profile_public:
        raise HTTPException(status_code=404, detail="This shelf is private or doesn't exist.")

    counts, entries, hauls = await _shelf_for(session, owner, viewer, public_only=True)
    return PublicShelfRead(
        owner=_owner(owner),
        counts=counts,
        entries=entries,
        hauls=hauls,
        viewer_book_ids=sorted(await _viewer_book_ids(session, viewer), key=str),
    )
