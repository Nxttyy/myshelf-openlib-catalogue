"""
Open Library: the Volumes API for ISBN lookups, the Search API for title search.

Payload kinds:
    "edition"  a record from /api/volumes/brief/isbn/{isbn}.json (data + details)
    "work"     a doc from /search.json, i.e. a work with edition-level hints
"""

from app.config import settings
from app.services.isbn import isbn_identifiers
from app.services.sources.base import (
    SourceRecord,
    add_identifiers,
    empty_fields,
    get_json,
    https,
    language_code,
)

NAME = "openlibrary"
SITE = "https://openlibrary.org"

# Search fields we ask for. The doc is stored whole (bar trimmed lists), so
# anything here is available to later backfills.
_SEARCH_FIELDS = ",".join([
    "key", "title", "subtitle", "author_name", "author_key", "first_publish_year",
    "cover_i", "isbn", "edition_count", "publisher", "subject", "language",
    "number_of_pages_median", "ratings_average", "ratings_count", "ia",
])
# Popular works list hundreds of ISBNs/subjects across all their editions.
_SEARCH_LIST_CAPS = {"isbn": 20, "publisher": 10, "subject": 30, "ia": 5, "author_key": 10}


def configured() -> bool:
    return True


async def lookup_isbn(isbn: str) -> SourceRecord | None:
    """GET /api/volumes/brief/isbn/{isbn}.json. Open Library answers `[]`, not
    an empty dict, when it has no record."""
    raw = await get_json(NAME, f"{settings.OPENLIBRARY_BASE_URL}/{isbn}.json")
    records = raw.get("records") if isinstance(raw, dict) else None
    if not isinstance(records, dict):
        return None
    for key, record in records.items():
        if isinstance(record, dict):
            data = record.get("data") or {}
            return SourceRecord(
                provider=NAME,
                external_id=data.get("key") or key,
                kind="edition",
                payload=record,
                url=https(data.get("url")) or f"{SITE}{key}",
            )
    return None


async def search(query: str, limit: int) -> list[SourceRecord]:
    params = {"q": query, "fields": _SEARCH_FIELDS, "limit": limit}
    raw = await get_json(NAME, settings.OPENLIBRARY_SEARCH_URL, params)
    records = []
    for doc in (raw.get("docs") or []) if isinstance(raw, dict) else []:
        key = doc.get("key")
        if not key:
            continue
        for field, cap in _SEARCH_LIST_CAPS.items():
            if isinstance(doc.get(field), list):
                doc[field] = doc[field][:cap]
        records.append(SourceRecord(provider=NAME, external_id=key, kind="work", payload=doc, url=f"{SITE}{key}"))
    return records


def hit(record: SourceRecord) -> dict:
    doc = record.payload
    isbns = doc.get("isbn") or []
    return {
        "title": doc.get("title", ""),
        "authors": doc.get("author_name") or [],
        "first_publish_year": doc.get("first_publish_year"),
        "edition_count": doc.get("edition_count"),
        "isbns": isbns,
        "cover_url": _cover_url(doc.get("cover_i"), "M"),
    }


# ── Normalising ──────────────────────────────────────────────────────────────


def _cover_url(cover_id, size: str) -> str | None:
    return f"{settings.OPENLIBRARY_COVERS_URL}/{cover_id}-{size}.jpg" if cover_id else None


def covers_from_url(cover_url: str | None) -> list[dict]:
    """Small/medium/large from one Open Library cover URL: they only differ by
    a size suffix (…-S.jpg/-M.jpg/-L.jpg)."""
    if not cover_url:
        return []
    base = cover_url
    for suffix in ("-S.jpg", "-M.jpg", "-L.jpg"):
        if base.endswith(suffix):
            base = base[: -len(suffix)]
            break
    else:
        return [{"small": cover_url, "medium": cover_url, "large": cover_url}]
    return [{"small": f"{base}-S.jpg", "medium": f"{base}-M.jpg", "large": f"{base}-L.jpg"}]


def _text(raw) -> str | None:
    """Open Library text fields are sometimes a plain string, sometimes a
    {"type": ..., "value": ...} dict."""
    if isinstance(raw, dict):
        raw = raw.get("value")
    return (raw.strip() or None) if isinstance(raw, str) else None


def _named(items, keep_url: bool) -> list[dict]:
    out = []
    for item in items or []:
        if isinstance(item, dict) and item.get("name"):
            out.append({"name": item["name"], "url": https(item.get("url"))} if keep_url else {"name": item["name"]})
    return out


def _names(items) -> list[str]:
    return [i["name"] for i in items or [] if isinstance(i, dict) and i.get("name")]


def _normalize_edition(record: dict) -> dict:
    data: dict = record.get("data") or {}
    outer = record.get("details") or {}
    details: dict = (outer.get("details") or {}) if isinstance(outer, dict) else {}

    f = empty_fields()
    f["title"] = data.get("title") or details.get("title")
    f["subtitle"] = data.get("subtitle") or details.get("subtitle")
    f["description"] = _text(details.get("description"))
    f["authors"] = _named(data.get("authors"), keep_url=True)
    f["publishers"] = _named(data.get("publishers"), keep_url=False)
    f["subjects"] = _named(data.get("subjects"), keep_url=True)
    f["publish_date"] = data.get("publish_date") or details.get("publish_date")
    f["number_of_pages"] = data.get("number_of_pages") or details.get("number_of_pages")
    f["by_statement"] = data.get("by_statement") or details.get("by_statement")
    languages = details.get("languages") or []
    if languages and isinstance(languages[0], dict):
        f["language"] = language_code(languages[0].get("key"))

    cover = data.get("cover")
    if isinstance(cover, dict) and any(cover.values()):
        f["covers"] = [{"small": cover.get("small"), "medium": cover.get("medium"), "large": cover.get("large")}]

    ids: dict = {}
    for scheme, values in (data.get("identifiers") or {}).items():
        if scheme not in ("isbn_10", "isbn_13"):
            add_identifiers(ids, scheme, values)
    raw_isbns = list(record.get("isbns") or [])
    for scheme in ("isbn_13", "isbn_10"):
        raw_isbns += (data.get("identifiers") or {}).get(scheme) or []
    ids.update(isbn_identifiers(raw_isbns))
    add_identifiers(ids, "openlibrary", record.get("olids"))
    add_identifiers(ids, "oclc", record.get("oclcs"))
    add_identifiers(ids, "lccn", record.get("lccns"))
    add_identifiers(ids, "archive", details.get("ocaid"))
    add_identifiers(ids, "openlibrary_work", [
        w["key"].rsplit("/", 1)[-1] for w in details.get("works") or [] if isinstance(w, dict) and w.get("key")
    ])
    f["identifiers"] = ids

    extra: dict = {}
    for key in ("pagination", "weight"):
        if data.get(key):
            extra[key] = data[key]
    if details.get("physical_dimensions"):
        extra["dimensions"] = details["physical_dimensions"]
    if data.get("classifications"):
        extra["classifications"] = data["classifications"]
    for key in ("subject_places", "subject_people", "subject_times"):
        names = _names(data.get(key))
        if names:
            extra[key] = names
    notes = _text(data.get("notes")) or _text(details.get("notes"))
    if notes:
        extra["notes"] = notes
    toc = [t.get("title") for t in data.get("table_of_contents") or [] if isinstance(t, dict) and t.get("title")]
    if toc:
        extra["table_of_contents"] = toc
    excerpts = [e.get("text") for e in data.get("excerpts") or [] if isinstance(e, dict) and e.get("text")]
    if excerpts:
        extra["excerpts"] = excerpts
    ebooks = [e for e in data.get("ebooks") or [] if isinstance(e, dict)]
    if ebooks:
        extra["ebook"] = {k: https(v) if k.endswith("_url") else v for k, v in ebooks[0].items() if isinstance(v, str)}
    f["extra"] = extra
    return f


def _normalize_work(doc: dict) -> dict:
    f = empty_fields()
    f["title"] = doc.get("title")
    f["subtitle"] = doc.get("subtitle")
    names = doc.get("author_name") or []
    keys = doc.get("author_key") or []
    f["authors"] = [
        {"name": name, "url": f"{SITE}/authors/{keys[i]}" if i < len(keys) else None}
        for i, name in enumerate(names)
    ]
    f["publishers"] = [{"name": p} for p in (doc.get("publisher") or [])[:5]]
    f["subjects"] = [{"name": s, "url": None} for s in (doc.get("subject") or [])[:20]]
    year = doc.get("first_publish_year")
    f["publish_date"] = str(year) if year else None
    f["number_of_pages"] = doc.get("number_of_pages_median")
    languages = doc.get("language") or []
    f["language"] = language_code(languages[0]) if len(languages) == 1 else None
    f["covers"] = covers_from_url(_cover_url(doc.get("cover_i"), "M"))

    ids = isbn_identifiers(doc.get("isbn") or [])
    add_identifiers(ids, "openlibrary_work", (doc.get("key") or "").rsplit("/", 1)[-1])
    add_identifiers(ids, "archive", (doc.get("ia") or [])[:1])
    f["identifiers"] = ids

    extra: dict = {}
    if doc.get("edition_count"):
        extra["edition_count"] = doc["edition_count"]
    if year:
        extra["first_publish_year"] = year
    if doc.get("ratings_count"):
        extra["rating"] = {"average": doc.get("ratings_average"), "count": doc["ratings_count"], "source": NAME}
    f["extra"] = extra
    return f


def normalize(kind: str, payload: dict) -> dict:
    if kind == "edition":
        return _normalize_edition(payload)
    if kind == "work":
        return _normalize_work(payload)
    raise ValueError(f"Unknown Open Library payload kind: {kind}")
