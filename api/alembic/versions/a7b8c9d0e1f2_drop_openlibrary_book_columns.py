"""drop_openlibrary_book_columns

Drops the Open Library-only columns from books now that book_sources and
book_identifiers hold that information: openbook_key/openbook_url (the
Open Library source's external_id/url), archive_id (identifiers.archive) and
publish_dates (in the Open Library payload).

Run after the code that reads book_sources is deployed.

Revision ID: a7b8c9d0e1f2
Revises: f1a2b3c4d5e6
Create Date: 2026-10-23 00:00:01.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'a7b8c9d0e1f2'
down_revision: Union[str, Sequence[str], None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index(op.f('ix_books_openbook_key'), table_name='books')
    op.drop_index(op.f('ix_books_openbook_url'), table_name='books')
    op.drop_index(op.f('ix_books_archive_id'), table_name='books')
    op.drop_column('books', 'openbook_key')
    op.drop_column('books', 'openbook_url')
    op.drop_column('books', 'archive_id')
    op.drop_column('books', 'publish_dates')


def downgrade() -> None:
    op.add_column('books', sa.Column('publish_dates', postgresql.JSONB(), nullable=False, server_default='[]'))
    op.add_column('books', sa.Column('archive_id', sa.String(), nullable=True))
    op.add_column('books', sa.Column('openbook_url', sa.String(), nullable=True))
    op.add_column('books', sa.Column('openbook_key', sa.String(), nullable=True))

    # Refill from each book's best Open Library source (edition over work).
    # (provider, external_id) is unique, so no key lands on two books.
    op.execute("""
        UPDATE books b
        SET openbook_key = s.external_id, openbook_url = s.url
        FROM (
            SELECT DISTINCT ON (book_id) book_id, external_id, url
            FROM book_sources
            WHERE provider = 'openlibrary'
            ORDER BY book_id, (kind = 'work'), fetched_at DESC
        ) s
        WHERE s.book_id = b.id
    """)
    op.execute("UPDATE books SET archive_id = identifiers->'archive'->>0")

    op.create_index(op.f('ix_books_openbook_key'), 'books', ['openbook_key'], unique=True)
    op.create_index(op.f('ix_books_openbook_url'), 'books', ['openbook_url'])
    op.create_index(op.f('ix_books_archive_id'), 'books', ['archive_id'])
