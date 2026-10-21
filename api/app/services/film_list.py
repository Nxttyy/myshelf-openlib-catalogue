"""
Pasted film lists → films. Runs as a background job the add dialog polls.

1. Read: the Film List Parser workflow turns the text into structured items
   ({line, title, alt_title, year, type, imdb_id, confidence}). Long lists go
   in chunks of about 4,000 characters, all at once. Without the workflow,
   or if it fails, a plain one-title-per-line parser does the job.
2. Match: each item becomes a film. Our films table first (by IMDb ID or
   normalized title), then film_title_lookups (what OMDb said last time,
   misses included), and only then OMDb: ?t= (one request, full record),
   falling back to ?s=. OMDb's free key allows 1,000 requests a day, so a
   user gets at most DAILY_LOOKUPS_PER_USER of them for lists.

Jobs live in memory for JOB_TTL_SECONDS; fine for one server process.
"""

import asyncio
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

import httpx
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db import engine
from app.models.film import Film
from app.models.film_title_lookup import FilmTitleLookup
from app.models.user_film import UserFilm
from app.schemas.film import FilmRead
from app.services import dora, omdb

MAX_CHARS = 12_000
CHUNK_CHARS = 4_000
LOOKUP_CONCURRENCY = 5
DAILY_LOOKUPS_PER_USER = 600
MISS_TTL = timedelta(days=7)
JOB_TTL_SECONDS = 15 * 60
POLL_EVERY_SECONDS = 3
POLL_CAP_SECONDS = 150

_IMDB_ID = re.compile(r"tt\d{7,8}")
_YEAR_AT_END = re.compile(r"[(,]\s*((?:19|20)\d{2})\)?\s*$")
_BULLET = re.compile(r"^(\d+[.)]\s+|[-*•]\s+)")
_RATING = re.compile(r"[★☆½]+|\s\d+(\.\d)?/(5|10)\b")


class ListTooLong(Exception):
    pass


@dataclass
class Item:
    line: int
    text: str  # what the user wrote for it
    title: str = ""
    alt_title: str | None = None
    year: str | None = None
    type: str | None = None
    imdb_id: str | None = None
    guessed: bool = False  # inferred from a description, not named
    missing: bool = False  # a line the parser couldn't read as a film


# ── Lines and chunks ─────────────────────────────────────────────────────────

def number_lines(text: str) -> list[tuple[int, str]]:
    """Non-empty lines, numbered from 1. A single line with ; or " | "
    between titles counts as several lines."""
    lines = [s.strip() for s in text.splitlines() if s.strip()]
    if len(lines) == 1 and re.search(r";|\s\|\s", lines[0]):
        lines = [s.strip() for s in re.split(r";|\s\|\s", lines[0]) if s.strip()]
    return list(enumerate(lines, start=1))


def _split_long(text: str, limit: int) -> list[str]:
    """Cut a line longer than `limit` at the last , ; or . before it."""
    parts = []
    while len(text) > limit:
        cut = max(text.rfind(c, 0, limit) for c in ",;.")
        cut = cut + 1 if cut > 0 else limit
        parts.append(text[:cut].strip())
        text = text[cut:].strip()
    return parts + [text] if text else parts


def chunk_lines(lines: list[tuple[int, str]]) -> list[str]:
    """The parser's input, "L1: ..." per line, in chunks of about
    CHUNK_CHARS characters that never split a line (an over-long line is
    cut into pieces that keep its number)."""
    chunks, current, size = [], [], 0
    for n, text in lines:
        for piece in _split_long(text, CHUNK_CHARS - 20):
            row = f"L{n}: {piece}"
            if current and size + len(row) + 1 > CHUNK_CHARS:
                chunks.append("\n".join(current))
                current, size = [], 0
            current.append(row)
            size += len(row) + 1
    if current:
        chunks.append("\n".join(current))
    return chunks


def fallback_items(lines: list[tuple[int, str]]) -> list[Item]:
    """One title per line: bullets and rank numbers dropped, a trailing
    (1953) or , 1953 read as the year, an IMDb ID or link used as is."""
    items = []
    for n, text in lines:
        ids = _IMDB_ID.findall(text)
        if ids:
            items.append(Item(line=n, text=text, imdb_id=ids[0]))
            continue
        clean = _RATING.sub("", _BULLET.sub("", text)).strip()
        year = None
        m = _YEAR_AT_END.search(clean)
        if m:
            year, clean = m.group(1), clean[: m.start()].strip()
        items.append(Item(line=n, text=text, title=clean, year=year))
    return items


def _items_from_output(raw: dict, lines: dict[int, str]) -> list[Item]:
    """The parser's JSON → items, checked against what the user pasted:
    unknown line numbers are dropped, and an IMDb ID only counts if it is
    really in that line (the agent must never invent one)."""
    items: list[Item] = []
    for it in raw.get("items") or []:
        if not isinstance(it, dict):
            continue
        try:
            n = int(it.get("line"))
        except (TypeError, ValueError):
            continue
        if n not in lines:
            continue
        imdb_id = it.get("imdb_id") if isinstance(it.get("imdb_id"), str) else None
        if imdb_id and imdb_id not in _IMDB_ID.findall(lines[n]):
            imdb_id = None
        title = str(it.get("title") or "").strip()[:200]
        if not title and not imdb_id:
            continue
        year = str(it.get("year") or "").strip()
        year = year if re.fullmatch(r"(18|19|20)\d{2}", year) else None
        kind = it.get("type") if it.get("type") in omdb.FILM_TYPES else None
        alt = str(it.get("alt_title") or "").strip()[:200] or None
        items.append(Item(
            line=n, text=str(it.get("source") or lines[n])[:300], title=title, alt_title=alt,
            # a pasted IMDb ID is never a guess, whatever the parser says
            year=year, type=kind, imdb_id=imdb_id, guessed=not imdb_id and it.get("confidence") == "low",
        ))
    # Lines the parser couldn't read, and lines it skipped without saying
    # why, show as "no match" so nothing the user pasted silently vanishes.
    ignored = {}
    for ig in raw.get("ignored") or []:
        try:
            ignored[int(ig.get("line"))] = ig.get("reason")
        except (TypeError, ValueError, AttributeError):
            continue
    # A pasted IMDb ID is never lost, even when the parser skipped its line.
    covered = {i.line for i in items}
    for n, text in lines.items():
        if n in covered:
            continue
        ids = _IMDB_ID.findall(text)
        if ids:
            items.append(Item(line=n, text=text, imdb_id=ids[0]))
        elif ignored.get(n, "unclear") == "unclear":
            items.append(Item(line=n, text=text, missing=True))
    return sorted(items, key=lambda i: i.line)  # stable: keeps order within a line


async def _parse_chunk(chunk: str, lines: dict[int, str]) -> list[Item]:
    """Run the parser on one chunk; falls back to one title per line."""
    mine = {n: lines[n] for n in map(int, re.findall(r"^L(\d+):", chunk, re.M))}
    try:
        run_id = await dora.trigger(dora.LIST, f"LIST:\n{chunk}")
        deadline = time.monotonic() + POLL_CAP_SECONDS
        while time.monotonic() < deadline:
            await asyncio.sleep(POLL_EVERY_SECONDS)
            status, output = await dora.fetch_run(dora.LIST, run_id)
            if status == "completed":
                raw = dora.extract_json(output)
                if raw is not None and isinstance(raw.get("items"), list):
                    return _items_from_output(raw, mine)
                break
            if status == "failed":
                break
    except (httpx.HTTPError, dora.DoraError) as exc:
        print(f"Film list parser unavailable: {exc}")
    return fallback_items(sorted(mine.items()))


async def read_list(lines: list[tuple[int, str]]) -> list[Item]:
    if not dora.is_configured(dora.LIST):
        return fallback_items(lines)
    by_n = dict(lines)
    parts = await asyncio.gather(*(_parse_chunk(c, by_n) for c in chunk_lines(lines)))
    return sorted((i for p in parts for i in p), key=lambda i: i.line)


# ── Matching ─────────────────────────────────────────────────────────────────

_lookups_today: dict[tuple[str, date], int] = {}


class QuotaUsed(Exception):
    pass


def _best_hit(hits: list[dict], norm: str, year: str | None) -> dict | None:
    """The search hit whose title matches best; None when no title is even
    close (OMDb's search is loose, and a wrong film is worse than none)."""
    def score(h: dict) -> int:
        t = omdb.norm_title(h["title"])
        s = 3 if t == norm else 2 if t.startswith(norm) else 1 if norm in t or t in norm else 0
        return s + (1 if s and year and (h.get("year") or "").startswith(year) else 0)
    scored = [(score(h), i, h) for i, h in enumerate(hits)]
    scored = [x for x in scored if x[0] > 0]
    return max(scored, key=lambda x: (x[0], -x[1]))[2] if scored else None


class Matcher:
    """Turns items into films for one user's job, LOOKUP_CONCURRENCY at a
    time. The same title asked twice in one list is matched once."""

    def __init__(self, user_id: str):
        self.user_id = user_id
        self.sem = asyncio.Semaphore(LOOKUP_CONCURRENCY)
        self.memo: dict[tuple, asyncio.Task] = {}

    async def _omdb(self, call):
        key = (self.user_id, date.today())
        if _lookups_today.get(key, 0) >= DAILY_LOOKUPS_PER_USER:
            raise QuotaUsed("You've looked up a lot of films today. Try the rest tomorrow.")
        _lookups_today[key] = _lookups_today.get(key, 0) + 1
        return await call

    async def _persist(self, session: AsyncSession, raw: dict) -> Film:
        try:
            return await omdb.persist_film(session, raw)
        except IntegrityError:  # another lookup saved the same film first
            await session.rollback()
            return await omdb.find_film(session, raw["imdbID"])

    async def _by_id(self, session: AsyncSession, imdb_id: str) -> Film | None:
        film = await omdb.find_film(session, imdb_id)
        if film is not None:
            return film
        try:
            return await self._persist(session, await self._omdb(omdb.fetch_film(imdb_id)))
        except omdb.OmdbNotFound:
            return None

    async def _remember(self, session: AsyncSession, norm: str, year: str, kind: str, imdb_id: str | None):
        stmt = insert(FilmTitleLookup).values(
            id=uuid.uuid4(), title_norm=norm, year=year, type=kind, imdb_id=imdb_id, checked_at=datetime.utcnow(),
        ).on_conflict_do_update(
            constraint="uq_film_title_lookups_key", set_={"imdb_id": imdb_id, "checked_at": datetime.utcnow()},
        )
        await session.exec(stmt)
        await session.commit()

    async def _by_title(self, session: AsyncSession, title: str, year: str | None, kind: str | None) -> Film | None:
        norm = omdb.norm_title(title)
        if len(norm) < 2:
            return None

        # a. films we already have
        stmt = select(Film).where(Film.title_norm == norm)
        if kind:
            stmt = stmt.where(Film.type == kind)
        known = (await session.exec(stmt)).all()
        if year:
            known = [f for f in known if (f.year or "").startswith(year)]
        if len(known) == 1 or (known and year):
            return known[0]

        # b. what OMDb said last time
        seen = (await session.exec(select(FilmTitleLookup).where(
            FilmTitleLookup.title_norm == norm,
            FilmTitleLookup.year == (year or ""),
            FilmTitleLookup.type == (kind or ""),
        ))).first()
        if seen is not None:
            if seen.imdb_id:
                return await self._by_id(session, seen.imdb_id)
            if datetime.utcnow() - seen.checked_at < MISS_TTL:
                return None

        # c. OMDb: exact title, then a search
        film = None
        try:
            film = await self._persist(session, await self._omdb(omdb.fetch_by_title(title, year, kind)))
        except omdb.OmdbNotFound:
            hits = await self._omdb(omdb.search_titles(title, year, kind))
            if not hits and year:  # the year in the list may be off by one
                hits = await self._omdb(omdb.search_titles(title, None, kind))
            best = _best_hit(hits, norm, year)
            if best:
                film = await self._by_id(session, best["imdb_id"])
        await self._remember(session, norm, year or "", kind or "", film.imdb_id if film else None)
        return film

    async def _match(self, item: Item) -> Film | None:
        async with self.sem, AsyncSession(engine, expire_on_commit=False) as session:
            if item.imdb_id:
                return await self._by_id(session, item.imdb_id)
            seen = set()
            for title in (item.title, item.alt_title):
                if not title or omdb.norm_title(title) in seen:
                    continue
                seen.add(omdb.norm_title(title))
                film = await self._by_title(session, title, item.year, item.type)
                if film is not None:
                    return film
            return None

    def match(self, item: Item) -> asyncio.Task:
        key = (item.imdb_id,) if item.imdb_id else (
            omdb.norm_title(item.title), omdb.norm_title(item.alt_title or ""), item.year, item.type)
        if key not in self.memo:
            self.memo[key] = asyncio.ensure_future(self._match(item))
        return self.memo[key]


# ── Jobs ─────────────────────────────────────────────────────────────────────

@dataclass
class Job:
    user_id: str
    status: str = "reading"  # reading → matching → done | failed
    total: int = 0
    done: int = 0
    rows: list[dict] = field(default_factory=list)
    error: str | None = None
    created: float = field(default_factory=time.monotonic)


_jobs: dict[str, Job] = {}
_tasks: set[asyncio.Task] = set()  # keeps running jobs from being garbage collected


async def _owned_imdb_ids(user_id: str) -> set[str]:
    async with AsyncSession(engine) as session:
        rows = await session.exec(
            select(Film.imdb_id).join(UserFilm, UserFilm.film_id == Film.id).where(UserFilm.user_id == uuid.UUID(user_id))
        )
        return set(rows.all())


async def _run(job: Job, lines: list[tuple[int, str]]) -> None:
    try:
        items = await read_list(lines)
        job.status = "matching"
        wanted = [i for i in items if not i.missing]
        job.total = len(wanted)
        matcher = Matcher(job.user_id)

        async def one(item: Item):
            try:
                return await matcher.match(item), None
            except QuotaUsed as exc:
                return None, str(exc)
            except omdb.OmdbUnavailable as exc:
                return None, str(exc)
            finally:
                job.done += 1

        results = await asyncio.gather(*(one(i) for i in wanted))
        found = dict(zip(map(id, wanted), results))
        owned = await _owned_imdb_ids(job.user_id)
        seen: set[str] = set()
        rows = []
        for item in items:
            film, error = found.get(id(item), (None, None))
            row = {"line": item.line, "text": item.text, "film": None, "on_shelf": False,
                   "dup": False, "guessed": item.guessed, "error": error}
            if film is not None:
                row.update(film=FilmRead.model_validate(film).model_dump(mode="json"),
                           on_shelf=film.imdb_id in owned, dup=film.imdb_id in seen)
                seen.add(film.imdb_id)
            rows.append(row)
        job.rows = rows
        job.status = "done"
    except Exception as exc:  # the job must always end, or the dialog polls forever
        print(f"Film list job failed: {exc!r}")
        job.status, job.error = "failed", "Couldn't read that list. Try again."


def _sweep() -> None:
    cutoff = time.monotonic() - JOB_TTL_SECONDS
    for job_id in [k for k, j in _jobs.items() if j.created < cutoff]:
        del _jobs[job_id]


def start(user_id: str, text: str) -> str:
    """Start reading a pasted list in the background; returns the job id."""
    if len(text) > MAX_CHARS:
        raise ListTooLong()
    _sweep()
    job_id = uuid.uuid4().hex
    job = _jobs[job_id] = Job(user_id=user_id)
    task = asyncio.create_task(_run(job, number_lines(text)))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return job_id


def get(job_id: str, user_id: str) -> Job | None:
    job = _jobs.get(job_id)
    return job if job is not None and job.user_id == user_id else None

