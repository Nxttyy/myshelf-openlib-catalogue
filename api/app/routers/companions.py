"""
Companions: the people you say you read or watched something with, in a
diary log. Names you type, private to you.
"""

from fastapi import APIRouter, Depends

from app.db import SessionDep
from app.auth import require_user
from app.models.user import User
from app.schemas.entry_log import CompanionCreate, CompanionRead
from app.services import entry_logs

router = APIRouter(prefix="/companions", tags=["Companions"])


@router.get("", response_model=list[CompanionRead])
async def list_companions(session: SessionDep, me: User = Depends(require_user)):
    return await entry_logs.companions(session, me.id)


@router.post("", response_model=CompanionRead)
async def add_companion(request_data: CompanionCreate, session: SessionDep, me: User = Depends(require_user)):
    return await entry_logs.add_companion(session, me.id, request_data)
