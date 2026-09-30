"""initial schema: users, measurements, measurement_state

Revision ID: 0001_initial
Revises:
Create Date: 2026-07-09

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("sso_provider", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "measurements",
        sa.Column("uuid", sa.String(), nullable=False),
        sa.Column("abs_path", sa.String(), nullable=True),
        sa.Column("source_format", sa.String(), nullable=True),
        sa.Column("uuid_origin", sa.String(), nullable=False),
        sa.Column("cryostat", sa.String(), nullable=True),
        sa.Column("sample", sa.String(), nullable=True),
        sa.Column("wafer_id", sa.String(), nullable=True),
        sa.Column("device_type", sa.String(), nullable=True),
        sa.Column("experiment", sa.String(), nullable=True),
        sa.Column("metadata_json", sa.String(), nullable=True),
        sa.Column("first_seen", sa.DateTime(), nullable=False),
        sa.Column("last_opened", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("uuid"),
    )
    op.create_index("ix_measurements_abs_path", "measurements", ["abs_path"])

    op.create_table(
        "measurement_state",
        sa.Column("uuid", sa.String(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("hearted", sa.Boolean(), nullable=False),
        sa.Column("trashed", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["uuid"], ["measurements.uuid"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("uuid", "user_id"),
    )
    op.create_index("ix_measurement_state_hearted", "measurement_state", ["hearted"])
    op.create_index("ix_measurement_state_trashed", "measurement_state", ["trashed"])


def downgrade() -> None:
    op.drop_index("ix_measurement_state_trashed", table_name="measurement_state")
    op.drop_index("ix_measurement_state_hearted", table_name="measurement_state")
    op.drop_table("measurement_state")
    op.drop_index("ix_measurements_abs_path", table_name="measurements")
    op.drop_table("measurements")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
