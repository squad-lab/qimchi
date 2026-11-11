"""
Generate the recorded Qanary datasets used by compatibility tests.

Run this file with a Qanary requirement and output name; see ``main()`` for the
accepted arguments.

"""

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CRASH_AFTER = 20


def produce(data_root: Path, mode: str) -> None:
    """Run one hardware-free measurement (inside the writer's environment)."""
    from qanary.measure import Measurement, Station
    from qanary.sweep import Sweep
    from qcodes.instrument_drivers.mock_instruments import DummyInstrument
    from qcodes.parameters import Parameter
    from qimchi_connect import registry as live_db

    live_db.configure_database(data_root / "live_measurements.db")
    live_db.init_database()

    dac = DummyInstrument("fixture_dac", gates=["x", "y"])
    reads = 0

    def read_signal():
        nonlocal reads
        reads += 1
        if mode == "interrupted" and reads > CRASH_AFTER:
            os._exit(3)
        return 100.0 * dac.x() + dac.y()

    signal = Parameter(
        "signal", label="Signal", unit="A", instrument=dac, get_cmd=read_signal
    )
    current = Parameter(
        "current",
        label="Current",
        unit="nA",
        instrument=dac,
        get_cmd=lambda: dac.x() * dac.y() - 0.5,
    )
    station = Station("fixture")
    station.instruments.append(dac)
    station.add_parameter("x_gate", "X gate", dac.x)
    station.add_parameter("y_gate", "Y gate", dac.y)

    measurement = Measurement(
        wafer_id="W1",
        device_type="hall-bar",
        sample_name="S1",
        experiment_name=f"fixture-{mode}",
        station=station,
        data_location=str(data_root / "data"),
        metadata={"purpose": "format compatibility fixture"},
        fridge_name="test",
        save_interval=0.0,
    )
    measurement.get_installed_packages = lambda: ""

    if mode == "sweep-1d":
        sweeps = [Sweep(dac.x, -1.0, 1.0, num=11)]
    else:
        sweeps = [Sweep(dac.x, 0.0, 0.7, num=8), Sweep(dac.y, 0.0, 0.5, num=6)]
    try:
        measurement.run(sweeps, [signal, current], no_hashing=True)
    finally:
        dac.close()


def record(spec: str, name: str) -> None:
    """Run every measurement with ``spec`` and copy the results to ``name``."""
    out = HERE / name
    shutil.rmtree(out, ignore_errors=True)
    for mode in ("sweep-2d", "sweep-1d", "interrupted"):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            env = {**os.environ, "QANARY_HOME": str(root / "home")}
            subprocess.run(
                [
                    "uv",
                    "run",
                    "--no-project",
                    "--with",
                    spec,
                    "--python",
                    "3.13",
                    "python",
                    __file__,
                    "--produce",
                    str(root),
                    mode,
                ],
                env=env,
                check=mode != "interrupted",
            )
            produced = sorted((root / "data").rglob("*.nc")) + sorted(
                (root / "home" / "live").glob("*.zarr")
            )
            assert len(produced) == 1, produced
            (out / mode).mkdir(parents=True)
            source = produced[0]
            if source.is_dir():
                shutil.copytree(source, out / mode / source.name)
            else:
                shutil.copy2(source, out / mode / source.name)


if __name__ == "__main__":
    if sys.argv[1] == "--produce":
        produce(Path(sys.argv[2]), sys.argv[3])
    else:
        record(sys.argv[1], sys.argv[2])
