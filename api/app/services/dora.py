"""
Ask Dora — client for the FlowStudio agent workflows.

Three workflows, each behind its own webhook, all async fire-and-poll
style: POST /trigger returns a run_id, then GET /runs/{run_id} until status
is "completed" or "failed".

- books: User Profiler → User-Book Fit Calculator. Final output is one
  verdict: {kind, verdict, reason, familiarity_to_taste,
  adventure_in_the_right_direction}.
- films: Film Taste Profiler → Film Fit Calculator. Final output is
  {"verdicts": [{imdb_id, kind, verdict, summary, ...scores}]}, one per
  candidate.
- list: Film List Parser. Final output is {"items": [...], "ignored": [...]}
  (see services/film_list.py).

Prompts and the profiler's tool code live in api/flowstudio/.
"""

import json

import httpx

from app.config import settings

BOOKS, FILMS, LIST = "books", "films", "list"


class DoraError(Exception):
    """The workflow service misbehaved (bad response, no run_id, ...)."""


def _webhook(workflow: str) -> tuple[str | None, str | None]:
    if workflow == FILMS:
        return settings.DORA_FILM_WEBHOOK_URL, settings.DORA_FILM_WEBHOOK_SECRET
    if workflow == LIST:
        return settings.DORA_LIST_WEBHOOK_URL, settings.DORA_LIST_WEBHOOK_SECRET
    return settings.DORA_WEBHOOK_URL, settings.DORA_WEBHOOK_SECRET


def is_configured(workflow: str = BOOKS) -> bool:
    url, secret = _webhook(workflow)
    return bool(url and secret)


async def trigger(workflow: str, initial_input: str) -> str:
    """Start a run; returns its run_id."""
    url, secret = _webhook(workflow)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{url}/trigger",
            headers={"X-Webhook-Secret": secret},
            json={"initial_input": initial_input},
        )
        resp.raise_for_status()
        run_id = resp.json().get("run_id")
    if not run_id:
        raise DoraError("trigger accepted but returned no run_id")
    return run_id


async def fetch_run(workflow: str, run_id: str) -> tuple[str, str | None]:
    """One poll of a run: (status, final_output). status is "running",
    "completed" or "failed"; final_output is set only when completed."""
    url, secret = _webhook(workflow)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(f"{url}/runs/{run_id}", headers={"X-Webhook-Secret": secret})
        resp.raise_for_status()
        data = resp.json()
    status = data.get("status")
    if status == "completed":
        return "completed", data.get("final_output")
    if status == "failed":
        return "failed", None
    # running, awaiting_checkpoint (unused by these workflows) or anything
    # unknown: still running, so the caller keeps polling until its own cap.
    return "running", None


def extract_json(text: str | None) -> dict | None:
    """The JSON object in an agent's final output. Tolerates markdown fences
    and surrounding prose; None if there is no valid object."""
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.strip("`")
        if t.startswith("json"):
            t = t[4:]
    start, end = t.find("{"), t.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        raw = json.loads(t[start : end + 1])
    except ValueError:
        return None
    return raw if isinstance(raw, dict) else None


def _score(raw: dict, key: str) -> int:
    try:
        return min(5, max(1, int(raw.get(key))))
    except (TypeError, ValueError):
        return 3


def _kind(raw: dict) -> str:
    kind = raw.get("kind")
    return kind if kind in ("buy", "hold", "skip") else "hold"


# ── Books ────────────────────────────────────────────────────────────────────

def _build_input(user_id: str, book: dict) -> str:
    candidate = {k: v for k, v in book.items() if v}
    return f"USER_ID: {user_id}\n\nCANDIDATE_BOOK: {json.dumps(candidate)}"


async def fire_verdict(user_id: str, book: dict) -> str:
    """Trigger a verdict run for one candidate book; returns the run_id."""
    return await trigger(BOOKS, _build_input(user_id, book))


def _parse_verdict(text: str) -> dict | None:
    """Parse the book workflow's final output into a normalized verdict
    dict; None if no valid verdict JSON can be extracted."""
    raw = extract_json(text)
    if raw is None or "verdict" not in raw:
        return None
    return {
        "kind": _kind(raw),
        "verdict": str(raw["verdict"])[:120],
        "reason": str(raw.get("reason") or "")[:400] or None,
        "familiarity_to_taste": _score(raw, "familiarity_to_taste"),
        "adventure_in_the_right_direction": _score(raw, "adventure_in_the_right_direction"),
    }


async def poll_run(run_id: str) -> dict:
    """One poll of a book verdict run. Returns {"status": ..., "verdict": ...}.

    A completed run whose output can't be parsed counts as failed.
    """
    status, output = await fetch_run(BOOKS, run_id)
    if status == "completed":
        verdict = _parse_verdict(output)
        if verdict is None:
            return {"status": "failed", "verdict": None}
        return {"status": "completed", "verdict": verdict}
    return {"status": status, "verdict": None}


# ── Films ────────────────────────────────────────────────────────────────────

# Nothing on the film shelf yet: answered here, without a run.
EMPTY_SHELF_VERDICT = {
    "kind": "hold",
    "verdict": "Add a few films first",
    "summary": "Your film shelf is empty, so there is nothing to compare yet.",
    "familiarity_to_taste": 1,
    "adventure_in_the_right_direction": 3,
}


def build_film_input(user_id: str, candidates: list[dict]) -> str:
    return f"USER_ID: {user_id}\n\nCANDIDATE_FILMS: {json.dumps(candidates, ensure_ascii=False)}"


def parse_film_verdicts(text: str | None, imdb_ids: list[str]) -> dict[str, dict] | None:
    """The film workflow's final output as {imdb_id: verdict}, keeping only
    the candidates that were asked about. None if the output is unusable
    (no JSON, or the workflow reported an error)."""
    raw = extract_json(text)
    if raw is None or raw.get("error") or not isinstance(raw.get("verdicts"), list):
        return None
    asked = set(imdb_ids)
    out: dict[str, dict] = {}
    for v in raw["verdicts"]:
        if not isinstance(v, dict) or v.get("imdb_id") not in asked or not v.get("verdict"):
            continue
        out[v["imdb_id"]] = {
            "kind": _kind(v),
            "verdict": str(v["verdict"])[:60],
            "summary": str(v.get("summary") or "")[:320] or None,
            "familiarity_to_taste": _score(v, "familiarity_to_taste"),
            "adventure_in_the_right_direction": _score(v, "adventure_in_the_right_direction"),
        }
    return out
