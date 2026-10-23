"""
Ask Dora router — proxies the FlowStudio verdict workflow for the frontend.

The browser never talks to FlowStudio directly (the webhook secret stays
server-side): POST /dora/ask fires a run for the signed-in user, then the
frontend polls GET /dora/ask/{run_id} until it gets a verdict. Films work
the same way under /dora/films/ask, several films per run.
"""

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import require_user
from app.db import SessionDep
from app.models.user import User
from app.services import book_taste, dora, film_taste, omdb

router = APIRouter(prefix="/dora", tags=["Ask Dora"])


class AskDoraRequest(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    authors: list[str] = []
    isbn: str | None = None
    context: str | None = None


class AskDoraFilmsRequest(BaseModel):
    imdb_ids: list[str] = Field(min_length=1, max_length=40)


def _require_configured(workflow: str = dora.BOOKS):
    if not dora.is_configured(workflow):
        raise HTTPException(status_code=503, detail="Ask Dora is not configured")


@router.post("/ask")
async def ask_dora(
    payload: AskDoraRequest, session: SessionDep, current_user: User = Depends(require_user)
):
    """Get it or skip it, for a book you don't own yet. Returns {"verdict"}
    at once when cached (or when your shelf is empty), else {"run_id"} to poll."""
    _require_configured()
    try:
        return await book_taste.ask(session, current_user.id, payload.model_dump())
    except (httpx.HTTPError, dora.DoraError):
        raise HTTPException(status_code=502, detail="Dora service unavailable")


@router.get("/ask/{run_id}")
async def poll_dora(run_id: str, session: SessionDep, current_user: User = Depends(require_user)):
    _require_configured()
    try:
        result = await book_taste.poll(session, current_user.id, run_id)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Dora service unavailable")
    if result is None:
        raise HTTPException(status_code=404, detail="That question has expired. Ask again.")
    return result


@router.post("/films/ask")
async def ask_dora_films(
    payload: AskDoraFilmsRequest, session: SessionDep, current_user: User = Depends(require_user)
):
    """Verdicts for films you don't own yet. Returns cached answers at once
    and run ids to poll for the rest."""
    _require_configured(dora.FILMS)
    ids = omdb.parse_imdb_ids(" ".join(payload.imdb_ids))
    try:
        return await film_taste.ask(session, current_user.id, ids)
    except (httpx.HTTPError, dora.DoraError):
        raise HTTPException(status_code=502, detail="Dora service unavailable")


@router.get("/films/ask/{run_id}")
async def poll_dora_films(run_id: str, session: SessionDep, current_user: User = Depends(require_user)):
    _require_configured(dora.FILMS)
    try:
        result = await film_taste.poll(session, current_user.id, run_id)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Dora service unavailable")
    if result is None:
        raise HTTPException(status_code=404, detail="That question has expired. Ask again.")
    return result
