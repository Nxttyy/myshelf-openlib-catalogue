"""
MCP server exposing read-only library data for the Ask Dora agent workflow.

Mounted at /mcp (streamable HTTP). External agent services (FlowStudio) call
these tools instead of connecting to Postgres directly, since the database is
not reachable from outside. Guarded by a shared secret: requests must send
`Authorization: Bearer <MCP_SECRET>` (or `X-MCP-Secret: <MCP_SECRET>`).
"""

import json
from urllib.parse import parse_qs
from uuid import UUID

import sqlalchemy as sa
from fastapi import APIRouter, HTTPException, Query, Request, Response
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import settings
from app.db import engine
from app.services import taste
from app.services.isbn import to_isbn13

mcp = FastMCP(
    "dora-library",
    instructions=(
        "Read-only access to one person's Dora shelves (books and films). "
        "Start with get_taste_profile: it summarises what they love, dislike, "
        "value and leave unread, with their own 1-10 enjoyment ratings. Use "
        "search_user_library to check what they own by an author, director, "
        "series or subject, and get_past_verdicts to see what Dora told them "
        "before and how it turned out. get_user_library and "
        "get_user_film_library return the full raw shelves."
    ),
    stateless_http=True,
    json_response=True,
    streamable_http_path="/",
    # Served behind a tunnel/proxy under changing hostnames; access is
    # controlled by the shared secret, so skip the Host-header allowlist.
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)


def _log(scores, finished_on, precision, times) -> dict | None:
    """A diary log, compact: per-criterion scores (1-10), their average as
    enjoyment, when it was finished and how many times. None if unrated."""
    scores = json.loads(scores) if isinstance(scores, str) else scores
    if not scores:
        return None
    when = None
    if finished_on is not None:
        when = finished_on.isoformat()[: {"year": 4, "month": 7}.get(precision, 10)]
    return {
        "enjoyment": round(sum(scores.values()) / len(scores), 1),
        "scores": scores,
        "finished": when,
        "times": times,
    }


def _names(items: list | None) -> list[str]:
    """Flatten [{url, name}, ...] JSONB to bare names."""
    return [i["name"] for i in items or [] if isinstance(i, dict) and i.get("name")]


_LIBRARY_SQL = sa.text(
    """
    SELECT b.title, b.subtitle, b.authors, b.subjects, b.description,
           b.publish_date, b.number_of_pages,
           ub.status, ub.comment, ub.is_pinned, ub.created_at,
           el.scores, el.finished_on, el.finished_on_precision, el.times
    FROM user_books ub
    JOIN books b ON b.id = ub.book_id
    LEFT JOIN entry_logs el ON el.user_book_id = ub.id
    WHERE ub.user_id = :user_id
    ORDER BY ub.created_at
    """
)

_BOOK_BY_ID_SQL = sa.text("SELECT * FROM books WHERE id = :book_id")
_BOOK_BY_ISBN_SQL = sa.text(
    """
    SELECT b.* FROM book_identifiers bi
    JOIN books b ON b.id = bi.book_id
    WHERE bi.scheme = 'isbn_13' AND bi.value = :isbn
    """
)


@mcp.tool()
async def get_user_library(user_id: str) -> str:
    """Return every book in a user's library with the user's own status,
    comment, pinned flag and diary log (enjoyment 1-10 with per-criterion
    scores, when finished, times read; null if unrated), plus the book's
    title, authors, subjects and description. user_id must be the user's UUID."""
    try:
        UUID(user_id)
    except ValueError:
        return json.dumps({"error": f"invalid user_id UUID: {user_id!r}"})

    async with AsyncSession(engine) as session:
        rows = (await session.execute(_LIBRARY_SQL, {"user_id": user_id})).mappings().all()

    books = [
        {
            "title": r["title"],
            "subtitle": r["subtitle"],
            "authors": _names(json.loads(r["authors"]) if isinstance(r["authors"], str) else r["authors"]),
            "subjects": _names(json.loads(r["subjects"]) if isinstance(r["subjects"], str) else r["subjects"]),
            "description": (r["description"] or "")[:600] or None,
            "publish_date": r["publish_date"],
            "number_of_pages": r["number_of_pages"],
            "reading_status": r["status"],
            "user_comment": r["comment"],
            "is_pinned": r["is_pinned"],
            "added_at": r["created_at"].isoformat(),
            "log": _log(r["scores"], r["finished_on"], r["finished_on_precision"], r["times"]),
        }
        for r in rows
    ]
    return json.dumps({"user_id": user_id, "book_count": len(books), "books": books})


@mcp.tool()
async def get_book_details(book_id: str = "", isbn: str = "") -> str:
    """Fetch metadata for one book by its UUID (book_id) or by ISBN.
    Provide exactly one of book_id or isbn."""
    async with AsyncSession(engine) as session:
        if book_id:
            try:
                UUID(book_id)
            except ValueError:
                return json.dumps({"error": f"invalid book_id UUID: {book_id!r}"})
            row = (await session.execute(_BOOK_BY_ID_SQL, {"book_id": book_id})).mappings().first()
        elif isbn:
            isbn13 = to_isbn13(isbn)
            if isbn13 is None:
                return json.dumps({"error": f"invalid ISBN: {isbn!r}"})
            row = (await session.execute(_BOOK_BY_ISBN_SQL, {"isbn": isbn13})).mappings().first()
        else:
            return json.dumps({"error": "provide book_id or isbn"})

    if row is None:
        return json.dumps({"error": "book not found"})

    def _jsonb(v):
        return json.loads(v) if isinstance(v, str) else v

    return json.dumps(
        {
            "book_id": str(row["id"]),
            "title": row["title"],
            "subtitle": row["subtitle"],
            "authors": _names(_jsonb(row["authors"])),
            "subjects": _names(_jsonb(row["subjects"])),
            "description": (row["description"] or "")[:1200] or None,
            "publish_date": row["publish_date"],
            "number_of_pages": row["number_of_pages"],
            "language": row["language"],
            "isbns": _jsonb(row["isbns"]),
        }
    )


def _media(media: str) -> str | None:
    media = (media or "").strip().lower()
    return media if media in ("books", "films") else None


def _user(user_id: str) -> UUID | None:
    try:
        return UUID(user_id)
    except (ValueError, TypeError):
        return None


@mcp.tool()
async def get_taste_profile(user_id: str, media: str) -> str:
    """The person's taste on one shelf, computed from their library: call this
    first. media is "books" or "films". Returns counts; loved and disliked
    items (by their own 1-10 enjoyment ratings, with notes); criteria_avg
    (how they score plot, characters, writing... on average: what they value
    most and least); creators and subjects/genres weighted by enjoyment;
    decades and languages; backlog (how much sits unstarted and what kind);
    recent activity; quotes from their notes; and favourites from their other
    shelf. insufficient_data is true below 3 items: then say so rather than
    guess."""
    uid, m = _user(user_id), _media(media)
    if uid is None:
        return json.dumps({"error": f"invalid user_id UUID: {user_id!r}"})
    if m is None:
        return json.dumps({"error": 'media must be "books" or "films"'})
    async with AsyncSession(engine) as session:
        items = await taste.items_for(session, uid, m)
        other = await taste.items_for(session, uid, "books" if m == "films" else "films")
    return json.dumps(taste.profile(items, m, other), ensure_ascii=False)


@mcp.tool()
async def search_user_library(user_id: str, media: str, query: str) -> str:
    """What the person owns matching a query: words matched against title,
    authors/directors and subjects/genres (all words must match). Use it for
    the candidate's author or director, series name, or main subject. Each
    hit has status (read/reading/unread, for films watched/watching/not
    watched), their enjoyment 1-10 and note if any. media is "books" or
    "films". An empty list means they own nothing like it."""
    uid, m = _user(user_id), _media(media)
    if uid is None:
        return json.dumps({"error": f"invalid user_id UUID: {user_id!r}"})
    if m is None:
        return json.dumps({"error": 'media must be "books" or "films"'})
    async with AsyncSession(engine) as session:
        items = await taste.items_for(session, uid, m)
    return json.dumps({"query": query, "hits": taste.search(items, query)}, ensure_ascii=False)


@mcp.tool()
async def get_past_verdicts(user_id: str, media: str) -> str:
    """Dora's last verdicts for this person on one shelf ("books" or "films"),
    newest first, with what happened next: on_shelf_now, status_now and
    their_enjoyment once rated. Use it to calibrate: if Dora said skip and
    they added and loved it anyway (or the reverse), adjust."""
    uid, m = _user(user_id), _media(media)
    if uid is None:
        return json.dumps({"error": f"invalid user_id UUID: {user_id!r}"})
    if m is None:
        return json.dumps({"error": 'media must be "books" or "films"'})
    async with AsyncSession(engine) as session:
        items = await taste.items_for(session, uid, m)
        rows = await taste.past_verdicts(session, uid, m, items)
    return json.dumps({"verdicts": rows}, ensure_ascii=False)


_FILM_LIBRARY_SQL = sa.text(
    """
    SELECT f.title, f.year, f.type, f.genres, f.director, f.country, f.language,
           uf.status, uf.comment, uf.is_pinned,
           el.scores, el.finished_on, el.finished_on_precision, el.times
    FROM user_films uf
    JOIN films f ON f.id = uf.film_id
    LEFT JOIN entry_logs el ON el.user_film_id = uf.id
    WHERE uf.user_id = :user_id
    ORDER BY uf.is_pinned DESC, uf.created_at DESC
    LIMIT 300
    """
)

_BOOKS_BRIEF_SQL = sa.text(
    """
    SELECT b.title, b.authors, b.subjects
    FROM user_books ub
    JOIN books b ON b.id = ub.book_id
    WHERE ub.user_id = :user_id
    ORDER BY ub.is_pinned DESC, ub.created_at DESC
    LIMIT 150
    """
)

_FILM_STATUS = {"unread": "not watched", "reading": "watching", "read": "watched"}


@mcp.tool()
async def get_user_film_library(user_id: str) -> str:
    """Return a user's films (title, year, director, genres, country,
    language, watch status, note, pinned, diary log: enjoyment 1-10 with
    per-criterion scores, when watched, times watched; null if unrated) and a short list of their books
    (title, authors, top subjects) for pairing films with books. user_id
    must be the user's UUID. Kept compact: up to 300 films, 150 books."""
    try:
        UUID(user_id)
    except ValueError:
        return json.dumps({"error": f"invalid user_id UUID: {user_id!r}"})

    def _jsonb(v):
        return json.loads(v) if isinstance(v, str) else v

    async with AsyncSession(engine) as session:
        films = (await session.execute(_FILM_LIBRARY_SQL, {"user_id": user_id})).mappings().all()
        books = (await session.execute(_BOOKS_BRIEF_SQL, {"user_id": user_id})).mappings().all()

    return json.dumps({
        "user_id": user_id,
        "film_count": len(films),
        "films": [
            {
                "title": r["title"],
                "year": r["year"],
                "type": r["type"],
                "director": r["director"],
                "genres": _jsonb(r["genres"]) or [],
                "country": r["country"],
                "language": r["language"],
                "watch_status": _FILM_STATUS.get(r["status"], r["status"]),
                "user_note": (r["comment"] or "")[:200] or None,
                "is_pinned": r["is_pinned"],
                "log": _log(r["scores"], r["finished_on"], r["finished_on_precision"], r["times"]),
            }
            for r in films
        ],
        "book_count": len(books),
        "books": [
            {
                "title": r["title"],
                "authors": _names(_jsonb(r["authors"]))[:2],
                "subjects": _names(_jsonb(r["subjects"]))[:3],
            }
            for r in books
        ],
    }, ensure_ascii=False)


def _unauthorized():
    body = json.dumps({"error": "unauthorized"}).encode()
    return {
        "status": 401,
        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
        "body": body,
    }


# ── Plain REST variant of the same tools ──────────────────────────────────
# For agent platforms whose custom tools are Python snippets making HTTP
# calls (rather than MCP clients). Same data, same shared secret.
rest_router = APIRouter(prefix="/agent-api", tags=["Agent API"])


def _check_rest_key(request: Request, key: str | None) -> None:
    token = (
        request.headers.get("x-mcp-secret")
        or request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        or key
    )
    if not settings.MCP_SECRET or token != settings.MCP_SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")


@rest_router.get("/user-library/{user_id}")
async def rest_user_library(user_id: str, request: Request, key: str | None = Query(None)):
    _check_rest_key(request, key)
    return Response(content=await get_user_library(user_id), media_type="application/json")


@rest_router.get("/book")
async def rest_book(
    request: Request,
    book_id: str = Query(""),
    isbn: str = Query(""),
    key: str | None = Query(None),
):
    _check_rest_key(request, key)
    return Response(content=await get_book_details(book_id, isbn), media_type="application/json")


@rest_router.get("/user-films/{user_id}")
async def rest_user_films(user_id: str, request: Request, key: str | None = Query(None)):
    _check_rest_key(request, key)
    return Response(content=await get_user_film_library(user_id), media_type="application/json")


def secured_mcp_app():
    """The MCP ASGI app wrapped in a shared-secret check."""
    inner = mcp.streamable_http_app()

    async def guard(scope, receive, send):
        if scope["type"] == "http":
            headers = {k.lower(): v for k, v in scope.get("headers", [])}
            bearer = headers.get(b"authorization", b"").decode().removeprefix("Bearer ").strip()
            # Fallback for MCP clients that can't send custom headers: the
            # secret may be passed as a ?key= query parameter instead.
            query_key = parse_qs(scope.get("query_string", b"").decode()).get("key", [""])[0]
            token = bearer or headers.get(b"x-mcp-secret", b"").decode().strip() or query_key
            authed = bool(settings.MCP_SECRET) and token == settings.MCP_SECRET

            if not authed:
                resp = _unauthorized()
                await send({"type": "http.response.start", "status": resp["status"], "headers": resp["headers"]})
                await send({"type": "http.response.body", "body": resp["body"]})
                return
        await inner(scope, receive, send)

    return guard
