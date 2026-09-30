"""Metadata responses for qanary and other dataset formats."""

import json

import numpy as np
import pytest
import xarray as xr

from api import dirtree
from api.models import PathData


def _dataset(attrs: dict) -> xr.Dataset:
    return xr.Dataset(
        {"signal": ("x", np.arange(3.0))},
        coords={"x": np.arange(3)},
        attrs=attrs,
    )


def _patch_loader(monkeypatch, dataset: xr.Dataset) -> None:
    async def _mock_load_dataset_async(_path: str):
        return dataset

    monkeypatch.setattr(dirtree, "load_dataset_async", _mock_load_dataset_async)


@pytest.mark.asyncio
async def test_a_qanary_dataset_shows_its_four_sections_and_nothing_else(monkeypatch):
    """Qanary metadata retains its four collapsible sections."""
    _patch_loader(
        monkeypatch,
        _dataset(
            {
                "Instruments Snapshot": {"dmm": {}},
                "Sweeps": {"x": [0, 1, 2]},
                "Extra Metadata": {"note": "hi"},
                "Parameters Snapshot": {"p": 1},
                "Cryostat": "BlueFors",
            }
        ),
    )

    out = await dirtree.get_metadata(PathData(path="/tmp/run.zarr"))

    assert list(out) == [
        "Sweeps",
        "Parameters Snapshot",
        "Extra Metadata",
        "Instruments Snapshot",
    ]
    assert "Cryostat" not in out


@pytest.mark.asyncio
async def test_qcodes_run_surfaces_its_own_attrs(monkeypatch):
    """A QCoDeS run has none of qanary's sections, and must not be blanked."""
    _patch_loader(
        monkeypatch,
        _dataset(
            {
                "run_id": 7,
                "ds_name": "sweep",
                "exp_name": "transport",
                "guid": "aaaa-bbbb",
                "run_timestamp": "2026-09-11 10:00:00+0000",
                "sample_name": "device-a",
                "qcodes_db_path": "/data/experiments.db",
                "snapshot": json.dumps({"station": {"instruments": {}}}),
                "completed_timestamp": "not requested",
            }
        ),
    )

    out = await dirtree.get_metadata(PathData(path="/tmp/experiments.db#run_id=7"))

    assert set(out) == {dirtree.QCODES_META_SECTION}
    qcodes = out[dirtree.QCODES_META_SECTION]
    assert list(qcodes) == list(dirtree.QCODES_META_KEYS)
    assert qcodes["ds_name"] == "sweep"
    assert qcodes["guid"] == "aaaa-bbbb"
    assert qcodes["snapshot"] == {"station": {"instruments": {}}}
    assert "run_id" not in qcodes
    assert "completed_timestamp" not in qcodes
    # No placeholder rows for sections this dataset never had.
    assert "Sweeps" not in out
    assert "N/A" not in qcodes.values()


@pytest.mark.asyncio
async def test_quantify_run_surfaces_its_own_attrs(monkeypatch):
    _patch_loader(
        monkeypatch,
        _dataset({"tuid": "20260911-120000-123-abcdef", "name": "T1 experiment"}),
    )

    out = await dirtree.get_metadata(PathData(path="/tmp/quantify.hdf5"))

    assert out["tuid"] == "20260911-120000-123-abcdef"
    assert out["name"] == "T1 experiment"


@pytest.mark.asyncio
async def test_loader_bookkeeping_is_not_shown_as_metadata(monkeypatch):
    """How Qimchi read the file is not part of the measurement's metadata."""
    _patch_loader(
        monkeypatch,
        _dataset(
            {
                "Sweeps": {"x": [0]},
                "path": "memory://abc",
                "actual_path": "/data/run.zarr",
                "loaded_from": "disk",
                "qimchi_tabular": True,
                "qimchi_all_columns": ["x", "signal"],
                "grid_2d": False,
            }
        ),
    )

    out = await dirtree.get_metadata(PathData(path="/tmp/run.zarr"))

    assert set(out) == {"Sweeps"}


@pytest.mark.asyncio
async def test_a_dataset_with_no_attrs_returns_nothing_to_show(monkeypatch):
    """An empty result is what the pane's "no metadata" state is for."""
    _patch_loader(monkeypatch, _dataset({}))

    out = await dirtree.get_metadata(PathData(path="/tmp/bare.nc"))

    assert out == {}


@pytest.mark.asyncio
async def test_attrs_payload_surfaces_qcodes_identity_fields(monkeypatch):
    """The attribute strip includes QCoDeS identity fields."""
    _patch_loader(
        monkeypatch,
        _dataset(
            {
                "run_id": 7,
                "guid": "aaaa-bbbb",
                "exp_name": "T1",
                "sample_name": "device_A",
            }
        ),
    )

    out = await dirtree.get_meta_attrs(PathData(path="/tmp/experiments.db#run_id=7"))

    assert out["run_id"] == 7
    assert out["guid"] == "aaaa-bbbb"
    assert out["exp_name"] == "T1"
    assert out["sample_name"] == "device_A"
    # qanary's keys are still present, so the cached payload keeps its shape.
    assert out["Cryostat"] == "N/A"
    assert out["independents"] == ["x"]


@pytest.mark.asyncio
async def test_attrs_payload_is_unchanged_for_a_qanary_dataset(monkeypatch):
    """Cached and fresh qanary payloads retain the same shape."""
    _patch_loader(
        monkeypatch,
        _dataset({"Cryostat": "BlueFors", "Measurement ID": "abc-123"}),
    )

    out = await dirtree.get_meta_attrs(PathData(path="/tmp/run.zarr"))

    assert set(out) == set(dirtree.ATTR_KEYS) | {
        "independents",
        "dependents",
        "variable_independents",
    }


@pytest.mark.asyncio
async def test_attrs_payload_skips_nested_values(monkeypatch):
    """The flat attribute strip omits nested values."""
    _patch_loader(
        monkeypatch,
        _dataset({"name": {"nested": "value"}, "tuid": "20260911-120000-123-abcdef"}),
    )

    out = await dirtree.get_meta_attrs(PathData(path="/tmp/quantify.hdf5"))

    assert "name" not in out
    assert out["tuid"] == "20260911-120000-123-abcdef"


@pytest.mark.asyncio
async def test_large_qcodes_snapshot_is_returned_without_bookkeeping(monkeypatch):
    snapshot_data = {
        f"instrument_{i}": {f"p_{j}": j for j in range(10)} for i in range(10)
    }
    _patch_loader(
        monkeypatch,
        _dataset(
            {
                "run_id": 8,
                "ds_name": "sweep",
                "guid": "aaaa-bbbb",
                "snapshot": json.dumps(snapshot_data),
            }
        ),
    )

    out = await dirtree.get_metadata(PathData(path="/tmp/experiments.db#run_id=8"))

    qcodes = out[dirtree.QCODES_META_SECTION]
    assert qcodes["ds_name"] == "sweep"
    assert qcodes["guid"] == "aaaa-bbbb"
    assert qcodes["snapshot"] == snapshot_data
    assert "__qimchi_metadata_too_large__" not in json.dumps(qcodes)


@pytest.mark.asyncio
async def test_large_metadata_section_is_returned_unchanged(monkeypatch):
    snapshot = {
        f"instrument_{i}": {f"param_{j}": j for j in range(20)} for i in range(40)
    }
    _patch_loader(
        monkeypatch,
        _dataset({"Instruments Snapshot": snapshot, "Sweeps": {"x": [0, 1]}}),
    )
    out = await dirtree.get_metadata(PathData(path="/tmp/huge.zarr"))

    assert out["Sweeps"] == {"x": [0, 1]}
    assert out["Instruments Snapshot"] == snapshot


@pytest.mark.asyncio
async def test_small_metadata_section_is_returned_unchanged(monkeypatch):
    _patch_loader(monkeypatch, _dataset({"Sweeps": {"x": [0, 1, 2]}}))

    out = await dirtree.get_metadata(PathData(path="/tmp/small.zarr"))

    assert out["Sweeps"] == {"x": [0, 1, 2]}


@pytest.mark.asyncio
async def test_pinned_parameters_come_back_in_engineering_units(monkeypatch):
    from api.models import PinnedParametersRequest

    snapshot = {
        "dac_ch1": {"value": 0.0123456, "unit": "V", "label": "Voltage 1"},
        "dmm_v1": {"value": 5.0760782441045915, "unit": "V", "label": "Voltmeter"},
        "mode": {"value": "sweep", "unit": "", "label": "Mode"},
    }
    _patch_loader(monkeypatch, _dataset({"Parameters Snapshot": json.dumps(snapshot)}))

    out = await dirtree.get_pinned_parameters(
        PinnedParametersRequest(
            path="run.zarr", names=["dmm_v1", "dac_ch1", "mode", "gone"]
        )
    )

    assert out["parameters"] == [
        {"name": "dmm_v1", "label": "Voltmeter", "display": "5.076 V"},
        {"name": "dac_ch1", "label": "Voltage 1", "display": "12.35 mV"},
        {"name": "mode", "label": "Mode", "display": "sweep"},
        {"name": "gone", "missing": True},
    ]
