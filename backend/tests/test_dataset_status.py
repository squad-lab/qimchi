"""
/dataset-status/ -- the endpoint the Viewer polls to notice a dataset changing.

It had no tests at all: every branch, including the 404, was unexercised.

"""

from datetime import datetime

import numpy as np
import pytest
import xarray as xr
from fastapi import HTTPException

from api import dirtree
from api.models import PathData


def _zarr_store(root, name: str = "run.zarr"):
    ds = xr.Dataset({"signal": ("x", np.arange(4.0))}, coords={"x": np.arange(4)})
    path = root / name
    ds.to_zarr(path, mode="w")
    return path


@pytest.mark.asyncio
async def test_reports_size_and_modification_time_for_a_store(tmp_path):
    store = _zarr_store(tmp_path)

    out = await dirtree.get_dataset_status(PathData(path=str(store)))

    assert out["success"] is True
    assert out["path"] == str(store)
    assert out["size"] >= 0
    assert out["last_modified"] > 0
    # The ISO form is what the frontend displays; it must agree with the float.
    assert (
        out["last_modified_iso"]
        == datetime.fromtimestamp(out["last_modified"]).isoformat()
    )


@pytest.mark.asyncio
async def test_reports_a_single_file_from_its_own_stat(tmp_path):
    dataset = tmp_path / "run.nc"
    dataset.write_bytes(b"netcdf-bytes")

    out = await dirtree.get_dataset_status(PathData(path=str(dataset)))

    assert out["size"] == len(b"netcdf-bytes")
    assert out["last_modified"] == dataset.stat().st_mtime


@pytest.mark.asyncio
async def test_a_missing_dataset_is_404_not_500(tmp_path):
    """The Viewer polls this; a deleted dataset is expected, not an error."""
    with pytest.raises(HTTPException) as excinfo:
        await dirtree.get_dataset_status(PathData(path=str(tmp_path / "gone.zarr")))

    assert excinfo.value.status_code == 404


@pytest.mark.asyncio
async def test_a_live_reference_is_resolved_to_its_file_on_disk(tmp_path, monkeypatch):
    """memory:// is the live protocol; status still comes from the disk copy."""
    store = _zarr_store(tmp_path, "live.zarr")
    monkeypatch.setattr(dirtree, "resolve_to_disk_path", lambda _ref: str(store))

    out = await dirtree.get_dataset_status(PathData(path="memory://abc-123"))

    assert out["path"] == str(store)
    assert out["success"] is True


@pytest.mark.asyncio
async def test_an_unresolvable_live_reference_surfaces_as_an_error(monkeypatch):
    def _boom(_ref):
        raise ValueError("no such measurement")

    monkeypatch.setattr(dirtree, "resolve_to_disk_path", _boom)

    with pytest.raises(HTTPException) as excinfo:
        await dirtree.get_dataset_status(PathData(path="memory://missing"))

    assert excinfo.value.status_code == 500
