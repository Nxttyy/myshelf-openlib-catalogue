"""add_user_book_images

Revision ID: b2c3d4e5f6a7
Revises: e3f4a5b6c7d8
Create Date: 2026-07-17 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'e3f4a5b6c7d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_book_images',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_book_id', sa.Uuid(), nullable=False),
        sa.Column('s3_key', sa.String(), nullable=False),
        sa.Column('content_type', sa.String(), nullable=False),
        sa.Column('byte_size', sa.Integer(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('status', sa.String(), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_book_id'], ['user_books.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('s3_key'),
    )
    op.create_index(op.f('ix_user_book_images_user_book_id'), 'user_book_images', ['user_book_id'])


def downgrade() -> None:
    op.drop_index(op.f('ix_user_book_images_user_book_id'), table_name='user_book_images')
    op.drop_table('user_book_images')
