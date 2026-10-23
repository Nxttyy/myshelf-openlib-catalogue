"""
Book — SQLModel DB table.

A book is the record users see, merged from everything the catalogue knows
about it: one `BookSource` row per provider record (Open Library, Google
Books, a hand-typed entry, ...) holding that provider's raw response, and one
`BookIdentifier` row per identifier, for lookups and de-duplication. The
display columns here are recomputed from the sources whenever one is added or
changes (services/catalogue.py), so reads never touch the other two tables.

Nested data (authors, publishers, subjects, covers, identifiers) is stored as
JSONB columns. This keeps things simple until there's a need to normalise into
separate tables.
"""

from datetime import datetime
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Column, Field, SQLModel


def _jsonb(default: str):
    return Column(sa.dialects.postgresql.JSONB, nullable=False, server_default=default)


class Book(SQLModel, table=True):
    __tablename__ = "books"

    id: UUID = Field(default_factory=uuid4, primary_key=True)

    # ── Merged display fields (see services/catalogue.merge_sources) ───────
    title: str
    subtitle: str | None = None
    description: str | None = None
    authors: list[dict] = Field(default_factory=list, sa_column=_jsonb("[]"))
    publishers: list[dict] = Field(default_factory=list, sa_column=_jsonb("[]"))
    subjects: list[dict] = Field(default_factory=list, sa_column=_jsonb("[]"))
    publish_date: str | None = None
    number_of_pages: int | None = None
    by_statement: str | None = None
    # ISO 639-1 where we know it ("en"), else whatever the source gave.
    language: str | None = None
    covers: list[dict] = Field(default_factory=list, sa_column=_jsonb("[]"))
    # ISBN-13s first, then ISBN-10s. A copy of the isbn_* identifiers, kept
    # for display and for the MCP tools' plain SQL.
    isbns: list[str] = Field(default_factory=list, sa_column=_jsonb("[]"))
    # scheme → values, e.g. {"isbn_13": [...], "openlibrary": ["OL1M"],
    # "google": ["zyTCAlFPjgYC"], "goodreads": [...], "archive": [...]}.
    identifiers: dict = Field(default_factory=dict, sa_column=_jsonb("{}"))
    # Fields a source offers that don't have a column (yet): ratings, preview
    # links, classifications, dimensions, ... keyed by a stable name.
    extra: dict = Field(default_factory=dict, sa_column=_jsonb("{}"))
    # [{"provider", "url"}] for each source, best first. For "find this book
    # on ..." links without loading the sources.
    source_links: list[dict] = Field(default_factory=list, sa_column=_jsonb("[]"))

    # ── Provenance ───────────────────────────────────────────────────────────
    # The provider the book was first created from: "openlibrary", "google",
    # or "manual" for entries a user typed in themselves.
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


class BookSource(SQLModel, table=True):
    """One provider's record of a book, kept whole.

    `payload` is the provider's response as received; `kind` says which of
    that provider's shapes it is (an Open Library edition record vs. a search
    doc, say), so it can be re-read later without calling the API again.
    `kind == "fields"` means the payload is already in the merged field shape:
    hand-typed entries, and records carried over from before this table.
    """

    __tablename__ = "book_sources"
    __table_args__ = (sa.UniqueConstraint("provider", "external_id"),)

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    book_id: UUID = Field(
        sa_column=Column(sa.Uuid, sa.ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    provider: str
    # The provider's own id: an Open Library key ("/books/OL1M", "/works/OL1W"),
    # a Google volume id, or the book's own id for manual entries.
    external_id: str
    kind: str
    url: str | None = None
    payload: dict = Field(default_factory=dict, sa_column=_jsonb("{}"))
    fetched_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(sa.DateTime, nullable=False, server_default=sa.func.now()),
    )


class BookIdentifier(SQLModel, table=True):
    """(scheme, value) → book, for "do we already have this?" lookups.

    The first book to claim an identifier keeps it; a later claim on the same
    pair is ignored rather than failing the save.
    """

    __tablename__ = "book_identifiers"

    scheme: str = Field(primary_key=True)
    value: str = Field(primary_key=True)
    book_id: UUID = Field(
        sa_column=Column(sa.Uuid, sa.ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True)
    )
