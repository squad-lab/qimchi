"""
End-to-end coverage for a live qanary heatmap and Qimchi filter.

The producer is a real, hardware-free qanary measurement. It runs in an
isolated environment with a pinned qanary release because qanary intentionally
uses Zarr 2 while the Qimchi backend uses Zarr 3. The consumer remains this process and
uses Qimchi's production registry lookup, WebSocket loader, heatmap builder,
and filter implementation without mocking any layer in that path.

"""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import time

import numpy as np
import pytest
from qimchi_connect import registry as live_db

from api import plots
from api.filters import _extract_axis_data
from api.models import PlotRequest

_PRODUCER_SCRIPT = """
import sys
import time
from pathlib import Path

from qcodes.instrument_drivers.mock_instruments import DummyInstrument
from qcodes.parameters import Parameter
from qimchi_connect import registry as live_db

from qanary.measure import Measurement, Station
from qanary.sweep import Sweep

signal_file = Path(sys.argv[1])
registry_path = Path(sys.argv[2])
data_root = Path(sys.argv[3])

live_db.configure_database(registry_path)
live_db.init_database()

dac = DummyInstrument("qanary_qimchi_e2e_dac", gates=["x", "y"])
dac.x(0.0)
dac.y(0.0)


def read_signal():
    time.sleep(0.08)
    return 100.0 * dac.x() + dac.y()


signal = Parameter(
    "signal",
    label="Signal",
    unit="A",
    instrument=dac,
    get_cmd=read_signal,
)
station = Station("qanary-qimchi-e2e")
station.instruments.append(dac)
station.add_parameter("x_gate", "X gate", dac.x)
station.add_parameter("y_gate", "Y gate", dac.y)

measurement = Measurement(
    wafer_id="W1",
    device_type="hall-bar",
    sample_name="S1",
    experiment_name="qimchi-live-e2e",
    station=station,
    data_location=str(data_root),
    metadata={"purpose": "qimchi live integration test"},
    fridge_name="test",
    save_interval=0.05,
)
measurement.get_installed_packages = lambda: ""
signal_file.write_text(measurement.id, encoding="utf-8")

try:
    measurement.run(
        [
            Sweep(dac.x, 0.0, 0.7, num=8),
            Sweep(dac.y, 0.0, 0.7, num=8),
        ],
        [signal],
        no_hashing=True,
    )
finally:
    dac.close()
    live_db.configure_database(None)
"""


def _plot_request(dataset_id: str) -> PlotRequest:
    return PlotRequest(
        fpaths=[f"memory://{dataset_id}"],
        indeps=["x", "y"],
        deps=["signal"],
        plotType="HeatMap",
        filters_order=["flip"],
        filters_opts={"flip": {}},
    )


def _qanary_spec() -> str:
    """Return the isolated producer requirement used by the live E2E.

    ``QIMCHI_QANARY_SPEC`` lets a developer exercise a local checkout, for
    example ``QIMCHI_QANARY_SPEC=../../qcutils``. CI and ordinary local runs
    use the pinned released version below. Qanary is intentionally not a
    backend extra because its Zarr 2 constraint conflicts with Qimchi's Zarr 3
    environment even when that extra is not installed.
    """
    override = os.environ.get("QIMCHI_QANARY_SPEC")
    if override:
        return override

    return "qanary==0.10.1"


def test_qanary_live_heatmap_and_filter_use_the_production_qimchi_path(tmp_path):
    """A partial qanary grid should become a filtered live Qimchi heatmap."""
    if shutil.which("uv") is None:
        pytest.skip("uv is required to run qanary in its isolated environment")

    registry_path = tmp_path / "live_measurements.db"
    live_db.configure_database(registry_path)
    live_db.init_database()

    script_path = tmp_path / "qanary_producer.py"
    script_path.write_text(_PRODUCER_SCRIPT, encoding="utf-8")
    signal_file = tmp_path / "dataset_id.txt"
    log_path = tmp_path / "producer.log"

    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            [
                "uv",
                "run",
                "--no-project",
                "--with",
                _qanary_spec(),
                "--python",
                "3.13",
                "python",
                str(script_path),
                str(signal_file),
                str(registry_path),
                str(tmp_path / "data"),
            ],
            stdout=log,
            stderr=subprocess.STDOUT,
        )

    try:
        deadline = time.time() + 60
        dataset_id = None
        while time.time() < deadline:
            if signal_file.exists():
                dataset_id = signal_file.read_text(encoding="utf-8").strip() or None
                if dataset_id:
                    break
            if process.poll() is not None:
                break
            time.sleep(0.1)

        assert dataset_id is not None, (
            f"qanary producer did not report its measurement id; "
            f"log:\n{log_path.read_text(encoding='utf-8')}"
        )

        observed_plot = None
        deadline = time.time() + 30
        while time.time() < deadline and process.poll() is None:
            response = asyncio.run(plots.create_plots(_plot_request(dataset_id)))
            if not response.success or response.skip_update or not response.plots:
                time.sleep(0.1)
                continue

            candidate = response.plots[0]
            trace = candidate["plotJson"]["data"][0]
            z_values = _extract_axis_data(trace, "z")
            measured = np.isfinite(z_values)
            # The producer can finish while create_plots() is awaiting its
            # snapshot. In that case Qimchi correctly returns the completed
            # disk fallback with is_live=False; it is not evidence that a
            # partial *live* plot was observed. Only select a candidate whose
            # response and data state describe the same live interval.
            if candidate["is_live"] is True and 0 < int(measured.sum()) < z_values.size:
                observed_plot = candidate
                break
            time.sleep(0.1)

        assert observed_plot is not None, (
            "never observed a partial filtered qanary heatmap while the "
            f"measurement was live; log:\n{log_path.read_text(encoding='utf-8')}"
        )
        assert observed_plot["type"] == "HeatMap"
        assert observed_plot["is_live"] is True
        assert observed_plot["resolved_fpath"] == f"memory://{dataset_id}"
        assert observed_plot["title"].endswith("(Filtered)")

        trace = observed_plot["plotJson"]["data"][0]
        x_values = _extract_axis_data(trace, "x")
        y_values = _extract_axis_data(trace, "y")
        z_values = _extract_axis_data(trace, "z")
        if z_values.ndim == 1:
            z_values = z_values.reshape((y_values.size, x_values.size))
        measured = np.isfinite(z_values)
        expected_flipped = -(100.0 * y_values[:, None] + x_values[None, :])
        np.testing.assert_allclose(z_values[measured], expected_flipped[measured])

        return_code = process.wait(timeout=20)
        assert return_code == 0, (
            "qanary producer failed after publishing the live plot; "
            f"log:\n{log_path.read_text(encoding='utf-8')}"
        )
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=15)
        live_db.configure_database(None)
