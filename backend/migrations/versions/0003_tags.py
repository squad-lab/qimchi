"""tags + measurement_tags

Revision ID: 0003_tags
Revises: 0002_notes
Create Date: 2026-07-09

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003_tags"
down_revision: Union[str, None] = "0002_notes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tags",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_tags_user_name"),
    )
    op.create_index("ix_tags_user_id", "tags", ["user_id"])

    op.create_table(
        "measurement_tags",
        sa.Column("uuid", sa.String(), nullable=False),
        sa.Column("tag_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"]),
        sa.PrimaryKeyConstraint("uuid", "tag_id"),
    )
    op.create_index(
        "ix_measurement_tags_tag_id", "measurement_tags", ["tag_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_measurement_tags_tag_id", table_name="measurement_tags")
    op.drop_table("measurement_tags")
    op.drop_index("ix_tags_user_id", table_name="tags")
    op.drop_table("tags")
