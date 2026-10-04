"""add_archive_id_and_description_to_books

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-06-04 00:00:01.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'd2e3f4a5b6c7'
down_revision: Union[str, Sequence[str], None] = 'c1d2e3f4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('books', sa.Column('description', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.add_column('books', sa.Column('archive_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.create_index(op.f('ix_books_archive_id'), 'books', ['archive_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_books_archive_id'), table_name='books')
    op.drop_column('books', 'archive_id')
    op.drop_column('books', 'description')
