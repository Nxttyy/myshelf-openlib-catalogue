"""add_films

Films (cached OMDb records), user_films (a film on someone's shelf), and
note photos for films: user_book_images gains user_film_id, and each photo
belongs to exactly one book entry or one film entry.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-10-15 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'films',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('imdb_id', sa.String(), nullable=False),
        sa.Column('type', sa.String(), nullable=False, server_default='movie'),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('year', sa.String(), nullable=True),
        sa.Column('rated', sa.String(), nullable=True),
        sa.Column('released', sa.Date(), nullable=True),
        sa.Column('runtime_min', sa.Integer(), nullable=True),
        sa.Column('genres', postgresql.JSONB(), nullable=False, server_default='[]'),
        sa.Column('director', sa.String(), nullable=True),
        sa.Column('writer', sa.String(), nullable=True),
        sa.Column('actors', sa.String(), nullable=True),
        sa.Column('plot', sa.String(), nullable=True),
        sa.Column('language', sa.String(), nullable=True),
        sa.Column('country', sa.String(), nullable=True),
        sa.Column('awards', sa.String(), nullable=True),
        sa.Column('poster_url', sa.String(), nullable=True),
        sa.Column('ratings', postgresql.JSONB(), nullable=False, server_default='[]'),
        sa.Column('imdb_rating', sa.Float(), nullable=True),
        sa.Column('imdb_votes', sa.Integer(), nullable=True),
        sa.Column('raw', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('fetched_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_films_imdb_id'), 'films', ['imdb_id'], unique=True)

    op.create_table(
        'user_films',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('film_id', sa.Uuid(), nullable=False),
        sa.Column('status', sa.String(), nullable=False, server_default='unread'),
        sa.Column('comment', sa.String(), nullable=True),
        sa.Column('is_public', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('is_pinned', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['film_id'], ['films.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'film_id', name='uq_user_films_user_film'),
    )
    op.create_index(op.f('ix_user_films_user_id'), 'user_films', ['user_id'])
    op.create_index(op.f('ix_user_films_film_id'), 'user_films', ['film_id'])

    op.alter_column('user_book_images', 'user_book_id', nullable=True)
    op.add_column('user_book_images', sa.Column('user_film_id', sa.Uuid(), nullable=True))
    op.create_foreign_key(
        'fk_user_book_images_user_film_id', 'user_book_images', 'user_films', ['user_film_id'], ['id']
    )
    op.create_index(op.f('ix_user_book_images_user_film_id'), 'user_book_images', ['user_film_id'])
    op.create_check_constraint(
        'ck_user_book_images_one_owner', 'user_book_images', 'num_nonnulls(user_book_id, user_film_id) = 1'
    )


def downgrade() -> None:
    op.execute('DELETE FROM user_book_images WHERE user_film_id IS NOT NULL')
    op.drop_constraint('ck_user_book_images_one_owner', 'user_book_images', type_='check')
    op.drop_index(op.f('ix_user_book_images_user_film_id'), table_name='user_book_images')
    op.drop_constraint('fk_user_book_images_user_film_id', 'user_book_images', type_='foreignkey')
    op.drop_column('user_book_images', 'user_film_id')
    op.alter_column('user_book_images', 'user_book_id', nullable=False)

    op.drop_index(op.f('ix_user_films_film_id'), table_name='user_films')
    op.drop_index(op.f('ix_user_films_user_id'), table_name='user_films')
    op.drop_table('user_films')
    op.drop_index(op.f('ix_films_imdb_id'), table_name='films')
    op.drop_table('films')
