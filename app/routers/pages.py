"""
Page routes — serves Jinja2 HTML templates.
"""

from fastapi import APIRouter, Depends, Request
from fastapi.templating import Jinja2Templates
from httpx import HTTPStatusError, RequestError

from app.auth import get_current_user
from app.db import SessionDep
from app.models.book import Book
from app.models.user import User
from app.services.openlibrary import get_or_create_book
from sqlmodel import select

router = APIRouter(tags=["Pages"])
templates = Jinja2Templates(directory="app/templates")


@router.get("/")
async def index(
    request: Request,
    session: SessionDep,
    isbn: str | None = None,
    current_user: User = Depends(get_current_user),
):
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
        "user": current_user,
    }

    return templates.TemplateResponse(
        name="index.html", request=request, context=context
    )


@router.get("/login")
async def login_page(request: Request, error: str | None = None):
    return templates.TemplateResponse(
        name="login.html", request=request, context={"error": error}
    )


@router.get("/register")
async def register_page(request: Request, error: str | None = None):
    return templates.TemplateResponse(
        name="register.html", request=request, context={"error": error}
    )


@router.get("/forgot-password")
async def forgot_password_page(request: Request, error: str | None = None):
    return templates.TemplateResponse(
        name="forgot-password.html", request=request, context={"error": error}
    )


@router.get("/reset-password")
async def reset_password_page(request: Request, token: str, error: str | None = None):
    return templates.TemplateResponse(
        name="reset-password.html", request=request, context={"token": token, "error": error}
    )
