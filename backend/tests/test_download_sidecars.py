"""
Downloads carry the library's record of each dataset.

A zip otherwise leaves every annotation behind -- the tags, the heart, the
measurement UUID -- so a dataset that comes back out of an archive has lost
everything Qimchi knew about it. Each dataset gets a <stem>.qimchi.json in its
notes folder inside the archive.
"""

import json
import zipfile

import pytest

from api import download
from api.db_models import LOCAL_USER_ID, Measurement, MeasurementTag, Tag
from api.models import PathData, PathsData
from api.shared.db import session_scope


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    """Point the DB at a scratch file and migrate it, per test."""
    monkeypatch.setenv("QIMCHI_HOME", str(tmp_path / "home"))
    from api.shared import db as db_mod

    db_mod._engine = None  # force a new engine at the new path
    db_mod.run_migrations()
    db_mod.seed_local_user()
    yield
    db_mod._engine = None


def _dataset(root, name: str = "21-abc.zarr"):
    """A zarr-shaped dataset directory with one file in it."""
    store = root / name
    store.mkdir(parents=True)
    (store / "zarr.json").write_text("{}", encoding="utf-8")
    return store


def _register(uuid: str, abs_path, tags: list[str]) -> None:
    """Register a measurement and attach tags, as the library would."""
    with session_scope() as session:
        session.add(
            Measurement(uuid=uuid, abs_path=str(abs_path), uuid_origin="qanary")
        )
        for name in tags:
            tag = Tag(user_id=LOCAL_USER_ID, name=name)
            session.add(tag)
            session.flush()
            session.add(MeasurementTag(uuid=uuid, tag_id=tag.id))


def _sidecars(zip_path) -> dict:
    """Every sidecar in an archive, by arcname."""
    with zipfile.ZipFile(zip_path) as archive:
        return {
            name: json.loads(archive.read(name))
            for name in archive.namelist()
            if name.endswith(download.LIBRARY_SIDECAR_SUFFIX)
        }


@pytest.mark.asyncio
async def test_download_carries_the_tags(tmp_path):
    store = _dataset(tmp_path)
    _register("21-abc", store, ["cold", "reviewed"])

    response = await download.download_dataset(PathData(path=str(store)))

    sidecars = _sidecars(response.path)
    assert list(sidecars) == ["21-abc/21-abc.qimchi.json"]
    record = sidecars["21-abc/21-abc.qimchi.json"]
    assert record["tags"] == ["cold", "reviewed"]
    assert record["measurement_uuid"] == "21-abc"
    assert record["uuid_origin"] == "qanary"


@pytest.mark.asyncio
async def test_an_untagged_dataset_still_gets_a_sidecar(tmp_path):
    """
    An absent file is ambiguous -- untagged, or an older download? -- so an
    empty record is written rather than nothing.
    """
    store = _dataset(tmp_path)

    response = await download.download_dataset(PathData(path=str(store)))

    record = _sidecars(response.path)["21-abc/21-abc.qimchi.json"]
    assert record["tags"] == []
    assert record["hearted"] is False


@pytest.mark.asyncio
async def test_the_download_survives_an_unusable_library(tmp_path, monkeypatch):
    """Annotations are a bonus; losing them must never lose the download."""

    def _boom(*_args, **_kwargs):
        raise RuntimeError("database is gone")

    store = _dataset(tmp_path)
    monkeypatch.setattr("api.library.library_metadata", _boom)

    response = await download.download_dataset(PathData(path=str(store)))

    with zipfile.ZipFile(response.path) as archive:
        names = archive.namelist()
    assert any(name.endswith("zarr.json") for name in names)


@pytest.mark.asyncio
async def test_every_dataset_in_a_multi_download_gets_its_own(tmp_path):
    """One record per dataset, so two datasets cannot share or overwrite one."""
    first = _dataset(tmp_path, "1-aaa.zarr")
    second = _dataset(tmp_path, "2-bbb.zarr")
    _register("1-aaa", first, ["cold"])
    _register("2-bbb", second, ["warm"])

    response = await download.download_multiple_datasets(
        PathsData(paths=[str(first), str(second)])
    )

    sidecars = _sidecars(response.path)
    assert set(sidecars) == {"1-aaa/1-aaa.qimchi.json", "2-bbb/2-bbb.qimchi.json"}
    assert sidecars["1-aaa/1-aaa.qimchi.json"]["tags"] == ["cold"]
    assert sidecars["2-bbb/2-bbb.qimchi.json"]["tags"] == ["warm"]


@pytest.mark.asyncio
async def test_a_folder_download_keeps_the_folder_in_the_path(tmp_path):
    """Sidecars sit where that endpoint puts notes, under the folder name."""
    folder = tmp_path / "Single gate sweep"
    store = _dataset(folder, "5-ccc.zarr")
    _register("5-ccc", store, ["hearted-run"])

    response = await download.download_folder(PathData(path=str(folder)))

    sidecars = _sidecars(response.path)
    assert list(sidecars) == ["Single gate sweep/5-ccc/5-ccc.qimchi.json"]
    assert sidecars["Single gate sweep/5-ccc/5-ccc.qimchi.json"]["tags"] == [
        "hearted-run"
    ]
