"""
ScanSession — cross-device barcode scanning hand-off.

A desktop creates a session (shows a QR code); a phone opens the session URL and
posts scanned ISBNs into it; the desktop reads them back. Persisted in Postgres
so the hand-off survives server restarts and works across multiple worker
processes (an in-memory dict would be invisible to other workers).
"""

from datetime import datetime
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Column, Field, SQLModel


class ScanSession(SQLModel, table=True):
    __tablename__ = "scan_sessions"

    token: UUID = Field(default_factory=uuid4, primary_key=True)
    isbns: list[str] = Field(
        default_factory=list,
        sa_column=Column(sa.dialects.postgresql.JSONB, nullable=False, server_default="[]"),
    )
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(sa.DateTime, nullable=False, server_default=sa.func.now(), index=True),
    )
