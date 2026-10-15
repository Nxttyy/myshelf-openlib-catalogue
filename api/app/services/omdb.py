"""
OMDb client: film search and lookup by IMDb ID.

Flow mirrors Open Library's: check the films table by IMDb ID → if missing
(or its ratings are a month old) → fetch from OMDb → persist → return.

The free OMDb key allows 1,000 requests a day, so every film is fetched
once and kept, and title searches are cached in memory for a day.
OMDb answers errors with HTTP 200 and {"Response": "False", "Error": ...};
those become OmdbNotFound or OmdbUnavailable here.
"""

import asyncio
import re
import time
from datetime import date, datetime, timedelta

import httpx
from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import settings
from app.models.film import Film

# Movies and series only; episodes and games aren't shelf material.
FILM_TYPES = {"movie", "series"}
REFRESH_AFTER = timedelta(days=30)
SEARCH_TTL_SECONDS = 24 * 3600
_IMDB_ID = re.compile(r"tt\d{7,8}")

_search_cache: dict[tuple[str, int], tuple[float, dict]] = {}
_SEARCH_CACHE_MAX = 500


class OmdbNotFound(Exception):
    pass


class OmdbUnavailable(Exception):
    """No key, bad key, quota used up, or OMDb unreachable."""


def omdb_configured() -> bool:
    return bool(settings.OMDB_API_KEY)


def require_omdb_configured() -> None:
    if not omdb_configured():
        raise HTTPException(status_code=503, detail="Film search isn't set up on this server.")


def parse_imdb_ids(text: str) -> list[str]:
    """Every IMDb ID in pasted text (IDs, links, a mix), in order, once each."""
    return list(dict.fromkeys(_IMDB_ID.findall(text or "")))


async def _get(params: dict) -> dict:
    if not omdb_configured():
        raise OmdbUnavailable("Film search isn't set up on this server.")
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            response = await client.get(settings.OMDB_BASE_URL, params={**params, "apikey": settings.OMDB_API_KEY})
    except httpx.RequestError as exc:
        raise OmdbUnavailable("Couldn't reach OMDb. Try again in a moment.") from exc
    try:
        data = response.json()
    except ValueError:
        data = {}
    if data.get("Response") == "True":
        return data
    error = str(data.get("Error") or f"OMDb returned {response.status_code}")
    low = error.lower()
    if "not found" in low or "incorrect imdb id" in low or "too many results" in low:
        raise OmdbNotFound(error)
    if "limit" in low:
        raise OmdbUnavailable("Film lookups are used up for today. Try again tomorrow.")
    raise OmdbUnavailable("Film search isn't working right now.")


def _na(value):
    """OMDb writes missing values as the string "N/A"."""
    if value is None:
        return None
    value = str(value).strip()
    return None if not value or value == "N/A" else value


def _int(value) -> int | None:
    value = _na(value)
    if value is None:
        return None
    digits = re.sub(r"[^\d]", "", value.split(" ")[0])
    return int(digits) if digits else None


def _released(value) -> date | None:
    value = _na(value)
    if value is None:
        return None
    try:
        return datetime.strptime(value, "%d %b %Y").date()
    except ValueError:
        return None


def film_fields(raw: dict) -> dict:
    """OMDb's ?i= payload → Film column values."""
    rating = _na(raw.get("imdbRating"))
    try:
        imdb_rating = float(rating) if rating else None
    except ValueError:
        imdb_rating = None
    return {
        "imdb_id": raw["imdbID"],
        "type": raw.get("Type") or "movie",
        "title": _na(raw.get("Title")) or raw["imdbID"],
        "year": _na(raw.get("Year")),
        "rated": _na(raw.get("Rated")),
        "released": _released(raw.get("Released")),
        "runtime_min": _int(raw.get("Runtime")),
        "genres": [g.strip() for g in (_na(raw.get("Genre")) or "").split(",") if g.strip()],
        "director": _na(raw.get("Director")),
        "writer": _na(raw.get("Writer")),
        "actors": _na(raw.get("Actors")),
        "plot": _na(raw.get("Plot")),
        "language": _na(raw.get("Language")),
        "country": _na(raw.get("Country")),
        "awards": _na(raw.get("Awards")),
        "poster_url": _na(raw.get("Poster")),
        "ratings": [
            {"source": r.get("Source"), "value": r.get("Value")}
            for r in raw.get("Ratings") or []
            if r.get("Source") and _na(r.get("Value"))
        ],
        "imdb_rating": imdb_rating,
        "imdb_votes": _int(raw.get("imdbVotes")),
        "raw": raw,
    }


async def fetch_film(imdb_id: str) -> dict:
    """Raw OMDb record for one IMDb ID. Raises OmdbNotFound for episodes and
    games too, since they can't go on a shelf."""
    raw = await _get({"i": imdb_id, "plot": "short"})
    if raw.get("Type") not in FILM_TYPES:
        raise OmdbNotFound(f"{imdb_id} isn't a film or a series.")
    return raw


async def prefetch_films(imdb_ids: list[str]) -> dict[str, dict | Exception]:
    """Fetch several IDs at once; each value is the raw record or the error."""
    results = await asyncio.gather(*(fetch_film(i) for i in imdb_ids), return_exceptions=True)
    return dict(zip(imdb_ids, results))


async def find_film(session: AsyncSession, imdb_id: str) -> Film | None:
    return (await session.exec(select(Film).where(Film.imdb_id == imdb_id))).first()


async def persist_film(session: AsyncSession, raw: dict) -> Film:
    """Insert or refresh the films row for an OMDb record."""
    fields = film_fields(raw)
    film = await find_film(session, fields["imdb_id"])
    if film is None:
        film = Film(**fields)
    else:
        for key, value in fields.items():
            setattr(film, key, value)
    film.fetched_at = datetime.utcnow()
    session.add(film)
    await session.commit()
    await session.refresh(film)
    return film


async def get_or_create_film(session: AsyncSession, imdb_id: str) -> Film:
    """The films row for an IMDb ID, fetching it from OMDb when it's new.
    A row whose ratings are over a month old is refreshed, but a failed
    refresh still returns the stored row."""
    film = await find_film(session, imdb_id)
    if film is not None:
        if datetime.utcnow() - film.fetched_at < REFRESH_AFTER:
            return film
        try:
            return await persist_film(session, await fetch_film(imdb_id))
        except (OmdbNotFound, OmdbUnavailable):
            return film
    return await persist_film(session, await fetch_film(imdb_id))


async def search_films(query: str, page: int = 1) -> dict:
    """Title search. OMDb returns 10 hits a page with title, year, type and
    poster only; director and runtime come with the full lookup."""
    key = (query.strip().lower(), page)
    hit = _search_cache.get(key)
    if hit and time.monotonic() - hit[0] < SEARCH_TTL_SECONDS:
        return hit[1]
    try:
        data = await _get({"s": query.strip(), "page": page})
        total = int(data.get("totalResults") or 0)
        results = [
            {
                "imdb_id": r["imdbID"],
                "title": r.get("Title") or r["imdbID"],
                "year": _na(r.get("Year")),
                "type": r.get("Type"),
                "poster_url": _na(r.get("Poster")),
            }
            for r in data.get("Search") or []
            if r.get("Type") in FILM_TYPES and r.get("imdbID")
        ]
    except OmdbNotFound:
        total, results = 0, []
    out = {"results": results, "total": total}
    if len(_search_cache) >= _SEARCH_CACHE_MAX:
        _search_cache.pop(next(iter(_search_cache)))
    _search_cache[key] = (time.monotonic(), out)
    return out
