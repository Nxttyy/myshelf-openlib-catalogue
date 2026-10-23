"""
Ask Dora — client for the FlowStudio agent workflows.

Three workflows, each behind its own webhook, all async fire-and-poll
style: POST /trigger returns a run_id, then GET /runs/{run_id} until status
is "completed" or "failed".

- books: one agent, "Dora · Books". Final output is one verdict:
  {kind, verdict, summary, predicted_enjoyment, confidence,
  familiarity_to_taste, adventure_in_the_right_direction}.
- films: one agent, "Dora · Films". Final output is
  {"verdicts": [{imdb_id, ...the same fields}]}, one per candidate.

Both agents read the person's shelves through the MCP tools
(app/mcp_server.py, services/taste.py).
- list: Film List Parser. Final output is {"items": [...], "ignored": [...]}
  (see services/film_list.py).

Prompts live in ~/Dev/flowstudio, outside this repo.
"""

import json
import re

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


# ── Verdicts ────────────────────────────────────────────────────────────────
# Two outcomes: watch / get it, or skip it. Plus an honest third when Dora
# can't judge (too little on the shelf to compare): "unsure", shown as "Not
# enough to go on" and never cached. The agents are told this and given the
# banned advice below; these checks catch what slips through, so a verdict
# that reaches the app is never "rent first", never a guess dressed up as a
# yes, and only bolds titles that really are on the person's shelves.

POSITIVE = {BOOKS: "get", FILMS: "watch"}
UNSURE = "unsure"
LABELS = {"get": "Get it", "watch": "Watch it", "skip": "Skip it", UNSURE: "Not enough to go on"}
CONFIDENCE = ("low", "medium", "high")

# Advice nobody follows: renting, borrowing, sampling, waiting, more research.
_BANNED = re.compile(
    r"\b(rent(s|al|ing)?|borrow(s|ing)?|sample|samples|trailer|preview)\b"
    r"|from (the|a|your) (local )?library|\blibrary card\b"
    r"|\bwait (for|until)\b|\bcheck (the |some )?reviews\b|\b(first|then) decide\b",
    re.I,
)
_SENTENCE = re.compile(r"(?<=[.!?])\s+")
_BOLD = re.compile(r"\*\*(.+?)\*\*")


def norm_title(title: str) -> str:
    return " ".join(re.sub(r"[^\w\s]", " ", title.lower()).split())


def _predicted(raw: dict) -> float | None:
    try:
        return round(min(10.0, max(1.0, float(raw.get("predicted_enjoyment")))), 1)
    except (TypeError, ValueError):
        return None


def _known_titles(summary: str, titles: set[str]) -> str:
    """Unbold any **title** that isn't on the person's shelves: the app shows
    bold as "yours", so an invented or misremembered title must not be."""
    def bare(t: str) -> str:
        return re.sub(r"^(the|a|an) ", "", t)

    known = {bare(k) for k in titles}

    def keep(m: re.Match) -> str:
        # The full title, or its start word for word ("Paterson" for
        # "Paterson: Poems"), ignoring a leading "The", "A" or "An".
        t = bare(norm_title(m.group(1)))
        if t and any(t == k or k.startswith(t + " ") for k in known):
            return m.group(0)
        return m.group(1)
    return _BOLD.sub(keep, summary)


def normalize_verdict(raw: dict, media: str, titles: set[str]) -> dict | None:
    """One agent verdict, checked and cleaned. `titles` are the person's own
    titles (both shelves), normalised with _norm. None if it isn't a verdict."""
    if not isinstance(raw, dict) or not (raw.get("verdict") or raw.get("kind")):
        return None
    positive = POSITIVE[media]
    fam = _score(raw, "familiarity_to_taste")
    adv = _score(raw, "adventure_in_the_right_direction")
    predicted = _predicted(raw)

    kind = str(raw.get("kind") or "").lower()
    if kind in ("buy", "watch", "get"):
        kind = positive
    elif kind != "skip":
        kind = UNSURE
    # No predicted rating means no judgement was made (the agent couldn't
    # read the shelf, or an old-style "maybe"): say so rather than guess.
    if predicted is None:
        kind = UNSURE
    # The rating it predicts and the call it makes have to agree.
    elif kind == positive and predicted < 5:
        kind = "skip"
    elif kind == "skip" and predicted >= 7.5:
        kind = positive

    verdict = " ".join(str(raw.get("verdict") or "").split())[:60]
    says_skip = verdict.lower().startswith("skip")
    if kind == UNSURE or not verdict or _BANNED.search(verdict) or says_skip != (kind == "skip"):
        verdict = LABELS[kind]

    summary = str(raw.get("summary") or raw.get("reason") or "")
    summary = " ".join(x for x in _SENTENCE.split(summary.strip()) if x and not _BANNED.search(x))
    summary = _known_titles(summary, titles)[:360] or None

    if kind == UNSURE:
        summary = summary or "There isn't enough on your shelf to compare this with yet."
    confidence = str(raw.get("confidence") or "").lower()
    return {
        "kind": kind,
        "verdict": verdict,
        "summary": summary,
        "predicted_enjoyment": predicted if kind != UNSURE else None,
        "confidence": confidence if confidence in CONFIDENCE and kind != UNSURE else None,
        "familiarity_to_taste": fam,
        "adventure_in_the_right_direction": adv,
    }


def own_titles(*shelves: list[dict]) -> set[str]:
    return {norm_title(i["title"]) for shelf in shelves for i in shelf}


# Nothing on the shelf yet: answered here, without a run. "none" is neither
# outcome; the app shows it without a green or red dot.
def empty_shelf_verdict(media: str) -> dict:
    noun = "films" if media == FILMS else "books"
    return {
        "kind": "none",
        "verdict": f"Add a few {noun} first",
        "summary": f"Your {noun[:-1]} shelf is empty, so there is nothing to compare yet.",
        "predicted_enjoyment": None,
        "confidence": None,
        "familiarity_to_taste": 1,
        "adventure_in_the_right_direction": 3,
    }


# ── Books ────────────────────────────────────────────────────────────────────

def build_book_input(user_id: str, candidate: dict) -> str:
    return f"USER_ID: {user_id}\n\nCANDIDATE_BOOK: {json.dumps(candidate, ensure_ascii=False)}"


def parse_book_verdict(text: str | None, titles: set[str]) -> dict | None:
    raw = extract_json(text)
    if raw is None or raw.get("error"):
        return None
    return normalize_verdict(raw, BOOKS, titles)


# ── Films ────────────────────────────────────────────────────────────────────

def build_film_input(user_id: str, candidates: list[dict]) -> str:
    return f"USER_ID: {user_id}\n\nCANDIDATE_FILMS: {json.dumps(candidates, ensure_ascii=False)}"


def parse_film_verdicts(text: str | None, imdb_ids: list[str], titles: set[str]) -> dict[str, dict] | None:
    """The film workflow's final output as {imdb_id: verdict}, keeping only
    the candidates that were asked about. None if the output is unusable
    (no JSON, or the workflow reported an error)."""
    raw = extract_json(text)
    if raw is None or raw.get("error") or not isinstance(raw.get("verdicts"), list):
        return None
    asked = set(imdb_ids)
    out: dict[str, dict] = {}
    for v in raw["verdicts"]:
        if not isinstance(v, dict) or v.get("imdb_id") not in asked:
            continue
        verdict = normalize_verdict(v, FILMS, titles)
        if verdict is not None:
            out[v["imdb_id"]] = verdict
    return out
