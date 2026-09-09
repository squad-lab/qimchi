"""Regression tests for DB-backed measurement notes."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from threading import Barrier
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from api import notes
from api.db_models import LOCAL_USER_ID, Note
from api.models import NotesData, PathData


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    """Point the DB at a scratch file and migrate it, per test."""
    monkeypatch.setenv("QIMCHI_HOME", str(tmp_path / "home"))
    from api.shared import db as db_mod

    db_mod._engine = None
    db_mod.run_migrations()
    db_mod.seed_local_user()
    yield
    if db_mod._engine is not None:
        db_mod._engine.dispose()
    db_mod._engine = None


def test_concurrent_first_writes_upsert_instead_of_colliding(monkeypatch):
    """Two requests that both observe no note must not race on INSERT."""
    from api.shared import db as db_mod

    readers = Barrier(2)

    @contextmanager
    def synchronized_session_scope():
        session = Session(db_mod.get_engine())

        class SynchronizedSession:
            def get(self, *args, **kwargs):
                result = session.get(*args, **kwargs)
                readers.wait(timeout=5)
                return result

            def __getattr__(self, name):
                return getattr(session, name)

        try:
            yield SynchronizedSession()
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    monkeypatch.setattr(notes, "session_scope", synchronized_session_scope)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(notes._db_upsert_note, "same-uuid", f"body-{index}")
            for index in range(2)
        ]
        for future in futures:
            future.result(timeout=10)

    with Session(db_mod.get_engine()) as session:
        stored = session.get(Note, ("same-uuid", LOCAL_USER_ID))

    assert stored is not None
    assert stored.body in {"body-0", "body-1"}


def test_frontmatter_and_timestamp_helpers():
    when = datetime(2026, 1, 2, 3, 4, tzinfo=timezone.utc)
    rendered = notes._make_frontmatter("run", when) + "body\n"

    assert notes._parse_frontmatter(rendered) == (
        "body\n",
        "2026-01-02T03:04:00+00:00",
        "run",
    )
    assert notes._parse_frontmatter("") == ("", None, None)
    assert notes._parse_frontmatter("plain text") == ("plain text", None, None)
    assert notes._parse_iso("2026-01-02T03:04:00+00:00") == when
    assert notes._parse_iso("not-a-date").tzinfo is not None


def test_note_path_helpers_and_dataset_metadata(tmp_path, monkeypatch):
    measurement = tmp_path / "sample" / "experiment" / "run.zarr"
    uuid, note_dir, note_path = notes._measurement_notes_paths(measurement)
    assert (uuid, note_dir.name, note_path.name) == ("run", "run", "run.md")
    assert notes._infer_sample_dir_from_measurement_path(measurement).name == "sample"

    closed = []
    dataset = SimpleNamespace(
        attrs={"Sample Name": " chip ", "Cryostat": " fridge "},
        close=lambda: closed.append(True),
    )
    monkeypatch.setattr(notes, "_detect_filesystem_format", lambda _path: "zarr")
    monkeypatch.setattr(notes, "load_xarray_dataset", lambda *_args: dataset)

    assert notes._read_dataset_names(measurement) == ("chip", "fridge")
    filename, sample_dir, sample_path = notes._sample_notes_path(measurement)
    assert filename == "fridge_chip.md"
    assert sample_dir.name == "sample"
    assert sample_path == sample_dir / filename
    assert closed == [True, True]

    monkeypatch.setattr(
        notes, "load_xarray_dataset", lambda *_args: (_ for _ in ()).throw(OSError())
    )
    assert notes._read_dataset_names(measurement) == (None, None)


def test_ensure_file_and_rollup_text_helpers(tmp_path):
    note_path = tmp_path / "run" / "run.md"
    notes._ensure_notes_file(note_path, "run")
    original = note_path.read_text(encoding="utf-8")
    notes._ensure_notes_file(note_path, "run")
    assert note_path.read_text(encoding="utf-8") == original

    when = datetime(2026, 1, 2, 3, 4, tzinfo=timezone.utc)
    measurement = tmp_path / "run.zarr"
    entry = notes._format_sample_rollup_entry(when, measurement, note_path, "hello\n")
    assert entry.startswith("[2026-01-02T03:04] [Measurement]")
    assert entry.endswith("hello")
    assert notes._format_sample_rollup_entry(when, measurement, note_path, "").endswith(
        f"[Notes]({note_path})"
    )
    assert notes._find_last_synced_measurement_body(entry, measurement) == "hello"
    assert notes._find_last_synced_measurement_body("", measurement) is None
    assert notes._normalize_link_path(r"C:\\DATA\\RUN") == "c://data//run"


@pytest.mark.parametrize(
    ("previous", "current", "expected"),
    [
        (None, "new", "new"),
        ("same", "same\n", ""),
        ("old", "old\nadded", "added"),
        ("old", "replacement", "replacement"),
        ("old", "", ""),
    ],
)
def test_compute_incremental_body(previous, current, expected):
    assert notes._compute_incremental_body(previous, current) == expected


def test_build_initial_pool_and_incremental_rollup(tmp_path, monkeypatch):
    sample = tmp_path / "sample"
    experiment = sample / "experiment"
    measurement = experiment / "run.zarr"
    measurement.mkdir(parents=True)
    _, note_dir, note_path = notes._measurement_notes_paths(measurement)
    note_dir.mkdir()
    when = datetime(2026, 1, 2, 3, 4, tzinfo=timezone.utc)
    note_path.write_text(
        notes._make_frontmatter("run", when) + "first", encoding="utf-8"
    )
    monkeypatch.setattr(notes, "_read_dataset_names", lambda _path: (None, None))

    initial = notes._build_initial_sample_pool_body(sample, when)
    assert "first" in initial

    first = notes.append_sample_rollup(
        measurement,
        "first",
        when,
        sample_path=str(sample),
        sample_name="chip",
        cryostat_name="cryo",
    )
    unchanged = notes.append_sample_rollup(
        measurement,
        "first",
        when,
        sample_path=str(sample),
        sample_name="chip",
        cryostat_name="cryo",
    )
    added = notes.append_sample_rollup(
        measurement,
        "first\nsecond",
        when,
        sample_path=str(sample),
        sample_name="chip",
        cryostat_name="cryo",
    )

    assert first["appended"] == "true"
    assert unchanged["appended"] == "false"
    assert added["appended"] == "true"
    pooled = Path(added["sample_notes_path"]).read_text(encoding="utf-8")
    assert pooled.count("first") == 1
    assert pooled.count("second") == 1


@pytest.mark.asyncio
async def test_measurement_note_load_save_and_sidecar_import(tmp_path, monkeypatch):
    measurement = tmp_path / "sample" / "experiment" / "run.zarr"
    measurement.mkdir(parents=True)
    monkeypatch.setattr(notes, "_read_dataset_names", lambda _path: (None, None))

    blank = await notes.load_notes(PathData(path=str(measurement)))
    assert blank["notes"] == ""

    saved = await notes.save_notes(
        NotesData(path=str(measurement), notes="saved text")
    )
    loaded = await notes.load_notes(PathData(path=str(measurement)))
    assert saved["message"] == "Notes saved successfully."
    assert loaded["notes"] == "saved text"
    assert notes._db_get_note("run")[0] == "saved text"

    imported_measurement = measurement.with_name("legacy.zarr")
    imported_measurement.mkdir()
    _, legacy_dir, legacy_path = notes._measurement_notes_paths(imported_measurement)
    legacy_dir.mkdir()
    when = datetime(2025, 4, 14, tzinfo=timezone.utc)
    legacy_path.write_text(
        notes._make_frontmatter("legacy", when) + "legacy body", encoding="utf-8"
    )

    imported = await notes.load_notes(PathData(path=str(imported_measurement)))
    assert imported["notes"] == "legacy body"
    assert notes._db_get_note("legacy")[0] == "legacy body"


@pytest.mark.asyncio
async def test_measurement_note_db_errors_are_reported(tmp_path, monkeypatch):
    path = str(tmp_path / "run.zarr")
    monkeypatch.setattr(
        notes, "_db_get_note", lambda _uuid: (_ for _ in ()).throw(OSError("db down"))
    )
    result = await notes.load_notes(PathData(path=path))
    assert "db down" in result["error"]

    with pytest.raises(HTTPException) as exc:
        await notes.save_notes(NotesData(path=path, notes="text"))
    assert exc.value.status_code == 500


@pytest.mark.asyncio
async def test_sample_note_round_trip_and_initial_pool(tmp_path, monkeypatch):
    sample = tmp_path / "sample"
    measurement = sample / "experiment" / "run.zarr"
    measurement.mkdir(parents=True)
    monkeypatch.setattr(notes, "_read_dataset_names", lambda _path: (None, None))

    initial = await notes.load_notes(
        PathData(
            path=str(measurement),
            note_scope="sample",
            sample_path=str(sample),
            sample_name="chip",
            cryostat_name="cryo",
        )
    )
    assert initial["filename"] == "cryo_chip.md"

    saved = await notes.save_notes(
        NotesData(
            path=str(measurement),
            notes="sample note",
            note_scope="sample",
            sample_path=str(sample),
            sample_name="chip",
            cryostat_name="cryo",
        )
    )
    loaded = await notes.load_notes(
        PathData(
            path=str(measurement),
            note_scope="sample",
            sample_path=str(sample),
            sample_name="chip",
            cryostat_name="cryo",
        )
    )
    assert saved["note_scope"] == "sample"
    assert loaded["notes"] == "sample note"
