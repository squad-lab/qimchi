"""measurements.source_fingerprint (metadata read-through cache)

``metadata_json`` was already written on every open but never read back, so
metadata was re-loaded from disk every time. Serving it from the cache needs a
way to tell whether the file changed underneath us: ``source_fingerprint``
stores a cheap stat-derived signature (mtime + size), and a mismatch means the
cached attrs are discarded and reloaded.

Revision ID: 0004_metadata_cache
Revises: 0003_tags
Create Date: 2026-08-16

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004_metadata_cache"
down_revision: Union[str, None] = "0003_tags"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "measurements",
        sa.Column("source_fingerprint", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("measurements", "source_fingerprint")
