import pytest
import xarray as xr

from api import dirtree
from api import plots
from api.models import PathData, PlotRequest


def _sample_dataset() -> xr.Dataset:
    return xr.Dataset(
        data_vars={"signal": (("x",), [1.0, 2.0, 3.0])},
        coords={"x": [0, 1, 2]},
        attrs={
            "Timestamp": "2026-01-01T00:00:00",
            "Cryostat": "BlueFors",
            "Sweeps": {"x": [0, 1, 2]},
        },
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("suffix", [".nc", ".h5"])
async def test_get_meta_attrs_supports_netcdf_hdf5_paths(monkeypatch, suffix):
    async def _mock_load_dataset_async(_path: str):
        return _sample_dataset()

    monkeypatch.setattr(dirtree, "load_dataset_async", _mock_load_dataset_async)

    payload = PathData(path=f"/tmp/example{suffix}")
    out = await dirtree.get_meta_attrs(payload)

    assert out["Timestamp"] == "2026-01-01T00:00:00"
    assert out["Cryostat"] == "BlueFors"
    assert out["independents"] == ["x"]
    assert out["dependents"] == ["signal"]


@pytest.mark.asyncio
@pytest.mark.parametrize("suffix", [".nc", ".h5"])
async def test_get_metadata_supports_netcdf_hdf5_paths(monkeypatch, suffix):
    async def _mock_load_dataset_async(_path: str):
        return _sample_dataset()

    monkeypatch.setattr(dirtree, "load_dataset_async", _mock_load_dataset_async)

    payload = PathData(path=f"/tmp/example{suffix}")
    out = await dirtree.get_metadata(payload)

    assert "Sweeps" in out
    assert out["Sweeps"] == {"x": [0, 1, 2]}


@pytest.mark.asyncio
@pytest.mark.parametrize("suffix", [".nc", ".h5"])
async def test_create_plots_accepts_netcdf_hdf5_file_paths(
    tmp_path, monkeypatch, suffix
):
    fpath = tmp_path / f"dataset{suffix}"
    fpath.write_text("placeholder")

    async def _mock_load_dataset_async(_path: str):
        ds = _sample_dataset()
        ds.attrs["path"] = str(fpath)
        return ds

    monkeypatch.setattr(plots, "load_dataset_async", _mock_load_dataset_async)

    req = PlotRequest(
        fpaths=[str(fpath)],
        indeps=["x"],
        deps=["signal"],
        plotType="LinePlot",
    )
    out = await plots.create_plots(req)

    assert out.success is True
    assert len(out.plots) == 1
    assert out.plots[0]["type"] == "LinePlot"


@pytest.mark.asyncio
async def test_get_meta_attrs_uses_tabular_columns_for_indep_dep(monkeypatch):
    async def _mock_load_dataset_async(_path: str):
        return xr.Dataset(
            coords={
                "row": [0, 1],
                "v1": ("row", [1.0, 2.0]),
                "v2": ("row", [3.0, 4.0]),
            },
            attrs={
                "Timestamp": "2026-01-01T00:00:00",
                "qimchi_all_columns": ["v1", "v2"],
            },
        )

    monkeypatch.setattr(dirtree, "load_dataset_async", _mock_load_dataset_async)
    payload = PathData(path="/tmp/example.csv")
    out = await dirtree.get_meta_attrs(payload)

    assert out["independents"] == ["v1", "v2"]
    assert out["dependents"] == ["v1", "v2"]


@pytest.mark.asyncio
@pytest.mark.parametrize("suffix", [".csv", ".txt", ".dat"])
async def test_create_plots_accepts_flat_table_file_paths(
    tmp_path, monkeypatch, suffix
):
    fpath = tmp_path / f"dataset{suffix}"
    fpath.write_text("x,y\n0,1\n1,2\n")

    async def _mock_load_dataset_async(_path: str):
        ds = xr.Dataset(
            coords={
                "row": [0, 1],
                "x": ("row", [0.0, 1.0]),
                "y": ("row", [1.0, 2.0]),
            },
        )
        ds.attrs["path"] = str(fpath)
        return ds

    monkeypatch.setattr(plots, "load_dataset_async", _mock_load_dataset_async)

    req = PlotRequest(
        fpaths=[str(fpath)],
        indeps=["x"],
        deps=["y"],
        plotType="LinePlot",
    )
    out = await plots.create_plots(req)

    assert out.success is True
    assert len(out.plots) == 1
    assert out.plots[0]["type"] == "LinePlot"


@pytest.mark.asyncio
async def test_create_plots_accepts_sqlite_run_reference_path(tmp_path, monkeypatch):
    db_path = tmp_path / "dataset.db"
    db_path.write_text("placeholder")
    ref_path = f"{db_path}#run_id=1"

    async def _mock_load_dataset_async(_path: str):
        ds = _sample_dataset()
        ds.attrs["path"] = ref_path
        return ds

    monkeypatch.setattr(plots, "load_dataset_async", _mock_load_dataset_async)

    req = PlotRequest(
        fpaths=[ref_path],
        indeps=["x"],
        deps=["signal"],
        plotType="LinePlot",
    )
    out = await plots.create_plots(req)

    assert out.success is True
    assert len(out.plots) == 1
    assert out.plots[0]["type"] == "LinePlot"
    assert out.plots[0]["resolved_fpath"] == ref_path
