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

mcp = FastMCP(
    "dora-library",
    instructions=(
        "Read-only access to the Dora book app database. "
        "Use get_user_library to profile a user's reading taste, and "
        "get_book_details to fetch metadata for a candidate book."
    ),
    stateless_http=True,
    json_response=True,
    streamable_http_path="/",
    # Served behind a tunnel/proxy under changing hostnames; access is
    # controlled by the shared secret, so skip the Host-header allowlist.
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)


def _names(items: list | None) -> list[str]:
    """Flatten Open Library style [{url, name}, ...] JSONB to bare names."""
    return [i["name"] for i in items or [] if isinstance(i, dict) and i.get("name")]


_LIBRARY_SQL = sa.text(
    """
    SELECT b.title, b.subtitle, b.authors, b.subjects, b.description,
           b.publish_date, b.number_of_pages,
           ub.status, ub.comment, ub.is_pinned, ub.created_at
    FROM user_books ub
    JOIN books b ON b.id = ub.book_id
    WHERE ub.user_id = :user_id
    ORDER BY ub.created_at
    """
)

_BOOK_BY_ID_SQL = sa.text("SELECT * FROM books WHERE id = :book_id")
_BOOK_BY_ISBN_SQL = sa.text("SELECT * FROM books WHERE isbns @> :isbn LIMIT 1")


@mcp.tool()
async def get_user_library(user_id: str) -> str:
    """Return every book in a user's library with the user's own status,
    comment and pinned flag, plus the book's title, authors, subjects and
    description. user_id must be the user's UUID."""
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
            row = (
                await session.execute(_BOOK_BY_ISBN_SQL, {"isbn": json.dumps([isbn])})
            ).mappings().first()
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
            "isbns": _jsonb(row["isbns"]),
        }
    )


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
    _log_access(f"REST GET /agent-api/user-library/{user_id} auth=ok")
    return Response(content=await get_user_library(user_id), media_type="application/json")


@rest_router.get("/book")
async def rest_book(
    request: Request,
    book_id: str = Query(""),
    isbn: str = Query(""),
    key: str | None = Query(None),
):
    _check_rest_key(request, key)
    _log_access(f"REST GET /agent-api/book book_id={book_id!r} isbn={isbn!r} auth=ok")
    return Response(content=await get_book_details(book_id, isbn), media_type="application/json")


# TEMPORARY debug aid while wiring up FlowStudio: every /mcp request is
# appended here (method, JSON-RPC method, tool name, auth result).
_ACCESS_LOG = "/tmp/dora_mcp_access.log"


def _log_access(line: str) -> None:
    from datetime import datetime, timezone

    try:
        with open(_ACCESS_LOG, "a") as f:
            f.write(f"{datetime.now(timezone.utc).isoformat()} {line}\n")
    except OSError:
        pass


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

            # Buffer the request body so we can log the JSON-RPC method, then
            # replay it for the inner app.
            messages = []
            if scope["method"] in ("POST", "PUT"):
                while True:
                    msg = await receive()
                    messages.append(msg)
                    if msg["type"] != "http.request" or not msg.get("more_body"):
                        break
            body = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.request")
            rpc, tool = "-", "-"
            try:
                parsed = json.loads(body or b"{}")
                rpc = parsed.get("method", "-")
                tool = parsed.get("params", {}).get("name", "-")
            except (ValueError, AttributeError):
                pass
            ua = headers.get(b"user-agent", b"-").decode()
            _log_access(
                f"{scope['method']} {scope.get('path', '')} rpc={rpc} tool={tool} "
                f"auth={'ok' if authed else 'DENIED'} ua={ua!r}"
            )

            if not authed:
                resp = _unauthorized()
                await send({"type": "http.response.start", "status": resp["status"], "headers": resp["headers"]})
                await send({"type": "http.response.body", "body": resp["body"]})
                return

            idx = 0

            async def replay():
                nonlocal idx
                if idx < len(messages):
                    m = messages[idx]
                    idx += 1
                    return m
                return await receive()

            await inner(scope, replay, send)
            return
        await inner(scope, receive, send)

    return guard
