"""Create the plot_setups table.

Revision ID: 0010_plot_setups
Revises: 0009_filter_presets
Create Date: 2026-11-01

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010_plot_setups"
down_revision: Union[str, None] = "0009_filter_presets"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "plot_setups",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("setup_json", sa.String(), nullable=False, server_default="{}"),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_plot_setups_user_name"),
    )
    op.create_index("ix_plot_setups_user_id", "plot_setups", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_plot_setups_user_id", table_name="plot_setups")
    op.drop_table("plot_setups")
