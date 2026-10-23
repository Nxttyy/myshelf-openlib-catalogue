"""add_book_sources

Books stop being shaped around Open Library: each provider's record of a book
becomes a book_sources row (raw payload kept whole), every identifier gets a
book_identifiers row for lookups, and books keeps the merged display fields
(plus language, extra and source_links).

Existing books get one source each, holding a snapshot of their current
fields (kind "fields", since the raw Open Library response was never kept;
scripts/refetch_books.py can replace it with the real thing). Identifiers are
normalised on the way: every ISBN-10 also gets its ISBN-13, and Open Library
keys and Internet Archive ids move into `identifiers`.

Non-destructive: the old Open Library columns are dropped in the next
revision, so this one can run while the previous code is still serving.

Revision ID: f1a2b3c4d5e6
Revises: e5f6a7b8c9d0
Create Date: 2026-10-23 00:00:00.000000

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Copies of services/isbn.py as it was when this ran.
def _clean_isbn(raw):
    if not isinstance(raw, str):
        return None
    isbn = raw.replace('-', '').replace(' ', '').strip().upper()
    if len(isbn) not in (10, 13) or not isbn[:-1].isdigit() or isbn[-1] not in '0123456789X':
        return None
    if len(isbn) == 13 and not isbn.isdigit():
        return None
    return isbn


def _isbn10_to_13(isbn10):
    body = '978' + isbn10[:9]
    total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(body))
    return body + str((10 - total % 10) % 10)


def _add(ids, scheme, values):
    bucket = ids.setdefault(scheme, [])
    for value in values if isinstance(values, list) else [values]:
        if value is None:
            continue
        value = str(value).strip()
        if value and value not in bucket:
            bucket.append(value)
    if not bucket:
        del ids[scheme]


def _jsonb(value, default):
    if value is None:
        return default
    return json.loads(value) if isinstance(value, str) else value


def _https(url):
    if isinstance(url, str) and url.startswith('http://'):
        return 'https://' + url[len('http://'):]
    return url or None


def upgrade() -> None:
    op.add_column('books', sa.Column('language', sa.String(), nullable=True))
    op.add_column('books', sa.Column('extra', postgresql.JSONB(), nullable=False, server_default='{}'))
    op.add_column('books', sa.Column('source_links', postgresql.JSONB(), nullable=False, server_default='[]'))

    op.create_table(
        'book_sources',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('book_id', sa.Uuid(), sa.ForeignKey('books.id', ondelete='CASCADE'), nullable=False),
        sa.Column('provider', sa.String(), nullable=False),
        sa.Column('external_id', sa.String(), nullable=False),
        sa.Column('kind', sa.String(), nullable=False),
        sa.Column('url', sa.String(), nullable=True),
        sa.Column('payload', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('fetched_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('provider', 'external_id'),
    )
    op.create_index(op.f('ix_book_sources_book_id'), 'book_sources', ['book_id'])

    op.create_table(
        'book_identifiers',
        sa.Column('scheme', sa.String(), primary_key=True),
        sa.Column('value', sa.String(), primary_key=True),
        sa.Column('book_id', sa.Uuid(), sa.ForeignKey('books.id', ondelete='CASCADE'), nullable=False),
    )
    op.create_index(op.f('ix_book_identifiers_book_id'), 'book_identifiers', ['book_id'])

    bind = op.get_bind()
    books = bind.execute(sa.text("""
        SELECT id, title, subtitle, description, authors, publishers, subjects,
               publish_date, number_of_pages, by_statement, covers, isbns,
               identifiers, openbook_key, openbook_url, archive_id, source,
               updated_at
        FROM books
        ORDER BY created_at
    """)).mappings().all()

    for b in books:
        ids = {}
        old_ids = _jsonb(b['identifiers'], {})
        for scheme, values in old_ids.items():
            if scheme not in ('isbn_10', 'isbn_13'):
                _add(ids, scheme, values if isinstance(values, list) else [values])
        raw_isbns = list(_jsonb(b['isbns'], [])) + list(old_ids.get('isbn_13') or []) + list(old_ids.get('isbn_10') or [])
        for raw in raw_isbns:
            isbn = _clean_isbn(raw)
            if isbn is None:
                continue
            if len(isbn) == 10:
                _add(ids, 'isbn_10', isbn)
                isbn = _isbn10_to_13(isbn)
            _add(ids, 'isbn_13', isbn)
        key = b['openbook_key'] or ''
        if key.startswith('/works/'):
            _add(ids, 'openlibrary_work', key.rsplit('/', 1)[-1])
        elif key.startswith('/books/'):
            _add(ids, 'openlibrary', key.rsplit('/', 1)[-1])
        if b['archive_id']:
            _add(ids, 'archive', b['archive_id'])

        fields = {
            'title': b['title'], 'subtitle': b['subtitle'], 'description': b['description'],
            'authors': _jsonb(b['authors'], []), 'publishers': _jsonb(b['publishers'], []),
            'subjects': _jsonb(b['subjects'], []), 'publish_date': b['publish_date'],
            'number_of_pages': b['number_of_pages'], 'by_statement': b['by_statement'],
            'language': None, 'covers': _jsonb(b['covers'], []), 'identifiers': ids, 'extra': {},
        }

        if b['source'] == 'manual':
            provider, external_id, url = 'manual', str(b['id']), None
        else:
            provider = b['source']
            external_id = key or f"legacy:{b['id']}"
            url = _https(b['openbook_url']) or (f'https://openlibrary.org{key}' if key else None)

        bind.execute(
            sa.text("""
                INSERT INTO book_sources (id, book_id, provider, external_id, kind, url, payload, fetched_at)
                VALUES (gen_random_uuid(), :book_id, :provider, :external_id, 'fields', :url,
                        CAST(:payload AS JSONB), :fetched_at)
                ON CONFLICT (provider, external_id) DO NOTHING
            """),
            {'book_id': b['id'], 'provider': provider, 'external_id': external_id, 'url': url,
             'payload': json.dumps(fields), 'fetched_at': b['updated_at']},
        )
        bind.execute(
            sa.text("""
                UPDATE books
                SET identifiers = CAST(:ids AS JSONB), isbns = CAST(:isbns AS JSONB),
                    source_links = CAST(:links AS JSONB)
                WHERE id = :id
            """),
            {'id': b['id'], 'ids': json.dumps(ids),
             'isbns': json.dumps(ids.get('isbn_13', []) + ids.get('isbn_10', [])),
             'links': json.dumps([{'provider': provider, 'url': url}] if url else [])},
        )
        for scheme, values in ids.items():
            for value in values:
                bind.execute(
                    sa.text("""
                        INSERT INTO book_identifiers (scheme, value, book_id)
                        VALUES (:scheme, :value, :book_id)
                        ON CONFLICT DO NOTHING
                    """),
                    {'scheme': scheme, 'value': value, 'book_id': b['id']},
                )


def downgrade() -> None:
    # identifiers/isbns keep their normalised values; both are still valid in
    # the old shape (ISBN-13 copies of ISBN-10s are just extra entries).
    op.drop_index(op.f('ix_book_identifiers_book_id'), table_name='book_identifiers')
    op.drop_table('book_identifiers')
    op.drop_index(op.f('ix_book_sources_book_id'), table_name='book_sources')
    op.drop_table('book_sources')
    op.drop_column('books', 'source_links')
    op.drop_column('books', 'extra')
    op.drop_column('books', 'language')
