"""
End-to-end verification that a real QCoDeS measurement, published with
qimchi_connect the way examples/qcodes_measurement.py in the qimchi-connect repo
does, resolves through Qimchi's own production data_loader while still
running: memory:// -> the shared live_measurements.db registry -> a live
WebSocket connection -- the exact path a real QCoDeS/qanary measurement
takes, with no mocking of any layer in between.

"""

import threading
import time

import xarray as xr
from qcodes.dataset import (
    Measurement,
    initialise_or_create_database_at,
    load_or_create_experiment,
)
from qcodes.instrument import Instrument
from qcodes.instrument_drivers.mock_instruments import (
    DummyInstrument,
    DummyInstrumentWithMeasurement,
)
from qimchi_connect import live_measurement

from api import data_loader


def test_qcodes_live_measurement_resolves_through_qimchi_data_loader(tmp_path):
    db_path = tmp_path / "qcodes_live.db"
    initialise_or_create_database_at(str(db_path))
    experiment = load_or_create_experiment(
        experiment_name="qimchi_backend_live_test", sample_name="s"
    )

    Instrument.close_all()
    try:
        dac = DummyInstrument("dac", gates=["ch1"])
        dmm = DummyInstrumentWithMeasurement("dmm", setter_instr=dac)

        meas = Measurement(exp=experiment, name="qimchi_backend_live_test_sweep")
        meas.register_parameter(dac.ch1)
        meas.register_parameter(dmm.v1, setpoints=(dac.ch1,))

        total_points = 60
        cache_lock = threading.Lock()
        cached_snapshot = xr.Dataset()
        observed = {}

        with meas.run() as datasaver:
            dataset_id = f"qcodes-backend-live-test-{datasaver.dataset.captured_run_id}"

            def refresh_cache():
                # QCoDeS's sqlite connection is thread-affine and batches
                # writes -- must flush + re-read from the same thread that
                # entered `meas.run()` (this test's own thread). See
                # qimchi-connect/examples/qcodes_measurement.py for the full
                # explanation; verified there against a real crash.
                nonlocal cached_snapshot
                datasaver.flush_data_to_database(block=True)
                snap = datasaver.dataset.to_xarray_dataset()
                with cache_lock:
                    cached_snapshot = snap

            def snapshot():
                # Runs on qimchi_connect's own background server thread when a
                # client asks -- only ever touches the lock-protected cache
                # above, never qcodes' sqlite connection directly.
                with cache_lock:
                    return cached_snapshot

            refresh_cache()

            with live_measurement(dataset_id, snapshot, disk_path=db_path):
                # The sweep and the data_loader client checks below both run
                # on this same thread, interleaved -- data_loader.load_data_sync
                # is just a WebSocket client call to the server's own thread,
                # so it never touches qcodes' sqlite connection and needs no
                # thread of its own.
                for i, voltage in enumerate(v / 10 for v in range(total_points)):
                    dac.ch1.set(voltage)
                    reading = dmm.v1.get()
                    datasaver.add_result((dac.ch1, voltage), (dmm.v1, reading))
                    refresh_cache()

                    if "loaded" not in observed and i >= 3:
                        loaded = data_loader.load_data_sync(f"memory://{dataset_id}")
                        n = loaded.obj.sizes.get("dac_ch1", 0)
                        if 0 < n < total_points:
                            observed["loaded"] = loaded

                    time.sleep(0.05)

        assert "loaded" in observed, (
            "never observed a partial live snapshot through data_loader"
        )
        loaded = observed["loaded"]
        assert loaded.loaded_from == "memory"
        assert loaded.metadata["live_status"] is True
        n = loaded.obj.sizes["dac_ch1"]
        assert 0 < n < total_points
        loaded.obj.close()
    finally:
        Instrument.close_all()
