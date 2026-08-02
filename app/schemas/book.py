"""
Pydantic schemas for Book — used for API request/response validation.
Separate from the SQLModel DB model.
"""

from uuid import UUID

from pydantic import BaseModel


# ── Nested schemas ───────────────────────────────────────────────────────────

class AuthorSchema(BaseModel):
    url: str | None = None
    name: str


class PublisherSchema(BaseModel):
    name: str


class SubjectSchema(BaseModel):
    name: str
    url: str | None = None


class CoverSchema(BaseModel):
    small: str | None = None
    medium: str | None = None
    large: str | None = None


# ── Book response schema ────────────────────────────────────────────────────

class BookRead(BaseModel):
    """What the API returns for a book."""

    id: UUID
    isbns: list[str] = []
    publish_dates: list[str] = []
    # None on manually-created books — they have no Open Library record.
    openbook_url: str | None = None
    openbook_key: str | None = None
    title: str
    subtitle: str | None = None
    description: str | None = None
    archive_id: str | None = None
    authors: list[AuthorSchema] = []
    number_of_pages: int | None = None
    by_statement: str | None = None
    identifiers: dict[str, list[str]] = {}
    publishers: list[PublisherSchema] = []
    publish_date: str | None = None
    subjects: list[SubjectSchema] = []
    covers: list[CoverSchema] = []
    source: str = "openlibrary"

    model_config = {"from_attributes": True}


# ── Manual book creation ────────────────────────────────────────────────────

class ManualBookCreate(BaseModel):
    """A book a user types in themselves, for when there's no copy to scan and
    no Open Library record to search. Only the title is required."""

    title: str
    subtitle: str | None = None
    authors: list[str] = []
    publishers: list[str] = []
    publish_date: str | None = None
    number_of_pages: int | None = None
    description: str | None = None
    isbns: list[str] = []
    subjects: list[str] = []
    by_statement: str | None = None
    # Storage key returned by /books/covers/presign, once the bytes are uploaded.
    cover_key: str | None = None
