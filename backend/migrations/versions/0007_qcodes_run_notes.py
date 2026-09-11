"""key notes by measurement and QCoDeS run

Revision ID: 0007_qcodes_run_notes
Revises: 0006_dataset_scan_cache
Create Date: 2026-09-11

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007_qcodes_run_notes"
down_revision: Union[str, None] = "0006_dataset_scan_cache"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite cannot alter a primary key in place. Rebuild the small notes table
    # and preserve every existing note as the overall (run_id=0) note.
    op.rename_table("notes", "notes_before_run_ids")
    op.create_table(
        "notes",
        sa.Column("uuid", sa.String(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("body", sa.String(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("uuid", "user_id", "run_id"),
    )
    op.execute(
        """
        INSERT INTO notes (uuid, user_id, run_id, body, updated_at)
        SELECT uuid, user_id, 0, body, updated_at FROM notes_before_run_ids
        """
    )
    op.drop_table("notes_before_run_ids")


def downgrade() -> None:
    # Older versions have room for the overall note only. Run-wise notes cannot
    # be represented by their two-column primary key and are intentionally
    # discarded during a downgrade.
    op.rename_table("notes", "notes_with_run_ids")
    op.create_table(
        "notes",
        sa.Column("uuid", sa.String(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("body", sa.String(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("uuid", "user_id"),
    )
    op.execute(
        """
        INSERT INTO notes (uuid, user_id, body, updated_at)
        SELECT uuid, user_id, body, updated_at
        FROM notes_with_run_ids WHERE run_id = 0
        """
    )
    op.drop_table("notes_with_run_ids")
