"""
Films: OMDb search and lookup, your film shelf, and everyone's recent films.
Same model as books (routers/book.py + routers/web.py), fed by OMDb.

Routes with a fixed path (/films/search, /films/recent, /films/user_films...)
are declared before /films/{film_id}/... so they aren't read as an id.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import select

from app.auth import get_current_user, require_user
from app.db import SessionDep
from app.models.film import Film
from app.models.user import User
from app.models.user_film import UserFilm
from app.schemas.film import (
    BatchUserFilmRequest,
    BatchUserFilmResult,
    FilmCatalogEntry,
    FilmEntryRead,
    FilmListJob,
    FilmListSearchRequest,
    FilmRead,
    FilmRecentPage,
    FilmSearchHit,
    FilmSearchPage,
    FilmShelfCounts,
    FilmShelfEntry,
    FilmShelfRead,
    PublicFilmShelfRead,
    UpdateUserFilmRequest,
)
from app.schemas.user_book_image import PresignBatchRequest, PresignedUpload, UserBookImageRead
from app.schemas.web import ShelfOwner
from app.services import film_list, omdb, photos

router = APIRouter(prefix="/films", tags=["Films"])
# /profiles/{handle}/films sits next to the book profile route.
profiles_router = APIRouter(tags=["Films"])

VALID_STATUSES = {"unread", "reading", "read"}
RECENT_PAGE_SIZE = 50


def _handle(user: User) -> str:
    return user.username or user.email.split("@")[0]


def _owner(user: User) -> ShelfOwner:
    return ShelfOwner(
        handle=_handle(user),
        firstname=user.firstname,
        lastname=user.lastname,
        is_profile_public=user.is_profile_public,
    )


async def _viewer_film_ids(session: SessionDep, viewer: User | None) -> set[UUID]:
    if viewer is None:
        return set()
    rows = await session.exec(select(UserFilm.film_id).where(UserFilm.user_id == viewer.id))
    return set(rows.all())


def _entry(uf: UserFilm, film: Film, images: list) -> FilmShelfEntry:
    return FilmShelfEntry(
        id=uf.id, status=uf.status, is_public=uf.is_public, is_pinned=uf.is_pinned,
        comment=uf.comment, created_at=uf.created_at, images=images,
        film=FilmRead.model_validate(film),
    )


async def _shelf_for(session: SessionDep, owner: User, public_only: bool) -> tuple[FilmShelfCounts, list[FilmShelfEntry]]:
    stmt = (
        select(UserFilm, Film)
        .join(Film, UserFilm.film_id == Film.id)
        .where(UserFilm.user_id == owner.id)
        .order_by(UserFilm.is_pinned.desc(), UserFilm.created_at.desc())
    )
    if public_only:
        stmt = stmt.where(UserFilm.is_public == True)  # noqa: E712
    items = [{"user_film": uf, "film": f} for uf, f in (await session.exec(stmt)).all()]
    await photos.attach(session, "user_film_id", items, "user_film")
    entries = [_entry(item["user_film"], item["film"], item["images"]) for item in items]

    reading = sum(1 for e in entries if e.status == "reading")
    watched = [e for e in entries if e.status == "read"]
    counts = FilmShelfCounts(
        all=len(entries), reading=reading, read=len(watched),
        unread=len(entries) - reading - len(watched),
        minutes_watched=sum(e.film.runtime_min or 0 for e in watched),
    )
    return counts, entries


# ── OMDb ─────────────────────────────────────────────────────────────────────

@router.get("/search", response_model=FilmSearchPage)
async def search_films(
    session: SessionDep,
    q: Annotated[str, Query(min_length=2, description="Film or series title")],
    page: Annotated[int, Query(ge=1, le=20)] = 1,
    viewer: User | None = Depends(get_current_user),
):
    """Title search via OMDb, 10 results a page. Searching by director or
    actor isn't something OMDb does."""
    omdb.require_omdb_configured()
    try:
        found = await omdb.search_films(q, page)
    except omdb.OmdbUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    owned: set[str] = set()
    if viewer is not None and found["results"]:
        owned = set((await session.exec(
            select(Film.imdb_id)
            .join(UserFilm, UserFilm.film_id == Film.id)
            .where(UserFilm.user_id == viewer.id, Film.imdb_id.in_([r["imdb_id"] for r in found["results"]]))
        )).all())
    return FilmSearchPage(
        results=[FilmSearchHit(**r, on_shelf=r["imdb_id"] in owned) for r in found["results"]],
        total=found["total"],
        page=page,
    )


@router.get("/lookup/{imdb_id:path}", response_model=FilmCatalogEntry)
async def lookup_film(
    imdb_id: str,
    session: SessionDep,
    viewer: User | None = Depends(get_current_user),
):
    """One film by IMDb ID (or an IMDb link). Checks the catalogue first,
    otherwise fetches it from OMDb and keeps it."""
    ids = omdb.parse_imdb_ids(imdb_id)
    if not ids:
        raise HTTPException(status_code=422, detail="That doesn't look like an IMDb ID. It starts with tt.")
    try:
        film = await omdb.get_or_create_film(session, ids[0])
    except omdb.OmdbNotFound:
        raise HTTPException(status_code=404, detail=f"No film found for {ids[0]}. Check the ID.")
    except omdb.OmdbUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return FilmCatalogEntry(
        film=FilmRead.model_validate(film),
        on_shelf=film.id in await _viewer_film_ids(session, viewer),
    )


@router.post("/list-search")
async def start_list_search(request_data: FilmListSearchRequest, me: User = Depends(require_user)):
    """Find every film in a pasted list. Returns a job id to poll: reading a
    long list and matching each title takes a while."""
    omdb.require_omdb_configured()
    try:
        return {"job_id": film_list.start(str(me.id), request_data.text)}
    except film_list.ListTooLong:
        raise HTTPException(status_code=413, detail="That list is too long. Paste it in parts.")


@router.get("/list-search/{job_id}", response_model=FilmListJob)
async def poll_list_search(job_id: str, me: User = Depends(require_user)):
    job = film_list.get(job_id, str(me.id))
    if job is None:
        raise HTTPException(status_code=404, detail="That search has expired. Search again.")
    return FilmListJob(status=job.status, total=job.total, done=job.done, rows=job.rows, error=job.error)


# ── Catalogue ────────────────────────────────────────────────────────────────

@router.get("/recent", response_model=FilmRecentPage)
async def recent_films(
    session: SessionDep,
    offset: int = Query(0, ge=0),
    viewer: User | None = Depends(get_current_user),
):
    """Newest films across Dora, a page at a time (Explore, and the home page).
    Only films someone has on a public shelf."""
    public = select(UserFilm.film_id).where(UserFilm.is_public == True)  # noqa: E712
    films = (await session.exec(
        select(Film)
        .where(Film.id.in_(public))
        .order_by(Film.created_at.desc())  # type: ignore[attr-defined]
        .offset(offset)
        .limit(RECENT_PAGE_SIZE + 1)
    )).all()
    has_more = len(films) > RECENT_PAGE_SIZE
    films = films[:RECENT_PAGE_SIZE]
    on_shelf = await _viewer_film_ids(session, viewer)
    return FilmRecentPage(
        entries=[FilmCatalogEntry(film=FilmRead.model_validate(f), on_shelf=f.id in on_shelf) for f in films],
        next_offset=offset + RECENT_PAGE_SIZE if has_more else None,
    )


# ── Your shelf ───────────────────────────────────────────────────────────────

@router.get("/user_films", response_model=FilmShelfRead)
async def my_film_shelf(session: SessionDep, me: User = Depends(require_user)):
    """The signed-in user's films, including private ones."""
    counts, entries = await _shelf_for(session, me, public_only=False)
    return FilmShelfRead(owner=_owner(me), counts=counts, entries=entries)


@router.post("/user_films/batch", response_model=BatchUserFilmResult)
async def batch_add_user_films(
    session: SessionDep,
    request_data: BatchUserFilmRequest,
    current_user: User = Depends(require_user),
):
    """Save the add dialog's queue. New IMDb IDs are fetched from OMDb all at
    once; each entry then commits on its own, so one bad ID can't drop the
    rest."""
    user_id = current_user.id  # read before commits expire current_user

    ids_by_index: dict[int, str] = {}
    for i, entry in enumerate(request_data.entries):
        if entry.film_id is None and entry.imdb_id:
            found = omdb.parse_imdb_ids(entry.imdb_id)
            if found:
                ids_by_index[i] = found[0]
    known: dict[str, UUID] = {}
    misses: list[str] = []
    for imdb_id in dict.fromkeys(ids_by_index.values()):
        film = await omdb.find_film(session, imdb_id)
        if film is not None:
            known[imdb_id] = film.id
        else:
            misses.append(imdb_id)
    fetched = await omdb.prefetch_films(misses)

    added = 0
    errors: list[str] = []
    for i, entry in enumerate(request_data.entries):
        label = entry.imdb_id or str(entry.film_id)
        try:
            if entry.film_id is not None:
                film_id = entry.film_id
                if await session.get(Film, film_id) is None:
                    errors.append(f"Couldn't find {label}")
                    continue
            elif i in ids_by_index:
                imdb_id = ids_by_index[i]
                if imdb_id not in known:
                    raw = fetched[imdb_id]
                    if isinstance(raw, Exception):
                        raise raw
                    known[imdb_id] = (await omdb.persist_film(session, raw)).id
                film_id = known[imdb_id]
            else:
                errors.append(f"{label}: not an IMDb ID")
                continue

            existing = (await session.exec(
                select(UserFilm).where(UserFilm.user_id == user_id, UserFilm.film_id == film_id)
            )).first()
            if existing is not None:
                continue
            session.add(UserFilm(
                user_id=user_id, film_id=film_id, is_public=entry.is_public,
                status=entry.status if entry.status in VALID_STATUSES else "unread",
            ))
            await session.commit()
            added += 1
        except omdb.OmdbNotFound:
            await session.rollback()
            errors.append(f"No film found for {label}")
        except omdb.OmdbUnavailable as exc:
            await session.rollback()
            errors.append(f"{label}: {exc}")
        except Exception as exc:
            await session.rollback()
            errors.append(f"Couldn't add {label}")
            print(f"Error adding film {label}: {exc}")
    return BatchUserFilmResult(added=added, errors=errors)


@router.post("/user_films/add/{film_id}")
async def add_film_to_shelf(
    film_id: UUID,
    session: SessionDep,
    current_user: User = Depends(require_user),
):
    """Add a film that's already in the catalogue (from Explore or a profile)."""
    if await session.get(Film, film_id) is None:
        raise HTTPException(status_code=404, detail="Film not found")
    existing = (await session.exec(
        select(UserFilm).where(UserFilm.user_id == current_user.id, UserFilm.film_id == film_id)
    )).first()
    if existing:
        return {"ok": True, "already": True}
    session.add(UserFilm(user_id=current_user.id, film_id=film_id, is_public=True, status="unread"))
    await session.commit()
    return {"ok": True, "already": False}


async def _owned_user_film(session: SessionDep, user_film_id: UUID, user: User) -> UserFilm:
    uf = await session.get(UserFilm, user_film_id)
    if not uf or uf.user_id != user.id:
        raise HTTPException(status_code=404, detail="Film not found in your library")
    return uf


@router.patch("/user_films/{user_film_id}")
async def update_user_film(
    user_film_id: UUID,
    request_data: UpdateUserFilmRequest,
    session: SessionDep,
    current_user: User = Depends(require_user),
):
    uf = await _owned_user_film(session, user_film_id, current_user)
    if request_data.status is not None:
        if request_data.status not in VALID_STATUSES:
            raise HTTPException(status_code=422, detail=f"status must be one of {VALID_STATUSES}")
        uf.status = request_data.status
    if request_data.is_public is not None:
        uf.is_public = request_data.is_public
    if request_data.comment is not None:
        uf.comment = request_data.comment
    if request_data.is_pinned is not None:
        if request_data.is_pinned:
            # One pinned film at a time, like books.
            others = (await session.exec(select(UserFilm).where(
                UserFilm.user_id == current_user.id,
                UserFilm.is_pinned == True,  # noqa: E712
                UserFilm.id != user_film_id,
            ))).all()
            for other in others:
                other.is_pinned = False
                session.add(other)
        uf.is_pinned = request_data.is_pinned
    session.add(uf)
    await session.commit()
    return {"ok": True}


@router.post("/user_films/{user_film_id}/images/presign", response_model=list[PresignedUpload])
async def presign_user_film_images(
    user_film_id: UUID,
    request_data: PresignBatchRequest,
    session: SessionDep,
    current_user: User = Depends(require_user),
):
    await _owned_user_film(session, user_film_id, current_user)
    return await photos.presign(session, "user_film_id", user_film_id, request_data)


@router.post("/user_films/{user_film_id}/images/{image_id}/confirm", response_model=UserBookImageRead)
async def confirm_user_film_image(
    user_film_id: UUID,
    image_id: UUID,
    session: SessionDep,
    current_user: User = Depends(require_user),
):
    await _owned_user_film(session, user_film_id, current_user)
    return await photos.confirm(session, "user_film_id", user_film_id, image_id)


@router.delete("/user_films/{user_film_id}/images/{image_id}")
async def delete_user_film_image(
    user_film_id: UUID,
    image_id: UUID,
    session: SessionDep,
    current_user: User = Depends(require_user),
):
    await _owned_user_film(session, user_film_id, current_user)
    await photos.delete(session, "user_film_id", user_film_id, image_id)
    return {"ok": True}


# ── One film ─────────────────────────────────────────────────────────────────

@router.get("/{film_id}/entry", response_model=FilmEntryRead)
async def film_entry(
    film_id: UUID,
    session: SessionDep,
    viewer: User | None = Depends(get_current_user),
):
    """One film with the viewer's context, so a shared ?film= link opens
    its record directly."""
    film = await session.get(Film, film_id)
    if not film:
        raise HTTPException(status_code=404, detail="Film not found")
    shelf = None
    if viewer is not None:
        uf = (await session.exec(
            select(UserFilm).where(UserFilm.user_id == viewer.id, UserFilm.film_id == film_id)
        )).first()
        if uf is not None:
            item = {"user_film": uf}
            await photos.attach(session, "user_film_id", [item], "user_film")
            shelf = _entry(uf, film, item["images"])
    return FilmEntryRead(film=FilmRead.model_validate(film), on_shelf=shelf is not None, shelf=shelf)


@profiles_router.get("/profiles/{handle}/films", response_model=PublicFilmShelfRead)
async def public_film_shelf(
    handle: str,
    session: SessionDep,
    viewer: User | None = Depends(get_current_user),
):
    """Someone's public films. 404 when the handle doesn't exist or the
    profile is private, same as their books."""
    owner = (await session.exec(select(User).where(User.username == handle))).first()
    if not owner or not owner.is_profile_public:
        raise HTTPException(status_code=404, detail="This shelf is private or doesn't exist.")
    counts, entries = await _shelf_for(session, owner, public_only=True)
    return PublicFilmShelfRead(
        owner=_owner(owner), counts=counts, entries=entries,
        viewer_film_ids=sorted(await _viewer_film_ids(session, viewer), key=str),
    )
