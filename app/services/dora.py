"""
Ask Dora — client for the FlowStudio agent workflow.

The workflow chains two agents (User Profiler → User-Book Fit Calculator) and
is triggered over a webhook, async fire-and-poll style: POST /trigger returns
a run_id, then GET /runs/{run_id} until status is "completed" or "failed".
The last agent's output is a JSON verdict: {kind, verdict, reason,
familiarity_to_taste, adventure_in_the_right_direction}.
"""

import json

import httpx

from app.config import settings


class DoraError(Exception):
    """The workflow service misbehaved (bad response, no run_id, ...)."""


def is_configured() -> bool:
    return bool(settings.DORA_WEBHOOK_URL and settings.DORA_WEBHOOK_SECRET)


def _headers() -> dict:
    return {"X-Webhook-Secret": settings.DORA_WEBHOOK_SECRET}


def _build_input(user_id: str, book: dict) -> str:
    candidate = {k: v for k, v in book.items() if v}
    return f"USER_ID: {user_id}\n\nCANDIDATE_BOOK: {json.dumps(candidate)}"


async def fire_verdict(user_id: str, book: dict) -> str:
    """Trigger a verdict run for one candidate book; returns the run_id."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{settings.DORA_WEBHOOK_URL}/trigger",
            headers=_headers(),
            json={"initial_input": _build_input(user_id, book)},
        )
        resp.raise_for_status()
        run_id = resp.json().get("run_id")
    if not run_id:
        raise DoraError("trigger accepted but returned no run_id")
    return run_id


def _parse_verdict(text: str) -> dict | None:
    """Parse the workflow's final output into a normalized verdict dict.

    Tolerates markdown fences and surrounding prose; returns None if no valid
    verdict JSON can be extracted.
    """
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
    if not isinstance(raw, dict) or "verdict" not in raw:
        return None

    kind = raw.get("kind")
    if kind not in ("buy", "hold", "skip"):
        kind = "hold"

    def _score(key: str) -> int:
        try:
            return min(5, max(1, int(raw.get(key))))
        except (TypeError, ValueError):
            return 3

    return {
        "kind": kind,
        "verdict": str(raw["verdict"])[:120],
        "reason": str(raw.get("reason") or "")[:400] or None,
        "familiarity_to_taste": _score("familiarity_to_taste"),
        "adventure_in_the_right_direction": _score("adventure_in_the_right_direction"),
    }


async def poll_run(run_id: str) -> dict:
    """One poll of a verdict run. Returns {"status": ..., "verdict": ...}.

    status is "running", "completed" or "failed"; verdict is set only when
    completed. A completed run whose output can't be parsed counts as failed.
    """
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{settings.DORA_WEBHOOK_URL}/runs/{run_id}", headers=_headers()
        )
        resp.raise_for_status()
        data = resp.json()

    status = data.get("status")
    if status == "completed":
        verdict = _parse_verdict(data.get("final_output"))
        if verdict is None:
            return {"status": "failed", "verdict": None}
        return {"status": "completed", "verdict": verdict}
    if status in ("failed", "running"):
        return {"status": status, "verdict": None}
    # awaiting_checkpoint (unused by this workflow) or anything unknown:
    # treat as still running so the client keeps polling until its own cap.
    return {"status": "running", "verdict": None}
