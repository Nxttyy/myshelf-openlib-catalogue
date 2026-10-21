"""
Film — a cached OMDb record, one row per IMDb ID.

The fields Dora shows get their own columns ("N/A" stored as NULL); the whole
OMDb payload is kept in `raw` so a field we start showing later needs no
refetch.
"""

from datetime import date, datetime
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Column, Field, SQLModel


class Film(SQLModel, table=True):
    __tablename__ = "films"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    imdb_id: str = Field(unique=True, index=True)
    type: str = Field(default="movie")  # movie | series
    title: str
    # norm_title(title), so pasted lists can match films we already have.
    title_norm: str | None = Field(default=None, index=True)
    # A string: series run over years, e.g. "2005–2013".
    year: str | None = None
    rated: str | None = None
    released: date | None = None
    runtime_min: int | None = None
    genres: list[str] = Field(
        default_factory=list,
        sa_column=Column(sa.dialects.postgresql.JSONB, nullable=False, server_default="[]"),
    )
    director: str | None = None
    writer: str | None = None
    actors: str | None = None
    plot: str | None = None
    language: str | None = None
    country: str | None = None
    awards: str | None = None
    poster_url: str | None = None
    # [{"source": "Rotten Tomatoes", "value": "94%"}, ...]
    ratings: list[dict] = Field(
        default_factory=list,
        sa_column=Column(sa.dialects.postgresql.JSONB, nullable=False, server_default="[]"),
    )
    imdb_rating: float | None = None
    imdb_votes: int | None = None
    raw: dict = Field(
        default_factory=dict,
        sa_column=Column(sa.dialects.postgresql.JSONB, nullable=False, server_default="{}"),
    )
    # When OMDb was last asked; ratings older than a month get refreshed.
    fetched_at: datetime = Field(default_factory=datetime.utcnow)

    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    updated_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(
            sa.DateTime,
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )
