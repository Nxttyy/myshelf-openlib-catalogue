"""
Username helpers — slugifying and generating unique, shareable usernames.

The public profile lives at /u/{username}, so usernames must be unique and
URL-safe (lowercase letters, digits, hyphen, underscore; 3–30 chars).
"""

import re

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models.user import User

USERNAME_RE = re.compile(r"^[a-z0-9_-]{3,30}$")


def slugify_username(raw: str) -> str:
    """Reduce arbitrary text (e.g. an email local part) to a valid username base."""
    slug = re.sub(r"[^a-z0-9_-]", "", (raw or "").lower())
    if len(slug) < 3:
        slug = (slug + "user")  # pad short/empty bases so they pass validation
    return slug[:30]


async def generate_unique_username(session: AsyncSession, base: str) -> str:
    """Return a unique username derived from `base`, appending a counter on clash."""
    base = slugify_username(base)
    candidate = base
    i = 2
    while (await session.exec(select(User).where(User.username == candidate))).first():
        suffix = str(i)
        candidate = f"{base[:30 - len(suffix)]}{suffix}"
        i += 1
    return candidate
