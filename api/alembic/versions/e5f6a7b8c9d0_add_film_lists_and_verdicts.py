"""add_film_lists_and_verdicts

Pasted film lists and Ask Dora for films: films gain title_norm (filled in
for existing rows), film_title_lookups remembers OMDb's answer per title,
and dora_verdicts caches Ask Dora answers per user.

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-10-20 00:00:00.000000

"""
import re
import unicodedata
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _norm(title: str) -> str:
    # A copy of omdb.norm_title as it was when this ran.
    s = unicodedata.normalize('NFD', title.lower())
    s = ''.join(c for c in s if not unicodedata.combining(c)).replace('&', 'and')
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def upgrade() -> None:
    op.add_column('films', sa.Column('title_norm', sa.String(), nullable=True))
    op.create_index(op.f('ix_films_title_norm'), 'films', ['title_norm'])
    conn = op.get_bind()
    for film_id, title in conn.execute(sa.text('SELECT id, title FROM films')).all():
        conn.execute(sa.text('UPDATE films SET title_norm = :n WHERE id = :id'), {'n': _norm(title), 'id': film_id})

    op.create_table(
        'film_title_lookups',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('title_norm', sa.String(), nullable=False),
        sa.Column('year', sa.String(), nullable=False, server_default=''),
        sa.Column('type', sa.String(), nullable=False, server_default=''),
        sa.Column('imdb_id', sa.String(), nullable=True),
        sa.Column('checked_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('title_norm', 'year', 'type', name='uq_film_title_lookups_key'),
    )

    op.create_table(
        'dora_verdicts',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('media', sa.String(), nullable=False),
        sa.Column('item_key', sa.String(), nullable=False),
        sa.Column('library_sig', sa.String(), nullable=False),
        sa.Column('verdict', postgresql.JSONB(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'media', 'item_key', name='uq_dora_verdicts_item'),
    )
    op.create_index(op.f('ix_dora_verdicts_user_id'), 'dora_verdicts', ['user_id'])


def downgrade() -> None:
    op.drop_index(op.f('ix_dora_verdicts_user_id'), table_name='dora_verdicts')
    op.drop_table('dora_verdicts')
    op.drop_table('film_title_lookups')
    op.drop_index(op.f('ix_films_title_norm'), table_name='films')
    op.drop_column('films', 'title_norm')
