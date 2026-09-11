"""dataset_scan_cache (Explorer scan cache)

A zarr store holds one file per chunk, so deriving its size and modification
time costs a directory walk per dataset -- on a tree of a few thousand
measurements that dominated the whole Explorer scan. This table keeps those two
values against the store's stat fingerprint, so an unchanged dataset is free on
every scan after the first.

Keyed on abs_path, not the measurement UUID: resolving a UUID means opening the
dataset, which is the cost being avoided. The table holds nothing the user
owns, so dropping it only makes the next scan slower.

Revision ID: 0006_dataset_scan_cache
Revises: 0005_qanary_uuid_origin
Create Date: 2026-09-11

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006_dataset_scan_cache"
down_revision: Union[str, None] = "0005_qanary_uuid_origin"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "dataset_scan_cache",
        sa.Column("abs_path", sa.String(), primary_key=True),
        sa.Column("fingerprint", sa.String(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_modified", sa.Float(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("dataset_scan_cache")
