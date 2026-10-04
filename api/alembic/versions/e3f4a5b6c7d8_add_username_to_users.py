"""add_username_to_users

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
Create Date: 2026-06-04 00:00:02.000000

"""
import re
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e3f4a5b6c7d8'
down_revision: Union[str, Sequence[str], None] = 'd2e3f4a5b6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _slugify(raw: str) -> str:
    slug = re.sub(r"[^a-z0-9_-]", "", (raw or "").lower())
    if len(slug) < 3:
        slug = slug + "user"
    return slug[:30]


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('username', sa.String(), nullable=True))

    # Backfill from each email's local part, de-duplicating collisions
    # (e.g. two different domains that share a local part).
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, email FROM users ORDER BY created_at, id")).fetchall()
    used: set[str] = set()
    for row in rows:
        base = _slugify((row.email or "").split("@")[0])
        candidate, i = base, 2
        while candidate in used:
            suffix = str(i)
            candidate = f"{base[:30 - len(suffix)]}{suffix}"
            i += 1
        used.add(candidate)
        bind.execute(
            sa.text("UPDATE users SET username = :u WHERE id = :id"),
            {"u": candidate, "id": row.id},
        )

    op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_users_username'), table_name='users')
    op.drop_column('users', 'username')
