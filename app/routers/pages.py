"""
Page routes — serves Jinja2 HTML templates.
"""

from fastapi import APIRouter, Request
from fastapi.templating import Jinja2Templates
from httpx import HTTPStatusError, RequestError

from app.db import SessionDep
from app.models.book import Book
from app.services.openlibrary import get_or_create_book
from sqlmodel import select

router = APIRouter(tags=["Pages"])
templates = Jinja2Templates(directory="app/templates")


@router.get("/")
async def index(request: Request, session: SessionDep, isbn: str | None = None):
    """
    Home page:
    - Lists all books in the database on the left.
    - If `isbn` is present, ensures it's in DB and displays details on the right.
    """
    selected_book: Book | None = None
    error: str | None = None

    # 1. If ISBN provided, get/create and set as selected
    if isbn:
        isbn = isbn.strip()
        try:
            selected_book = await get_or_create_book(session, isbn)
        except ValueError as exc:
            error = str(exc)
        except HTTPStatusError as exc:
            error = f"Open Library returned HTTP {exc.response.status_code}"
        except RequestError as exc:
            error = f"Could not reach Open Library: {exc}"

    # 2. Fetch all books for the sidebar *after* any potential commit
    # This prevents 'MissingGreenlet' errors when the commit expires previous fetches
    all_books_result = await session.exec(select(Book).order_by(Book.title))
    all_books = all_books_result.all()

    context: dict = {
        "isbn": isbn,
        "all_books": all_books,
        "selected_book": selected_book,
        "error": error,
    }

    return templates.TemplateResponse(
        name="index.html", request=request, context=context
    )
