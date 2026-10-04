"""
User — SQLModel DB table.
"""

from datetime import datetime
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Column, Field, SQLModel


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    firstname: str
    lastname: str
    email: str = Field(unique=True, index=True)
    username: str | None = Field(default=None, unique=True, index=True)
    password: str
    is_google_user: bool = Field(default=False)
    is_profile_public: bool = Field(default=True)

    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    updated_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(
            sa.DateTime,
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )


class UserCreate(SQLModel):
    firstname: str
    lastname: str
    email: str
    password: str


class UserLogin(SQLModel):
    email: str
    password: str


class Token(SQLModel):
    access_token: str
    token_type: str


class TokenData(SQLModel):
    email: str | None = None
