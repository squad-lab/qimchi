"""End-to-end unit tests for the database-backed library API functions."""

from __future__ import annotations

import pytest
import xarray as xr
from fastapi import HTTPException
from sqlmodel import Session

from api import library


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    monkeypatch.setenv("QIMCHI_HOME", str(tmp_path / "home"))
    monkeypatch.delenv("QIMCHI_DB_PATH", raising=False)
    from api.shared import db

    if db._engine is not None:
        db._engine.dispose()
    db._engine = None
    db.run_migrations()
    db.seed_local_user()
    yield
    if db._engine is not None:
        db._engine.dispose()
    db._engine = None


@pytest.mark.parametrize(
    ("value", "expected"),
    [(None, None), ("", None), (" N/A ", None), (" value ", "value"), (42, "42")],
)
def test_na_normalization(value, expected):
    assert library._na(value) == expected


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("run.zarr", "zarr"),
        ("run.nc", "netcdf"),
        ("run.hdf5", "hdf5"),
        ("run.db", "qcodes"),
        ("run.db#run_id=3", "qcodes"),
        ("run.sqlite", "container"),
        ("run.sqlite#run_id=3", "qcodes"),
        ("run.csv", "csv"),
        ("run.unknown", None),
    ],
)
def test_source_format_detection(path, expected):
    assert library._source_format(path) == expected


@pytest.mark.asyncio
async def test_loading_qcodes_attrs_attaches_its_guid_to_the_qimchi_db(tmp_path):
    from api.db_models import Measurement
    from api.shared import db as db_mod

    db_path = tmp_path / "runs.db"
    db_path.write_bytes(b"qcodes")
    ref = f"{db_path}#run_id=4"
    dataset = xr.Dataset(attrs={"guid": "qcodes-guid", "run_id": 4})
    attrs = {"guid": "qcodes-guid", "run_id": 4, "independents": [], "dependents": []}

    await library.store_cached_attrs(ref, attrs, dataset)

    with Session(db_mod.get_engine()) as session:
        measurement = session.get(Measurement, "qcodes-guid")
        assert measurement is not None
        assert measurement.abs_path == ref
        assert measurement.source_format == "qcodes"


@pytest.mark.asyncio
async def test_library_route_workflow_preserves_state_and_tags(tmp_path):
    dataset = tmp_path / "run.nc"
    dataset.write_bytes(b"data")
    registered = await library.register(
        library.RegisterRequest(
            path=str(dataset),
            attrs={
                "Measurement ID": "measurement-1",
                "Sample Name": "chip",
                "Cryostat": "cryo",
            },
        )
    )
    assert registered.uuid == "measurement-1"

    hearted = await library.heart(
        library.HeartRequest(uuid=registered.uuid, hearted=True)
    )
    trashed = await library.trash(
        library.TrashRequest(uuid=registered.uuid, trashed=True)
    )
    tag = await library.create_tag(library.CreateTagRequest(name="interesting"))
    assigned = await library.tag_measurement(
        library.TagMeasurementRequest(uuid=registered.uuid, tag_id=tag.id)
    )

    assert hearted.hearted is True
    assert trashed.trashed is True
    assert assigned == [tag.id]
    states = await library.states()
    assert states[0].uuid == registered.uuid
    assert states[0].tags == [tag.id]

    renamed = await library.rename_tag(
        tag.id, library.RenameTagRequest(name="important")
    )
    assert renamed.name == "important"
    assert (await library.list_tags())[0].count == 1

    removed = await library.tag_measurement(
        library.TagMeasurementRequest(uuid=registered.uuid, tag_id=tag.id, add=False)
    )
    assert removed == []
    assert await library.delete_tag(tag.id) == {"deleted": tag.id}
    assert await library.list_tags() == []


@pytest.mark.asyncio
async def test_library_routes_report_unknown_measurements_and_register_failures(
    monkeypatch,
):
    with pytest.raises(HTTPException) as heart:
        await library.heart(library.HeartRequest(uuid="missing", hearted=True))
    assert heart.value.status_code == 404

    with pytest.raises(HTTPException) as trash:
        await library.trash(library.TrashRequest(uuid="missing", trashed=True))
    assert trash.value.status_code == 404

    async def fail(*_args):
        raise OSError("unreadable")

    monkeypatch.setattr(library, "_resolve", fail)
    with pytest.raises(HTTPException) as register:
        await library.register(library.RegisterRequest(path="missing.nc"))
    assert register.value.status_code == 500


@pytest.mark.asyncio
async def test_register_without_an_identity_is_a_safe_noop(monkeypatch):
    async def no_identity(*_args):
        return None, None, {}

    monkeypatch.setattr(library, "_resolve", no_identity)
    result = await library.register(library.RegisterRequest(path="unreadable.nc"))
    assert result == library.StateOut()
