"""
Shared links: what a link to a book, film or note photo says when it's
pasted into a chat app or posted (title, description, preview card), and
whether it may say anything at all.

Links, as the web app builds them (web/src/lib/share.ts):
    /u/<handle>?book=<id>[&photo=<image id>]       someone's copy, their note photo
    /u/<handle>/films?film=<id>[&photo=<image id>]
    /explore?book=<id>, /explore/films?film=<id>   the catalogue record
    /u/<handle>, /u/<handle>/films                 the whole shelf

Only public things are described: a private profile, a private entry or a
photo on one reads like the bare page. The same checks guard the cards
(routers/og.py), so neither leaks what the page itself wouldn't show.
"""

import hashlib
import html
import re
from dataclasses import dataclass
from urllib.parse import urlencode, urlparse
from uuid import UUID

from sqlmodel import select

from app.config import settings
from app.db import SessionDep
from app.models.book import Book
from app.models.film import Film
from app.models.user import User
from app.models.user_book import UserBook
from app.models.user_book_image import UserBookImage
from app.models.user_film import UserFilm
from app.services.og_card import DESIGN_VERSION, Card, Jacket

BOOK_STATUS = {"unread": "Unread", "reading": "Reading", "read": "Read"}
FILM_STATUS = {"unread": "Not watched", "reading": "Watching", "read": "Watched"}


def base_url() -> str:
    return settings.PUBLIC_URL.rstrip("/")


def site_name() -> str:
    """The address printed on cards, e.g. dora.you.et."""
    return urlparse(settings.PUBLIC_URL).netloc or "dora.you.et"


def _uuid(value: str | None) -> UUID | None:
    try:
        return UUID(value) if value else None
    except ValueError:
        return None


def _clip(s: str, n: int) -> str:
    s = " ".join(s.split())
    return s if len(s) <= n else s[:n].rsplit(" ", 1)[0].rstrip(",.;:") + "…"


async def public_owner(session: SessionDep, handle: str | None) -> User | None:
    if not handle:
        return None
    owner = (await session.exec(select(User).where(User.username == handle))).first()
    return owner if owner and owner.is_profile_public else None


def _year(b: Book) -> str | None:
    """lib/covers.ts: the first four-digit run in the publish date."""
    m = re.search(r"\d{4}", b.publish_date or "")
    return m.group(0) if m else None


# ── What's being shared ─────────────────────────────────────────────────

@dataclass
class Shared:
    """A book or film, and, when shared from a profile, that person's
    public copy of it (and maybe one photo from its note)."""
    kind: str                            # "book" | "film"
    item: Book | Film
    owner: User | None = None
    entry: UserBook | UserFilm | None = None
    photo: UserBookImage | None = None

    @property
    def handle(self) -> str | None:
        return self.owner.username if self.owner else None

    # words

    def byline(self) -> str:
        if self.kind == "book":
            names = [a.get("name") for a in self.item.authors if a.get("name")]
            return ", ".join(names[:2])
        f = self.item
        return f.director or (f.writer or "").split(",")[0].strip()

    def title(self) -> str:
        """Simple and precise: "Stoner by John Williams",
        "Paris, Texas (1984) by Wim Wenders"."""
        name = self.item.title
        if self.kind == "film" and self.item.year:
            name += f" ({self.item.year})"
        by = self.byline()
        return f"{name} by {by}" if by else name

    def status(self) -> str:
        labels = BOOK_STATUS if self.kind == "book" else FILM_STATUS
        return labels.get(self.entry.status, "") if self.entry else ""

    def label(self) -> str:
        """The small line above the title on the card."""
        if self.photo:
            return f"Photo from @{self.handle}'s note"
        if self.entry:
            if self.entry.status == "unread":
                return f"On @{self.handle}'s shelf"
            return f"@{self.handle} · {self.status()}"
        if self.kind == "book":
            b = self.item
            return " · ".join(p for p in (_year(b), f"{b.number_of_pages} pages" if b.number_of_pages else None) if p)
        f = self.item
        runtime = f"{f.runtime_min // 60}h {f.runtime_min % 60}m" if f.runtime_min and f.runtime_min >= 60 else (
            f"{f.runtime_min}m" if f.runtime_min else None)
        return " · ".join(p for p in ("Series" if f.type == "series" else "Film", f.year, runtime) if p)

    def description(self) -> str:
        note = self.entry.comment.strip() if self.entry and self.entry.comment else ""
        if self.photo:
            lead = f"A photo from @{self.handle}'s note on {self.item.title}."
            return lead + (f' "{_clip(note, 140)}"' if note else "")
        if self.entry:
            lead = f"On @{self.handle}'s shelf" + (f" · {self.status()}" if self.entry.status != "unread" else "")
            return lead + (f' · "{_clip(note, 140)}"' if note else "")
        text = self.item.description if self.kind == "book" else self.item.plot
        if text:
            return _clip(text, 200)
        return "On Dora, a record of the books people own." if self.kind == "book" else (
            "On Dora, a record of the films people watch.")

    # links

    def page_url(self) -> str:
        params = {self.kind: str(self.item.id)}
        if self.photo:
            params["photo"] = str(self.photo.id)
        if self.owner:
            path = f"/u/{self.handle}" + ("/films" if self.kind == "film" else "")
        else:
            path = "/explore" + ("/films" if self.kind == "film" else "")
        return f"{base_url()}{path}?{urlencode(params)}"

    def card(self) -> Card:
        if self.kind == "book":
            b = self.item
            jacket = Jacket(
                key=str(b.id), title=b.title, author=self.byline().split(",")[0] or "Unknown",
                year=_year(b), pages=b.number_of_pages,
                catalog=((b.isbns or [None])[0] or str(b.id).replace("-", ""))[-5:],
            )
        else:
            f = self.item
            jacket = Jacket(key=f.imdb_id, title=f.title, author=self.byline() or "Unknown", year=f.year)
        return Card(title=self.item.title, byline=self.byline(), label=self.label(), jacket=jacket)

    def fingerprint(self) -> str:
        """Changes whenever the card would look different, so a new card
        gets a new URL (and a new cache entry) instead of a stale one."""
        c = self.card()
        parts = [str(DESIGN_VERSION), self.kind, str(self.item.id), c.title, c.byline, c.label, cover_source(self) or "",
                 str(self.photo.id) if self.photo else ""]
        return hashlib.sha1("\x1f".join(parts).encode()).hexdigest()[:12]

    def image_url(self) -> str:
        if self.photo:
            path = f"/og/photo/{self.photo.id}.jpg"
            params = {}
        else:
            path = f"/og/{self.kind}/{self.item.id}.jpg"
            params = {"u": self.handle} if self.owner else {}
        params["v"] = self.fingerprint()
        return f"{base_url()}{path}?{urlencode(params)}"


def cover_source(s: Shared) -> str | None:
    """Where the cover image comes from: "s3:<key>" or an http(s) URL."""
    if s.kind == "book":
        b = s.item
        if b.cover_s3_key:
            return "s3:" + b.cover_s3_key
        c = b.covers[0] if b.covers else {}
        url = c.get("large") or c.get("medium") or c.get("small")
        return url if url and url.startswith("http") else None
    return s.item.poster_url


def bigger_poster(url: str) -> str | None:
    """OMDb's posters are 300 to 380px wide. Amazon serves the same image at
    any width when the size part of the name changes (`._V1_SX900.jpg`)."""
    if "media-amazon.com" not in url:
        return None
    big = re.sub(r"\._V1_[^/]*\.jpg$", "._V1_SX900.jpg", url)
    return big if big != url else None


async def _entry(session: SessionDep, kind: str, owner: User, item_id: UUID):
    Entry, col = (UserBook, UserBook.book_id) if kind == "book" else (UserFilm, UserFilm.film_id)
    entry = (await session.exec(select(Entry).where(Entry.user_id == owner.id, col == item_id))).first()
    return entry if entry and entry.is_public else None


async def resolve(
    session: SessionDep, kind: str, item_id: UUID, handle: str | None = None, photo_id: UUID | None = None,
) -> Shared | None:
    """The thing a link shares, or None if it doesn't exist. Asked for from
    a profile that's private, or where the entry isn't public, it comes back
    as None too, so nothing about that shelf shows."""
    item = await session.get(Book if kind == "book" else Film, item_id)
    if item is None:
        return None
    if handle is None:
        return Shared(kind, item)
    owner = await public_owner(session, handle)
    entry = await _entry(session, kind, owner, item_id) if owner else None
    if entry is None:
        return None
    shared = Shared(kind, item, owner, entry)
    if photo_id:
        photo = await session.get(UserBookImage, photo_id)
        if photo and photo.status == "uploaded" and entry.id == (photo.user_book_id if kind == "book" else photo.user_film_id):
            shared.photo = photo
    return shared


async def resolve_photo(session: SessionDep, photo_id: UUID) -> Shared | None:
    """A note photo on its own (the photo card), with the same checks."""
    photo = await session.get(UserBookImage, photo_id)
    if not photo or photo.status != "uploaded":
        return None
    if photo.user_book_id:
        entry = await session.get(UserBook, photo.user_book_id)
        kind, item_id = "book", entry.book_id if entry else None
    else:
        entry = await session.get(UserFilm, photo.user_film_id)
        kind, item_id = "film", entry.film_id if entry else None
    if not entry or not entry.is_public:
        return None
    owner = await session.get(User, entry.user_id)
    if not owner or not owner.is_profile_public or not owner.username:
        return None
    shared = await resolve(session, kind, item_id, owner.username, photo_id)
    return shared if shared and shared.photo else None


# ── Page tags ───────────────────────────────────────────────────────────

def _tags(title: str, description: str, url: str, image: str | None, page_title: str | None = None) -> str:
    e = lambda s: html.escape(s, quote=True)  # noqa: E731
    tags = [
        f"<title>{e(page_title or title)}</title>",
        f'<meta name="description" content="{e(description)}" />',
        f'<meta property="og:title" content="{e(title)}" />',
        f'<meta property="og:description" content="{e(description)}" />',
        f'<meta property="og:url" content="{e(url)}" />',
        '<meta property="og:site_name" content="Dora" />',
        '<meta property="og:type" content="website" />',
    ]
    if image:
        tags += [
            f'<meta property="og:image" content="{e(image)}" />',
            '<meta property="og:image:type" content="image/jpeg" />',
            '<meta property="og:image:width" content="1200" />',
            '<meta property="og:image:height" content="630" />',
            f'<meta property="og:image:alt" content="{e(title)}" />',
            '<meta name="twitter:card" content="summary_large_image" />',
            f'<meta name="twitter:image" content="{e(image)}" />',
        ]
    else:
        tags.append('<meta name="twitter:card" content="summary" />')
    return "".join(tags)


async def _profile_tags(session: SessionDep, handle: str, films: bool) -> str | None:
    """The whole shelf: "Natty (@natty) on Dora"."""
    owner = await public_owner(session, handle)
    if not owner:
        return None
    Entry = UserFilm if films else UserBook
    count = len((await session.exec(
        select(Entry.id).where(Entry.user_id == owner.id, Entry.is_public == True)  # noqa: E712
    )).all())
    name = " ".join(p for p in (owner.firstname, owner.lastname) if p.strip()) or "@" + handle
    if films:
        desc = f"{count} {'film' if count == 1 else 'films'} on their shelf. A record of the films they watch."
    else:
        desc = f"{count} {'book' if count == 1 else 'books'} on their shelf. A record of the books they own."
    url = f"{base_url()}/u/{handle}" + ("/films" if films else "")
    return _tags(f"{name} (@{handle}) on Dora", desc, url, None)


async def page_tags(session: SessionDep, path: str, query: dict) -> str | None:
    """Title and link-preview tags for an app page, or None to leave the
    page's own <title>. Chat apps and social sites don't run JavaScript, so
    these have to be in the HTML the server sends."""
    parts = path.strip("/").split("/")
    films = parts[-1] == "films"
    kind = "film" if films else "book"
    item_id = _uuid(query.get(kind))

    if parts[0] == "u" and len(parts) in (2, 3) and parts[1] and (len(parts) == 2 or films):
        handle = parts[1]
        if item_id:
            shared = await resolve(session, kind, item_id, handle, _uuid(query.get("photo")))
            if shared:
                t = shared.title()
                return _tags(t, shared.description(), shared.page_url(), shared.image_url(), f"{t} · Dora")
        return await _profile_tags(session, handle, films)

    if parts[0] == "explore" and len(parts) in (1, 2) and item_id and (len(parts) == 1 or films):
        shared = await resolve(session, kind, item_id)
        if shared:
            t = shared.title()
            return _tags(t, shared.description(), shared.page_url(), shared.image_url(), f"{t} · Dora")
    return None
