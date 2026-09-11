"""Tests for dataset and folder download archives."""

from __future__ import annotations

import zipfile
from urllib.parse import unquote

import pytest
from fastapi import HTTPException

from api import download
from api.models import PathData, PathsData


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


def _members(response) -> set[str]:
    with zipfile.ZipFile(response.path) as archive:
        return set(archive.namelist())


def _data_members(response) -> set[str]:
    """Archive contents minus the library sidecars, which every download adds."""
    return {
        name
        for name in _members(response)
        if not name.endswith(download.LIBRARY_SIDECAR_SUFFIX)
    }


@pytest.mark.asyncio
async def test_download_dataset_archives_directory_and_sidecar(tmp_path):
    dataset = tmp_path / "run.zarr"
    (dataset / "nested").mkdir(parents=True)
    (dataset / "nested" / "data.bin").write_bytes(b"data")
    notes = tmp_path / "run"
    notes.mkdir()
    (notes / "run.md").write_text("notes", encoding="utf-8")

    response = await download.download_dataset(PathData(path=str(dataset)))

    assert response.filename == "run.zip"
    assert _data_members(response) == {"run.zarr/nested/data.bin", "run/run.md"}
    assert "run/run.qimchi.json" in _members(response)


@pytest.mark.asyncio
async def test_download_dataset_archives_single_file(tmp_path):
    dataset = tmp_path / "run.nc"
    dataset.write_bytes(b"netcdf")

    response = await download.download_dataset(PathData(path=str(dataset)))

    assert _data_members(response) == {"run.nc"}


@pytest.mark.asyncio
async def test_download_dataset_rejects_missing_path(tmp_path):
    with pytest.raises(HTTPException) as exc:
        await download.download_dataset(PathData(path=str(tmp_path / "missing.nc")))

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_download_dataset_reports_archive_failure(tmp_path, monkeypatch):
    dataset = tmp_path / "run.nc"
    dataset.write_bytes(b"netcdf")

    def fail(*_args, **_kwargs):
        raise OSError("archive unavailable")

    monkeypatch.setattr(download.zipfile, "ZipFile", fail)

    with pytest.raises(HTTPException) as exc:
        await download.download_dataset(PathData(path=str(dataset)))

    assert exc.value.status_code == 500
    assert "archive unavailable" in exc.value.detail


@pytest.mark.asyncio
async def test_download_selected_validates_input(tmp_path):
    with pytest.raises(HTTPException) as empty:
        await download.download_selected_datasets([])
    assert empty.value.status_code == 400

    with pytest.raises(HTTPException) as invalid:
        await download.download_selected_datasets(
            [PathData(path=str(tmp_path / "missing"))]
        )
    assert invalid.value.status_code == 404


@pytest.mark.asyncio
async def test_download_selected_skips_missing_and_includes_notes(tmp_path):
    dataset = tmp_path / "one.zarr"
    dataset.mkdir()
    (dataset / "zarr.json").write_text("{}", encoding="utf-8")
    notes = tmp_path / "one"
    notes.mkdir()
    (notes / "one.md").write_text("note", encoding="utf-8")
    single = tmp_path / "two.nc"
    single.write_bytes(b"two")

    response = await download.download_selected_datasets(
        [
            PathData(path=str(dataset)),
            PathData(path=str(tmp_path / "missing")),
            PathData(path=str(single)),
        ]
    )

    assert response.filename == "selected_datasets_2_files.zip"
    assert _data_members(response) == {"one.zarr/zarr.json", "one/one.md", "two.nc"}


@pytest.mark.asyncio
async def test_download_multiple_validates_input(tmp_path):
    with pytest.raises(HTTPException) as empty:
        await download.download_multiple_datasets(PathsData(paths=[]))
    assert empty.value.status_code == 400

    with pytest.raises(HTTPException) as invalid:
        await download.download_multiple_datasets(
            PathsData(paths=[str(tmp_path / "missing")])
        )
    assert invalid.value.status_code == 404


@pytest.mark.asyncio
async def test_download_multiple_handles_files_dataset_dirs_and_folders(tmp_path):
    standalone = tmp_path / "trace.nc"
    standalone.write_bytes(b"trace")
    standalone_notes = tmp_path / "trace"
    standalone_notes.mkdir()
    (standalone_notes / "trace.md").write_text("note", encoding="utf-8")

    zarr = tmp_path / "sweep.zarr"
    zarr.mkdir()
    (zarr / "zarr.json").write_text("{}", encoding="utf-8")
    zarr_notes = tmp_path / "sweep"
    zarr_notes.mkdir()
    (zarr_notes / "sweep.md").write_text("note", encoding="utf-8")

    folder = tmp_path / "sample"
    folder.mkdir()
    (folder / "readme.log").write_text("log", encoding="utf-8")
    nested_dataset = folder / "nested.csv"
    nested_dataset.write_text("x,y", encoding="utf-8")
    nested_notes = folder / "nested"
    nested_notes.mkdir()
    (nested_notes / "nested.md").write_text("note", encoding="utf-8")

    with pytest.warns(UserWarning, match="Duplicate name"):
        response = await download.download_multiple_datasets(
            PathsData(paths=[str(standalone), str(zarr), str(folder)])
        )

    members = _members(response)
    assert response.filename == "items_3_files.zip"
    assert {
        "trace.nc",
        "trace/trace.md",
        "sweep.zarr/zarr.json",
        "sweep/sweep.md",
        "sample/readme.log",
        "sample/nested.csv",
        "sample/nested/nested.md",
    } <= members


@pytest.mark.asyncio
async def test_download_folder_preserves_tree_and_rejects_files(tmp_path):
    folder = tmp_path / "sample"
    (folder / "nested").mkdir(parents=True)
    (folder / "nested" / "data.txt").write_text("data", encoding="utf-8")

    response = await download.download_folder(PathData(path=str(folder)))

    assert _members(response) == {"sample/nested/data.txt"}

    not_folder = tmp_path / "file.nc"
    not_folder.write_bytes(b"x")
    with pytest.raises(HTTPException) as exc:
        await download.download_folder(PathData(path=str(not_folder)))
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_download_folder_reports_archive_failure(tmp_path, monkeypatch):
    folder = tmp_path / "sample"
    folder.mkdir()

    def fail(*_args, **_kwargs):
        raise OSError("zip failed")

    monkeypatch.setattr(download.zipfile, "ZipFile", fail)
    with pytest.raises(HTTPException) as exc:
        await download.download_folder(PathData(path=str(folder)))

    assert exc.value.status_code == 500


def test_desktop_download_is_saved_and_reports_destination(tmp_path, monkeypatch):
    archive = tmp_path / "source.zip"
    archive.write_bytes(b"zip")
    downloads = tmp_path / "Downloads with spaces"
    monkeypatch.setenv("QIMCHI_DESKTOP", "1")
    monkeypatch.setenv("QIMCHI_DOWNLOAD_DIR", str(downloads))

    first = download._download_response(archive, "measurement.zip")
    second = download._download_response(archive, "measurement.zip")

    first_path = unquote(first.headers["x-qimchi-saved-to"])
    second_path = unquote(second.headers["x-qimchi-saved-to"])
    assert first_path == str(downloads / "measurement.zip")
    assert second_path == str(downloads / "measurement (2).zip")
    assert (downloads / "measurement.zip").read_bytes() == b"zip"
    assert (downloads / "measurement (2).zip").read_bytes() == b"zip"


def test_browser_download_is_not_copied_to_disk(tmp_path, monkeypatch):
    archive = tmp_path / "source.zip"
    archive.write_bytes(b"zip")
    downloads = tmp_path / "Downloads"
    monkeypatch.delenv("QIMCHI_DESKTOP", raising=False)
    monkeypatch.setenv("QIMCHI_DOWNLOAD_DIR", str(downloads))

    response = download._download_response(archive, "measurement.zip")

    assert "x-qimchi-saved-to" not in response.headers
    assert not downloads.exists()
