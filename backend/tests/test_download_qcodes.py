"""Download tests for QCoDeS runs and databases."""

import json
import sqlite3
import time
import zipfile

import numpy as np
import pytest
from qcodes.dataset import (
    Measurement,
    initialise_or_create_database_at,
    load_or_create_experiment,
)

from api import data_loader, download
from api.dirtree import qcodes_run_day
from api.models import PathData, PathsData
from api.shared import db as db_mod


@pytest.fixture(autouse=True)
def _keep_archives_inside_test_directory(tmp_path, monkeypatch):
    created = 0

    def make_temp_dir():
        nonlocal created
        created += 1
        target = tmp_path / f"archive-{created}"
        target.mkdir()
        return str(target)

    monkeypatch.setattr(download.tempfile, "mkdtemp", make_temp_dir)
    monkeypatch.delenv("QIMCHI_DESKTOP", raising=False)
    # Sidecars read the library; keep them away from the developer's.
    monkeypatch.setenv("QIMCHI_HOME", str(tmp_path / "home"))
    monkeypatch.setattr(db_mod, "_engine", None)


@pytest.fixture
def qcodes_db(tmp_path):
    """Create a database containing varied runs and dates."""
    db_path = tmp_path / "exp.db"
    initialise_or_create_database_at(str(db_path))
    experiment = load_or_create_experiment("download", sample_name="sample")

    def record(name, rows, paramtype="numeric"):
        measurement = Measurement(exp=experiment, name=name)
        measurement.register_custom_parameter("vg", unit="V")
        measurement.register_custom_parameter(
            "i", setpoints=("vg",), paramtype=paramtype
        )
        with measurement.run() as saver:
            for vg, i in rows:
                saver.add_result(("vg", vg), ("i", i))
        return saver.dataset

    record("sweep | gate", [(v, 2 * v) for v in range(5)])
    record("complex", [(v, v + 1j) for v in range(3)], paramtype="complex")
    record("old", [(0, 0)])
    with sqlite3.connect(db_path) as conn:
        conn.execute("UPDATE runs SET run_timestamp = 0 WHERE run_id = 3")
    return db_path


def _open(response):
    archive = zipfile.ZipFile(response.path)
    return archive, set(archive.namelist())


def _load_nc(tmp_path, archive, member):
    target = tmp_path / "unpacked" / member
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(archive.read(member))
    return data_loader.load_dataset_sync(str(target))


@pytest.mark.asyncio
async def test_a_run_downloads_as_netcdf_that_qimchi_reopens(tmp_path, qcodes_db):
    response = await download.download_dataset(PathData(path=f"{qcodes_db}#run_id=1"))

    archive, members = _open(response)
    assert response.filename == "exp_run-1.zip"
    assert response.headers[download.QCODES_RUNS_HEADER.lower()] == "1"
    assert members == {
        "exp/1-sweep _ gate.nc",
        "exp/1-sweep _ gate/1-sweep _ gate.qimchi.json",
    }

    dataset = _load_nc(tmp_path, archive, "exp/1-sweep _ gate.nc")
    original = data_loader._load_qcodes_xarray_dataset(qcodes_db, 1)
    np.testing.assert_array_equal(dataset["i"].values, original["i"].values)
    assert dataset["vg"].attrs.get("units") == original["vg"].attrs.get("units")
    assert dataset.attrs["guid"] == original.attrs["guid"]
    assert json.loads(dataset.attrs["snapshot"]) == original.attrs["snapshot"]

    sidecar = json.loads(archive.read("exp/1-sweep _ gate/1-sweep _ gate.qimchi.json"))
    assert sidecar["dataset_uuid"] == original.attrs["guid"]


@pytest.mark.asyncio
async def test_a_complex_run_keeps_its_values(tmp_path, qcodes_db):
    response = await download.download_dataset(PathData(path=f"{qcodes_db}#run_id=2"))

    archive, _ = _open(response)
    dataset = _load_nc(tmp_path, archive, "exp/2-complex.nc")
    # Qimchi splits complex values into parts when it opens a file.
    np.testing.assert_array_equal(dataset["i_real"].values, np.arange(3))
    np.testing.assert_array_equal(dataset["i_imag"].values, np.ones(3))


@pytest.mark.asyncio
async def test_a_date_downloads_only_its_runs(qcodes_db):
    today = qcodes_run_day(time.time())

    response = await download.download_folder(
        PathData(path=f"{qcodes_db}#date={today}")
    )

    _, members = _open(response)
    assert response.filename == f"exp_{today}.zip"
    assert response.headers[download.QCODES_RUNS_HEADER.lower()] == "2"
    assert {m for m in members if m.endswith(".nc")} == {
        "exp/1-sweep _ gate.nc",
        "exp/2-complex.nc",
    }


@pytest.mark.asyncio
async def test_a_run_selected_twice_is_written_once(qcodes_db, tmp_path):
    other = tmp_path / "trace.nc"
    other.write_bytes(b"trace")
    today = qcodes_run_day(time.time())

    response = await download.download_multiple_datasets(
        PathsData(
            paths=[f"{qcodes_db}#run_id=1", f"{qcodes_db}#date={today}", str(other)]
        )
    )

    _, members = _open(response)
    assert {m for m in members if m.endswith(".nc")} == {
        "trace.nc",
        "exp/1-sweep _ gate.nc",
        "exp/2-complex.nc",
    }
    assert response.headers[download.QCODES_RUNS_HEADER.lower()] == "2"


@pytest.mark.asyncio
async def test_the_basket_downloads_runs(qcodes_db):
    response = await download.download_selected_datasets(
        [PathData(path=f"{qcodes_db}#run_id=2")]
    )

    _, members = _open(response)
    assert "exp/2-complex.nc" in members


@pytest.mark.asyncio
async def test_a_run_still_being_measured_downloads_what_is_recorded(tmp_path):
    db_path = tmp_path / "live.db"
    initialise_or_create_database_at(str(db_path))
    experiment = load_or_create_experiment("live", sample_name="sample")
    measurement = Measurement(exp=experiment, name="live")
    measurement.register_custom_parameter("vg")
    measurement.register_custom_parameter("i", setpoints=("vg",))

    with measurement.run() as saver:
        for v in range(3):
            saver.add_result(("vg", v), ("i", v))
        saver.flush_data_to_database(block=True)

        response = await download.download_dataset(PathData(path=f"{db_path}#run_id=1"))

    archive, _ = _open(response)
    dataset = _load_nc(tmp_path, archive, "live/1-live.nc")
    np.testing.assert_array_equal(dataset["i"].values, np.arange(3))


@pytest.mark.asyncio
async def test_unknown_dates_and_databases_are_not_found(qcodes_db, tmp_path):
    with pytest.raises(download.HTTPException) as exc:
        await download.download_folder(PathData(path=f"{qcodes_db}#date=1999-01-01"))
    assert exc.value.status_code == 404

    with pytest.raises(download.HTTPException) as exc:
        await download.download_dataset(
            PathData(path=f"{tmp_path / 'missing.db'}#run_id=1")
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_a_database_download_includes_what_is_still_in_its_wal(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    db_path = data / "busy.db"
    writer = sqlite3.connect(db_path)
    try:
        writer.execute("PRAGMA journal_mode=WAL")
        writer.execute("PRAGMA wal_autocheckpoint=0")
        writer.execute("CREATE TABLE t (x)")
        writer.execute("INSERT INTO t VALUES (42)")
        writer.commit()
        assert (data / "busy.db-wal").stat().st_size > 0

        response = await download.download_folder(PathData(path=str(db_path)))
        folder = await download.download_folder(PathData(path=str(data)))
    finally:
        writer.close()

    archive, members = _open(response)
    assert "busy.db" in members
    copy = tmp_path / "copy.db"
    copy.write_bytes(archive.read("busy.db"))
    with sqlite3.connect(copy) as conn:
        assert conn.execute("SELECT x FROM t").fetchall() == [(42,)]
        assert conn.execute("PRAGMA journal_mode").fetchone() == ("delete",)

    _, folder_members = _open(folder)
    assert "data/busy.db" in folder_members
    assert not any(m.endswith(("-wal", "-shm")) for m in folder_members)


@pytest.mark.asyncio
async def test_a_db_file_that_is_not_sqlite_is_copied_as_it_is(tmp_path):
    thumbs = tmp_path / "Thumbs.db"
    thumbs.write_bytes(b"not a database")

    response = await download.download_dataset(PathData(path=str(thumbs)))

    archive, _ = _open(response)
    assert archive.read("Thumbs.db") == b"not a database"
