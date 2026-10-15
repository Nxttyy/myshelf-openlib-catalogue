"""
UserFilm — relationship table between users and films. Mirrors UserBook,
statuses included (unread | reading | read), which the app labels
Not watched / Watching / Watched.
"""

from datetime import datetime
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Column, Field, SQLModel


class UserFilm(SQLModel, table=True):
    __tablename__ = "user_films"
    __table_args__ = (sa.UniqueConstraint("user_id", "film_id", name="uq_user_films_user_film"),)

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)
    film_id: UUID = Field(foreign_key="films.id", index=True)
    status: str = Field(default="unread")
    comment: str | None = None
    is_public: bool = Field(default=True)
    is_pinned: bool = Field(default=False)

    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
