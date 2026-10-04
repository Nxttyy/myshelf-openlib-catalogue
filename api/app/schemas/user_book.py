"""
Pydantic schemas for UserBook — API request/response validation.
"""

from uuid import UUID

from pydantic import BaseModel


class UserBookCreate(BaseModel):
    book_id: UUID
    comment: str | None = None
    is_public: bool = True


class UserBookRead(BaseModel):
    id: UUID
    user_id: UUID
    book_id: UUID
    comment: str | None = None
    is_public: bool

    model_config = {"from_attributes": True}
