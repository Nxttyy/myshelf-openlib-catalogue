"""
Book router — ISBN lookup endpoint (API).
"""

from uuid import UUID

from pydantic import BaseModel
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Depends
from httpx import HTTPStatusError, RequestError

from sqlmodel import select
from app.db import SessionDep
from app.auth import get_current_user
from app.models.user import User
from app.models.user_book import UserBook
from app.schemas.book import BookRead
from app.services.openlibrary import get_or_create_book

router = APIRouter(prefix="/books", tags=["Books"])

VALID_STATUSES = {'unread', 'reading', 'read'}

class BatchUserBookEntry(BaseModel):
    isbn: str
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
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=f"Open Library returned {exc.response.status_code}",
        )
    except RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to reach Open Library: {exc}",
        )

    return book

@router.post("/user_books/batch")
async def batch_add_user_books(
    session: SessionDep,
    request_data: BatchUserBookRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Save a batch of books to the user's library.
    """
    added_count = 0
    for entry in request_data.entries:
        try:
            # Assuming get_or_create_book returns a Book instance
            book = await get_or_create_book(session, entry.isbn)
            
            # Check if UserBook already exists
            stmt = select(UserBook).where(
                UserBook.user_id == current_user.id,
                UserBook.book_id == book.id
            )
            existing = (await session.exec(stmt)).first()
            
            if not existing:
                ub = UserBook(
                    user_id=current_user.id,
                    book_id=book.id,
                    is_public=entry.is_public,
                    comment=entry.comment,
                    status=entry.status if entry.status in VALID_STATUSES else 'unread',
                )
                session.add(ub)
                added_count += 1
            else:
                existing.is_public = entry.is_public
                existing.comment = entry.comment
                session.add(existing)
                
        except Exception as e:
            # Maybe log the error, but continue batch
            print(f"Error adding {entry.isbn}: {e}")
            pass

    await session.commit()
    return {"message": f"Successfully added {added_count} books"}


@router.patch("/user_books/{user_book_id}")
async def update_user_book(
    user_book_id: UUID,
    request_data: UpdateUserBookRequest,
    session: SessionDep,
    current_user: User = Depends(get_current_user),
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
