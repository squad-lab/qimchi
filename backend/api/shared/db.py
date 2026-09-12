"""
Qimchi database engine, session factory and startup init.

SQLite via SQLModel/SQLAlchemy (sync engine). Blocking DB calls are run off the
event loop with ``asyncio.to_thread`` in the routers, consistent with the repo
convention. WAL is enabled for concurrent reads + a single writer, which stays
correct under the current single uvicorn worker and hedges if that ever changes.

Migrations (Alembic) own the schema; see ``migrations/`` and ``run_migrations``.

"""

import sqlite3
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from fastapi import HTTPException
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlmodel import Session, create_engine, select

from ..db_models import LOCAL_USER_EMAIL, LOCAL_USER_ID, User
from ..logger import logger
from .paths import db_path

_engine: Engine | None = None

# Whether startup migrations succeeded. Library/notes endpoints consult this so
# a broken database degrades visibly (503 + reason) instead of either taking the
# whole app down or silently accepting writes it cannot persist.
_db_ready: bool = False
_db_error: str | None = None


def set_db_status(ready: bool, error: str | None) -> None:
    """Record the outcome of startup DB init (called from ``main.lifespan``)."""
    global _db_ready, _db_error
    _db_ready = ready
    _db_error = error


def db_status() -> tuple[bool, str | None]:
    """Return ``(ready, error_reason)`` for the Qimchi database."""
    return _db_ready, _db_error


def require_db() -> None:
    """
    Guard for endpoints that need the database.

    Raises 503 with the startup failure reason so the UI can tell the user *why*
    hearts/tags/notes are unavailable rather than surfacing an opaque 500.

    """
    if not _db_ready:
        raise HTTPException(
            status_code=503,
            detail=(
                "The Qimchi library database is unavailable, so hearts, tags and "
                "notes cannot be saved. Plotting is unaffected. Reason: "
                f"{_db_error or 'unknown'}"
            ),
        )


@event.listens_for(Engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, _connection_record) -> None:
    """Enable WAL, enforce foreign keys, and set a busy timeout on every
    SQLite connection. Applied engine-wide; harmless for non-SQLite engines
    (none are used here)."""
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
    finally:
        cursor.close()


def get_engine() -> Engine:
    """Return the process-wide SQLite engine, creating it on first use."""
    global _engine
    if _engine is None:
        url = f"sqlite:///{db_path().as_posix()}"
        # check_same_thread=False: the engine is shared across threads spawned
        # by asyncio.to_thread; WAL + busy_timeout serialize writes safely.
        _engine = create_engine(url, connect_args={"check_same_thread": False})
        logger.info("Qimchi DB engine created at %s", db_path())
    return _engine


@contextmanager
def session_scope() -> Iterator[Session]:
    """Provide a transactional session scope (commit on success, rollback on error)."""
    session = Session(get_engine())
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _migrations_dir() -> Path:
    """Locate the ``migrations/`` directory in dev and in a frozen bundle."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        frozen = Path(sys._MEIPASS) / "migrations"  # type: ignore[attr-defined]
        if frozen.is_dir():
            return frozen
    # backend/api/shared/db.py -> backend/migrations
    return Path(__file__).resolve().parents[2] / "migrations"


def _backup_database(backup: Path) -> bool:
    """
    Snapshot the live database to ``backup``, returning True on success.

    Uses SQLite's online-backup API rather than a file copy. Under WAL, freshly
    committed rows can still live in ``qimchi.db-wal`` -- and SQLAlchemy's pool
    holds the connection open, so no checkpoint has necessarily happened. A
    plain ``shutil.copy2`` of ``qimchi.db`` therefore silently omits them, which
    would hand back an incomplete library exactly when a failed auto-update
    migration made the backup matter. ``backup()`` reads through the WAL and
    writes a single consolidated, already-checkpointed file.

    """
    # Drop any stale sidecars so the backup is never confused with a live DB.
    for suffix in ("-wal", "-shm"):
        Path(str(backup) + suffix).unlink(missing_ok=True)
    try:
        source = sqlite3.connect(f"file:{db_path()}?mode=ro", uri=True)
        try:
            # isolation_level=None: autocommit, so the PRAGMA below can run.
            target = sqlite3.connect(str(backup), isolation_level=None)
            try:
                source.backup(target)
                # backup() inherits the source's WAL header, which would leave
                # the backup as a 3-file set. Restoring is "copy this one file
                # over qimchi.db", so collapse it to a self-contained DB --
                # otherwise a restore drops whatever sat in the backup's -wal.
                target.execute("PRAGMA journal_mode=DELETE")
            finally:
                target.close()
        finally:
            source.close()
    except (sqlite3.Error, OSError):
        logger.exception("Failed to back up DB before migration: %s", backup)
        backup.unlink(missing_ok=True)
        return False
    logger.info("Backed up DB before migration: %s", backup)
    return True


def _alembic_config() -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(_migrations_dir()))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path().as_posix()}")
    return cfg


def run_migrations() -> None:
    """
    Bring the database up to ``head``, backing it up first if an *existing*
    database is being upgraded (never on a fresh create). Guards against the
    on-disk schema being *newer* than the app (a downgrade after installing an
    older build) by refusing to run rather than corrupting data.

    """
    cfg = _alembic_config()
    script = ScriptDirectory.from_config(cfg)
    head = script.get_current_head()

    # Connecting also creates the (empty) SQLite file on first run.
    with get_engine().connect() as conn:
        current = MigrationContext.configure(conn).get_current_revision()

    if current == head:
        return  # already up to date

    if current is not None:
        known = {rev.revision for rev in script.walk_revisions()}
        if current not in known:
            raise RuntimeError(
                f"Qimchi DB schema revision {current!r} is unknown to this build "
                f"(head={head!r}). The database was likely written by a newer "
                f"version of Qimchi. Refusing to migrate to avoid data loss."
            )
        # Existing, older DB -> back it up before upgrading.
        backup = db_path().with_name(f"{db_path().name}.bak-{current}")
        if not _backup_database(backup):
            raise RuntimeError(
                f"Could not create a pre-migration backup at {backup}. Refusing to "
                f"migrate {db_path()} from {current!r} to {head!r} unprotected."
            )

    command.upgrade(cfg, "head")
    logger.info("DB migrated to head (%s)", head)


def seed_local_user() -> None:
    """Ensure the implicit desktop ``local`` user exists (id=1)."""
    with session_scope() as session:
        existing = session.get(User, LOCAL_USER_ID)
        if existing is None:
            # Guard against a pre-existing row with the same email but no/other id.
            by_email = session.exec(
                select(User).where(User.email == LOCAL_USER_EMAIL)
            ).first()
            if by_email is None:
                session.add(
                    User(id=LOCAL_USER_ID, email=LOCAL_USER_EMAIL, name="Local")
                )
                logger.info("Seeded local user (id=%s)", LOCAL_USER_ID)
