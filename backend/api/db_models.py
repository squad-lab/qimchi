"""
Database models used by Qimchi.

The database lives at ``~/.qimchi/qimchi.db`` and contains tables for users,
user settings, measurements, measurement state (hearts/trash), notes, tags,
and measurement-tag relationships.

The schema is managed by Alembic in ``backend/migrations``.Any changes to
these models should therefore be accompanied by a matching migration,
so existing databases stay compatible.

A few implementation details are worth keeping in mind:

- Measurements are identified by UUID rather than ``abs_path``. This keeps the
  database independent of where a dataset happens to live and makes future
  cross-node syncing easier. ``shared/identity.py`` resolves the UUID from the
  qanary ``Measurement ID`` when available, then a QCoDeS run ``guid``, and
  finally a content-signature-based UUID5. ``measurements.uuid_origin`` records
  which method was used.

- ``user_id`` is included in the schema from the beginning. Desktop Qimchi uses
  a single implicit ``local`` user (``LOCAL_USER_ID``), which leaves room for
  authentication or multiple users later without changing the basic data model.

- ``measurements`` also acts as the metadata cache. ``metadata_json`` stores the
  ``/load-attrs/`` payload, while ``source_fingerprint`` stores the filesystem
  signature used to determine whether that cached metadata is still current.
  See ``api/library.py`` for the corresponding logic.

- ``notes`` and ``measurement_tags`` intentionally do not have foreign keys to
  ``measurements``. This allows notes and tags to be attached to datasets that
  have not been registered in the library, such as QCoDeS runs or other
  artefacts.
"""

from datetime import datetime, timezone

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

# The implicit single-user id used in desktop (no-auth) mode.
LOCAL_USER_ID = 1
LOCAL_USER_EMAIL = "local"


def _utcnow() -> datetime:
    """Timezone-aware UTC now (stored as-is; SQLite keeps the ISO string)."""
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    """An application user. Desktop mode seeds a single ``local`` row."""

    __tablename__ = "users"

    id: int | None = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True)
    name: str | None = None
    sso_provider: str | None = None


class UserSettings(SQLModel, table=True):
    """
    Frontend-owned preference overrides stored as one JSON document.

    Only values the user changed are stored. Everything else falls back to the
    defaults in code, so adding a setting needs no migration.

    """

    __tablename__ = "user_settings"

    user_id: int = Field(primary_key=True, foreign_key="users.id")
    settings_json: str = "{}"
    updated_at: datetime = Field(default_factory=_utcnow)


class Measurement(SQLModel, table=True):
    """A measurement keyed by stable UUID, with a node-local path and attrs cache."""

    __tablename__ = "measurements"

    uuid: str = Field(primary_key=True)
    abs_path: str | None = Field(default=None, index=True)
    source_format: str | None = None  # zarr | netcdf | qcodes | csv | ...
    uuid_origin: str = "qanary"  # where the UUID came from
    cryostat: str | None = None
    sample: str | None = None
    wafer_id: str | None = None
    device_type: str | None = None
    experiment: str | None = None
    metadata_json: str | None = None  # cached attrs (JSON string)
    # Dataset mtime and size when metadata_json was written.
    source_fingerprint: str | None = None
    first_seen: datetime = Field(default_factory=_utcnow)
    last_opened: datetime = Field(default_factory=_utcnow)


class MeasurementState(SQLModel, table=True):
    """Per-user heart/trash state for a measurement (DirTree filters)."""

    __tablename__ = "measurement_state"

    uuid: str = Field(primary_key=True, foreign_key="measurements.uuid")
    user_id: int = Field(primary_key=True, foreign_key="users.id")
    hearted: bool = Field(default=False, index=True)
    trashed: bool = Field(default=False, index=True)
    updated_at: datetime = Field(default_factory=_utcnow)


class Note(SQLModel, table=True):
    """
    Per-user measurement notes (the DB is the source of truth).

    ``uuid`` is the Qimchi measurement identity. ``run_id`` is zero for the
    overall measurement note and the QCoDeS run integer for a run-wise note.
    It is intentionally NOT foreign-keyed to ``measurements`` so legacy notes
    can still be imported before their measurement is registered.
    """

    __tablename__ = "notes"

    uuid: str = Field(primary_key=True)
    user_id: int = Field(primary_key=True, foreign_key="users.id")
    run_id: int = Field(default=0, primary_key=True)
    body: str = ""
    updated_at: datetime = Field(default_factory=_utcnow)


class Tag(SQLModel, table=True):
    """A user-defined label (Gmail-style). Unique by (user_id, name)."""

    __tablename__ = "tags"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_tags_user_name"),)

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    name: str


class MeasurementTag(SQLModel, table=True):
    """Association of a tag with a measurement (by UUID). Not FK-constrained on
    ``uuid`` so it stays flexible; the DirTree resolves it via ``measurements``."""

    __tablename__ = "measurement_tags"

    uuid: str = Field(primary_key=True)
    tag_id: int = Field(primary_key=True, foreign_key="tags.id", index=True)


class FilterPreset(SQLModel, table=True):
    """A named filter sequence and its options."""

    __tablename__ = "filter_presets"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_filter_presets_user_name"),
    )

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    name: str
    filters_json: str = "[]"
    updated_at: datetime = Field(default_factory=_utcnow)


class DatasetScanCache(SQLModel, table=True):
    """
    Node-local Explorer scan cache keyed by absolute path.

    Size and mtime remain valid while the store fingerprint matches.
    """

    __tablename__ = "dataset_scan_cache"

    abs_path: str = Field(primary_key=True)
    fingerprint: str
    size_bytes: int = 0
    last_modified: float = 0.0
    updated_at: datetime = Field(default_factory=_utcnow)
