import sqlite3
import threading
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import xarray as xr

from api import data_loader


@pytest.mark.asyncio
async def test_load_data_async_zarr_runs_off_the_event_loop(tmp_path, monkeypatch):
    """
    The zarr provider must open the file in a thread, not inline.

    Opening a dataset is blocking I/O, and this provider is the common path.
    Awaiting it inline pinned the event loop for the whole read, which is what
    made a large Basket stall unrelated requests while metadata loaded.

    """
    zarr_path = tmp_path / "demo.zarr"
    zarr_path.mkdir(parents=True)

    ds = xr.Dataset(
        data_vars={"signal": (("x",), [1.0, 2.0, 3.0])},
        coords={"x": [0, 1, 2]},
    )

    opened_on = []

    def _record_thread(*_args):
        opened_on.append(threading.current_thread().name)
        return ds

    monkeypatch.setattr(data_loader, "_load_xarray_dataset", _record_thread)

    loaded = await data_loader.load_data_async(str(zarr_path))

    assert loaded.kind == "dataset"
    assert loaded.format == "zarr"
    # asyncio.to_thread runs on a worker, never the thread the loop is on.
    assert opened_on and opened_on[0] != threading.current_thread().name


def test_qcodes_loader_decodes_the_station_snapshot(tmp_path, monkeypatch):
    import qcodes.dataset

    db_path = tmp_path / "runs.db"
    db_path.write_bytes(b"qcodes")
    qcodes_dataset = SimpleNamespace(
        to_xarray_dataset=lambda: xr.Dataset(
            attrs={"snapshot": '{"station": {"temperature": 0.02}}'}
        )
    )
    monkeypatch.setattr(
        qcodes.dataset, "initialised_database_at", lambda _path: nullcontext()
    )
    monkeypatch.setattr(qcodes.dataset, "load_by_id", lambda _run_id: qcodes_dataset)

    loaded = data_loader._load_qcodes_xarray_dataset(db_path, 7)

    assert loaded.attrs["snapshot"] == {"station": {"temperature": 0.02}}
    assert loaded.attrs["run_id"] == 7


def test_load_data_sync_zarr(tmp_path, monkeypatch):
    zarr_path = tmp_path / "demo.zarr"
    zarr_path.mkdir(parents=True)

    ds = xr.Dataset(
        data_vars={"signal": (("x",), [1.0, 2.0, 3.0])},
        coords={"x": [0, 1, 2]},
    )
    monkeypatch.setattr(data_loader, "_load_xarray_dataset", lambda *_args: ds)

    loaded = data_loader.load_data_sync(str(zarr_path))
    assert loaded.kind == "dataset"
    assert loaded.format == "zarr"
    assert loaded.loaded_from == "disk"
    assert loaded.obj.attrs["path"] == str(zarr_path)
    loaded.obj.close()


def test_load_data_sync_zarr_v3_marker_dir(tmp_path, monkeypatch):
    zarr_path = tmp_path / "demo_v3_store"
    zarr_path.mkdir(parents=True)
    (zarr_path / "zarr.json").write_text("{}")

    ds = xr.Dataset(
        data_vars={"signal": (("x",), [1.0, 2.0, 3.0])},
        coords={"x": [0, 1, 2]},
    )
    monkeypatch.setattr(data_loader, "_load_xarray_dataset", lambda *_args: ds)

    loaded = data_loader.load_data_sync(str(zarr_path))
    assert loaded.kind == "dataset"
    assert loaded.format == "zarr"
    assert loaded.loaded_from == "disk"
    assert loaded.obj.attrs["path"] == str(zarr_path)
    loaded.obj.close()


def test_load_data_sync_zarr_v2_group_marker_dir(tmp_path, monkeypatch):
    zarr_path = tmp_path / "demo_v2_store"
    zarr_path.mkdir(parents=True)
    (zarr_path / ".zgroup").write_text("{}")

    ds = xr.Dataset(
        data_vars={"signal": (("x",), [1.0, 2.0, 3.0])},
        coords={"x": [0, 1, 2]},
    )
    monkeypatch.setattr(data_loader, "_load_xarray_dataset", lambda *_args: ds)

    loaded = data_loader.load_data_sync(str(zarr_path))
    assert loaded.kind == "dataset"
    assert loaded.format == "zarr"
    assert loaded.loaded_from == "disk"
    assert loaded.obj.attrs["path"] == str(zarr_path)
    loaded.obj.close()


def test_load_data_sync_netcdf_file(tmp_path, monkeypatch):
    nc_path = tmp_path / "demo.nc"
    nc_path.write_text("placeholder")
    ds = xr.Dataset(data_vars={"signal": (("x",), [1.0, 2.0])}, coords={"x": [0, 1]})
    monkeypatch.setattr(data_loader, "_load_xarray_dataset", lambda *_args: ds)

    loaded = data_loader.load_data_sync(str(nc_path))
    assert loaded.kind == "dataset"
    assert loaded.format == "netcdf"
    assert loaded.loaded_from == "disk"
    assert loaded.obj.attrs["path"] == str(nc_path)
    loaded.obj.close()


def test_load_data_sync_hdf5_file(tmp_path, monkeypatch):
    h5_path = tmp_path / "demo.h5"
    h5_path.write_text("placeholder")
    ds = xr.Dataset(data_vars={"signal": (("x",), [1.0, 2.0])}, coords={"x": [0, 1]})
    monkeypatch.setattr(data_loader, "_load_xarray_dataset", lambda *_args: ds)

    loaded = data_loader.load_data_sync(str(h5_path))
    assert loaded.kind == "dataset"
    assert loaded.format == "hdf5"
    assert loaded.loaded_from == "disk"
    assert loaded.obj.attrs["path"] == str(h5_path)
    loaded.obj.close()


def test_qcodes_sqlite_explicit_run_id_fragment(tmp_path, monkeypatch):
    db_path = tmp_path / "qcodes.db"
    db_path.write_text("placeholder")
    ds = xr.Dataset(data_vars={"signal": (("x",), [1.0])}, coords={"x": [0]})

    captured = {"run_id": None, "path": None}

    def _mock_load_qcodes(path, run_id):
        captured["run_id"] = run_id
        captured["path"] = str(path)
        return ds

    monkeypatch.setattr(data_loader, "_load_qcodes_xarray_dataset", _mock_load_qcodes)

    loaded = data_loader.load_data_sync(f"{db_path}#run_id=7")
    assert loaded.format == "sqlite"
    assert loaded.metadata["run_id"] == 7
    assert captured["run_id"] == 7
    assert captured["path"] == str(db_path)
    assert loaded.obj.attrs["path"] == f"{db_path}#run_id=7"
    loaded.obj.close()


def test_qcodes_sqlite_defaults_to_latest_run(tmp_path, monkeypatch):
    db_path = tmp_path / "qcodes.sqlite"
    db_path.write_text("placeholder")
    ds = xr.Dataset(data_vars={"signal": (("x",), [1.0])}, coords={"x": [0]})

    monkeypatch.setattr(data_loader, "_get_latest_qcodes_run_id", lambda _p: 12)
    monkeypatch.setattr(data_loader, "_load_qcodes_xarray_dataset", lambda _p, _r: ds)

    loaded = data_loader.load_data_sync(str(db_path))
    assert loaded.format == "sqlite"
    assert loaded.metadata["run_id"] == 12
    loaded.obj.close()


def test_qcodes_resolve_disk_path_strips_fragment(tmp_path):
    db_path = tmp_path / "qcodes.db"
    db_path.write_text("placeholder")
    resolved = data_loader.resolve_to_disk_path(f"{db_path}#42")
    assert resolved == str(db_path)


def test_unsupported_extension_returns_deterministic_error(tmp_path):
    p = tmp_path / "unsupported.foo"
    p.write_text("hello")

    with pytest.raises(data_loader.UnsupportedDatasetFormatError) as exc:
        data_loader.load_data_sync(str(p))

    assert "Unsupported dataset path/format" in str(exc.value)


def test_memory_reference_falls_back_to_disk(tmp_path, monkeypatch):
    zarr_path = tmp_path / "fallback.zarr"
    zarr_path.mkdir(parents=True)
    ds = xr.Dataset(
        data_vars={"signal": (("x",), [1.0, 2.0, 3.0])},
        coords={"x": [0, 1, 2]},
    )
    monkeypatch.setattr(data_loader, "_load_xarray_dataset", lambda *_args: ds)

    monkeypatch.setattr(
        data_loader,
        "resolve_live_dataset",
        lambda _m: {
            "disk_path": str(zarr_path),
            "ws_url": "ws://localhost:9999",
            "ws_port": 9999,
            "live_status": True,
            "started_at": "2026-01-01T00:00:00",
            "ended_at": None,
        },
    )

    def _fail_ws(*_args, **_kwargs):
        raise RuntimeError("ws unavailable")

    monkeypatch.setattr(data_loader.live_client, "open_live_measurement_sync", _fail_ws)

    loaded = data_loader.load_data_sync("memory://m-001")
    assert loaded.kind == "dataset"
    assert loaded.loaded_from == "disk"
    assert loaded.obj.attrs["path"] == "memory://m-001"
    assert loaded.obj.attrs["actual_path"] == str(zarr_path)
    loaded.obj.close()


@pytest.mark.asyncio
async def test_sync_async_parity_for_memory_ws(monkeypatch):
    base = xr.Dataset(
        data_vars={"value": (("x",), [10.0, 20.0])},
        coords={"x": [0, 1]},
    )

    monkeypatch.setattr(
        data_loader,
        "resolve_live_dataset",
        lambda _m: {
            "disk_path": None,
            "ws_url": "ws://localhost:9999",
            "ws_port": 9999,
            "live_status": True,
            "started_at": "2026-01-01T00:00:00",
            "ended_at": None,
        },
    )

    def _sync_ws(*_args, **_kwargs):
        return base.copy(deep=True)

    async def _async_ws(*_args, **_kwargs):
        return base.copy(deep=True)

    monkeypatch.setattr(data_loader.live_client, "open_live_measurement_sync", _sync_ws)
    monkeypatch.setattr(data_loader.live_client, "open_live_measurement", _async_ws)

    sync_loaded = data_loader.load_data_sync("memory://m-002")
    async_loaded = await data_loader.load_data_async("memory://m-002")

    assert sync_loaded.loaded_from == "memory"
    assert async_loaded.loaded_from == "memory"
    assert sync_loaded.obj.attrs["measurement_id"] == "m-002"
    assert async_loaded.obj.attrs["measurement_id"] == "m-002"


def _live_row(**overrides):
    """A registry row for a running measurement, with fields overridden."""
    row = {
        "disk_path": None,
        "ws_url": "ws://localhost:9999",
        "ws_port": 9999,
        "live_status": True,
        "started_at": "2026-01-01T00:00:00",
        "ended_at": None,
    }
    row.update(overrides)
    return row


def _counting_ws(monkeypatch, result):
    """
    Install a WebSocket loader that counts its calls.

    Args:
        monkeypatch: Pytest fixture used to install the fake.
        result: Dataset to return, or an exception instance to raise.

    Returns:
        list: One-element call counter, so a test can assert on attempts.

    """
    calls = []

    def _ws(*_args, **_kwargs):
        calls.append(1)
        if isinstance(result, Exception):
            raise result
        return result.copy(deep=True)

    monkeypatch.setattr(data_loader.live_client, "open_live_measurement_sync", _ws)
    monkeypatch.setattr(data_loader, "_WS_DISOWNED", {})
    return calls


def _disk_backed(tmp_path, monkeypatch):
    """Give the loader a readable disk artefact and return its path."""
    zarr_path = tmp_path / "ended.zarr"
    zarr_path.mkdir(parents=True)
    ds = xr.Dataset(
        data_vars={"signal": (("x",), [1.0, 2.0])},
        coords={"x": [0, 1]},
    )
    monkeypatch.setattr(data_loader, "_load_xarray_dataset", lambda *_args: ds)
    return zarr_path


def test_a_finished_measurement_is_read_from_disk_without_dialling_the_socket(
    tmp_path, monkeypatch
):
    """
    A producer that has ended has also exited, so its endpoint cannot answer.
    Dialling it once per plot refresh only delays the plot.

    """
    zarr_path = _disk_backed(tmp_path, monkeypatch)
    monkeypatch.setattr(
        data_loader,
        "resolve_live_dataset",
        lambda _m: _live_row(
            disk_path=str(zarr_path),
            live_status=False,
            ended_at="2026-01-01T00:01:00",
        ),
    )
    calls = _counting_ws(monkeypatch, RuntimeError("should not be called"))

    loaded = data_loader.load_data_sync("memory://m-ended")

    assert calls == []
    assert loaded.loaded_from == "disk"
    loaded.obj.close()


def test_a_finished_measurement_with_no_disk_path_still_tries_the_socket(monkeypatch):
    """With nothing on disk to fall back to, the socket is the only source."""
    base = xr.Dataset(data_vars={"value": (("x",), [1.0])}, coords={"x": [0]})
    monkeypatch.setattr(
        data_loader,
        "resolve_live_dataset",
        lambda _m: _live_row(live_status=False, ended_at="2026-01-01T00:01:00"),
    )
    calls = _counting_ws(monkeypatch, base)

    loaded = data_loader.load_data_sync("memory://m-no-disk")

    assert len(calls) == 1
    assert loaded.loaded_from == "memory"


def test_a_server_that_disowns_a_measurement_is_not_asked_again(tmp_path, monkeypatch):
    """
    "Measurement not found" comes from a live server that answered, so it is
    conclusive -- it is what a later producer inheriting the port reports.

    """
    zarr_path = _disk_backed(tmp_path, monkeypatch)
    monkeypatch.setattr(
        data_loader,
        "resolve_live_dataset",
        lambda _m: _live_row(disk_path=str(zarr_path)),
    )
    calls = _counting_ws(
        monkeypatch,
        RuntimeError("Failed to get snapshot for m-gone: Measurement m-gone not found"),
    )

    first = data_loader.load_data_sync("memory://m-gone")
    second = data_loader.load_data_sync("memory://m-gone")

    assert len(calls) == 1, "the denial should be remembered, not re-asked"
    assert first.loaded_from == "disk"
    assert second.loaded_from == "disk"
    first.obj.close()
    second.obj.close()


def test_a_refused_connection_is_tried_again(tmp_path, monkeypatch):
    """A producer can be slow to bind or restarting; that is not conclusive."""
    zarr_path = _disk_backed(tmp_path, monkeypatch)
    monkeypatch.setattr(
        data_loader,
        "resolve_live_dataset",
        lambda _m: _live_row(disk_path=str(zarr_path)),
    )
    calls = _counting_ws(monkeypatch, OSError("[WinError 1225] refused"))

    data_loader.load_data_sync("memory://m-refused").obj.close()
    data_loader.load_data_sync("memory://m-refused").obj.close()

    assert len(calls) == 2


class TestLiveRowAccumulation:
    """
    Following a live sweep by asking only for the rows measured since the last
    poll. A producer preallocates its grid, so re-fetching the whole thing
    every second moves the same bytes over and over; these pin the folding,
    the cases that must fall back to a whole snapshot, and the bookkeeping
    that keeps memory bounded.

    """

    ROWS, COLS = 6, 3

    def _grid(self, written: int, *, offset: float = 0.0):
        """A grid whose first ``written`` rows hold values."""
        values = np.full((self.ROWS, self.COLS), np.nan)
        values[:written] = offset + np.arange(written * self.COLS, dtype=float).reshape(
            written, self.COLS
        )
        return xr.Dataset(
            {"signal": (("y", "x"), values)},
            coords={"y": np.arange(self.ROWS), "x": np.arange(self.COLS)},
        )

    def _rows(self, ds, *, rows_from, rows_written, rows_total=None):
        ds.encoding["qimchi_connect_rows"] = {
            "append_dim": "y",
            "rows_from": rows_from,
            "rows_written": rows_written,
            "rows_total": self.ROWS if rows_total is None else rows_total,
        }
        return ds

    def _serve(self, monkeypatch, responses):
        """Serve the given datasets in order, recording each since_rows."""
        asked = []

        def _ws(_measurement_id, ws_url=None, since_rows=None, **_kwargs):
            asked.append(since_rows)
            return responses[min(len(asked) - 1, len(responses) - 1)]

        monkeypatch.setattr(data_loader, "_LIVE_ACCUM", {})
        monkeypatch.setattr(data_loader.live_client, "open_live_measurement_sync", _ws)
        monkeypatch.setattr(data_loader, "resolve_live_dataset", lambda _m: _live_row())
        return asked

    def test_the_first_poll_fetches_everything_and_records_the_frontier(
        self, monkeypatch
    ):
        whole = self._rows(self._grid(2), rows_from=0, rows_written=2)
        asked = self._serve(monkeypatch, [whole])

        data_loader.load_data_sync("memory://m-acc")

        assert asked == [None], "nothing is held yet, so nothing to ask from"
        assert data_loader._LIVE_ACCUM["m-acc"]["rows"] == 2

    def test_the_next_poll_asks_only_for_what_it_is_missing(self, monkeypatch):
        whole = self._rows(self._grid(2), rows_from=0, rows_written=2)
        later = self._rows(
            self._grid(4).isel(y=slice(2, 4)), rows_from=2, rows_written=4
        )
        asked = self._serve(monkeypatch, [whole, later])

        data_loader.load_data_sync("memory://m-acc")
        loaded = data_loader.load_data_sync("memory://m-acc")

        assert asked == [None, 2]
        assert loaded.obj.sizes["y"] == self.ROWS, "the full grid is still plotted"
        assert data_loader._LIVE_ACCUM["m-acc"]["rows"] == 4

    def test_the_fetched_rows_land_where_they_belong(self, monkeypatch):
        whole = self._rows(self._grid(2), rows_from=0, rows_written=2)
        fresh = self._grid(4, offset=100.0)
        later = self._rows(fresh.isel(y=slice(2, 4)), rows_from=2, rows_written=4)
        self._serve(monkeypatch, [whole, later])

        data_loader.load_data_sync("memory://m-acc")
        loaded = data_loader.load_data_sync("memory://m-acc")

        values = loaded.obj["signal"].values
        assert np.array_equal(values[:2], whole["signal"].values[:2]), "kept"
        assert np.array_equal(values[2:4], fresh["signal"].values[2:4]), "folded in"
        assert np.isnan(values[4:]).all(), "the unmeasured tail stays empty"

    def test_rows_from_a_differently_shaped_run_force_a_whole_refetch(
        self, monkeypatch
    ):
        whole = self._rows(self._grid(2), rows_from=0, rows_written=2)
        mismatched = self._rows(
            self._grid(4).isel(y=slice(2, 4)),
            rows_from=2,
            rows_written=4,
            rows_total=self.ROWS + 10,
        )
        asked = self._serve(monkeypatch, [whole, mismatched, whole])

        data_loader.load_data_sync("memory://m-acc")
        loaded = data_loader.load_data_sync("memory://m-acc")

        assert asked == [None, 2, None], "the unfoldable answer is refetched whole"
        assert loaded.obj.sizes["y"] == self.ROWS

    def test_a_producer_that_cannot_describe_rows_is_never_accumulated(
        self, monkeypatch
    ):
        """An older qimchi-connect sends no row fields, so nothing is held."""
        plain = self._grid(2)
        asked = self._serve(monkeypatch, [plain])

        data_loader.load_data_sync("memory://m-old")
        data_loader.load_data_sync("memory://m-old")

        assert asked == [None, None]
        assert data_loader._LIVE_ACCUM == {}

    def test_only_a_bounded_number_of_measurements_is_held(self, monkeypatch):
        """Each entry is a whole measurement in memory, so the map is capped."""
        whole = self._rows(self._grid(2), rows_from=0, rows_written=2)
        self._serve(monkeypatch, [whole])

        for i in range(data_loader._LIVE_ACCUM_MAX + 2):
            data_loader.load_data_sync(f"memory://m-{i}")

        assert len(data_loader._LIVE_ACCUM) == data_loader._LIVE_ACCUM_MAX


def test_custom_provider_registration_smoke():
    class DummyProvider:
        name = "dummy"

        def supports(self, ref: str) -> bool:
            return ref.startswith("dummy://")

        def resolve_disk_path(self, ref: str) -> str:
            return ref

        def load_sync(self, ref: str) -> data_loader.LoadedData:
            return data_loader.LoadedData(
                kind="dataset",
                obj=xr.Dataset(),
                source_ref=ref,
                actual_path=None,
                format="dummy",
                loaded_from="dummy",
                metadata={},
            )

        async def load_async(self, ref: str) -> data_loader.LoadedData:
            return self.load_sync(ref)

    data_loader.clear_custom_providers()
    data_loader.register_provider(DummyProvider(), prepend=True)
    try:
        loaded = data_loader.load_data_sync("dummy://example")
        assert loaded.format == "dummy"
        assert loaded.loaded_from == "dummy"
    finally:
        data_loader.clear_custom_providers()


def test_hdf5_loader_engine_fallback(monkeypatch):
    calls = []
    ds = xr.Dataset(data_vars={"signal": (("x",), [1.0, 2.0])}, coords={"x": [0, 1]})

    def _mock_load_dataset(path: str, engine=None):
        calls.append((path, engine))
        if engine == "h5netcdf":
            raise ImportError("h5netcdf not installed")
        return ds

    monkeypatch.setattr(data_loader.xr, "load_dataset", _mock_load_dataset)
    out = data_loader._load_xarray_dataset(Path("dummy.h5"), "hdf5")
    assert out is ds
    assert calls[0][1] == "h5netcdf"
    assert calls[1][1] == "netcdf4"


def test_netcdf_loader_engine_fallback(monkeypatch):
    calls = []
    ds = xr.Dataset(data_vars={"signal": (("x",), [1.0, 2.0])}, coords={"x": [0, 1]})

    def _mock_load_dataset(path: str, engine=None):
        calls.append((path, engine))
        if engine in {"h5netcdf", "scipy"}:
            raise ValueError(f"{engine} cannot open file")
        return ds

    monkeypatch.setattr(data_loader.xr, "load_dataset", _mock_load_dataset)
    out = data_loader._load_xarray_dataset(Path("dummy.nc"), "netcdf")
    assert out is ds
    assert calls[0][1] == "h5netcdf"
    assert calls[1][1] == "scipy"
    assert calls[2][1] == "netcdf4"


def test_qcodes_missing_dependency_maps_to_backend_error(tmp_path, monkeypatch):
    db_path = tmp_path / "qcodes.db"
    db_path.write_text("placeholder")

    monkeypatch.setattr(data_loader, "_get_latest_qcodes_run_id", lambda _p: 1)

    def _raise_missing(*_args, **_kwargs):
        raise data_loader.MissingBackendDependencyError("qcodes missing")

    monkeypatch.setattr(data_loader, "_load_qcodes_xarray_dataset", _raise_missing)

    with pytest.raises(data_loader.MissingBackendDependencyError):
        data_loader.load_data_sync(str(db_path))


def test_list_qcodes_runs_returns_desc_order(tmp_path):
    db_path = tmp_path / "qcodes.db"
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            "CREATE TABLE runs (run_id INTEGER PRIMARY KEY, name TEXT, result_table_name TEXT, run_timestamp REAL)"
        )
        conn.execute(
            "INSERT INTO runs (run_id, name, result_table_name, run_timestamp) VALUES (1, 'scan_a', 'results_1', 100.0)"
        )
        conn.execute(
            "INSERT INTO runs (run_id, name, result_table_name, run_timestamp) VALUES (2, 'scan_b', 'results_2', 200.0)"
        )
        conn.commit()
    finally:
        conn.close()

    runs = data_loader.list_qcodes_runs(db_path)
    assert [r["run_id"] for r in runs] == [2, 1]
    assert runs[0]["name"] == "scan_b"


@pytest.mark.parametrize("suffix", [".csv", ".txt", ".dat"])
def test_flat_table_provider_loads_supported_files(tmp_path, monkeypatch, suffix):
    table_path = tmp_path / f"table{suffix}"
    table_path.write_text("x,y\n1,2\n3,4\n")

    ds = xr.Dataset(
        coords={
            "row": [0, 1],
            "x": ("row", [1, 3]),
            "y": ("row", [2, 4]),
        },
        attrs={"qimchi_all_columns": ["x", "y"], "qimchi_tabular": True},
    )
    monkeypatch.setattr(data_loader, "_load_flat_table_dataset", lambda _p: ds)

    loaded = data_loader.load_data_sync(str(table_path))
    assert loaded.kind == "dataset"
    assert loaded.format == suffix.lstrip(".")
    assert loaded.loaded_from == "disk"
    assert loaded.metadata["columns"] == ["x", "y"]
    assert loaded.obj.attrs["path"] == str(table_path)
    loaded.obj.close()


def test_datatree_reference_loads_selected_node_dataset(tmp_path, monkeypatch):
    store_path = tmp_path / "tree.zarr"
    store_path.mkdir(parents=True)
    ref = f"{store_path}#dt_path=/group/run_1"
    ds = xr.Dataset(data_vars={"signal": (("x",), [1.0])}, coords={"x": [0]})

    monkeypatch.setattr(data_loader, "_open_xarray_datatree", lambda _p, _fmt: object())
    monkeypatch.setattr(
        data_loader, "_extract_dataset_from_datatree", lambda _dt, _np: ds
    )

    loaded = data_loader.load_data_sync(ref)
    assert loaded.kind == "dataset"
    assert loaded.loaded_from == "disk"
    assert loaded.format == "zarr"
    assert loaded.metadata["dt_path"] == "/group/run_1"
    assert loaded.obj.attrs["path"] == ref
    loaded.obj.close()


# --- Quantify support ---
#
# Fixture datasets below mirror the exact on-disk structure of real
# quantify-core-generated files (dim_0-indexed flat x0/x1 coordinates,
# grid_2d/xlen/ylen attrs, long_name/units on every coord and data var),
# verified against actual `quantify_core.data.handling.to_gridded_dataset()`
# output.


def _quantify_1d_dataset() -> xr.Dataset:
    x_vals = np.linspace(-1, 1, 21)
    ds = xr.Dataset(
        {"y0": ("dim_0", np.sin(x_vals))},
        coords={"x0": ("dim_0", x_vals)},
        attrs={
            "tuid": "20260902-172313-694-c1732f",
            "name": "qimchi_test_1d",
            "grid_2d": False,
            "grid_2d_uniformly_spaced": False,
        },
    )
    ds["x0"].attrs.update({"name": "x", "long_name": "X Voltage", "units": "V"})
    ds["y0"].attrs.update({"name": "y", "long_name": "Signal", "units": "A"})
    return ds


def _quantify_2d_dataset(*, measured_points: int | None = None) -> xr.Dataset:
    x_vals = np.linspace(-1, 1, 5)
    y_vals = np.linspace(0, 2, 4)
    xx, yy = np.meshgrid(x_vals, y_vals, indexing="ij")
    x0_full = xx.flatten()
    x1_full = yy.flatten()
    y0_full = np.sin(x0_full) + np.cos(x1_full)
    if measured_points is not None:
        y0_full = y0_full.copy()
        y0_full[measured_points:] = np.nan

    ds = xr.Dataset(
        {"y0": ("dim_0", y0_full)},
        coords={"x0": ("dim_0", x0_full), "x1": ("dim_0", x1_full)},
        attrs={
            "tuid": "20260902-172330-257-5069c6",
            "name": "qimchi_test_2d",
            "grid_2d": True,
            "grid_2d_uniformly_spaced": True,
            "xlen": 5,
            "ylen": 4,
        },
    )
    ds["x0"].attrs.update({"name": "x", "long_name": "X Voltage", "units": "V"})
    ds["x1"].attrs.update({"name": "y", "long_name": "Y Voltage", "units": "V"})
    ds["y0"].attrs.update({"name": "z", "long_name": "Signal", "units": "A"})
    return ds


def test_quantify_1d_dataset_is_tagged_but_left_ungridded(tmp_path, monkeypatch):
    h5_path = tmp_path / "dataset.hdf5"
    h5_path.write_text("placeholder")
    ds = _quantify_1d_dataset()
    monkeypatch.setattr(data_loader, "_load_xarray_dataset", lambda *_args: ds)

    loaded = data_loader.load_data_sync(str(h5_path))
    assert loaded.format == "quantify"
    assert loaded.obj.sizes == {"dim_0": 21}
    # A single settable is already directly plottable via its dim_0 coord.
    assert loaded.obj["x0"].attrs["label"] == "X Voltage"
    assert loaded.obj["x0"].attrs["unit"] == "V"
    assert loaded.obj["y0"].attrs["label"] == "Signal"
    assert loaded.obj["y0"].attrs["unit"] == "A"
    loaded.obj.close()


def test_quantify_2d_dataset_is_gridded(tmp_path, monkeypatch):
    h5_path = tmp_path / "dataset.hdf5"
    h5_path.write_text("placeholder")
    ds = _quantify_2d_dataset()
    monkeypatch.setattr(data_loader, "_load_xarray_dataset", lambda *_args: ds)

    loaded = data_loader.load_data_sync(str(h5_path))
    gridded = loaded.obj
    assert loaded.format == "quantify"
    assert gridded.sizes == {"x0": 5, "x1": 4}
    np.testing.assert_allclose(gridded["x0"].values, np.linspace(-1, 1, 5))
    np.testing.assert_allclose(gridded["x1"].values, np.linspace(0, 2, 4))
    np.testing.assert_allclose(
        gridded["y0"].values,
        np.sin(gridded["x0"].values)[:, None] + np.cos(gridded["x1"].values)[None, :],
    )
    assert gridded.attrs["grid_2d"] is False
    assert gridded.attrs["qimchi_quantify_gridded"] is True
    # CF long_name/units survive the reshape and get mirrored to label/unit.
    assert gridded["x1"].attrs["label"] == "Y Voltage"
    assert gridded["x1"].attrs["unit"] == "V"
    assert gridded["y0"].attrs["label"] == "Signal"
    loaded.obj.close()


def test_quantify_2d_mid_run_dataset_grids_with_nan_gaps(tmp_path, monkeypatch):
    h5_path = tmp_path / "dataset.hdf5"
    h5_path.write_text("placeholder")
    ds = _quantify_2d_dataset(measured_points=11)
    monkeypatch.setattr(data_loader, "_load_xarray_dataset", lambda *_args: ds)

    loaded = data_loader.load_data_sync(str(h5_path))
    gridded = loaded.obj
    assert gridded.sizes == {"x0": 5, "x1": 4}
    assert int(gridded["y0"].isnull().sum()) == 20 - 11
    loaded.obj.close()


def test_quantify_dataset_without_grid_2d_left_sparse(tmp_path, monkeypatch):
    # A 3+ settable sweep: quantify-core itself never sets grid_2d for this
    # case, so Qimchi does not attempt to grid it either.
    h5_path = tmp_path / "dataset.hdf5"
    h5_path.write_text("placeholder")
    ds = xr.Dataset(
        {"y0": ("dim_0", [1.0, 2.0])},
        coords={
            "x0": ("dim_0", [0.0, 1.0]),
            "x1": ("dim_0", [0.0, 0.0]),
            "x2": ("dim_0", [0.0, 0.0]),
        },
        attrs={"tuid": "fake-3d", "name": "n", "grid_2d": False},
    )
    monkeypatch.setattr(data_loader, "_load_xarray_dataset", lambda *_args: ds)

    loaded = data_loader.load_data_sync(str(h5_path))
    assert loaded.format == "quantify"
    assert loaded.obj.sizes == {"dim_0": 2}
    loaded.obj.close()


def test_non_quantify_hdf5_dataset_is_unaffected(tmp_path, monkeypatch):
    h5_path = tmp_path / "demo.h5"
    h5_path.write_text("placeholder")
    ds = xr.Dataset(data_vars={"signal": (("x",), [1.0, 2.0])}, coords={"x": [0, 1]})
    monkeypatch.setattr(data_loader, "_load_xarray_dataset", lambda *_args: ds)

    loaded = data_loader.load_data_sync(str(h5_path))
    assert loaded.format == "hdf5"
    assert "qimchi_quantify_gridded" not in loaded.obj.attrs
    loaded.obj.close()
