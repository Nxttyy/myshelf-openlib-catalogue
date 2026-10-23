"""
EntryLog — the diary log on a shelf entry (a UserBook or a UserFilm): six
enjoyment scores, when it was finished, where, who with, and how many times.
One per entry; an entry with no row is "not rated yet".

Companion — someone a user read or watched with. Just a name the user typed,
private to them; not a Dora account.
"""

from datetime import date, datetime
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Column, Field, SQLModel


class Companion(SQLModel, table=True):
    __tablename__ = "companions"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", ondelete="CASCADE", index=True)
    name: str
    initials: str = Field(max_length=3)
    color: str
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(sa.DateTime, nullable=False, server_default=sa.func.now()),
    )


class EntryLog(SQLModel, table=True):
    __tablename__ = "entry_logs"
    __table_args__ = (
        sa.CheckConstraint("(user_book_id IS NULL) <> (user_film_id IS NULL)", name="ck_entry_logs_one_entry"),
        sa.CheckConstraint("times >= 1", name="ck_entry_logs_times"),
        sa.CheckConstraint(
            "finished_on_precision IS NULL OR finished_on_precision IN ('day', 'month', 'year')",
            name="ck_entry_logs_precision",
        ),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    # Exactly one is set, like UserBookImage.
    user_book_id: UUID | None = Field(default=None, foreign_key="user_books.id", ondelete="CASCADE", unique=True)
    user_film_id: UUID | None = Field(default=None, foreign_key="user_films.id", ondelete="CASCADE", unique=True)
    # Criterion → 1..10, e.g. {"plot": 7, "characters": 8, ...}. Keyed rather
    # than ordered so renaming or reordering criteria can't scramble old logs.
    # Enjoyment is their average, computed on read.
    scores: dict = Field(
        default_factory=dict,
        sa_column=Column(sa.dialects.postgresql.JSONB, nullable=False, server_default="{}"),
    )
    # For month/year precision, the 1st of the month / Jan 1.
    finished_on: date | None = None
    finished_on_precision: str | None = None  # day | month | year
    place: str | None = None
    times: int = Field(default=1, sa_column=Column(sa.SmallInteger, nullable=False, server_default="1"))
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    updated_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(sa.DateTime, nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()),
    )


class EntryLogCompanion(SQLModel, table=True):
    __tablename__ = "entry_log_companions"

    log_id: UUID = Field(foreign_key="entry_logs.id", ondelete="CASCADE", primary_key=True)
    companion_id: UUID = Field(foreign_key="companions.id", ondelete="CASCADE", primary_key=True, index=True)
