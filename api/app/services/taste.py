"""
What Ask Dora knows about a person, computed here rather than by the agent:
a taste profile per shelf (books or films), library search, and Dora's past
verdicts with what happened next. Served to the FlowStudio agents as MCP
tools (app/mcp_server.py); the agent reads the result and decides.

Signals, strongest first: diary logs (enjoyment 1-10 and its six criteria,
rereads), notes, pins, status. An item's weight in the tallies below is its
enjoyment / 10 when rated, else a fixed weight by status, so a loved book
counts for more than one bought and never opened.
"""

import hashlib
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy.dialects.postgresql import insert
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models.book import Book
from app.models.dora_verdict import DoraVerdict
from app.models.entry_log import EntryLog
from app.models.film import Film
from app.models.user_book import UserBook
from app.models.user_film import UserFilm

Media = Literal["books", "films"]

STATUS_WEIGHT = {"read": 0.6, "reading": 0.5, "unread": 0.25}
LOVED_AT, DISLIKED_AT = 8.0, 4.5
RECENT_DAYS = 90


def _names(items) -> list[str]:
    return [i["name"] for i in items or [] if isinstance(i, dict) and i.get("name")]


def _tag(name: str) -> str:
    """Open Library tags some subjects as "series:Harry_Potter"."""
    if name.lower().startswith("series:"):
        return "Series: " + name[7:].replace("_", " ").strip()
    return name


def _year(text) -> int | None:
    m = re.search(r"\b(1[5-9]\d\d|20\d\d)\b", str(text or ""))
    return int(m.group(1)) if m else None


def _finished(log: EntryLog | None) -> str | None:
    if log is None or log.finished_on is None:
        return None
    return log.finished_on.isoformat()[: {"year": 4, "month": 7}.get(log.finished_on_precision or "day", 10)]


def _logged(item: dict, log: EntryLog | None) -> dict:
    if log is not None and log.scores:
        item["enjoyment"] = round(sum(log.scores.values()) / len(log.scores), 1)
        item["scores"] = log.scores
        item["times"] = log.times
        if log.finished_on:
            item["finished"] = _finished(log)
            item["_finished_on"] = log.finished_on
    return item


# ── Loading a shelf ──────────────────────────────────────────────────────────


async def book_items(session: AsyncSession, user_id: UUID) -> list[dict]:
    rows = (await session.exec(
        select(UserBook, Book, EntryLog)
        .join(Book, Book.id == UserBook.book_id)
        .outerjoin(EntryLog, EntryLog.user_book_id == UserBook.id)
        .where(UserBook.user_id == user_id)
        .order_by(UserBook.created_at.desc())
    )).all()
    items = []
    for ub, b, log in rows:
        item = {
            "title": b.title, "by": _names(b.authors)[:2], "tags": [_tag(n) for n in _names(b.subjects)[:8]],
            "year": _year(b.publish_date), "pages": b.number_of_pages, "language": b.language,
            "status": ub.status, "pinned": ub.is_pinned, "note": (ub.comment or "").strip() or None,
            "added": ub.created_at.date().isoformat(), "_added": ub.created_at,
            "_isbns": set(b.isbns or []),
        }
        items.append(_logged(item, log))
    return items


async def film_items(session: AsyncSession, user_id: UUID) -> list[dict]:
    rows = (await session.exec(
        select(UserFilm, Film, EntryLog)
        .join(Film, Film.id == UserFilm.film_id)
        .outerjoin(EntryLog, EntryLog.user_film_id == UserFilm.id)
        .where(UserFilm.user_id == user_id)
        .order_by(UserFilm.created_at.desc())
    )).all()
    items = []
    for uf, f, log in rows:
        item = {
            "title": f.title, "by": [d.strip() for d in (f.director or "").split(",") if d.strip()][:2],
            "tags": list(f.genres or []), "year": _year(f.year), "type": f.type,
            "country": f.country, "language": f.language, "runtime_min": f.runtime_min,
            "status": uf.status, "pinned": uf.is_pinned, "note": (uf.comment or "").strip() or None,
            "added": uf.created_at.date().isoformat(), "_added": uf.created_at, "imdb_id": f.imdb_id,
        }
        items.append(_logged(item, log))
    return items


async def items_for(session: AsyncSession, user_id: UUID, media: Media) -> list[dict]:
    return await (film_items if media == "films" else book_items)(session, user_id)


def library_sig(items: list[dict]) -> str:
    """Changes whenever something is added, removed, changes status or is
    (re)rated: what makes a cached verdict stale."""
    parts = sorted(f"{i['title']}|{i['added']}|{i['status']}|{i.get('enjoyment')}|{i.get('times')}" for i in items)
    return hashlib.sha1("\n".join(parts).encode()).hexdigest()[:16]


def public(item: dict) -> dict:
    """An item as the agent sees it: no internal fields, no empty ones."""
    return {k: v for k, v in item.items() if not k.startswith("_") and v not in (None, [], "", False)}


def _brief(item: dict) -> dict:
    keep = ("title", "by", "year", "enjoyment", "times", "status", "pinned")
    return {k: item[k] for k in keep if item.get(k) not in (None, [], False)}


# ── The profile ──────────────────────────────────────────────────────────────


def _weight(item: dict) -> float:
    if "enjoyment" in item:
        return item["enjoyment"] / 10
    return STATUS_WEIGHT.get(item["status"], 0.3)


def _tally(items: list[dict], key, limit: int) -> list[dict]:
    """Top values of a per-item list field, by summed weight."""
    weight: dict[str, float] = defaultdict(float)
    count: Counter = Counter()
    rated: dict[str, list[float]] = defaultdict(list)
    for item in items:
        for value in dict.fromkeys(key(item)):
            weight[value] += _weight(item)
            count[value] += 1
            if "enjoyment" in item:
                rated[value].append(item["enjoyment"])
    top = sorted(weight, key=lambda v: (-weight[v], -count[v]))[:limit]
    out = []
    for value in top:
        row = {"name": value, "owned": count[value]}
        if rated[value]:
            row["avg_enjoyment"] = round(sum(rated[value]) / len(rated[value]), 1)
        out.append(row)
    return out


def _counts(values, limit: int) -> dict:
    return dict(Counter(v for v in values if v).most_common(limit))


def profile(items: list[dict], media: Media, other: list[dict]) -> dict:
    """The taste profile for one shelf. `other` is the person's other shelf,
    summarised briefly for links between books and films."""
    rated = [i for i in items if "enjoyment" in i]
    statuses = Counter(i["status"] for i in items)
    today = date.today()

    loved = sorted(
        (i for i in rated if i["enjoyment"] >= LOVED_AT or (i.get("times", 1) > 1 and i["enjoyment"] >= 6)),
        key=lambda i: (-i["enjoyment"], -i.get("times", 1)),
    )[:10]
    if not loved:
        # No ratings yet: started or finished items that are pinned or noted
        # stand in for favourites (an unstarted pin is a wish, not a taste).
        loved = [i for i in items if i["status"] != "unread" and (i["pinned"] or i["note"])][:10]
    disliked = sorted((i for i in rated if i["enjoyment"] <= DISLIKED_AT), key=lambda i: i["enjoyment"])[:6]

    criteria: dict[str, list[int]] = defaultdict(list)
    for i in rated:
        for k, v in i["scores"].items():
            criteria[k].append(v)
    criteria_avg = {k: round(sum(v) / len(v), 1) for k, v in sorted(criteria.items())}
    by_value = sorted(criteria_avg, key=criteria_avg.get, reverse=True)

    unread = [i for i in items if i["status"] == "unread"]
    cutoff = today - timedelta(days=RECENT_DAYS)
    finished_recently = [i for i in rated if i.get("_finished_on") and i["_finished_on"] >= cutoff]

    out: dict = {
        "media": media,
        "insufficient_data": len(items) < 3,
        "counts": {
            "total": len(items), "finished": statuses.get("read", 0), "in_progress": statuses.get("reading", 0),
            "not_started": statuses.get("unread", 0), "rated": len(rated),
        },
        "enjoyment_scale": "1-10, the average of six criteria the person scored themselves",
        "avg_enjoyment": round(sum(i["enjoyment"] for i in rated) / len(rated), 1) if rated else None,
        "loved": [_brief(i) | ({"note": i["note"][:160]} if i["note"] else {}) for i in loved],
        "disliked": [_brief(i) | ({"note": i["note"][:160]} if i["note"] else {}) for i in disliked],
        "criteria_avg": criteria_avg,
        "values_most": by_value[:2] if len(rated) >= 2 else [],
        "values_least": by_value[-1:] if len(rated) >= 2 and criteria_avg[by_value[0]] - criteria_avg[by_value[-1]] >= 1 else [],
        "creators": _tally(items, lambda i: i["by"], 10),
        ("genres" if media == "films" else "subjects"): _tally(items, lambda i: i["tags"], 12),
        "decades": _counts((f"{i['year'] // 10 * 10}s" for i in items if i.get("year")), 6),
        "backlog": {
            "not_started": len(unread),
            "share": round(len(unread) / len(items), 2) if items else 0,
            "oldest_days": (today - min(i["_added"] for i in unread).date()).days if unread else 0,
            "piles_up": [t["name"] for t in _tally(unread, lambda i: i["tags"], 5)],
        },
        "recent": {
            "added_last_90_days": sum(1 for i in items if i["_added"].date() >= cutoff),
            "finished_last_90_days": [_brief(i) for i in finished_recently[:8]],
        },
        "notes": [{"title": i["title"], "note": i["note"][:220]} for i in items if i["note"]][:8],
    }
    if media == "films":
        out["countries"] = _counts((c.strip() for i in items for c in (i.get("country") or "").split(",")[:1]), 6)
        out["languages"] = _counts(((i.get("language") or "").split(",")[0].strip() for i in items), 6)
    else:
        out["languages"] = _counts((i.get("language") for i in items), 6)

    other_rated = sorted((i for i in other if "enjoyment" in i), key=lambda i: -i["enjoyment"])
    other_top = other_rated[:6] or [i for i in other if i["pinned"] or i["status"] == "read"][:6]
    out["other_shelf"] = {
        "media": "books" if media == "films" else "films",
        "total": len(other),
        "favourites": [_brief(i) | {"tags": i["tags"][:3]} for i in other_top],
    }
    return out


def search(items: list[dict], query: str, limit: int = 10) -> list[dict]:
    """Owned items whose title, creators or tags contain every word of the query."""
    words = [w for w in query.lower().split() if w]
    if not words:
        return []
    hits = []
    for item in items:
        hay = " ".join([item["title"], *item["by"], *item["tags"]]).lower()
        if all(w in hay for w in words):
            hits.append(public(item))
    return hits[:limit]


# ── Past verdicts ────────────────────────────────────────────────────────────


async def past_verdicts(session: AsyncSession, user_id: UUID, media: Media, items: list[dict], limit: int = 15) -> list[dict]:
    """Dora's recent verdicts for this shelf, with what the person did next:
    whether it's on their shelf now, its status and their enjoyment."""
    rows = (await session.exec(
        select(DoraVerdict).where(DoraVerdict.user_id == user_id, DoraVerdict.media == media)
        .order_by(DoraVerdict.created_at.desc()).limit(limit)
    )).all()
    if media == "films":
        owned = {i["imdb_id"]: i for i in items}
        missing = [r.item_key for r in rows if r.item_key not in owned and not r.verdict.get("title")]
        titles = dict((await session.exec(select(Film.imdb_id, Film.title).where(Film.imdb_id.in_(missing)))).all()) if missing else {}
    else:
        owned = {isbn: i for i in items for isbn in i["_isbns"]}
        titles = {}
    out = []
    for r in rows:
        v = r.verdict
        item = owned.get(r.item_key)
        row = {
            "title": v.get("title") or (item and item["title"]) or titles.get(r.item_key) or r.item_key,
            "asked": r.created_at.date().isoformat(),
            "dora_said": v.get("verdict"),
            "kind": v.get("kind"),
            "predicted_enjoyment": v.get("predicted_enjoyment"),
            "on_shelf_now": item is not None,
        }
        if item is not None:
            row["status_now"] = item["status"]
            if "enjoyment" in item:
                row["their_enjoyment"] = item["enjoyment"]
        out.append({k: val for k, val in row.items() if val is not None})
    return out


async def remember(session: AsyncSession, user_id: UUID, media: str, item_key: str, sig: str, verdict: dict) -> None:
    """Cache a verdict (with the item's title, for get_past_verdicts) until the
    library changes. The caller commits."""
    await session.exec(insert(DoraVerdict).values(
        id=uuid4(), user_id=user_id, media=media, item_key=item_key, library_sig=sig, verdict=verdict,
    ).on_conflict_do_update(
        constraint="uq_dora_verdicts_item",
        set_={"library_sig": sig, "verdict": verdict, "created_at": datetime.utcnow()},
    ))
