"""
What every catalogue provider has in common.

A provider module (openlibrary.py, google_books.py, ...) exposes:

    NAME: str
    configured() -> bool
    async lookup_isbn(isbn) -> SourceRecord | None     (None: not found)
    async search(query, limit) -> list[SourceRecord]
    normalize(kind, payload) -> dict                    (the "fields" shape below)
    hit(record) -> dict                                 (a search result row)

and raises ProviderError when it can't answer (down, slow, rate-limited).

The "fields" shape is what a provider's payload normalises to, and what the
merged Book columns are built from:

    title, subtitle, description, publish_date, by_statement, language: str | None
    number_of_pages: int | None
    authors:    [{"name", "url"}]
    publishers: [{"name"}]
    subjects:   [{"name", "url"}]
    covers:     [{"small", "medium", "large"}]
    identifiers: {scheme: [values]}
    extra:      {name: value}
"""

import html
import re
from dataclasses import dataclass

import httpx

from app.config import settings

# Identify ourselves per Open Library's API etiquette (descriptive UA + contact).
USER_AGENT = f"Dora/0.1 (+mailto:{settings.CONTACT_EMAIL})"

FIELD_KEYS = (
    "title", "subtitle", "description", "authors", "publishers", "subjects",
    "publish_date", "number_of_pages", "by_statement", "language", "covers",
    "identifiers", "extra",
)


@dataclass
class SourceRecord:
    """One provider's answer about one book, before it's saved."""

    provider: str
    external_id: str
    kind: str
    payload: dict
    url: str | None = None


class ProviderError(Exception):
    """A provider couldn't answer. `status` is the HTTP status if there was one."""

    def __init__(self, provider: str, message: str, status: int | None = None, retry_after: str | None = None):
        super().__init__(f"{provider}: {message}")
        self.provider = provider
        self.status = status
        self.retry_after = retry_after


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=settings.BOOK_LOOKUP_TIMEOUT,
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
    )


async def get_json(provider: str, url: str, params: dict | None = None):
    """GET and decode JSON, turning every failure into a ProviderError."""
    try:
        async with client() as c:
            response = await c.get(url, params=params)
            response.raise_for_status()
            return response.json()
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        raise ProviderError(
            provider, f"returned {status}", status=status,
            retry_after=exc.response.headers.get("Retry-After"),
        ) from exc
    except (httpx.RequestError, ValueError) as exc:
        raise ProviderError(provider, f"unreachable ({type(exc).__name__})") from exc


def empty_fields() -> dict:
    return {
        "title": None, "subtitle": None, "description": None, "authors": [],
        "publishers": [], "subjects": [], "publish_date": None,
        "number_of_pages": None, "by_statement": None, "language": None,
        "covers": [], "identifiers": {}, "extra": {},
    }


def https(url: str | None) -> str | None:
    if isinstance(url, str) and url.startswith("http://"):
        return "https://" + url[len("http://"):]
    return url or None


_BREAKS = re.compile(r"<\s*(br|/p|/div|/li)\s*/?\s*>", re.I)
_TAGS = re.compile(r"<[^>]+>")


def plain_text(value: str | None) -> str | None:
    """Strip HTML (Google descriptions carry <p>, <b>, <br>) down to text."""
    if not isinstance(value, str):
        return None
    text = _BREAKS.sub("\n", value)
    text = html.unescape(_TAGS.sub("", text))
    text = "\n".join(" ".join(line.split()) for line in text.splitlines())
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text or None


def add_identifiers(target: dict, scheme: str, values) -> None:
    """Append string values under `scheme`, skipping blanks and repeats."""
    if values is None:
        return
    if not isinstance(values, (list, tuple)):
        values = [values]
    bucket = target.setdefault(scheme, [])
    for value in values:
        if value is None:
            continue
        value = str(value).strip()
        if value and value not in bucket:
            bucket.append(value)
    if not bucket:
        del target[scheme]


# MARC (Open Library, 3-letter) → ISO 639-1 for the languages we're likely
# to see; anything else is kept as given.
_LANGUAGES = {
    "eng": "en", "fre": "fr", "fra": "fr", "ger": "de", "deu": "de", "spa": "es",
    "ita": "it", "por": "pt", "rus": "ru", "jpn": "ja", "chi": "zh", "zho": "zh",
    "ara": "ar", "amh": "am", "dut": "nl", "nld": "nl", "swe": "sv", "nor": "no",
    "dan": "da", "fin": "fi", "pol": "pl", "tur": "tr", "gre": "el", "ell": "el",
    "heb": "he", "hin": "hi", "kor": "ko", "lat": "la", "per": "fa", "fas": "fa",
}


def language_code(raw: str | None) -> str | None:
    if not raw:
        return None
    code = raw.rsplit("/", 1)[-1].lower()
    return _LANGUAGES.get(code, code)
