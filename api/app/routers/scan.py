"""
Scan router — cross-device barcode hand-off.

Sessions are persisted in Postgres (see app.models.scan_session) so they survive
server restarts and are visible across all worker processes.
"""

from datetime import datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import delete, select

from app.db import SessionDep
from app.models.scan_session import ScanSession

router = APIRouter(prefix="/scan", tags=["Scan"])

_SESSION_TTL = timedelta(hours=2)


def _parse_token(token: str) -> UUID:
    try:
        return UUID(token)
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found or expired")


async def _get_active_session(session: SessionDep, token: str) -> ScanSession:
    token_uuid = _parse_token(token)
    obj = await session.get(ScanSession, token_uuid)
    if obj is None or datetime.utcnow() - obj.created_at > _SESSION_TTL:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    return obj


class AddIsbnRequest(BaseModel):
    isbn: str


@router.post("/session")
async def create_scan_session(request: Request, session: SessionDep):
    # Opportunistically purge expired sessions so the table doesn't grow forever.
    cutoff = datetime.utcnow() - _SESSION_TTL
    await session.exec(delete(ScanSession).where(ScanSession.created_at < cutoff))

    obj = ScanSession()
    session.add(obj)
    await session.commit()
    await session.refresh(obj)

    base_url = str(request.base_url).rstrip("/")
    return {"token": str(obj.token), "scan_url": f"{base_url}/mobile-scan/{obj.token}"}


@router.post("/session/{token}/add")
async def add_isbn_to_session(token: str, body: AddIsbnRequest, session: SessionDep):
    obj = await _get_active_session(session, token)
    isbn = body.isbn.strip()
    if isbn and isbn not in obj.isbns:
        # Reassign (not in-place append) so SQLAlchemy detects the JSONB change.
        obj.isbns = obj.isbns + [isbn]
        session.add(obj)
        await session.commit()
        await session.refresh(obj)
    return {"ok": True, "total": len(obj.isbns)}


@router.get("/session/{token}/items")
async def get_session_items(token: str, session: SessionDep, after: int = 0):
    obj = await _get_active_session(session, token)
    return {"isbns": obj.isbns[after:], "total": len(obj.isbns)}
