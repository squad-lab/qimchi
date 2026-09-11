"""
Metadata handling for non-qanary measurements.

The endpoint used to return a fixed four keys -- Sweeps, Parameters Snapshot,
Extra Metadata, Instruments Snapshot -- defaulting each to "N/A". A QCoDeS or
Quantify run has none of them, so those datasets showed four rows of "N/A" and
none of the metadata they actually carry.

"""

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
async def test_qanary_sections_keep_their_order(monkeypatch):
    """qanary datasets are unchanged: its sections come first, in order."""
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

    assert list(out)[:4] == [
        "Sweeps",
        "Parameters Snapshot",
        "Extra Metadata",
        "Instruments Snapshot",
    ]
    # Anything else the dataset carries still comes through, after them.
    assert out["Cryostat"] == "BlueFors"


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
    """
    /load-attrs/ reported "N/A" for every field on a QCoDeS run.

    ATTR_KEYS is qanary's vocabulary, so the Basket's attribute strip had
    nothing to show for a run that does carry a run id, a guid and an
    experiment name under different names.
    """
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
    """
    A qanary payload must be byte-for-byte what it was.

    It is cached and compared against freshly built payloads, so an extra key
    here would mean a cache hit returning a different shape from a miss.
    """
    _patch_loader(
        monkeypatch,
        _dataset({"Cryostat": "BlueFors", "Measurement ID": "abc-123"}),
    )

    out = await dirtree.get_meta_attrs(PathData(path="/tmp/run.zarr"))

    assert set(out) == set(dirtree.ATTR_KEYS) | {"independents", "dependents"}


@pytest.mark.asyncio
async def test_attrs_payload_skips_nested_values(monkeypatch):
    """
    The strip renders flat key/value pairs, so a nested snapshot is skipped.

    Handing it a dict or a list would either break the render outright or bury
    the fields worth reading.
    """
    _patch_loader(
        monkeypatch,
        _dataset({"name": {"nested": "value"}, "tuid": "20260911-120000-123-abcdef"}),
    )

    out = await dirtree.get_meta_attrs(PathData(path="/tmp/quantify.hdf5"))

    assert "name" not in out
    assert out["tuid"] == "20260911-120000-123-abcdef"


def test_count_nodes_expands_json_stored_as_a_string():
    """
    QCoDeS keeps its station snapshot as a JSON string, not a dict.

    Counted as a string it is one node, so the budget never fired on the very
    payload it exists for: a real run here carries ~220KB of JSON in one attr
    that the pane expands into ~7200 nodes.
    """
    snapshot = json.dumps(
        {f"instrument_{i}": {f"p_{j}": j for j in range(10)} for i in range(10)}
    )

    assert dirtree._count_nodes({"snapshot": snapshot}) > 100
    # Strings that are not JSON stay worth one node.
    assert dirtree._count_nodes({"note": "just text"}) == 1
    assert dirtree._count_nodes({"note": "{not json"}) == 1


@pytest.mark.asyncio
async def test_only_the_oversized_section_is_withheld(monkeypatch):
    """
    The budget is per section, so one huge sibling cannot hide the rest.

    A real QCoDeS run carries 15 sections: 13 single scalars, a 67-node run
    description, and a station snapshot of ~7,000. Refusing the whole payload
    would drop run_id, guid and sample_name over that one section.
    """
    snapshot = json.dumps(
        {f"instrument_{i}": {f"p_{j}": j for j in range(10)} for i in range(10)}
    )
    _patch_loader(
        monkeypatch,
        _dataset(
            {
                "run_id": 8,
                "ds_name": "sweep",
                "guid": "aaaa-bbbb",
                "snapshot": snapshot,
            }
        ),
    )
    monkeypatch.setattr(dirtree, "METADATA_MAX_NODES", 100)

    out = await dirtree.get_metadata(PathData(path="/tmp/experiments.db#run_id=8"))

    # The small sections come through untouched.
    qcodes = out[dirtree.QCODES_META_SECTION]
    assert qcodes["ds_name"] == "sweep"
    assert qcodes["guid"] == "aaaa-bbbb"

    # Only the snapshot is replaced, and by a report of its real size.
    report = qcodes["snapshot"]
    assert report[dirtree.METADATA_TOO_LARGE_KEY] is True
    assert report["nodeCount"] > 100
    assert report["nodeLimit"] == 100


def test_count_nodes_reports_the_whole_structure():
    """
    The count must not depend on the budget it is compared against.

    Stopping early made the same dataset report 33 entries against a limit of
    20 and 57 against 50 -- a number that told the user nothing.
    """
    assert dirtree._count_nodes({"a": {"b": [1, 2, 3]}}) == 5
    assert dirtree._count_nodes({}) == 0

    deep = {"root": [{"k": list(range(50))} for _ in range(50)]}
    # 1 root + 50 dicts + 50 keys + 2500 items, whatever the budget is.
    assert dirtree._count_nodes(deep) == 1 + 50 + 50 * (1 + 50)


@pytest.mark.asyncio
async def test_oversized_section_contents_never_ride_along(monkeypatch):
    """The withheld section is replaced, not merely flagged."""
    snapshot = {
        f"instrument_{i}": {f"param_{j}": j for j in range(20)} for i in range(40)
    }
    _patch_loader(
        monkeypatch,
        _dataset({"Instruments Snapshot": snapshot, "Sweeps": {"x": [0, 1]}}),
    )
    monkeypatch.setattr(dirtree, "METADATA_MAX_NODES", 100)

    out = await dirtree.get_metadata(PathData(path="/tmp/huge.zarr"))

    assert out["Sweeps"] == {"x": [0, 1]}
    assert set(out["Instruments Snapshot"]) == {
        dirtree.METADATA_TOO_LARGE_KEY,
        "nodeCount",
        "nodeLimit",
    }


@pytest.mark.asyncio
async def test_metadata_under_the_budget_is_returned_whole(monkeypatch):
    _patch_loader(monkeypatch, _dataset({"Sweeps": {"x": [0, 1, 2]}}))
    monkeypatch.setattr(dirtree, "METADATA_MAX_NODES", 100)

    out = await dirtree.get_metadata(PathData(path="/tmp/small.zarr"))

    assert out["Sweeps"] == {"x": [0, 1, 2]}
