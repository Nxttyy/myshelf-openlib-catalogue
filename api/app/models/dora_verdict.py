"""
DoraVerdict — a cached Ask Dora answer for one user and one item. It holds
only while the user's library is unchanged: library_sig is a hash of what
was on the shelf when Dora answered.
"""

from datetime import datetime
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Column, Field, SQLModel


class DoraVerdict(SQLModel, table=True):
    __tablename__ = "dora_verdicts"
    __table_args__ = (
        sa.UniqueConstraint("user_id", "media", "item_key", name="uq_dora_verdicts_item"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)
    media: str  # films (books may use it later)
    item_key: str  # IMDb ID for films
    library_sig: str
    verdict: dict = Field(sa_column=Column(sa.dialects.postgresql.JSONB, nullable=False))
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
