"""saved filter presets

Revision ID: 0009_filter_presets
Revises: 0008_user_settings
Create Date: 2026-09-29

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009_filter_presets"
down_revision: Union[str, None] = "0008_user_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "filter_presets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("filters_json", sa.String(), nullable=False, server_default="[]"),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_filter_presets_user_name"),
    )
    op.create_index("ix_filter_presets_user_id", "filter_presets", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_filter_presets_user_id", table_name="filter_presets")
    op.drop_table("filter_presets")
