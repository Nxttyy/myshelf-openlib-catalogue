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
    openbook_url: str
    openbook_key: str
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

    model_config = {"from_attributes": True}
