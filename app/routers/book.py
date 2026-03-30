"""
Book router — ISBN lookup endpoint (API).
"""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path
from httpx import HTTPStatusError, RequestError

from app.db import SessionDep
from app.schemas.book import BookRead
from app.services.openlibrary import get_or_create_book

router = APIRouter(prefix="/books", tags=["Books"])


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
