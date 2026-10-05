"""
Response schemas for the JSON endpoints the React app (web/) reads.
Each mirrors what a Jinja page used to get as template context.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.schemas.book import BookRead
from app.schemas.user_book_image import UserBookImageRead


class CatalogEntry(BaseModel):
    """A book as anyone browsing the catalogue sees it."""

    book: BookRead
    # Handle of the person who typed a manual entry in; None for Open Library books.
    added_by: str | None = None
    # The viewer typed this manual entry in, so they may edit its details.
    can_edit: bool = False
    # Already on the viewer's shelf (always False for guests).
    on_shelf: bool = False


class ShelfEntry(BaseModel):
    """A book on someone's shelf, with that person's status, note and photos."""

    id: UUID  # the UserBook id
    status: str
    is_public: bool
    is_pinned: bool
    comment: str | None = None
    created_at: datetime
    images: list[UserBookImageRead] = []
    book: BookRead
    added_by: str | None = None
    can_edit: bool = False


class Haul(BaseModel):
    """Books added close together in time (see services/shelf.build_hauls)."""

    number: int  # oldest haul is 1
    heading: str  # one date, or a date range
    date_display: str
    total_pages: int
    user_book_ids: list[UUID]


class ShelfCounts(BaseModel):
    all: int
    reading: int
    read: int
    unread: int


class ShelfOwner(BaseModel):
    handle: str
    firstname: str
    lastname: str
    is_profile_public: bool


class ShelfRead(BaseModel):
    owner: ShelfOwner
    counts: ShelfCounts
    entries: list[ShelfEntry]  # pinned first, then newest
    hauls: list[Haul]  # newest first


class PublicShelfRead(ShelfRead):
    # Book ids already on the viewer's own shelf, for "Add" vs "On your shelf".
    viewer_book_ids: list[UUID] = []


class RecentPage(BaseModel):
    entries: list[CatalogEntry]
    # Pass back as ?offset= for the next page; None when there are no more.
    next_offset: int | None = None


class BookEntryRead(CatalogEntry):
    # The viewer's own shelf entry for this book, if they have it.
    shelf: ShelfEntry | None = None
