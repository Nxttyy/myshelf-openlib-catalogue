"""
Ask Dora for books: should you get a book you don't own yet?

Like film_taste.py: ask() answers at once when it can (an empty shelf, a
verdict cached while the shelf and its ratings are unchanged) and otherwise
fires one FlowStudio run; poll() checks it, cleans the verdict and caches it.
The candidate goes in with the facts we have (catalogue record, or the
search result it came from), so the agent judges the book, not its memory
of the title.
"""

import time
import uuid
from dataclasses import dataclass, field

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models.dora_verdict import DoraVerdict
from app.services import catalogue, dora, taste
from app.services.isbn import to_isbn13
from app.services.sources import normalize

RUN_TTL_SECONDS = 3600


@dataclass
class Run:
    user_id: uuid.UUID
    library_sig: str
    item_key: str
    title: str
    created: float = field(default_factory=time.monotonic)


_runs: dict[str, Run] = {}


def item_key(candidate: dict) -> str:
    """The cache key: the ISBN-13, else the title and first author."""
    isbn13 = to_isbn13(candidate.get("isbn"))
    if isbn13:
        return isbn13
    author = (candidate.get("authors") or [""])[0]
    return "t:" + dora.norm_title(f"{candidate['title']} {author}")


async def _facts(session: AsyncSession, candidate: dict) -> dict:
    """What we know about the candidate, beyond the title the user picked."""
    facts = {k: v for k, v in candidate.items() if v}
    fields = None
    book = await catalogue.find_book_by_isbn(session, candidate["isbn"]) if candidate.get("isbn") else None
    if book is not None:
        fields = {
            "title": book.title, "subtitle": book.subtitle, "description": book.description,
            "authors": book.authors, "subjects": book.subjects, "publishers": book.publishers,
            "publish_date": book.publish_date, "number_of_pages": book.number_of_pages,
            "language": book.language, "extra": book.extra,
        }
    else:
        record = catalogue.recall_by_isbn(candidate.get("isbn"))
        if record is not None:
            fields = normalize(record.provider, record.kind, record.payload)
    if fields:
        extra = fields.get("extra") or {}
        facts.update({k: v for k, v in {
            "subtitle": fields.get("subtitle"),
            "description": (fields.get("description") or "")[:700] or None,
            "subjects": [s["name"] for s in fields.get("subjects") or []][:10] or None,
            "publisher": next((p["name"] for p in fields.get("publishers") or []), None),
            "published": fields.get("publish_date"),
            "pages": fields.get("number_of_pages"),
            "language": fields.get("language"),
            "rating": extra.get("rating"),
            "series": extra.get("series"),
        }.items() if v})
    return facts


async def ask(session: AsyncSession, user_id: uuid.UUID, candidate: dict) -> dict:
    """{"verdict": ...} when answered at once, else {"run_id": ...} to poll."""
    items = await taste.book_items(session, user_id)
    if not items:
        return {"verdict": dora.empty_shelf_verdict(dora.BOOKS)}
    sig, key = taste.library_sig(items), item_key(candidate)
    cached = (await session.exec(select(DoraVerdict).where(
        DoraVerdict.user_id == user_id, DoraVerdict.media == dora.BOOKS,
        DoraVerdict.item_key == key, DoraVerdict.library_sig == sig,
    ))).first()
    if cached is not None:
        return {"verdict": cached.verdict}

    facts = await _facts(session, candidate)
    isbn13 = to_isbn13(candidate.get("isbn"))
    if isbn13 and any(isbn13 in i["_isbns"] for i in items):
        facts["already_on_shelf"] = True
    _sweep()
    run_id = await dora.trigger(dora.BOOKS, dora.build_book_input(str(user_id), facts))
    _runs[run_id] = Run(user_id=user_id, library_sig=sig, item_key=key, title=candidate["title"])
    return {"run_id": run_id}


async def poll(session: AsyncSession, user_id: uuid.UUID, run_id: str) -> dict | None:
    """{"status", "verdict"} for one of this user's runs, or None if it isn't
    theirs (or was forgotten). A completed run without a usable verdict
    counts as failed."""
    run = _runs.get(run_id)
    if run is None or run.user_id != user_id:
        return None
    status, output = await dora.fetch_run(dora.BOOKS, run_id)
    if status != "completed":
        return {"status": status, "verdict": None}
    titles = dora.own_titles(await taste.book_items(session, user_id), await taste.film_items(session, user_id))
    verdict = dora.parse_book_verdict(output, titles)
    if verdict is None:
        return {"status": "failed", "verdict": None}
    if verdict["kind"] != dora.UNSURE:  # an unsure answer may just be a bad run: ask again next time
        await taste.remember(session, user_id, dora.BOOKS, run.item_key, run.library_sig, verdict | {"title": run.title})
        await session.commit()
    return {"status": "completed", "verdict": verdict}


def _sweep() -> None:
    cutoff = time.monotonic() - RUN_TTL_SECONDS
    for run_id in [k for k, r in _runs.items() if r.created < cutoff]:
        del _runs[run_id]
