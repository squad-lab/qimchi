"""
Tests for the /load-attrs/ metadata read-through cache.

metadata_json was previously written on every open and never read back, so
metadata reloaded from disk every time. Serving it needs three things to hold:
the cached payload must be identical to what the endpoint would build, a
changed file must invalidate it, and live datasets must never be cached.
"""

import json
import os
import time

import numpy as np
import pytest
import xarray as xr
from sqlmodel import select

from api import library
from api.db_models import Measurement
from api.dirtree import build_attrs_payload
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


def _dataset() -> xr.Dataset:
    x = np.linspace(0, 1, 16)
    return xr.Dataset(
        data_vars={"signal": (("voltage",), np.sin(x))},
        coords={"voltage": x},
        attrs={"Sample Name": "S1", "Cryostat": "Triton"},
    )


def _register(path: str, attrs: dict) -> str | None:
    return library._register(path, attrs, "uuid-under-test", "qanary").uuid


def test_payload_shape_matches_the_endpoint(tmp_path):
    """A cache hit must return exactly what a cache miss would build."""
    nc = tmp_path / "run.nc"
    _dataset().to_netcdf(nc)
    with xr.open_dataset(nc) as ds:
        payload = build_attrs_payload(ds)

    assert payload["independents"] == ["voltage"]
    assert payload["dependents"] == ["signal"]
    assert payload["Sample Name"] == "S1"
    assert payload["Measurement ID"] == "N/A"  # absent -> sentinel, not missing


@pytest.mark.asyncio
async def test_first_open_of_an_unseen_measurement_populates_the_cache(tmp_path):
    """
    The load-bearing case: a measurement nobody has hearted/tagged.

    Nothing registers a measurement just because it was opened -- /library/register
    is called lazily, only on the first annotation. So store_cached_attrs has to
    create the row itself, or the cache would never populate for the common case.
    """
    nc = tmp_path / "run.nc"
    _dataset().to_netcdf(nc)
    with xr.open_dataset(nc) as ds:
        payload = build_attrs_payload(ds)

        # Nothing in the DB yet -> miss.
        assert await library.get_cached_attrs(str(nc)) is None

        # This is all /load-attrs/ does on a miss.
        await library.store_cached_attrs(str(nc), payload, ds)

    # Second open -> served from the DB, no dataset needed.
    cached = await library.get_cached_attrs(str(nc))
    assert cached is not None
    assert cached["independents"] == ["voltage"]
    assert cached["dependents"] == ["signal"]
    assert cached["Sample Name"] == "S1"

    # ...and the measurement row was created, keyed by content signature.
    with session_scope() as session:
        rows = session.exec(select(Measurement)).all()
        assert len(rows) == 1
        assert rows[0].uuid_origin == "content"
        assert rows[0].abs_path == str(nc)


@pytest.mark.asyncio
async def test_cache_miss_then_hit_via_register(tmp_path):
    """The other population path: the user hearts/tags it first."""
    nc = tmp_path / "run.nc"
    _dataset().to_netcdf(nc)
    with xr.open_dataset(nc) as ds:
        payload = build_attrs_payload(ds)

    assert await library.get_cached_attrs(str(nc)) is None  # nothing registered

    _register(str(nc), payload)
    cached = await library.get_cached_attrs(str(nc))
    assert cached is not None
    assert cached["independents"] == ["voltage"]
    assert cached["Sample Name"] == "S1"


@pytest.mark.asyncio
async def test_changed_file_invalidates_the_cache(tmp_path):
    """The whole point of the fingerprint: don't serve stale attrs."""
    nc = tmp_path / "run.nc"
    _dataset().to_netcdf(nc)
    with xr.open_dataset(nc) as ds:
        payload = build_attrs_payload(ds)
    _register(str(nc), payload)
    assert await library.get_cached_attrs(str(nc)) is not None

    # Rewrite with a different variable set, as a re-run would.
    time.sleep(0.01)
    other = xr.Dataset(
        data_vars={"current": (("gate",), np.arange(8.0))},
        coords={"gate": np.arange(8.0)},
        attrs={"Sample Name": "S2"},
    )
    os.remove(nc)
    other.to_netcdf(nc)

    assert await library.get_cached_attrs(str(nc)) is None


@pytest.mark.asyncio
async def test_live_datasets_are_never_cached(tmp_path):
    """memory:// datasets grow while running; their attrs really do change."""
    live = "memory://12-abcdef"
    _register(live, {"independents": ["x"], "dependents": ["y"]})
    assert await library.get_cached_attrs(live) is None
    await library.store_cached_attrs(live, {"independents": ["x"]})
    assert await library.get_cached_attrs(live) is None


@pytest.mark.asyncio
async def test_qcodes_run_reference_is_not_cached(tmp_path):
    """A .db mtime changes whenever ANY run is added, so it would churn."""
    ref = f"{tmp_path / 'runs.db'}#run_id=3"
    assert await library.get_cached_attrs(ref) is None


@pytest.mark.asyncio
async def test_incomplete_legacy_row_is_not_served(tmp_path):
    """Rows written before independents/dependents were cached must miss."""
    nc = tmp_path / "run.nc"
    _dataset().to_netcdf(nc)
    _register(str(nc), {"Sample Name": "S1"})  # no independents key

    with session_scope() as session:
        row = session.get(Measurement, "uuid-under-test")
        assert "independents" not in json.loads(row.metadata_json)

    assert await library.get_cached_attrs(str(nc)) is None


@pytest.mark.asyncio
async def test_store_cached_attrs_updates_an_existing_row(tmp_path):
    nc = tmp_path / "run.nc"
    _dataset().to_netcdf(nc)
    _register(str(nc), {"Sample Name": "S1"})  # incomplete -> not served

    with xr.open_dataset(nc) as ds:
        payload = build_attrs_payload(ds)
    await library.store_cached_attrs(str(nc), payload)

    cached = await library.get_cached_attrs(str(nc))
    assert cached is not None and cached["dependents"] == ["signal"]
