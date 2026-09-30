"""
End-to-end verification that a real Quantify measurement resolves through
Qimchi's own production data_loader while still running.

Quantify-core is deprecated/EOL and requires a qcodes version incompatible
with this project's own `qcodes~=0.56.0` (see the `quantify-tests` extra in
pyproject.toml), so it cannot be imported in this venv at all. The producer
side therefore runs in a throwaway `uv run --no-project --with ...`
environment, provisioned fresh by this test; the consumer side is Qimchi's
own real data_loader, imported and called normally in this process.

Skipped by default -- opt in with QIMCHI_RUN_QUANTIFY_LIVE_TEST=1. This
provisions a large, rarely-changing dependency tree (quantify-core pulls in
matplotlib, scikit-learn, PyQt5, ...) that has no reason to slow down every
routine test run; the qcodes-based equivalent (test_qcodes_live_integration.py)
needs no such extra since qcodes is already a normal dependency here.

"""

from __future__ import annotations

import os
import shutil
import subprocess
import time
import tomllib
from pathlib import Path

import pytest

from api import data_loader

pytestmark = pytest.mark.skipif(
    os.environ.get("QIMCHI_RUN_QUANTIFY_LIVE_TEST") != "1",
    reason=(
        "opt-in only: set QIMCHI_RUN_QUANTIFY_LIVE_TEST=1 to provision an "
        "isolated quantify-core environment and run this test"
    ),
)

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_QIMCHI_CONNECT_ROOT = _BACKEND_ROOT.parents[1] / "qimchi-connect"

_PRODUCER_SCRIPT = """
import sys
import tempfile
import threading
import time
from pathlib import Path

import numpy as np
from filelock import FileLock
from qcodes import validators
from qcodes.instrument import ManualParameter
from quantify_core.data.handling import (
    get_tuids_containing,
    load_dataset,
    locate_experiment_container,
    set_datadir,
)
from quantify_core.measurement import MeasurementControl

from qimchi_connect import live_measurement

signal_file = Path(sys.argv[1])
datadir = sys.argv[2]
exp_name = sys.argv[3]

set_datadir(datadir)

MC = MeasurementControl("MC")
# Quantify's own docs: this governs how often the in-progress dataset is
# flushed to disk during acquisition -- the same mechanism its own plot
# monitor relies on for live updates. No MC internals are touched here.
MC.update_interval(0.15)

x = ManualParameter("x", label="X Voltage", unit="V", vals=validators.Numbers())
y = ManualParameter("y", label="Y Voltage", unit="V", vals=validators.Numbers())


class Gettable:
    def __init__(self, x_par, y_par):
        self.x_par, self.y_par = x_par, y_par
        self.name = "z"
        self.label = "Signal"
        self.unit = "A"

    def get(self):
        time.sleep(0.15)  # simulate acquisition time
        return np.sin(self.x_par()) + np.cos(self.y_par())


x_vals = np.linspace(-1, 1, 8)
y_vals = np.linspace(0, 2, 8)
MC.settables([x, y])
MC.setpoints_grid([x_vals, y_vals])
MC.gettables(Gettable(x, y))

done = {"flag": False}


def publish():
    # Poll for the tuid the same way Quantify's own plot monitor discovers
    # the current experiment -- public API, no private MC internals.
    tuid = None
    for _ in range(400):
        try:
            tuids = get_tuids_containing(exp_name)
        except FileNotFoundError:
            tuids = []
        if tuids:
            tuid = tuids[-1]
            break
        time.sleep(0.05)
    if tuid is None:
        signal_file.write_text("ERROR: tuid never appeared")
        return

    container = Path(locate_experiment_container(tuid))
    dataset_path = container / "dataset.hdf5"
    measurement_id = f"quantify-{tuid}"
    # Quantify rewrites dataset.hdf5 under this lock. A concurrent HDF5 read
    # can otherwise make the writer's truncate fail on Windows. Its public
    # load_dataset() eagerly loads and closes the file, so holding the same
    # lock for that short read gives the snapshot callback a detached dataset.
    dataset_lock = Path(tempfile.gettempdir()) / f"{tuid}-dataset.hdf5.lock"

    def snapshot():
        with FileLock(dataset_lock, timeout=5):
            return load_dataset(tuid)

    with live_measurement(
        measurement_id=measurement_id,
        snapshot=snapshot,
        disk_path=dataset_path,
        metadata={"source_package": "quantify"},
    ):
        signal_file.write_text(measurement_id)
        while not done["flag"]:
            time.sleep(0.05)


publisher = threading.Thread(target=publish)
publisher.start()

MC.run(exp_name)
done["flag"] = True
publisher.join()
"""


def _quantify_core_spec() -> str:
    pyproject = tomllib.loads((_BACKEND_ROOT / "pyproject.toml").read_text())
    (spec,) = pyproject["project"]["optional-dependencies"]["quantify-tests"]
    return spec


def test_quantify_live_measurement_resolves_through_qimchi_data_loader(tmp_path):
    if shutil.which("uv") is None:
        pytest.skip("uv is required to provision the isolated quantify-core env")

    script_path = tmp_path / "quantify_producer.py"
    script_path.write_text(_PRODUCER_SCRIPT)
    signal_file = tmp_path / "dataset_id.txt"
    datadir = tmp_path / "quantify-data"
    datadir.mkdir()
    exp_name = "qimchi_backend_live_test"

    log_path = tmp_path / "producer.log"
    with open(log_path, "w") as log:
        proc = subprocess.Popen(
            [
                "uv",
                "run",
                "--no-project",
                "--with",
                str(_QIMCHI_CONNECT_ROOT),
                "--with",
                "qcodes==0.42.1",
                "--with",
                _quantify_core_spec(),
                "python",
                str(script_path),
                str(signal_file),
                str(datadir),
                exp_name,
            ],
            stdout=log,
            stderr=subprocess.STDOUT,
        )

    try:
        # Provisioning the isolated environment can be slow, especially cold.
        deadline = time.time() + 180
        dataset_id = None
        while time.time() < deadline:
            if signal_file.exists():
                content = signal_file.read_text().strip()
                if content:
                    dataset_id = content
                    break
            if proc.poll() is not None:
                break
            time.sleep(0.5)

        assert dataset_id is not None, (
            f"producer never published a dataset id; log:\n{log_path.read_text()}"
        )
        assert not dataset_id.startswith("ERROR"), (
            f"producer error: {dataset_id}; log:\n{log_path.read_text()}"
        )

        observed = {}
        deadline = time.time() + 30
        while time.time() < deadline:
            try:
                loaded = data_loader.load_data_sync(f"memory://{dataset_id}")
            except Exception:
                time.sleep(0.3)
                continue
            # A read landing exactly mid-write to Quantify's own concurrently
            # written HDF5 file can occasionally come back ungridded (the
            # gridder's own defensive fallback: no crash, just an unreshaped
            # snapshot for that one poll) -- keep polling rather than treat
            # that as a failure, matching the resilience data_loader itself
            # already provides.
            if loaded.obj.sizes != {"x0": 8, "x1": 8}:
                loaded.obj.close()
                time.sleep(0.3)
                continue
            nan_count = int(loaded.obj["y0"].isnull().sum())
            total = loaded.obj["y0"].size
            if loaded.format == "quantify" and 0 < nan_count < total:
                observed["loaded"] = loaded
                observed["nan_count"] = nan_count
                observed["total"] = total
                break
            loaded.obj.close()
            time.sleep(0.3)

        assert "loaded" in observed, (
            f"never observed a partial gridded live Quantify snapshot through "
            f"data_loader; log:\n{log_path.read_text()}"
        )
        loaded = observed["loaded"]
        assert loaded.loaded_from == "memory"
        assert loaded.metadata["live_status"] is True
        assert loaded.obj.sizes == {"x0": 8, "x1": 8}
        assert loaded.obj["x0"].attrs.get("label") == "X Voltage"
        assert loaded.obj["x0"].attrs.get("unit") == "V"
        loaded.obj.close()

        return_code = proc.wait(timeout=30)
        assert return_code == 0, (
            f"Quantify producer failed; log:\n{log_path.read_text()}"
        )
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=15)
