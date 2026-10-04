"""
Async database engine and session dependency.
"""

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=settings.DEBUG)


async def get_session():
    async with AsyncSession(engine) as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]
