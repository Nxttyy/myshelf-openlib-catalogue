"""
Ask Dora for films: does a film you don't own yet fit your taste?

ask() answers what it can at once (an empty film shelf, verdicts cached
while the shelf is unchanged, including its ratings) and fires FlowStudio
runs for the rest, up to FILMS_PER_RUN candidates each, so "ask all" on a
long list reads the user's shelves once per run instead of once per film. poll() checks one run and caches
what it answered.

Runs are remembered in memory (who asked, about what, against which
library), so a user can only poll their own runs.
"""

import time
import uuid
from dataclasses import dataclass, field

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models.dora_verdict import DoraVerdict
from app.models.film import Film
from app.services import dora, omdb, taste

FILMS_PER_RUN = 8
RUN_TTL_SECONDS = 3600


@dataclass
class Run:
    user_id: uuid.UUID
    library_sig: str
    imdb_ids: list[str]
    titles: dict[str, str]  # imdb_id → title, cached with the verdict
    created: float = field(default_factory=time.monotonic)


_runs: dict[str, Run] = {}


def _candidate(f: Film) -> dict:
    """What the fit calculator knows about a candidate: facts, so it never
    judges from memory."""
    c = {
        "imdb_id": f.imdb_id, "title": f.title, "year": f.year, "type": f.type,
        "genre": ", ".join(f.genres) or None, "director": f.director, "writer": f.writer,
        "country": f.country, "language": f.language, "runtime_min": f.runtime_min,
        "rated": f.rated, "plot": (f.plot or "")[:300] or None, "imdb_rating": f.imdb_rating,
        "awards": f.awards,
    }
    return {k: v for k, v in c.items() if v is not None}


async def ask(session: AsyncSession, user_id: uuid.UUID, imdb_ids: list[str]) -> dict:
    """{"runs": [{run_id, imdb_ids}], "verdicts": {imdb_id: verdict}, "failed": [imdb_id...]}.
    Films already on the shelf are left out: there's nothing to decide."""
    items = await taste.film_items(session, user_id)
    sig, owned = taste.library_sig(items), {i["imdb_id"] for i in items}
    ids = [i for i in dict.fromkeys(imdb_ids) if i not in owned]
    if not owned:
        return {"runs": [], "verdicts": {i: dora.empty_shelf_verdict(dora.FILMS) for i in ids}, "failed": []}

    cached = (await session.exec(select(DoraVerdict).where(
        DoraVerdict.user_id == user_id, DoraVerdict.media == "films",
        DoraVerdict.item_key.in_(ids), DoraVerdict.library_sig == sig,
    ))).all()
    verdicts = {v.item_key: v.verdict for v in cached}

    candidates, failed = [], []
    for imdb_id in ids:
        if imdb_id in verdicts:
            continue
        try:
            candidates.append(_candidate(await omdb.get_or_create_film(session, imdb_id)))
        except (omdb.OmdbNotFound, omdb.OmdbUnavailable):
            failed.append(imdb_id)

    _sweep()
    runs = []
    for at in range(0, len(candidates), FILMS_PER_RUN):
        batch = candidates[at : at + FILMS_PER_RUN]
        run_id = await dora.trigger(dora.FILMS, dora.build_film_input(str(user_id), batch))
        _runs[run_id] = Run(
            user_id=user_id, library_sig=sig, imdb_ids=[c["imdb_id"] for c in batch],
            titles={c["imdb_id"]: c["title"] for c in batch},
        )
        runs.append({"run_id": run_id, "imdb_ids": _runs[run_id].imdb_ids})
    return {"runs": runs, "verdicts": verdicts, "failed": failed}


async def poll(session: AsyncSession, user_id: uuid.UUID, run_id: str) -> dict | None:
    """{"status", "verdicts", "imdb_ids"} for one of this user's runs, or None
    if it isn't theirs (or was forgotten). A completed run that answered
    nothing usable counts as failed."""
    run = _runs.get(run_id)
    if run is None or run.user_id != user_id:
        return None
    status, output = await dora.fetch_run(dora.FILMS, run_id)
    verdicts: dict[str, dict] = {}
    if status == "completed":
        titles = dora.own_titles(await taste.film_items(session, user_id), await taste.book_items(session, user_id))
        verdicts = dora.parse_film_verdicts(output, run.imdb_ids, titles) or {}
        if not verdicts:
            status = "failed"
        for imdb_id, v in verdicts.items():
            if v["kind"] == dora.UNSURE:  # may just be a bad run: ask again next time
                continue
            await taste.remember(session, user_id, dora.FILMS, imdb_id, run.library_sig, v | {"title": run.titles.get(imdb_id)})
        await session.commit()
    return {"status": status, "verdicts": verdicts, "imdb_ids": run.imdb_ids}


def _sweep() -> None:
    cutoff = time.monotonic() - RUN_TTL_SECONDS
    for run_id in [k for k, r in _runs.items() if r.created < cutoff]:
        del _runs[run_id]
