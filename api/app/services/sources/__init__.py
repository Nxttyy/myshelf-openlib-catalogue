"""
Catalogue providers. To add one, write a module with the interface described
in base.py and list it in PROVIDERS, then give its fields a place in
catalogue.FIELD_PRIORITY if the default order doesn't suit.
"""

from app.services.sources import google_books, openlibrary
from app.services.sources.base import FIELD_KEYS, ProviderError, SourceRecord

# Every provider that can be asked about books, in default priority order.
PROVIDERS = {m.NAME: m for m in (openlibrary, google_books)}

# Hand-typed entries: not a provider you can query, but a source a book can
# have like any other.
MANUAL = "manual"


def normalize(provider: str, kind: str, payload: dict) -> dict:
    """A stored source's payload in the merged field shape."""
    if kind == "fields":
        # Already normalised (hand-typed entries, records from before sources
        # were kept whole). Default any key that's missing.
        return {key: payload.get(key) for key in FIELD_KEYS} | {
            "authors": payload.get("authors") or [],
            "publishers": payload.get("publishers") or [],
            "subjects": payload.get("subjects") or [],
            "covers": payload.get("covers") or [],
            "identifiers": payload.get("identifiers") or {},
            "extra": payload.get("extra") or {},
        }
    return PROVIDERS[provider].normalize(kind, payload)


__all__ = ["MANUAL", "PROVIDERS", "ProviderError", "SourceRecord", "normalize"]
