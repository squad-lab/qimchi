"""
The pre-migration database backup.

A plain file copy of qimchi.db once produced a backup holding 0 of 1 rows:
under WAL, freshly committed rows can still sit in qimchi.db-wal, and
SQLAlchemy's pool keeps the connection open so nothing has checkpointed. These
tests pin the three properties that fix depends on -- the backup reads through
the WAL, it is a single self-contained file, and a failure aborts the migration
rather than proceeding unprotected.

"""

import sqlite3

import pytest

from api.db_models import LOCAL_USER_ID, Tag
from api.shared import db as db_mod


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    monkeypatch.setenv("QIMCHI_HOME", str(tmp_path / "home"))
    db_mod._engine = None  # force a new engine at the new path
    yield
    db_mod._engine = None


def _rows(path) -> int:
    """Count tags in a database file, opened read-only and standalone."""
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return conn.execute("SELECT COUNT(*) FROM tags").fetchone()[0]
    finally:
        conn.close()


def test_backup_includes_rows_still_sitting_in_the_wal(tmp_path):
    """
    The regression this function exists for.

    The row is committed but not checkpointed, and the pooled connection stays
    open -- which is exactly when a file copy loses it.

    """
    db_mod.run_migrations()
    db_mod.seed_local_user()

    with db_mod.session_scope() as session:
        session.add(Tag(user_id=LOCAL_USER_ID, name="cold"))

    # The engine still holds its connection, so the WAL has not been folded in.
    assert db_mod.db_path().with_name(db_mod.db_path().name + "-wal").exists()

    backup = tmp_path / "backup.db"
    assert db_mod._backup_database(backup) is True

    assert _rows(backup) == 1


def test_the_backup_is_one_self_contained_file(tmp_path):
    """
    Restoring is "copy this file over qimchi.db", so it must not need sidecars.

    backup() inherits the source's WAL header; without collapsing it, a restore
    would silently drop whatever sat in the backup's own -wal.

    """
    db_mod.run_migrations()
    db_mod.seed_local_user()
    with db_mod.session_scope() as session:
        session.add(Tag(user_id=LOCAL_USER_ID, name="warm"))

    backup = tmp_path / "backup.db"
    db_mod._backup_database(backup)

    conn = sqlite3.connect(str(backup))
    try:
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
    finally:
        conn.close()
    assert mode.lower() == "delete"
    assert not (tmp_path / "backup.db-wal").exists()


def test_a_stale_sidecar_is_cleared_before_writing(tmp_path):
    """A leftover -wal would make the new backup read as a 3-file set."""
    db_mod.run_migrations()
    backup = tmp_path / "backup.db"
    stale = tmp_path / "backup.db-wal"
    stale.write_bytes(b"stale")

    db_mod._backup_database(backup)

    assert not stale.exists()


def test_a_failed_backup_reports_failure_and_leaves_nothing_behind(
    tmp_path, monkeypatch
):
    def _boom(*_args, **_kwargs):
        raise sqlite3.Error("disk full")

    monkeypatch.setattr(db_mod.sqlite3, "connect", _boom)

    backup = tmp_path / "backup.db"
    assert db_mod._backup_database(backup) is False
    # A half-written file must not be mistaken for a usable backup.
    assert not backup.exists()


def test_migration_refuses_to_run_when_the_backup_fails(tmp_path, monkeypatch):
    """
    Migrating unprotected is the one outcome worse than not migrating.

    """
    db_mod.run_migrations()  # create at head
    db_mod.seed_local_user()

    # Pretend the DB is at an older revision so a backup is attempted.
    monkeypatch.setattr(db_mod, "_backup_database", lambda _backup: False)

    class _OldRevision:
        def get_current_revision(self):
            return "0001_initial"

    monkeypatch.setattr(
        db_mod.MigrationContext, "configure", staticmethod(lambda _conn: _OldRevision())
    )

    with pytest.raises(RuntimeError, match="Refusing to migrate"):
        db_mod.run_migrations()


def test_migration_refuses_a_schema_newer_than_this_build(monkeypatch):
    """A downgrade must not silently rewrite a newer schema."""
    db_mod.run_migrations()

    class _UnknownRevision:
        def get_current_revision(self):
            return "9999_from_the_future"

    monkeypatch.setattr(
        db_mod.MigrationContext,
        "configure",
        staticmethod(lambda _conn: _UnknownRevision()),
    )

    with pytest.raises(RuntimeError, match="unknown to this build"):
        db_mod.run_migrations()
