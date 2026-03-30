"""
Pydantic schemas for User — API request/response validation.
"""

from uuid import UUID

from pydantic import BaseModel, EmailStr


class UserCreate(BaseModel):
    firstname: str
    lastname: str
    email: EmailStr
    password: str


class UserRead(BaseModel):
    """Public-facing user data — never exposes password."""

    id: UUID
    firstname: str
    lastname: str
    email: str
    is_google_user: bool
    is_profile_public: bool

    model_config = {"from_attributes": True}
