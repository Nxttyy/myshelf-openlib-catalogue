"""
Book — SQLModel DB table.

Nested data (authors, publishers, subjects, covers, identifiers) is stored as
JSONB columns. This keeps things simple until there's a need to normalise into
separate tables.
"""

from datetime import datetime
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Column, Field, SQLModel


class Book(SQLModel, table=True):
    __tablename__ = "books"

    id: UUID = Field(default_factory=uuid4, primary_key=True)

    # Record-level fields
    isbns: list[str] = Field(
        default_factory=list,
        sa_column=Column(sa.dialects.postgresql.JSONB, nullable=False, server_default="[]"),
    )
    publish_dates: list[str] = Field(
        default_factory=list,
        sa_column=Column(sa.dialects.postgresql.JSONB, nullable=False, server_default="[]"),
    )

    # From record.data — NULL on manually-created books, which have no Open
    # Library record. Postgres allows many NULLs under a unique index, so
    # openbook_key stays unique for the books that do have one.
    openbook_url: str | None = Field(default=None, index=True)
    openbook_key: str | None = Field(default=None, unique=True, index=True)
    title: str
    subtitle: str | None = None
    description: str | None = None
    # Internet Archive identifier (ocaid) → https://archive.org/details/{archive_id}
    archive_id: str | None = Field(default=None, index=True)
    authors: list[dict] = Field(
        default_factory=list,
        sa_column=Column(sa.dialects.postgresql.JSONB, nullable=False, server_default="[]"),
    )
    number_of_pages: int | None = None
    by_statement: str | None = None
    identifiers: dict = Field(
        default_factory=dict,
        sa_column=Column(sa.dialects.postgresql.JSONB, nullable=False, server_default="{}"),
    )
    publishers: list[dict] = Field(
        default_factory=list,
        sa_column=Column(sa.dialects.postgresql.JSONB, nullable=False, server_default="[]"),
    )
    publish_date: str | None = None
    subjects: list[dict] = Field(
        default_factory=list,
        sa_column=Column(sa.dialects.postgresql.JSONB, nullable=False, server_default="[]"),
    )
    covers: list[dict] = Field(
        default_factory=list,
        sa_column=Column(sa.dialects.postgresql.JSONB, nullable=False, server_default="[]"),
    )

    # ── Provenance ───────────────────────────────────────────────────────────
    # "openlibrary" for catalogue records fetched from Open Library, "manual"
    # for entries a user typed in themselves (no copy to scan, not in OL).
    source: str = Field(default="openlibrary", index=True)
    # Who submitted a manual entry — attribution, edit permission, rate limiting.
    created_by_user_id: UUID | None = Field(default=None, foreign_key="users.id", index=True)
    # Object key of an uploaded cover. The public URL in `covers` points at
    # /books/{id}/cover, which redirects to a freshly presigned GET; the key is
    # kept so the signature can be regenerated and the object deleted.
    cover_s3_key: str | None = None

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
