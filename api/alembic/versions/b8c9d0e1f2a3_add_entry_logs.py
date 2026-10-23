"""add_entry_logs

The diary log on a shelf entry (folio/diary.jsx): how much you enjoyed a
book or film on six criteria, when you finished it, where, who with, and
how many times. One log per entry, in entry_logs; "not rated yet" is no row.
companions are the people a user adds to say who they read or watched with
(names only, private to that user, not Dora accounts).

Also makes user_book_images cascade when its shelf entry is deleted, which
"Remove from library" needs (the S3 objects are deleted by the endpoint).

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-10-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b8c9d0e1f2a3'
down_revision: Union[str, Sequence[str], None] = 'a7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _image_fks(ondelete):
    op.drop_constraint('user_book_images_user_book_id_fkey', 'user_book_images', type_='foreignkey')
    op.drop_constraint('fk_user_book_images_user_film_id', 'user_book_images', type_='foreignkey')
    op.create_foreign_key(
        'user_book_images_user_book_id_fkey', 'user_book_images', 'user_books',
        ['user_book_id'], ['id'], ondelete=ondelete,
    )
    op.create_foreign_key(
        'fk_user_book_images_user_film_id', 'user_book_images', 'user_films',
        ['user_film_id'], ['id'], ondelete=ondelete,
    )


def upgrade() -> None:
    _image_fks('CASCADE')

    op.create_table(
        'companions',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('initials', sa.String(length=3), nullable=False),
        sa.Column('color', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(op.f('ix_companions_user_id'), 'companions', ['user_id'])

    op.create_table(
        'entry_logs',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('user_book_id', sa.Uuid(), sa.ForeignKey('user_books.id', ondelete='CASCADE'), nullable=True),
        sa.Column('user_film_id', sa.Uuid(), sa.ForeignKey('user_films.id', ondelete='CASCADE'), nullable=True),
        sa.Column('scores', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('finished_on', sa.Date(), nullable=True),
        sa.Column('finished_on_precision', sa.String(), nullable=True),
        sa.Column('place', sa.String(), nullable=True),
        sa.Column('times', sa.SmallInteger(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('user_book_id'),
        sa.UniqueConstraint('user_film_id'),
        sa.CheckConstraint('(user_book_id IS NULL) <> (user_film_id IS NULL)', name='ck_entry_logs_one_entry'),
        sa.CheckConstraint('times >= 1', name='ck_entry_logs_times'),
        sa.CheckConstraint(
            "finished_on_precision IS NULL OR finished_on_precision IN ('day', 'month', 'year')",
            name='ck_entry_logs_precision',
        ),
    )

    op.create_table(
        'entry_log_companions',
        sa.Column('log_id', sa.Uuid(), sa.ForeignKey('entry_logs.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('companion_id', sa.Uuid(), sa.ForeignKey('companions.id', ondelete='CASCADE'), primary_key=True),
    )
    op.create_index(op.f('ix_entry_log_companions_companion_id'), 'entry_log_companions', ['companion_id'])


def downgrade() -> None:
    op.drop_index(op.f('ix_entry_log_companions_companion_id'), table_name='entry_log_companions')
    op.drop_table('entry_log_companions')
    op.drop_table('entry_logs')
    op.drop_index(op.f('ix_companions_user_id'), table_name='companions')
    op.drop_table('companions')
    _image_fks(None)
