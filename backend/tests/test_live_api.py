"""Unit tests for live-registry adapters and their API projections."""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest
from fastapi import HTTPException

from api import json_utils, live, live_measurements, live_utils


def _measurement(**changes):
    values = {
        "measurement_id": "m-1",
        "fpath": "/data/m-1.zarr",
        "ws_url": "ws://127.0.0.1:9000",
        "ws_port": 9000,
        "live_status": 1,
        "started_at": "2026-01-01T00:00:00Z",
        "ended_at": None,
    }
    values.update(changes)
    return SimpleNamespace(**values)


def test_live_utils_lists_and_resolves_registry_entries(monkeypatch):
    registry = SimpleNamespace(
        init_database=lambda: None,
        get_live_measurements=lambda: [_measurement()],
        get_measurement=lambda measurement_id: (
            _measurement(measurement_id=measurement_id)
            if measurement_id == "m-1"
            else None
        ),
    )
    monkeypatch.setattr(live_utils, "live_db", registry)

    assert live_utils.get_live_dataset_entries()["m-1"]["disk_path"].endswith(
        "m-1.zarr"
    )
    assert live_utils.resolve_live_dataset("m-1")["live_status"] is True
    assert live_utils.resolve_live_dataset("missing")["disk_path"] is None


@pytest.mark.parametrize(
    "registry", [None, SimpleNamespace(init_database=lambda: 1 / 0)]
)
def test_live_utils_degrades_when_registry_is_unavailable(monkeypatch, registry):
    monkeypatch.setattr(live_utils, "live_db", registry)

    assert live_utils.get_live_dataset_entries() == {}
    assert live_utils.resolve_live_dataset("m-1") == {
        "disk_path": None,
        "ws_url": None,
        "ws_port": None,
        "live_status": None,
        "started_at": None,
        "ended_at": None,
    }


def test_live_measurements_queries_and_converts_registry(monkeypatch):
    calls = []
    registry = SimpleNamespace(
        maintain_registry=lambda **kwargs: calls.append(kwargs),
        get_live_measurements=lambda: [_measurement()],
        init_database=lambda: calls.append("init"),
        get_measurement=lambda measurement_id: _measurement(
            measurement_id=measurement_id, live_status=False
        ),
    )
    monkeypatch.setattr(live_measurements, "live_db", registry)

    listed = live_measurements.get_live_measurements()
    resolved = live_measurements.get_measurement_info("m-2")

    assert listed[0].measurement_id == "m-1"
    assert calls[0] == {"retention_days": 7, "timeout": 2.0, "retries": 2}
    assert resolved.measurement_id == "m-2"
    assert resolved.live_status is False


def test_live_measurements_handles_missing_and_failed_registry(monkeypatch):
    registry = SimpleNamespace(
        init_database=lambda: None,
        get_measurement=lambda _measurement_id: None,
        maintain_registry=lambda **_kwargs: (_ for _ in ()).throw(OSError("down")),
    )
    monkeypatch.setattr(live_measurements, "live_db", registry)
    assert live_measurements.get_live_measurements() == []
    assert live_measurements.get_measurement_info("missing") is None

    monkeypatch.setattr(live_measurements, "live_db", None)
    assert live_measurements.get_live_measurements() == []
    assert live_measurements.get_measurement_info("missing") is None


@pytest.mark.asyncio
async def test_live_routes_shape_results_and_report_missing(monkeypatch):
    info = live_measurements.LiveMeasurementInfo(**vars(_measurement()))
    monkeypatch.setattr(live_measurements, "get_live_measurements", lambda: [info])
    monkeypatch.setattr(live_measurements, "get_measurement_info", lambda _id: info)

    listing = await live.list_live_measurements()
    detail = await live.get_live_measurement("m-1")
    legacy_listing = await live_measurements.api_get_live_measurements()
    legacy_detail = await live_measurements.api_get_measurement("m-1")

    assert listing["count"] == 1
    assert listing["measurements"][0]["path"] == "memory://m-1"
    assert detail["diskPath"] == "/data/m-1.zarr"
    assert legacy_listing["success"] is True
    assert legacy_detail["measurement"] == info

    monkeypatch.setattr(live_measurements, "get_measurement_info", lambda _id: None)
    with pytest.raises(HTTPException) as exc:
        await live.get_live_measurement("missing")
    assert exc.value.status_code == 404
    assert (await live_measurements.api_get_measurement("missing"))["success"] is False


def test_sanitize_for_json_recurses_through_numpy_and_containers():
    value = {
        "array": np.array([np.int64(1), np.int64(2)]),
        "scalar": np.float64(1.5),
        "tuple": (np.bool_(True), [np.int32(3)]),
        "plain": "unchanged",
    }

    assert json_utils.sanitize_for_json(value) == {
        "array": [1, 2],
        "scalar": 1.5,
        "tuple": [True, [3]],
        "plain": "unchanged",
    }
