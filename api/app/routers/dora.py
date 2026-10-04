"""
Ask Dora router — proxies the FlowStudio verdict workflow for the frontend.

The browser never talks to FlowStudio directly (the webhook secret stays
server-side): POST /dora/ask fires a run for the signed-in user, then the
frontend polls GET /dora/ask/{run_id} until it gets a verdict.
"""

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import require_user
from app.models.user import User
from app.services import dora

router = APIRouter(prefix="/dora", tags=["Ask Dora"])


class AskDoraRequest(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    authors: list[str] = []
    isbn: str | None = None
    context: str | None = None


def _require_configured():
    if not dora.is_configured():
        raise HTTPException(status_code=503, detail="Ask Dora is not configured")


@router.post("/ask")
async def ask_dora(
    payload: AskDoraRequest, current_user: User = Depends(require_user)
):
    _require_configured()
    try:
        run_id = await dora.fire_verdict(str(current_user.id), payload.model_dump())
    except (httpx.HTTPError, dora.DoraError):
        raise HTTPException(status_code=502, detail="Dora service unavailable")
    return {"run_id": run_id}


@router.get("/ask/{run_id}")
async def poll_dora(run_id: str, current_user: User = Depends(require_user)):
    _require_configured()
    try:
        return await dora.poll_run(run_id)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Dora service unavailable")
