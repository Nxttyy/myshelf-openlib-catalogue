"""
Google Books: the Volumes API, for ISBN lookups and title search.

Needs GOOGLE_BOOKS_API_KEY: Google's keyless quota for this API is zero, so
without a key the provider reports itself unconfigured and is skipped.

Payload kind:
    "volume"  one item from /books/v1/volumes (id, volumeInfo, saleInfo, accessInfo)
"""

from app.config import settings
from app.services.isbn import isbn_identifiers, to_isbn13
from app.services.sources.base import (
    SourceRecord,
    add_identifiers,
    empty_fields,
    get_json,
    https,
    plain_text,
)

NAME = "google"


def configured() -> bool:
    return bool(settings.GOOGLE_BOOKS_API_KEY)


def _record(volume: dict) -> SourceRecord:
    info = volume.get("volumeInfo") or {}
    return SourceRecord(
        provider=NAME,
        external_id=volume["id"],
        kind="volume",
        payload=volume,
        url=https(info.get("canonicalVolumeLink") or info.get("infoLink"))
        or f"https://books.google.com/books?id={volume['id']}",
    )


async def _volumes(params: dict) -> list[dict]:
    raw = await get_json(
        NAME, f"{settings.GOOGLE_BOOKS_BASE_URL}/volumes",
        {**params, "key": settings.GOOGLE_BOOKS_API_KEY},
    )
    items = raw.get("items") if isinstance(raw, dict) else None
    return [v for v in items or [] if isinstance(v, dict) and v.get("id")]


def _isbn13s(volume: dict) -> set[str]:
    ids = (volume.get("volumeInfo") or {}).get("industryIdentifiers") or []
    return {to_isbn13(i.get("identifier")) for i in ids if isinstance(i, dict)} - {None}


async def lookup_isbn(isbn: str) -> SourceRecord | None:
    """`isbn:` queries can return near misses (another edition, a book that
    merely mentions the number), so only a volume that lists this ISBN counts."""
    wanted = to_isbn13(isbn)
    for volume in await _volumes({"q": f"isbn:{isbn}", "maxResults": 5}):
        if wanted in _isbn13s(volume):
            return _record(volume)
    return None


async def search(query: str, limit: int) -> list[SourceRecord]:
    volumes = await _volumes({"q": query, "maxResults": min(limit, 40), "printType": "books"})
    return [_record(v) for v in volumes]


def _year(published: str | None) -> int | None:
    head = (published or "")[:4]
    return int(head) if head.isdigit() else None


def _image(url: str | None) -> str | None:
    """Google image links come as http:// with a page-curl effect baked in."""
    url = https(url)
    return url.replace("&edge=curl", "") if url else None


def hit(record: SourceRecord) -> dict:
    info = record.payload.get("volumeInfo") or {}
    images = info.get("imageLinks") or {}
    fields = normalize(record.kind, record.payload)
    ids = fields["identifiers"]
    return {
        "title": info.get("title", ""),
        "authors": info.get("authors") or [],
        "first_publish_year": _year(info.get("publishedDate")),
        "edition_count": None,
        "isbns": ids.get("isbn_13", []) + ids.get("isbn_10", []),
        "cover_url": _image(images.get("thumbnail") or images.get("smallThumbnail")),
    }


def _subjects(info: dict) -> list[dict]:
    """Categories are BISAC-style paths ("Fiction / Classics"); split them so
    each part reads as a subject on its own."""
    names: list[str] = []
    for category in [info.get("mainCategory"), *(info.get("categories") or [])]:
        for part in (category or "").split("/"):
            part = part.strip()
            if part and part.lower() not in (n.lower() for n in names) and part.lower() != "general":
                names.append(part)
    return [{"name": n, "url": None} for n in names]


def normalize(kind: str, payload: dict) -> dict:
    if kind != "volume":
        raise ValueError(f"Unknown Google Books payload kind: {kind}")
    info: dict = payload.get("volumeInfo") or {}
    access: dict = payload.get("accessInfo") or {}
    sale: dict = payload.get("saleInfo") or {}

    f = empty_fields()
    f["title"] = info.get("title")
    f["subtitle"] = info.get("subtitle")
    f["description"] = plain_text(info.get("description"))
    f["authors"] = [{"name": a, "url": None} for a in info.get("authors") or [] if a]
    f["publishers"] = [{"name": info["publisher"]}] if info.get("publisher") else []
    f["subjects"] = _subjects(info)
    f["publish_date"] = info.get("publishedDate")
    f["number_of_pages"] = info.get("pageCount") or info.get("printedPageCount") or None
    f["language"] = info.get("language")

    images = info.get("imageLinks") or {}
    if images:
        small = _image(images.get("smallThumbnail") or images.get("thumbnail"))
        medium = _image(images.get("thumbnail") or images.get("small") or images.get("smallThumbnail"))
        large = _image(
            images.get("extraLarge") or images.get("large") or images.get("medium")
            or images.get("small") or images.get("thumbnail")
        )
        f["covers"] = [{"small": small, "medium": medium, "large": large}]

    ids = isbn_identifiers([
        i.get("identifier") for i in info.get("industryIdentifiers") or []
        if isinstance(i, dict) and i.get("type") in ("ISBN_10", "ISBN_13")
    ])
    add_identifiers(ids, NAME, payload.get("id"))
    f["identifiers"] = ids

    extra: dict = {}
    if info.get("ratingsCount"):
        extra["rating"] = {"average": info.get("averageRating"), "count": info["ratingsCount"], "source": NAME}
    if info.get("maturityRating"):
        extra["maturity_rating"] = info["maturityRating"]
    if info.get("printType"):
        extra["print_type"] = info["printType"]
    if info.get("previewLink"):
        extra["preview_url"] = https(info["previewLink"])
    if info.get("dimensions"):
        extra["dimensions"] = info["dimensions"]
    if info.get("seriesInfo"):
        extra["series"] = info["seriesInfo"]
    viewability = access.get("viewability")
    if viewability:
        extra["viewability"] = viewability
        if viewability in ("PARTIAL", "ALL_PAGES") and access.get("webReaderLink"):
            extra["reader_url"] = https(access["webReaderLink"])
    if access.get("publicDomain"):
        extra["public_domain"] = True
    formats = {
        fmt: bool((access.get(fmt) or {}).get("isAvailable")) for fmt in ("epub", "pdf")
    }
    if any(formats.values()):
        extra["ebook_formats"] = [fmt for fmt, ok in formats.items() if ok]
    if sale.get("saleability") == "FOR_SALE" and sale.get("buyLink"):
        extra["buy_url"] = https(sale["buyLink"])
    f["extra"] = extra
    return f
