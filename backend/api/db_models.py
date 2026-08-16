"""
SQLModel table definitions for the Qimchi database (``~/.qimchi/qimchi.db``).

Tables: ``users``, ``measurements``, ``measurement_state`` (hearts/trash),
``notes``, ``tags`` and ``measurement_tags``. Alembic owns the schema
(``backend/migrations``, head ``0004_metadata_cache``) -- changing a model
here needs a matching migration, or an existing database will not match.

- Everything keys on the measurement UUID, never on ``abs_path`` -- so future
  cross-node sync stays additive. ``shared/identity.py`` resolves it: the
  qcutils ``Measurement ID``, else a QCoDeS run ``guid``, else a
  content-signature uuid5. ``measurements.uuid_origin`` records which tier
  answered.
- ``user_id`` is present from the start; desktop runs a single implicit
  ``local`` user (``LOCAL_USER_ID``), so auth stays additive too.
- ``measurements`` doubles as the metadata cache: ``metadata_json`` holds the
  ``/load-attrs/`` payload and ``source_fingerprint`` the stat signature it
  was built from (see ``api/library.py``).
- ``notes`` and ``measurement_tags`` are deliberately NOT foreign-keyed to
  ``measurements``, so datasets the library never registered (QCoDeS runs,
  artefacts) can still carry them.

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


class Measurement(SQLModel, table=True):
    """
    A measurement, identified by its node-stable UUID.

    ``abs_path`` is node-local (for resolution/Explorer only) and is never used
    as a key. ``metadata_json`` caches the dataset attrs loaded on first open;
    the dataset on disk remains the source of truth.

    """

    __tablename__ = "measurements"

    uuid: str = Field(primary_key=True)
    abs_path: str | None = Field(default=None, index=True)
    source_format: str | None = None  # zarr | netcdf | qcodes | csv | ...
    uuid_origin: str = "qcutils"  # where the UUID came from
    cryostat: str | None = None
    sample: str | None = None
    wafer_id: str | None = None
    device_type: str | None = None
    experiment: str | None = None
    metadata_json: str | None = None  # cached attrs (JSON string)
    # Cheap stat signature (mtime+size) of the dataset when metadata_json was
    # written. The cache is only served when this still matches, so an edited
    # dataset is reloaded rather than serving stale attrs.
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

    ``uuid`` is the measurement key (the dataset filename stem, matching the
    legacy ``.md`` sidecar naming). It is intentionally NOT a foreign key to
    ``measurements`` so notes work for datasets that were never registered via
    the library (e.g. QCoDeS/sqlite runs and artefacts, which have no writable
    sidecar location). A ``.md`` mirror + the pooled sample rollup are still
    written when ``QIMCHI_NOTES_MD_EXPORT`` is enabled.

    """

    __tablename__ = "notes"

    uuid: str = Field(primary_key=True)
    user_id: int = Field(primary_key=True, foreign_key="users.id")
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
