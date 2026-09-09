"""Tests for plot request validation, context, filtering, and slicing helpers."""

from __future__ import annotations

import numpy as np
import pytest
import xarray as xr
from fastapi import HTTPException

from api import plots
from api.models import PlotRequest


def _dataset():
    return xr.Dataset(
        {"signal": (("sweep", "x"), np.arange(12).reshape(3, 4))},
        coords={"x": [0.0, 1.0, 2.0, 3.0], "sweep": [0.0, 1.0, 2.0]},
        attrs={"path": "/data/run.nc"},
    )


def test_plot_context_reference_is_stable_and_registered():
    plots._PLOT_CONTEXTS.clear()
    context = {"fpath": "run.nc", "indeps": ["x"], "deps": ["signal"]}
    ref = plots._build_plot_ref(context)
    assert ref == plots._build_plot_ref(dict(reversed(list(context.items()))))
    assert len(ref) == 24
    plots.register_plot_context(ref, context)
    assert plots.get_plot_context(ref) == context
    assert plots.get_plot_context("missing") is None


def test_resolve_context_fpath_preserves_live_fragments_and_disk_fallback():
    dataset = xr.Dataset(attrs={"path": "database.db#run_id=4"})
    assert (
        plots._resolve_context_fpath("database.db#run_id=4", dataset, False)
        == "database.db#run_id=4"
    )
    assert plots._resolve_context_fpath("memory://m", dataset, True) == "memory://m"

    ended = xr.Dataset(
        attrs={"path": "memory://m", "actual_path": "/data/completed.zarr"}
    )
    assert (
        plots._resolve_context_fpath("memory://m", ended, False)
        == "/data/completed.zarr"
    )


def test_path_and_plot_type_validation(tmp_path, monkeypatch):
    file = tmp_path / "run.nc"
    file.write_bytes(b"x")
    assert plots._validate_paths([str(file), "memory://active"]) is True
    assert plots._validate_paths([str(tmp_path / "missing")]) is False
    assert plots._validate_plot_type("LinePlot") is True
    assert plots._validate_plot_type("Scatter3D") is False

    monkeypatch.setattr(
        plots,
        "resolve_to_disk_path",
        lambda _path: (_ for _ in ()).throw(ValueError("invalid reference")),
    )
    assert plots._validate_paths(["bad#run_id=x"]) is False


def test_apply_filters_sync_preserves_failed_plot(monkeypatch):
    source = [
        {"id": "good", "type": "LinePlot", "title": "One", "plotJson": {}},
        {"id": "bad", "type": "HeatMap", "title": "Two", "plotJson": {}},
    ]

    def fake_apply(**kwargs):
        if kwargs["fig_num_axes"] == 2:
            raise ValueError("filter failed")
        return {"filtered": True}, ["notice"]

    monkeypatch.setattr(plots, "apply_filters", fake_apply)
    result = plots._apply_filters_sync(source, ["normalize"], {"normalize": {}})
    assert result[0]["plotJson"] == {"filtered": True}
    assert result[0]["warnings"] == ["notice"]
    assert result[0]["title"].endswith("(Filtered)")
    assert result[1] is source[1]


def test_validate_variables_reports_every_missing_variable():
    first = xr.Dataset({"signal": ("x", [1, 2])}, coords={"x": [0, 1]})
    second = xr.Dataset({"other": ("y", [1, 2])}, coords={"y": [0, 1]})
    result = plots.validate_variables([first, second], ["x"], ["signal"])
    assert result["valid"] is False
    assert len(result["errors"]) == 2
    assert plots.validate_variables([first], ["x"], ["signal"])["valid"] is True


def test_slider_configuration_handles_ranges_singletons_and_bad_coords():
    dataset = _dataset().assign_coords(single=("single", [7.0])).expand_dims(
        bad=["not-numeric", "still-not-numeric"]
    )
    config = plots.gen_slider_config(dataset, ["x", "bad"])
    assert config["sweep"] == {"min": 0.0, "max": 2.0, "step": 1.0, "value": 0.0}
    assert config["single"] == {"min": 7.0, "max": 7.0, "step": 1.0, "value": 7.0}


def test_data_slicing_uses_nearest_and_duplicate_coordinate_fallback():
    dataset = _dataset()
    assert plots.apply_data_slicing(dataset, ["x"], {}) is dataset
    sliced = plots.apply_data_slicing(
        dataset, ["x"], {"sweep": {"value": 1.4}}
    )
    assert sliced.sizes == {"x": 4}
    assert float(sliced.sweep) == 1.0

    duplicate = dataset.assign_coords(sweep=[0.0, 0.0, 2.0])
    fallback = plots.apply_data_slicing(
        duplicate, ["x"], {"sweep": {"value": 1.9}}
    )
    assert float(fallback.sweep) == 2.0
    assert plots.apply_data_slicing(dataset, ["x"], {"absent": {"value": 1}}) is dataset


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("values", "message"),
    [
        ({"fpaths": [], "indeps": ["x"], "deps": ["y"]}, "No file paths"),
        ({"fpaths": ["run.nc"], "indeps": [], "deps": ["y"]}, "No independent"),
        ({"fpaths": ["run.nc"], "indeps": ["x"], "deps": []}, "No dependent"),
    ],
)
async def test_create_plots_rejects_incomplete_requests(values, message):
    response = await plots.create_plots(PlotRequest(plotType="LinePlot", **values))
    assert response.success is False
    assert message in response.message


@pytest.mark.asyncio
async def test_create_plots_handles_invalid_inputs_and_load_failures(tmp_path, monkeypatch):
    file = tmp_path / "run.nc"
    file.write_bytes(b"x")
    base = dict(fpaths=[str(file)], indeps=["x"], deps=["signal"])

    monkeypatch.setattr(plots, "_validate_paths", lambda _paths: False)
    invalid = await plots.create_plots(PlotRequest(plotType="LinePlot", **base))
    assert "invalid or inaccessible" in invalid.message

    monkeypatch.setattr(plots, "_validate_paths", lambda _paths: True)
    unsupported = await plots.create_plots(PlotRequest(plotType="Other", **base))
    assert "Unsupported plot type" in unsupported.message

    async def fail(_path):
        raise OSError("locked")

    monkeypatch.setattr(plots, "load_dataset_async", fail)
    disk = await plots.create_plots(PlotRequest(plotType="LinePlot", **base))
    live = await plots.create_plots(
        PlotRequest(
            fpaths=["memory://run"],
            indeps=["x"],
            deps=["signal"],
            plotType="LinePlot",
        )
    )
    assert disk.success is False and "locked" in disk.message
    assert live.success is True and live.skip_update is True


@pytest.mark.asyncio
async def test_create_plots_handles_variable_races_empty_results_and_filters(
    tmp_path, monkeypatch
):
    file = tmp_path / "run.nc"
    file.write_bytes(b"x")

    async def load(_path):
        return _dataset()

    monkeypatch.setattr(plots, "load_dataset_async", load)
    missing = await plots.create_plots(
        PlotRequest(
            fpaths=[str(file)],
            indeps=["missing"],
            deps=["signal"],
            plotType="LinePlot",
        )
    )
    assert missing.success is False and "Variable validation failed" in missing.message

    live_missing = await plots.create_plots(
        PlotRequest(
            fpaths=["memory://run"],
            indeps=["missing"],
            deps=["signal"],
            plotType="LinePlot",
        )
    )
    assert live_missing.success is True and live_missing.skip_update is True

    monkeypatch.setattr(plots, "create_line_plots", lambda *_args: [])
    empty = await plots.create_plots(
        PlotRequest(
            fpaths=[str(file)],
            indeps=["x"],
            deps=["signal"],
            plotType="LinePlot",
        )
    )
    assert empty.success is False and "No plots were created" in empty.message

    made = [{"id": "plot", "type": "LinePlot", "title": "Plot", "plotJson": {}}]
    monkeypatch.setattr(plots, "create_line_plots", lambda *_args: made)
    monkeypatch.setattr(plots, "_apply_filters_sync", lambda *_args: made)
    filtered = await plots.create_plots(
        PlotRequest(
            fpaths=[str(file)],
            indeps=["x"],
            deps=["signal"],
            plotType="LinePlot",
            filters_order=["diff"],
            filters_opts={"diff": {}},
        )
    )
    assert filtered.success is True


@pytest.mark.asyncio
async def test_create_plots_converts_internal_exceptions_to_response(tmp_path, monkeypatch):
    file = tmp_path / "run.nc"
    file.write_bytes(b"x")

    async def load(_path):
        raise HTTPException(status_code=409, detail="request conflict")

    monkeypatch.setattr(plots, "load_dataset_async", load)
    response = await plots.create_plots(
        PlotRequest(
            fpaths=[str(file)],
            indeps=["x"],
            deps=["signal"],
            plotType="LinePlot",
        )
    )
    assert "request conflict" in response.message
