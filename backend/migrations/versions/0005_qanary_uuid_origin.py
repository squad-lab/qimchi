"""measurements.uuid_origin: qcutils -> qanary

The measurement package qcutils was renamed to qanary, and
``shared/identity.py`` now records the new name as the origin of a native
``Measurement ID``. Rows written before the rename still say ``qcutils``, so
rewrite them rather than leave two spellings of one origin in the column.

Revision ID: 0005_qanary_uuid_origin
Revises: 0004_metadata_cache
Create Date: 2026-09-06

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005_qanary_uuid_origin"
down_revision: Union[str, None] = "0004_metadata_cache"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE measurements SET uuid_origin = 'qanary' WHERE uuid_origin = 'qcutils'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE measurements SET uuid_origin = 'qcutils' WHERE uuid_origin = 'qanary'"
    )
