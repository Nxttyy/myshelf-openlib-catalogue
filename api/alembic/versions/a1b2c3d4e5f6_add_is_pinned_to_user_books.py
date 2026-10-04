"""add_is_pinned_to_user_books

Revision ID: a1b2c3d4e5f6
Revises: 0724d4774c90
Create Date: 2026-06-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '0724d4774c90'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('user_books', sa.Column('is_pinned', sa.Boolean(), nullable=False, server_default='false'))


def downgrade() -> None:
    op.drop_column('user_books', 'is_pinned')
