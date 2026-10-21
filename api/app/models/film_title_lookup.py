"""
FilmTitleLookup — what OMDb answered for a title, so a pasted list never
spends a lookup twice on the same title. A row with no imdb_id remembers
that nothing was found (kept for a week, then asked again).
"""

from datetime import datetime
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


class FilmTitleLookup(SQLModel, table=True):
    __tablename__ = "film_title_lookups"
    __table_args__ = (
        sa.UniqueConstraint("title_norm", "year", "type", name="uq_film_title_lookups_key"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    title_norm: str
    # "" when the list didn't say, so the unique key works without NULLs.
    year: str = Field(default="")
    type: str = Field(default="")  # movie | series | ""
    imdb_id: str | None = None
    checked_at: datetime = Field(default_factory=datetime.utcnow)
