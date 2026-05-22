"""
UserBook — relationship table between users and books.
"""

from datetime import datetime
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Column, Field, SQLModel


class UserBook(SQLModel, table=True):
    __tablename__ = "user_books"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)
    book_id: UUID = Field(foreign_key="books.id", index=True)
    status: str = Field(default='unread')
    comment: str | None = None
    is_public: bool = Field(default=True)

    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
