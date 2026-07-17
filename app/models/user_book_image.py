"""
UserBookImage — photos attached to a UserBook's note.
"""

from datetime import datetime
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Column, Field, SQLModel


class UserBookImage(SQLModel, table=True):
    __tablename__ = "user_book_images"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_book_id: UUID = Field(foreign_key="user_books.id", index=True)
    s3_key: str = Field(unique=True)
    content_type: str
    byte_size: int
    position: int = Field(default=0)
    # pending until the client confirms the S3 upload landed; uploaded once verified.
    status: str = Field(default="pending")

    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
