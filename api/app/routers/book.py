"""
Book router — ISBN lookup endpoint (API).
"""

from uuid import UUID

from pydantic import BaseModel
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, Depends
from fastapi.responses import RedirectResponse
from httpx import HTTPStatusError, RequestError

from sqlmodel import select
from app.db import SessionDep
from app.auth import get_current_user, require_user
from app.models.book import Book
from app.models.user import User
from app.models.user_book import UserBook
from app.models.user_book_image import UserBookImage
from app.schemas.book import BookRead, ManualBookCreate
from app.schemas.user_book_image import (
    ImagePresignRequest,
    PresignBatchRequest,
    PresignedCoverUpload,
    PresignedUpload,
    UserBookImageRead,
)
from app.services import storage
from app.services.manual_book import (
    ManualBookError,
    apply_manual_book_edit,
    create_manual_book,
    search_local_books,
)
from app.services.openlibrary import (
    find_book_by_isbn,
    get_or_create_book,
    get_or_create_book_from_metadata,
    normalize_isbn,
    persist_fetched_book,
    prefetch_isbns,
    search_books,
)


def _raise_for_openlibrary(exc: HTTPStatusError):
    """Translate an Open Library HTTP error into a client-friendly HTTPException."""
    status = exc.response.status_code
    if status == 429:
        retry_after = exc.response.headers.get("Retry-After")
        raise HTTPException(
            status_code=429,
            detail="Open Library is rate-limiting us. Please try again shortly.",
            headers={"Retry-After": retry_after} if retry_after else None,
        )
    raise HTTPException(status_code=status, detail=f"Open Library returned {status}")

router = APIRouter(prefix="/books", tags=["Books"])

VALID_STATUSES = {'unread', 'reading', 'read'}

class SearchBookMetadata(BaseModel):
    key: str
    title: str | None = None
    authors: list[str] = []
    isbns: list[str] = []
    cover_url: str | None = None
    first_publish_year: int | None = None


class BatchUserBookEntry(BaseModel):
    # Exactly one of these identifies the book:
    #   isbn     — scanned or typed ISBN, resolved via Open Library
    #   book     — full Open Library search metadata, saved as-is
    #   book_id  — a book already in our catalogue (local search result)
    #   manual   — user-typed details; the catalogue row is created here, at
    #              save time, so an abandoned modal leaves nothing behind
    isbn: str | None = None
    book: SearchBookMetadata | None = None
    book_id: UUID | None = None
    manual: ManualBookCreate | None = None
    is_public: bool = True
    comment: str | None = None
    status: str = 'unread'

class BatchUserBookRequest(BaseModel):
    entries: list[BatchUserBookEntry]

class UpdateUserBookRequest(BaseModel):
    status: str | None = None
    is_public: bool | None = None
    comment: str | None = None
    is_pinned: bool | None = None



@router.get("/lookup/{isbn}", response_model=BookRead)
async def lookup_isbn(
    session: SessionDep,
    isbn: Annotated[str, Path(description="ISBN-10 or ISBN-13")],
):
    """
    Look up a book by ISBN.

    Checks local DB first; if not found, fetches from Open Library,
    persists the record, then returns it.
    """
    try:
        book = await get_or_create_book(session, isbn)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except HTTPStatusError as exc:
        _raise_for_openlibrary(exc)
    except RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to reach Open Library: {exc}",
        )

    return book

@router.get("/search")
async def search_books_endpoint(
    q: Annotated[str, Query(min_length=2, description="Title and/or author query")],
    limit: Annotated[int, Query(ge=1, le=40)] = 12,
):
    """
    Free-text book search via the Open Library Search API.

    Returns lightweight results for display; the caller adds a chosen result to
    the library by passing its `isbn` to the existing lookup/batch flow.
    """
    try:
        return await search_books(q, limit)
    except HTTPStatusError as exc:
        _raise_for_openlibrary(exc)
    except RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Failed to reach Open Library: {exc}")


@router.get("/search/local")
async def search_local_books_endpoint(
    session: SessionDep,
    q: Annotated[str, Query(min_length=2, description="Title and/or author query")],
    limit: Annotated[int, Query(ge=1, le=40)] = 12,
):
    """
    Search the local catalogue — including books users typed in manually, which
    are invisible to the Open Library search above.

    Results are added to a library by passing `book_id` to the batch endpoint.
    """
    books = await search_local_books(session, q, limit)

    # Resolve the handles of manual contributors for attribution.
    contributor_ids = {b.created_by_user_id for b in books if b.created_by_user_id}
    handles: dict = {}
    if contributor_ids:
        rows = (await session.exec(
            select(User.id, User.username, User.email).where(User.id.in_(contributor_ids))
        )).all()
        handles = {uid: (username or email.split("@")[0]) for uid, username, email in rows}

    return [
        {
            "book_id": str(b.id),
            "title": b.title,
            "authors": [a.get("name") for a in (b.authors or []) if a.get("name")],
            "cover_url": (b.covers[0].get("medium") or b.covers[0].get("small")) if b.covers else None,
            "publish_date": b.publish_date,
            "isbn": b.isbns[0] if b.isbns else None,
            "source": b.source,
            "added_by": handles.get(b.created_by_user_id),
        }
        for b in books
    ]


@router.post("/covers/presign", response_model=PresignedCoverUpload)
async def presign_book_cover(
    request_data: ImagePresignRequest,
    current_user: User = Depends(require_user),
):
    """Issue a presigned upload for a manually-added book's cover.

    Unlike comment photos there's no row to hang this off — the cover is
    uploaded before the book exists — so the key carries the uploader's id and
    is verified against it at creation time.
    """
    storage.require_storage_configured()
    if request_data.content_type not in storage.ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=422, detail=f"Unsupported image type: {request_data.content_type}")
    if request_data.byte_size <= 0 or request_data.byte_size > storage.MAX_BYTES:
        raise HTTPException(status_code=422, detail="Image is too large")

    key = storage.new_cover_key(current_user.id, request_data.content_type)
    post = storage.presign_post(key, request_data.content_type)
    return PresignedCoverUpload(key=key, upload_url=post["url"], fields=post["fields"])


@router.get("/{book_id}", response_model=BookRead)
async def get_book(book_id: UUID, session: SessionDep):
    book = await session.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.get("/{book_id}/cover")
async def get_book_cover(book_id: UUID, session: SessionDep):
    """Redirect to a freshly presigned GET for an uploaded cover.

    Book.covers holds this stable URL rather than a presigned one, which would
    expire while sitting in the column. Public, like the rest of the catalogue.
    """
    book = await session.get(Book, book_id)
    if not book or not book.cover_s3_key:
        raise HTTPException(status_code=404, detail="No cover for this book")
    storage.require_storage_configured()
    url = storage.presigned_get_url(book.cover_s3_key)
    return RedirectResponse(
        url,
        status_code=302,
        # Shorter than the signature's own lifetime so a cached redirect can't
        # outlive the URL it points at.
        headers={"Cache-Control": "private, max-age=1800"},
    )


@router.post("/manual", response_model=BookRead)
async def create_manual_book_endpoint(
    session: SessionDep,
    request_data: ManualBookCreate,
    current_user: User = Depends(require_user),
):
    """Create a catalogue entry by hand — for a book with no copy to scan and no
    Open Library record. The entry joins the shared catalogue, so other users
    find it via /books/search/local and Explore.

    Note the add-to-library modal doesn't use this: it sends `manual` entries to
    /user_books/batch so the row is only created when the user actually saves.
    """
    try:
        return await create_manual_book(session, current_user.id, request_data)
    except ManualBookError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.patch("/{book_id}", response_model=BookRead)
async def update_manual_book(
    book_id: UUID,
    request_data: ManualBookCreate,
    session: SessionDep,
    current_user: User = Depends(require_user),
):
    """Correct a manual entry. Only its creator can edit it — Open Library
    records are never editable here."""
    book = await session.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    if book.source != "manual" or book.created_by_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="This book isn't yours to edit")

    try:
        updated = await apply_manual_book_edit(session, current_user.id, book, request_data)
    except ManualBookError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return updated


@router.post("/user_books/batch")
async def batch_add_user_books(
    session: SessionDep,
    request_data: BatchUserBookRequest,
    current_user: User = Depends(require_user),
):
    """
    Save a batch of books to the user's library.

    Each entry is committed independently: a failure on one entry is rolled back
    and skipped so it can't poison the session and silently drop the rest.
    """
    # Capture the id up front: per-entry commits below expire ORM objects, and
    # touching current_user.id afterwards would trigger lazy IO outside the
    # async greenlet (the "greenlet_spawn" error).
    user_id = current_user.id

    added_count = 0
    # Reasons entries were dropped, surfaced to the client so a rejected manual
    # entry (rate limit, missing title) doesn't just silently vanish.
    errors: list[str] = []

    # Resolve plain-ISBN entries (scanned / typed) against the local DB first
    # (fast, sequential — it's one query per entry on the shared session), then
    # fetch every remaining cache-miss ISBN from Open Library concurrently.
    # The session itself still commits one entry at a time below, but the slow
    # part — N Open Library round trips — now overlaps instead of running
    # one after another.
    isbn_by_index: dict[int, str] = {}
    for i, entry in enumerate(request_data.entries):
        if entry.manual is None and entry.book_id is None and entry.book is None and entry.isbn:
            try:
                isbn_by_index[i] = normalize_isbn(entry.isbn)
            except ValueError:
                pass  # surfaced as a normal per-entry error in the main loop below

    local_hits: dict[int, Book] = {}
    miss_isbns: list[str] = []
    for i, isbn in isbn_by_index.items():
        existing = await find_book_by_isbn(session, isbn)
        if existing:
            local_hits[i] = existing
        else:
            miss_isbns.append(isbn)
    prefetched = await prefetch_isbns(miss_isbns)

    for i, entry in enumerate(request_data.entries):
        label = (
            (entry.manual and entry.manual.title.strip())
            or entry.isbn
            or (entry.book and entry.book.title)
            or (entry.book_id and str(entry.book_id))
            or "Untitled book"
        )
        try:
            # Search results carry full metadata → save directly (no re-lookup).
            # Scanned / manually-entered ISBNs → resolve via Open Library.
            if entry.manual is not None:
                book = await create_manual_book(session, user_id, entry.manual)
            elif entry.book_id is not None:
                book = await session.get(Book, entry.book_id)
                if book is None:
                    continue
            elif entry.book is not None:
                book = await get_or_create_book_from_metadata(session, entry.book.model_dump())
            elif entry.isbn:
                if i in local_hits:
                    book = local_hits[i]
                elif i in isbn_by_index:
                    raw = prefetched[isbn_by_index[i]]
                    if isinstance(raw, Exception):
                        raise raw
                    book = await persist_fetched_book(session, raw)
                else:
                    # Invalid ISBN (failed normalize_isbn above) — let this
                    # raise the same ValueError it always did.
                    book = await get_or_create_book(session, entry.isbn)
            else:
                continue

            book_id = book.id  # read before any commit expires `book`

            # Check if UserBook already exists
            stmt = select(UserBook).where(
                UserBook.user_id == user_id,
                UserBook.book_id == book_id
            )
            existing = (await session.exec(stmt)).first()

            is_new = existing is None
            if is_new:
                ub = UserBook(
                    user_id=user_id,
                    book_id=book_id,
                    is_public=entry.is_public,
                    comment=entry.comment,
                    status=entry.status if entry.status in VALID_STATUSES else 'unread',
                )
                session.add(ub)
            else:
                existing.is_public = entry.is_public
                existing.comment = entry.comment
                session.add(existing)

            await session.commit()
            if is_new:
                added_count += 1
        except ManualBookError as e:
            await session.rollback()
            errors.append(f"{label}: {e}")
        except Exception as e:
            # Roll back the poisoned transaction so the next entry starts clean.
            await session.rollback()
            errors.append(f"Couldn't add {label}")
            print(f"Error adding entry {label}: {e}")

    return {
        "message": f"Successfully added {added_count} books",
        "added": added_count,
        "errors": errors,
    }


@router.post("/user_books/add/{book_id}")
async def add_book_to_shelf(
    book_id: UUID,
    session: SessionDep,
    current_user: User = Depends(require_user),
):
    """Add a book that already exists in the catalogue to the user's shelf."""
    book = await session.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    existing = (await session.exec(
        select(UserBook).where(
            UserBook.user_id == current_user.id,
            UserBook.book_id == book_id,
        )
    )).first()
    if existing:
        return {"ok": True, "already": True}

    session.add(UserBook(user_id=current_user.id, book_id=book_id, is_public=True, status="unread"))
    await session.commit()
    return {"ok": True, "already": False}


@router.patch("/user_books/{user_book_id}")
async def update_user_book(
    user_book_id: UUID,
    request_data: UpdateUserBookRequest,
    session: SessionDep,
    current_user: User = Depends(require_user),
):
    ub = await session.get(UserBook, user_book_id)
    if not ub or ub.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Book not found in your library")
    if request_data.status is not None:
        if request_data.status not in VALID_STATUSES:
            raise HTTPException(status_code=422, detail=f"status must be one of {VALID_STATUSES}")
        ub.status = request_data.status
    if request_data.is_public is not None:
        ub.is_public = request_data.is_public
    if request_data.comment is not None:
        ub.comment = request_data.comment
    if request_data.is_pinned is not None:
        if request_data.is_pinned:
            # unpin any currently pinned book for this user first
            pinned_stmt = select(UserBook).where(
                UserBook.user_id == current_user.id,
                UserBook.is_pinned == True,
                UserBook.id != user_book_id,
            )
            currently_pinned = (await session.exec(pinned_stmt)).all()
            for other in currently_pinned:
                other.is_pinned = False
                session.add(other)
        ub.is_pinned = request_data.is_pinned
    session.add(ub)
    await session.commit()
    return {"ok": True}


async def _owned_user_book(session: SessionDep, user_book_id: UUID, current_user: User) -> UserBook:
    ub = await session.get(UserBook, user_book_id)
    if not ub or ub.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Book not found in your library")
    return ub


@router.post("/user_books/{user_book_id}/images/presign", response_model=list[PresignedUpload])
async def presign_user_book_images(
    user_book_id: UUID,
    request_data: PresignBatchRequest,
    session: SessionDep,
    current_user: User = Depends(require_user),
):
    """Issue a presigned upload for each requested file; the client PUTs the
    bytes straight to the bucket, then confirms via /confirm below."""
    storage.require_storage_configured()
    await _owned_user_book(session, user_book_id, current_user)

    existing_count = len((await session.exec(
        select(UserBookImage.id).where(UserBookImage.user_book_id == user_book_id)
    )).all())
    if existing_count + len(request_data.files) > storage.MAX_IMAGES_PER_BOOK:
        raise HTTPException(
            status_code=422,
            detail=f"A note can have at most {storage.MAX_IMAGES_PER_BOOK} photos",
        )

    results: list[PresignedUpload] = []
    for i, file in enumerate(request_data.files):
        if file.content_type not in storage.ALLOWED_CONTENT_TYPES:
            raise HTTPException(status_code=422, detail=f"Unsupported image type: {file.content_type}")
        if file.byte_size <= 0 or file.byte_size > storage.MAX_BYTES:
            raise HTTPException(status_code=422, detail="Image is too large")

        key = storage.new_key(file.content_type)
        image = UserBookImage(
            user_book_id=user_book_id,
            s3_key=key,
            content_type=file.content_type,
            byte_size=file.byte_size,
            position=existing_count + i,
            status="pending",
        )
        session.add(image)
        await session.commit()
        await session.refresh(image)

        post = storage.presign_post(key, file.content_type)
        results.append(PresignedUpload(
            image_id=image.id, key=key,
            upload_url=post["url"], fields=post["fields"],
        ))
    return results


@router.post("/user_books/{user_book_id}/images/{image_id}/confirm", response_model=UserBookImageRead)
async def confirm_user_book_image(
    user_book_id: UUID,
    image_id: UUID,
    session: SessionDep,
    current_user: User = Depends(require_user),
):
    storage.require_storage_configured()
    await _owned_user_book(session, user_book_id, current_user)

    image = await session.get(UserBookImage, image_id)
    if not image or image.user_book_id != user_book_id:
        raise HTTPException(status_code=404, detail="Image not found")

    head = storage.head_object(image.s3_key)
    if not head:
        raise HTTPException(status_code=422, detail="Upload not found in storage yet")

    image.status = "uploaded"
    session.add(image)
    # Capture fields before commit: commit expires the ORM object's attributes,
    # and touching them afterwards triggers lazy IO outside the async greenlet
    # (the "greenlet_spawn" error).
    image_id_, s3_key, position = image.id, image.s3_key, image.position
    await session.commit()
    return UserBookImageRead(id=image_id_, url=storage.presigned_get_url(s3_key), position=position)


@router.delete("/user_books/{user_book_id}/images/{image_id}")
async def delete_user_book_image(
    user_book_id: UUID,
    image_id: UUID,
    session: SessionDep,
    current_user: User = Depends(require_user),
):
    storage.require_storage_configured()
    await _owned_user_book(session, user_book_id, current_user)

    image = await session.get(UserBookImage, image_id)
    if not image or image.user_book_id != user_book_id:
        raise HTTPException(status_code=404, detail="Image not found")

    storage.delete_object(image.s3_key)
    await session.delete(image)
    await session.commit()
    return {"ok": True}
