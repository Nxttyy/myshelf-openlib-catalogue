import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/scan", tags=["Scan"])

_sessions: dict[str, dict] = {}
_SESSION_TTL = timedelta(minutes=30)


def _cleanup_sessions() -> None:
    now = datetime.utcnow()
    expired = [k for k, v in list(_sessions.items()) if now - v["created_at"] > _SESSION_TTL]
    for k in expired:
        del _sessions[k]


class AddIsbnRequest(BaseModel):
    isbn: str


@router.post("/session")
async def create_scan_session(request: Request):
    _cleanup_sessions()
    token = str(uuid.uuid4())
    _sessions[token] = {"isbns": [], "created_at": datetime.utcnow()}
    base_url = str(request.base_url).rstrip("/")
    return {"token": token, "scan_url": f"{base_url}/mobile-scan/{token}"}


@router.post("/session/{token}/add")
async def add_isbn_to_session(token: str, body: AddIsbnRequest):
    if token not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    isbn = body.isbn.strip()
    if isbn and isbn not in _sessions[token]["isbns"]:
        _sessions[token]["isbns"].append(isbn)
    return {"ok": True, "total": len(_sessions[token]["isbns"])}


@router.get("/session/{token}/items")
async def get_session_items(token: str, after: int = 0):
    if token not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    all_isbns = _sessions[token]["isbns"]
    return {"isbns": all_isbns[after:], "total": len(all_isbns)}
