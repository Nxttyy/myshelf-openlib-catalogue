"""add_manual_books

Adds the columns needed for user-authored catalogue entries (books with no
Open Library record) and relaxes the Open Library identity columns to nullable
— a manual book has no key/url. Postgres allows many NULLs under a unique
index, so the openbook_key uniqueness constraint survives untouched.

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-07-31 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'books',
        sa.Column('source', sa.String(), nullable=False, server_default='openlibrary'),
    )
    op.add_column('books', sa.Column('created_by_user_id', sa.Uuid(), nullable=True))
    op.add_column('books', sa.Column('cover_s3_key', sa.String(), nullable=True))
    op.create_index(op.f('ix_books_source'), 'books', ['source'])
    op.create_index(op.f('ix_books_created_by_user_id'), 'books', ['created_by_user_id'])
    op.create_foreign_key(
        'fk_books_created_by_user_id_users', 'books', 'users',
        ['created_by_user_id'], ['id'],
    )

    op.alter_column('books', 'openbook_url', existing_type=sa.VARCHAR(), nullable=True)
    op.alter_column('books', 'openbook_key', existing_type=sa.VARCHAR(), nullable=True)


def downgrade() -> None:
    # Manual books have no Open Library identity, so they must go before the
    # NOT NULL constraints can come back — along with everything referencing them.
    op.execute("""
        DELETE FROM user_book_images WHERE user_book_id IN (
            SELECT ub.id FROM user_books ub
            JOIN books b ON b.id = ub.book_id
            WHERE b.source = 'manual'
        )
    """)
    op.execute("""
        DELETE FROM user_books WHERE book_id IN (
            SELECT id FROM books WHERE source = 'manual'
        )
    """)
    op.execute("DELETE FROM books WHERE source = 'manual'")
    op.execute("UPDATE books SET openbook_url = '' WHERE openbook_url IS NULL")
    op.execute("UPDATE books SET openbook_key = '' WHERE openbook_key IS NULL")
    op.alter_column('books', 'openbook_key', existing_type=sa.VARCHAR(), nullable=False)
    op.alter_column('books', 'openbook_url', existing_type=sa.VARCHAR(), nullable=False)

    op.drop_constraint('fk_books_created_by_user_id_users', 'books', type_='foreignkey')
    op.drop_index(op.f('ix_books_created_by_user_id'), table_name='books')
    op.drop_index(op.f('ix_books_source'), table_name='books')
    op.drop_column('books', 'cover_s3_key')
    op.drop_column('books', 'created_by_user_id')
    op.drop_column('books', 'source')
