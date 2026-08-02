"""
Page routes — serves Jinja2 HTML templates.
"""

from datetime import timedelta

from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.templating import Jinja2Templates
from httpx import HTTPStatusError, RequestError

from app.auth import get_current_user
from app.db import SessionDep
from app.models.book import Book
from app.models.user import User
from app.models.user_book_image import UserBookImage
from app.services import storage
from app.services.openlibrary import get_or_create_book
from sqlmodel import select

router = APIRouter(tags=["Pages"])
templates = Jinja2Templates(directory="app/templates")

EXPLORE_PAGE_SIZE = 50

_COVER_PALETTES = [
    ("#1B2230", "#EDE6D6"), ("#243B6B", "#EDE6D6"), ("#E0A23E", "#231A0E"),
    ("#6B2B27", "#F0E5D8"), ("#23402F", "#E7E2D0"), ("#141210", "#E9E2D2"),
    ("#C97B4A", "#211009"), ("#3A4250", "#E5E3DC"), ("#3D2A41", "#E9DCEC"),
    ("#F2EBDD", "#3A2C1E"), ("#8FAFC0", "#15212A"), ("#EDE6D6", "#1A1714"),
]

templates.env.globals["cover_bg"] = lambda i: _COVER_PALETTES[i % len(_COVER_PALETTES)][0]
templates.env.globals["cover_fg"] = lambda i: _COVER_PALETTES[i % len(_COVER_PALETTES)][1]


async def _attach_images(session: SessionDep, items: list[dict]) -> None:
    """Attach item["images"] (uploaded comment photos, ordered) to each
    {"user_book", "book"} entry, keyed off UserBook.id."""
    for item in items:
        item["images"] = []
    if not items or not storage.storage_configured():
        return
    ub_ids = [item["user_book"].id for item in items]
    result = await session.exec(
        select(UserBookImage)
        .where(UserBookImage.user_book_id.in_(ub_ids), UserBookImage.status == "uploaded")
        .order_by(UserBookImage.position)
    )
    by_ub: dict = {}
    for img in result.all():
        by_ub.setdefault(img.user_book_id, []).append(
            {"id": str(img.id), "url": storage.presigned_get_url(img.s3_key), "position": img.position}
        )
    for item in items:
        item["images"] = by_ub.get(item["user_book"].id, [])


async def _contributor_handles(session: SessionDep, books) -> dict:
    """Map user id → handle for the people who typed manual entries in, so the
    catalogue can credit them. Empty for pages with no manual books."""
    ids = {b.created_by_user_id for b in books if b.created_by_user_id}
    if not ids:
        return {}
    rows = (await session.exec(
        select(User.id, User.username, User.email).where(User.id.in_(ids))
    )).all()
    return {uid: (username or email.split("@")[0]) for uid, username, email in rows}


def _build_hauls(user_books: list[dict], window: timedelta = timedelta(days=2)) -> list[dict]:
    """Group user_books into "hauls" for the timeline view — consecutive
    additions within `window` of each other, newest first. Purely a display
    grouping over UserBook.created_at; no separate haul entity to maintain,
    and it works retroactively over books added before this view existed."""
    if not user_books:
        return []

    ordered = sorted(user_books, key=lambda item: item["user_book"].created_at, reverse=True)

    groups: list[list[dict]] = [[ordered[0]]]
    for item in ordered[1:]:
        prev_time = groups[-1][-1]["user_book"].created_at
        if prev_time - item["user_book"].created_at <= window:
            groups[-1].append(item)
        else:
            groups.append([item])

    total = len(groups)
    out = []
    for i, group in enumerate(groups):
        books = [item["book"] for item in group]
        times = [item["user_book"].created_at for item in group]
        start, end = min(times), max(times)
        heading = (
            end.strftime("%b %d, %Y") if start.date() == end.date()
            else f"{start.strftime('%b %d')} – {end.strftime('%b %d, %Y')}"
        )
        out.append({
            "books": books,
            "total_pages": sum(b.number_of_pages or 0 for b in books),
            "date_display": end.strftime("%b %d, %Y"),
            "heading": heading,
            "number": total - i,
        })
    return out


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

    # 2. Fetch the first page of community books (rest load lazily via /explore)
    all_books_result = await session.exec(
        select(Book).order_by(Book.created_at.desc()).limit(EXPLORE_PAGE_SIZE)  # type: ignore[attr-defined]
    )
    all_books = all_books_result.all()

    # 3. Fetch user's books if logged in
    user_books = []
    hauls = []
    n_reading = n_read = n_unread = 0
    if current_user:
        from app.models.user_book import UserBook
        stmt = (
            select(UserBook, Book)
            .join(Book, UserBook.book_id == Book.id)
            .where(UserBook.user_id == current_user.id)
            .order_by(UserBook.is_pinned.desc(), UserBook.created_at.desc())
        )
        user_books_result = await session.exec(stmt)
        user_books = [{"user_book": ub, "book": b} for ub, b in user_books_result.all()]
        await _attach_images(session, user_books)
        hauls = _build_hauls(user_books)
        n_reading = sum(1 for item in user_books if item["user_book"].status == "reading")
        n_read    = sum(1 for item in user_books if item["user_book"].status == "read")
        n_unread  = len(user_books) - n_reading - n_read

    user_handle = (current_user.username or current_user.email.split("@")[0]) if current_user else None
    user_book_ids = {item["book"].id for item in user_books}

    context: dict = {
        "isbn": isbn,
        "all_books": all_books,
        "contributors": await _contributor_handles(
            session, list(all_books) + [item["book"] for item in user_books]
        ),
        "user_books": user_books,
        "hauls": hauls,
        "user_book_ids": user_book_ids,
        "explore_start": 0,
        "n_reading": n_reading,
        "n_read": n_read,
        "n_unread": n_unread,
        "selected_book": selected_book,
        "error": error,
        "user": current_user,
        "user_handle": user_handle,
    }

    return templates.TemplateResponse(
        name="index.html", request=request, context=context
    )


@router.get("/explore")
async def explore_page(
    request: Request,
    session: SessionDep,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
):
    """Return one page of community books as an HTML fragment (lazy loading)."""
    result = await session.exec(
        select(Book)
        .order_by(Book.created_at.desc())  # type: ignore[attr-defined]
        .offset(offset)
        .limit(EXPLORE_PAGE_SIZE)
    )
    books = result.all()

    user_book_ids: set = set()
    if current_user:
        from app.models.user_book import UserBook
        ub_result = await session.exec(
            select(UserBook.book_id).where(UserBook.user_id == current_user.id)
        )
        user_book_ids = set(ub_result.all())

    return templates.TemplateResponse(
        name="_explore_entries.html",
        request=request,
        context={
            "books": books,
            "explore_start": offset,
            "user_book_ids": user_book_ids,
            "contributors": await _contributor_handles(session, books),
            "user": current_user,
        },
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


@router.get("/mobile-scan/{token}")
async def mobile_scan_page(request: Request, token: str):
    return templates.TemplateResponse(
        name="mobile_scan.html", request=request, context={"token": token}
    )


@router.get("/guide")
async def guide_page(request: Request, current_user: User = Depends(get_current_user)):
    return templates.TemplateResponse(
        name="guide.html", request=request, context={"user": current_user}
    )


@router.get("/u/{handle}")
async def public_profile_page(
    request: Request,
    handle: str,
    session: SessionDep,
    current_user: User = Depends(get_current_user),
):
    """Public profile page — 404 if user not found or profile is private."""
    from app.models.user_book import UserBook

    profile_user = (
        await session.exec(select(User).where(User.username == handle))
    ).first()

    if not profile_user or not profile_user.is_profile_public:
        return templates.TemplateResponse(
            name="404.html",
            request=request,
            context={"user": current_user},
            status_code=404,
        )

    stmt = (
        select(UserBook, Book)
        .join(Book, UserBook.book_id == Book.id)
        .where(UserBook.user_id == profile_user.id, UserBook.is_public == True)
        .order_by(UserBook.is_pinned.desc(), UserBook.created_at.desc())
    )
    result = await session.exec(stmt)
    public_books = [{"user_book": ub, "book": b} for ub, b in result.all()]
    await _attach_images(session, public_books)
    contributors = await _contributor_handles(
        session, [item["book"] for item in public_books]
    )

    n_reading = sum(1 for item in public_books if item["user_book"].status == "reading")
    n_read    = sum(1 for item in public_books if item["user_book"].status == "read")
    n_unread  = len(public_books) - n_reading - n_read

    return templates.TemplateResponse(
        name="profile.html",
        request=request,
        context={
            "profile_user": profile_user,
            "handle": handle,
            "public_books": public_books,
            "contributors": contributors,
            "n_reading": n_reading,
            "n_read": n_read,
            "n_unread": n_unread,
            "user": current_user,
        },
    )
