import pytest
import xarray as xr
from pathlib import Path
import sqlite3

from api import data_loader


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

    monkeypatch.setattr(data_loader.live_client, "open_live_dataset_sync", _fail_ws)

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

    monkeypatch.setattr(data_loader.live_client, "open_live_dataset_sync", _sync_ws)
    monkeypatch.setattr(data_loader.live_client, "open_live_dataset", _async_ws)

    sync_loaded = data_loader.load_data_sync("memory://m-002")
    async_loaded = await data_loader.load_data_async("memory://m-002")

    assert sync_loaded.loaded_from == "memory"
    assert async_loaded.loaded_from == "memory"
    assert sync_loaded.obj.attrs["measurement_id"] == "m-002"
    assert async_loaded.obj.attrs["measurement_id"] == "m-002"


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
