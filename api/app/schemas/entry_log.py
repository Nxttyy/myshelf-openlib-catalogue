"""
Schemas for the diary log on a shelf entry, and the companions it names.
"""

from datetime import date
from uuid import UUID

from pydantic import BaseModel, Field


class CompanionRead(BaseModel):
    id: UUID
    name: str
    initials: str
    color: str

    model_config = {"from_attributes": True}


class CompanionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    # Default: the first letters of the name, and the next colour in turn.
    initials: str | None = Field(default=None, max_length=3)
    color: str | None = None


class EntryLogRead(BaseModel):
    # Criterion → 1..10. Books: plot, characters, writing, world, pacing,
    # ending. Films: story, characters, acting, visuals, music, pacing.
    scores: dict[str, int]
    # The average of the scores, to one decimal.
    enjoyment: float
    finished_on: date | None = None
    finished_on_precision: str | None = None  # day | month | year
    # Books: home, cafe, commute, other. Films: theater, home, on_the_go, friends_place.
    place: str | None = None
    times: int = 1
    # Empty: alone.
    companions: list[CompanionRead] = []


class EntryLogWrite(BaseModel):
    """The whole log, replacing what was there."""

    scores: dict[str, int]
    finished_on: date | None = None
    finished_on_precision: str | None = None
    place: str | None = None
    times: int = Field(default=1, ge=1, le=99)
    companion_ids: list[UUID] = Field(default=[], max_length=20)
