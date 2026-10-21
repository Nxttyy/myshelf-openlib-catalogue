"""
Schemas for films (OMDb records) and films on someone's shelf.
Shapes mirror the book ones in schemas/web.py.
"""

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.user_book_image import UserBookImageRead
from app.schemas.web import ShelfOwner


class FilmRating(BaseModel):
    source: str  # "Internet Movie Database" | "Rotten Tomatoes" | "Metacritic"
    value: str  # "7.6/10" | "94%" | "81/100"


class FilmRead(BaseModel):
    id: UUID
    imdb_id: str
    type: str  # movie | series
    title: str
    year: str | None = None
    rated: str | None = None
    released: date | None = None
    runtime_min: int | None = None
    genres: list[str] = []
    director: str | None = None
    writer: str | None = None
    actors: str | None = None
    plot: str | None = None
    language: str | None = None
    country: str | None = None
    awards: str | None = None
    poster_url: str | None = None
    ratings: list[FilmRating] = []
    imdb_rating: float | None = None
    imdb_votes: int | None = None

    model_config = {"from_attributes": True}


class FilmSearchHit(BaseModel):
    """One OMDb search result. Search only carries these few fields; the
    rest arrive with /films/lookup."""

    imdb_id: str
    title: str
    year: str | None = None
    type: str
    poster_url: str | None = None
    # Already on the viewer's shelf (False for guests).
    on_shelf: bool = False


class FilmSearchPage(BaseModel):
    results: list[FilmSearchHit]
    total: int
    page: int


class FilmCatalogEntry(BaseModel):
    """A film as anyone browsing sees it."""

    film: FilmRead
    on_shelf: bool = False


class FilmShelfEntry(BaseModel):
    """A film on someone's shelf, with that person's status, note and photos."""

    id: UUID  # the UserFilm id
    status: str
    is_public: bool
    is_pinned: bool
    comment: str | None = None
    created_at: datetime
    images: list[UserBookImageRead] = []
    film: FilmRead


class FilmShelfCounts(BaseModel):
    all: int
    reading: int  # watching
    read: int  # watched
    unread: int  # not watched
    minutes_watched: int


class FilmShelfRead(BaseModel):
    owner: ShelfOwner
    counts: FilmShelfCounts
    entries: list[FilmShelfEntry]  # pinned first, then newest


class PublicFilmShelfRead(FilmShelfRead):
    # Film ids already on the viewer's own shelf, for "Add" vs "On your shelf".
    viewer_film_ids: list[UUID] = []


class FilmRecentPage(BaseModel):
    entries: list[FilmCatalogEntry]
    next_offset: int | None = None


class FilmEntryRead(FilmCatalogEntry):
    # The viewer's own shelf entry for this film, if they have it.
    shelf: FilmShelfEntry | None = None


class BatchUserFilmEntry(BaseModel):
    # Exactly one identifies the film: an IMDb ID (looked up via OMDb when
    # new) or a film already in our catalogue.
    imdb_id: str | None = None
    film_id: UUID | None = None
    status: str = "unread"
    is_public: bool = True


class BatchUserFilmRequest(BaseModel):
    entries: list[BatchUserFilmEntry] = Field(max_length=50)


class BatchUserFilmResult(BaseModel):
    added: int
    errors: list[str]


class UpdateUserFilmRequest(BaseModel):
    status: str | None = None
    is_public: bool | None = None
    comment: str | None = None
    is_pinned: bool | None = None


class FilmListSearchRequest(BaseModel):
    # Characters, not lines: one pasted line can hold thirty titles.
    text: str = Field(min_length=2, max_length=20_000)


class FilmListRow(BaseModel):
    """One film named in a pasted list, with what it matched."""

    line: int  # the pasted line it came from, numbered from 1
    text: str  # what the user wrote for it
    film: FilmRead | None = None  # None: no match
    on_shelf: bool = False
    dup: bool = False  # the same film appeared earlier in the list
    guessed: bool = False  # inferred from a description, not named
    error: str | None = None  # why it wasn't looked up (quota, OMDb down)


class FilmListJob(BaseModel):
    status: str  # reading | matching | done | failed
    total: int  # films to match, known once reading is done
    done: int
    rows: list[FilmListRow] = []
    error: str | None = None
