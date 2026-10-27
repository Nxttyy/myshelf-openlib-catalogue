"""
Link-preview cards (og:image) for shared links. See services/share.py for
which links get one, and services/og_card.py for the drawing.

The bucket is private and presigned URLs expire within the hour, while chat
apps and social sites keep a preview image for days, so cards are served
from here at a stable address. The `v` query param the page tags add is a
fingerprint of the card's content: a changed card gets a new URL, and each
URL's image can be cached for a long time.
"""

import hashlib
import logging
from uuid import UUID

import httpx
from fastapi import APIRouter, HTTPException, Response
from fastapi.concurrency import run_in_threadpool

from app.config import settings
from app.db import SessionDep
from app.services import og_card, storage
from app.services.share import Shared, bigger_poster, cover_source, resolve, resolve_photo, site_name

router = APIRouter(prefix="/og", tags=["Link previews"])
log = logging.getLogger(__name__)

FETCH_TIMEOUT = 6.0
CACHE_HEADERS = {"Cache-Control": "public, max-age=604800"}


async def _fetch(source: str | None) -> bytes | None:
    """A cover or poster's bytes, from the bucket or the web. None on any
    failure: the card then draws the typographic jacket instead."""
    if not source:
        return None
    if source.startswith("s3:"):
        return await run_in_threadpool(storage.get_bytes, source[3:]) if storage.storage_configured() else None
    async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=True) as client:
        for url in filter(None, (bigger_poster(source), source)):
            try:
                r = await client.get(url, headers={"User-Agent": f"Dora ({settings.CONTACT_EMAIL})"})
            except httpx.HTTPError:
                continue
            if r.status_code == 200 and r.headers.get("content-type", "").startswith("image/"):
                return r.content
    return None


async def _render(shared: Shared) -> tuple[bytes, bool]:
    """The card, and whether it's the finished one: False when an image it
    should show couldn't be fetched, so a passing failure isn't cached."""
    card = shared.card()
    source = cover_source(shared)
    card.cover = await _fetch(source)
    complete = card.cover is not None or source is None
    site = site_name()
    if shared.photo:
        photo = await run_in_threadpool(storage.get_bytes, shared.photo.s3_key)
        if photo:
            data = await run_in_threadpool(og_card.photo_card, photo, card, site)
            if data:
                return data, complete
        # unreadable (HEIC, say) or gone: the plain card still beats nothing
    return await run_in_threadpool(og_card.entry_card, card, site), complete


async def _card(shared: Shared | None) -> Response:
    """The card, drawn once per fingerprint and kept in the bucket after."""
    if shared is None:
        raise HTTPException(status_code=404, detail="Nothing to preview")
    cached = storage.storage_configured()
    key = "og/" + hashlib.sha1(f"{shared.fingerprint()}:{shared.handle}".encode()).hexdigest() + ".jpg"
    data = await run_in_threadpool(storage.get_bytes, key) if cached else None
    if data is None:
        data, complete = await _render(shared)
        if cached and complete:
            try:
                await run_in_threadpool(storage.put_bytes, key, data, "image/jpeg")
            except Exception:
                log.warning("couldn't cache preview card %s", key, exc_info=True)
    return Response(data, media_type="image/jpeg", headers=CACHE_HEADERS)


def _id(raw: str) -> UUID:
    try:
        return UUID(raw.removesuffix(".jpg"))
    except ValueError:
        raise HTTPException(status_code=404, detail="Nothing to preview")


@router.api_route("/book/{book_id}", methods=["GET", "HEAD"])
async def book_card(book_id: str, session: SessionDep, u: str | None = None):
    """A book's card; with ?u=<handle>, that person's public copy of it."""
    return await _card(await resolve(session, "book", _id(book_id), u))


@router.api_route("/film/{film_id}", methods=["GET", "HEAD"])
async def film_card(film_id: str, session: SessionDep, u: str | None = None):
    return await _card(await resolve(session, "film", _id(film_id), u))


@router.api_route("/photo/{image_id}", methods=["GET", "HEAD"])
async def photo_card(image_id: str, session: SessionDep):
    """A photo from a public note, with its book or film beside it."""
    return await _card(await resolve_photo(session, _id(image_id)))
