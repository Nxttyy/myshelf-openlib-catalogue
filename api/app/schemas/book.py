"""
Pydantic schemas for Book — used for API request/response validation.
Separate from the SQLModel DB model.
"""

from typing import Any
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

class SourceLinkSchema(BaseModel):
    provider: str  # "openlibrary", "google", ...
    url: str


class BookRead(BaseModel):
    """What the API returns for a book: the fields merged from all its sources."""

    id: UUID
    # ISBN-13s first, then ISBN-10s.
    isbns: list[str] = []
    title: str
    subtitle: str | None = None
    description: str | None = None
    authors: list[AuthorSchema] = []
    number_of_pages: int | None = None
    by_statement: str | None = None
    language: str | None = None
    # scheme → values: isbn_13, isbn_10, openlibrary, openlibrary_work, google,
    # goodreads, librarything, oclc, lccn, wikidata, archive, ...
    identifiers: dict[str, list[str]] = {}
    publishers: list[PublisherSchema] = []
    publish_date: str | None = None
    subjects: list[SubjectSchema] = []
    covers: list[CoverSchema] = []
    # Fields without a column of their own, e.g. rating {average, count,
    # source}, preview_url, reader_url, classifications, dimensions.
    extra: dict[str, Any] = {}
    # Where this book's records came from, best first. Empty for manual books.
    source_links: list[SourceLinkSchema] = []
    # Where the book was first created from: "openlibrary", "google", "manual".
    source: str = "openlibrary"

    model_config = {"from_attributes": True}


# ── Manual book creation ────────────────────────────────────────────────────

class ManualBookCreate(BaseModel):
    """A book a user types in themselves, for when there's no copy to scan and
    no provider has a record of it. Only the title is required."""

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
