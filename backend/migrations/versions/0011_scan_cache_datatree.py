"""Remember which Explorer containers are xarray DataTrees.

Revision ID: 0011_scan_cache_datatree
Revises: 0010_plot_setups
Create Date: 2026-11-10

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011_scan_cache_datatree"
down_revision: Union[str, None] = "0010_plot_setups"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "dataset_scan_cache", sa.Column("datatree_nodes", sa.String(), nullable=True)
    )


def downgrade() -> None:
    with op.batch_alter_table("dataset_scan_cache") as batch_op:
        batch_op.drop_column("datatree_nodes")
