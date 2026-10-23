"""
ISBN shape checks and ISBN-10 → ISBN-13 conversion.

The catalogue indexes every book under its ISBN-13 (converting ISBN-10s), so a
book first found by the 10-digit number on an old copy is matched when someone
later scans the 13-digit barcode on a newer printing of the same edition.
"""


def clean_isbn(raw: str | None) -> str | None:
    """Strip separators and check the shape; None if it isn't a plausible
    ISBN-10/13. Checksums aren't verified: barcodes and catalogue records with
    a bad check digit still exist, and rejecting them helps nobody."""
    if not raw:
        return None
    isbn = raw.replace("-", "").replace(" ", "").strip().upper()
    if len(isbn) not in (10, 13):
        return None
    if not isbn[:-1].isdigit() or isbn[-1] not in "0123456789X":
        return None
    if len(isbn) == 13 and not isbn.isdigit():
        return None
    return isbn


def normalize_isbn(raw: str) -> str:
    """Like clean_isbn, but raises so malformed barcodes (e.g. "08/35110745",
    short/long scans) surface as a 404 instead of hitting the providers."""
    isbn = clean_isbn(raw)
    if isbn is None:
        raise ValueError(f"Invalid ISBN: {raw}")
    return isbn


def isbn10_to_13(isbn10: str) -> str:
    body = "978" + isbn10[:9]
    total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(body))
    return body + str((10 - total % 10) % 10)


def to_isbn13(raw: str | None) -> str | None:
    """The canonical (ISBN-13) form of any plausible ISBN, or None."""
    isbn = clean_isbn(raw)
    if isbn is None:
        return None
    return isbn if len(isbn) == 13 else isbn10_to_13(isbn)


def isbn_identifiers(raws: list[str]) -> dict[str, list[str]]:
    """{"isbn_13": [...], "isbn_10": [...]} for a list of mixed ISBNs, in
    first-seen order. Every ISBN-10 also contributes its ISBN-13."""
    out: dict[str, list[str]] = {"isbn_13": [], "isbn_10": []}
    for raw in raws:
        isbn = clean_isbn(raw)
        if isbn is None:
            continue
        if len(isbn) == 10:
            if isbn not in out["isbn_10"]:
                out["isbn_10"].append(isbn)
            isbn = isbn10_to_13(isbn)
        if isbn not in out["isbn_13"]:
            out["isbn_13"].append(isbn)
    return {k: v for k, v in out.items() if v}
