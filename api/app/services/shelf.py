"""
Shelf helpers shared by the Jinja pages (routers/pages.py) and the JSON
endpoints the React app uses (routers/web.py).
"""

from datetime import timedelta

from sqlmodel import select

from app.db import SessionDep
from app.models.user import User
from app.models.user_book_image import UserBookImage
from app.services import storage


async def attach_images(session: SessionDep, items: list[dict]) -> None:
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


async def contributor_handles(session: SessionDep, books) -> dict:
    """Map user id → handle for the people who typed manual entries in, so the
    catalogue can credit them. Empty for pages with no manual books."""
    ids = {b.created_by_user_id for b in books if b.created_by_user_id}
    if not ids:
        return {}
    rows = (await session.exec(
        select(User.id, User.username, User.email).where(User.id.in_(ids))
    )).all()
    return {uid: (username or email.split("@")[0]) for uid, username, email in rows}


def build_hauls(user_books: list[dict], window: timedelta = timedelta(days=2)) -> list[dict]:
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
            "user_book_ids": [item["user_book"].id for item in group],
            "total_pages": sum(b.number_of_pages or 0 for b in books),
            "date_display": end.strftime("%b %d, %Y"),
            "heading": heading,
            "number": total - i,
        })
    return out
