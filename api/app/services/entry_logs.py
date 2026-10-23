"""
Diary logs on shelf entries (folio/diary.jsx), shared by books and films.
Like services/photos.py, a log hangs off exactly one entry: `user_book_id`
or `user_film_id`, named here by `owner`.
"""

from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from sqlmodel import delete, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models.entry_log import Companion, EntryLog, EntryLogCompanion
from app.schemas.entry_log import CompanionCreate, CompanionRead, EntryLogRead, EntryLogWrite

Owner = Literal["user_book_id", "user_film_id"]

CRITERIA = {
    "user_book_id": ("plot", "characters", "writing", "world", "pacing", "ending"),
    "user_film_id": ("story", "characters", "acting", "visuals", "music", "pacing"),
}
PLACES = {
    "user_book_id": ("home", "cafe", "commute", "other"),
    "user_film_id": ("theater", "home", "on_the_go", "friends_place"),
}
PRECISIONS = ("day", "month", "year")

# The design's avatar colours, handed out in turn to new companions.
COMPANION_COLORS = ("#C9A27E", "#9DB4A0", "#A9A6C9", "#D7B56D", "#C99A9A", "#8FB3C4", "#B5A58C", "#A7C49A")
MAX_COMPANIONS = 50


def _column(owner: Owner):
    return getattr(EntryLog, owner)


def _invalid(detail: str):
    raise HTTPException(status_code=422, detail=detail)


def _validated(owner: Owner, data: EntryLogWrite) -> tuple[dict, date | None, str | None]:
    criteria = CRITERIA[owner]
    if set(data.scores) != set(criteria):
        _invalid(f"scores must rate exactly: {', '.join(criteria)}")
    if any(not 1 <= v <= 10 for v in data.scores.values()):
        _invalid("each score must be from 1 to 10")
    if data.place is not None and data.place not in PLACES[owner]:
        _invalid(f"place must be one of: {', '.join(PLACES[owner])}")

    finished_on, precision = data.finished_on, data.finished_on_precision
    if finished_on is None:
        precision = None
    else:
        precision = precision or "day"
        if precision not in PRECISIONS:
            _invalid(f"finished_on_precision must be one of: {', '.join(PRECISIONS)}")
        if finished_on > date.today():
            _invalid("finished_on can't be in the future")
        # Store the start of the period, so equal periods compare equal.
        if precision == "month":
            finished_on = finished_on.replace(day=1)
        elif precision == "year":
            finished_on = finished_on.replace(month=1, day=1)
    return {k: data.scores[k] for k in criteria}, finished_on, precision


def _read(log: EntryLog, companions: list[Companion]) -> EntryLogRead:
    scores = log.scores or {}
    enjoyment = round(sum(scores.values()) / len(scores), 1) if scores else 0.0
    return EntryLogRead(
        scores=scores, enjoyment=enjoyment,
        finished_on=log.finished_on, finished_on_precision=log.finished_on_precision,
        place=log.place, times=log.times,
        companions=[CompanionRead.model_validate(c) for c in companions],
    )


async def save(session: AsyncSession, owner: Owner, entry_id: UUID, user_id: UUID, data: EntryLogWrite) -> None:
    """Create or replace an entry's log. The caller checks the entry is the
    user's and commits."""
    scores, finished_on, precision = _validated(owner, data)

    wanted = list(dict.fromkeys(data.companion_ids))
    if wanted:
        mine = set((await session.exec(
            select(Companion.id).where(Companion.user_id == user_id, Companion.id.in_(wanted))
        )).all())
        if len(mine) != len(wanted):
            _invalid("Unknown companion")

    log = (await session.exec(select(EntryLog).where(_column(owner) == entry_id))).first()
    if log is None:
        log = EntryLog(**{owner: entry_id})
    log.scores, log.finished_on, log.finished_on_precision = scores, finished_on, precision
    log.place, log.times = data.place, data.times
    session.add(log)
    await session.flush()

    await session.exec(delete(EntryLogCompanion).where(EntryLogCompanion.log_id == log.id))
    for companion_id in wanted:
        session.add(EntryLogCompanion(log_id=log.id, companion_id=companion_id))


async def attach(session: AsyncSession, owner: Owner, items: list[dict], entry_key: str) -> None:
    """Set item["log"] (an EntryLogRead, or None) on each item, keyed off the
    id of item[entry_key] (a UserBook or UserFilm)."""
    for item in items:
        item["log"] = None
    ids = [item[entry_key].id for item in items]
    if not ids:
        return
    logs = (await session.exec(select(EntryLog).where(_column(owner).in_(ids)))).all()
    if not logs:
        return
    links = (await session.exec(
        select(EntryLogCompanion.log_id, Companion)
        .join(Companion, Companion.id == EntryLogCompanion.companion_id)
        .where(EntryLogCompanion.log_id.in_([log.id for log in logs]))
        .order_by(Companion.created_at)
    )).all()
    people: dict = {}
    for log_id, companion in links:
        people.setdefault(log_id, []).append(companion)
    by_entry = {getattr(log, owner): _read(log, people.get(log.id, [])) for log in logs}
    for item in items:
        item["log"] = by_entry.get(item[entry_key].id)


# ── Companions ───────────────────────────────────────────────────────────────


async def companions(session: AsyncSession, user_id: UUID) -> list[Companion]:
    return list((await session.exec(
        select(Companion).where(Companion.user_id == user_id).order_by(Companion.created_at)
    )).all())


def _initials(name: str) -> str:
    words = name.split()
    letters = "".join(w[0] for w in words[:2]) if len(words) > 1 else name[:2]
    return letters.upper()


async def add_companion(session: AsyncSession, user_id: UUID, data: CompanionCreate) -> Companion:
    name = " ".join(data.name.split())
    if not name:
        _invalid("A name is required")
    existing = await companions(session, user_id)
    if len(existing) >= MAX_COMPANIONS:
        _invalid(f"You can add up to {MAX_COMPANIONS} people")
    initials = (data.initials or "").strip().upper() or _initials(name)
    color = data.color if data.color in COMPANION_COLORS else COMPANION_COLORS[len(existing) % len(COMPANION_COLORS)]
    companion = Companion(user_id=user_id, name=name, initials=initials[:3], color=color)
    session.add(companion)
    await session.commit()
    await session.refresh(companion)
    return companion
