"""Tests for plot request validation, context, filtering, and slicing helpers."""

from __future__ import annotations

import base64

import numpy as np
import pytest
import xarray as xr
from fastapi import HTTPException

from api import figures, plots
from api.figures import HeatMap, Line
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
    dataset = (
        _dataset()
        .assign_coords(single=("single", [7.0]))
        .expand_dims(bad=["not-numeric", "still-not-numeric"])
    )
    config = plots.gen_slider_config(dataset, ["x", "bad"])
    assert config["sweep"] == {"min": 0.0, "max": 2.0, "step": 1.0, "value": 0.0}
    assert config["single"] == {"min": 7.0, "max": 7.0, "step": 1.0, "value": 7.0}


def test_data_slicing_uses_nearest_and_duplicate_coordinate_fallback():
    dataset = _dataset()
    assert plots.apply_data_slicing(dataset, ["x"], {}) is dataset
    sliced = plots.apply_data_slicing(dataset, ["x"], {"sweep": {"value": 1.4}})
    assert sliced.sizes == {"x": 4}
    assert float(sliced.sweep) == 1.0

    duplicate = dataset.assign_coords(sweep=[0.0, 0.0, 2.0])
    fallback = plots.apply_data_slicing(duplicate, ["x"], {"sweep": {"value": 1.9}})
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
async def test_create_plots_handles_invalid_inputs_and_load_failures(
    tmp_path, monkeypatch
):
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
async def test_create_plots_converts_internal_exceptions_to_response(
    tmp_path, monkeypatch
):
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


@pytest.mark.asyncio
async def test_heatmap_needs_two_independents(tmp_path, monkeypatch):
    """
    A HeatMap without both axes is a request error, not a server error.

    The Composer can be left with one independent selected when the plot type
    is switched, so this path is reachable from the UI.

    """
    file = tmp_path / "run.nc"
    file.write_bytes(b"x")

    async def load(_path):
        return _dataset()

    monkeypatch.setattr(plots, "load_dataset_async", load)

    result = await plots.create_plots(
        PlotRequest(
            fpaths=[str(file)],
            indeps=["x"],
            deps=["signal"],
            plotType="HeatMap",
        )
    )

    assert result.success is False
    assert "2 independent" in result.message


@pytest.mark.asyncio
async def test_heatmap_can_swap_its_axes(tmp_path, monkeypatch):
    file = tmp_path / "run.nc"
    file.write_bytes(b"x")

    async def load(_path):
        return _dataset()

    monkeypatch.setattr(plots, "load_dataset_async", load)

    normal = await plots.create_plots(
        PlotRequest(
            fpaths=[str(file)],
            indeps=["x", "sweep"],
            deps=["signal"],
            plotType="HeatMap",
        )
    )
    swapped = await plots.create_plots(
        PlotRequest(
            fpaths=[str(file)],
            indeps=["x", "sweep"],
            deps=["signal"],
            plotType="HeatMap",
            swap_xy=True,
        )
    )

    assert normal.success is True and swapped.success is True
    # Swapping is what the axis-swap button does; the two must differ.
    assert normal.plots[0]["plotJson"] != swapped.plots[0]["plotJson"]


@pytest.mark.asyncio
async def test_a_slider_value_from_the_frontend_overrides_the_automatic_one(
    tmp_path, monkeypatch
):
    """LineCut sends a slider position; it must win over the derived default."""
    file = tmp_path / "run.nc"
    file.write_bytes(b"x")

    async def load(_path):
        return _dataset()

    monkeypatch.setattr(plots, "load_dataset_async", load)

    result = await plots.create_plots(
        PlotRequest(
            fpaths=[str(file)],
            indeps=["x"],
            deps=["signal"],
            plotType="LinePlot",
            slider={"sweep": {"value": 2.0}},
        )
    )

    assert result.success is True


def _live_dataset(status):
    dataset = _dataset()
    dataset.attrs["path"] = "memory://run"
    dataset.attrs["loaded_from"] = "memory"
    if status is not None:
        dataset.attrs["measurement_live_status"] = status
    return dataset


@pytest.mark.asyncio
@pytest.mark.parametrize("plot_type", ["LinePlot", "HeatMap"])
@pytest.mark.parametrize(
    ("status", "expected"),
    [(True, True), (False, False), (None, True)],
)
async def test_live_flag_follows_the_registry_and_falls_back_to_the_loader(
    monkeypatch, plot_type, status, expected
):
    """
    is_live drives the Viewer's polling, so it must not be guessed wrongly.

    The registry is authoritative when it has an answer; when it does not, a
    dataset that did not come off disk is still being written to.

    """

    async def load(_path):
        return _live_dataset(status)

    monkeypatch.setattr(plots, "load_dataset_async", load)

    result = await plots.create_plots(
        PlotRequest(
            fpaths=["memory://run"],
            indeps=["x", "sweep"] if plot_type == "HeatMap" else ["x"],
            deps=["signal"],
            plotType=plot_type,
        )
    )

    assert result.success is True
    assert result.plots[0]["is_live"] is expected


@pytest.mark.asyncio
@pytest.mark.parametrize("plot_type", ["LinePlot", "HeatMap"])
async def test_a_figure_that_cannot_be_built_becomes_a_failed_response(
    tmp_path, monkeypatch, plot_type
):
    """A figure-building crash must not escape as an unhandled 500."""
    file = tmp_path / "run.nc"
    file.write_bytes(b"x")

    async def load(_path):
        return _dataset()

    def explode(*_args, **_kwargs):
        raise ValueError("bad axis")

    monkeypatch.setattr(plots, "load_dataset_async", load)
    monkeypatch.setattr(
        plots, "Line" if plot_type == "LinePlot" else "HeatMap", explode
    )

    result = await plots.create_plots(
        PlotRequest(
            fpaths=[str(file)],
            indeps=["x", "sweep"] if plot_type == "HeatMap" else ["x"],
            deps=["signal"],
            plotType=plot_type,
        )
    )

    assert result.success is False
    assert "bad axis" in result.message


@pytest.mark.asyncio
async def test_a_heatmap_slider_value_from_the_frontend_wins(tmp_path, monkeypatch):
    """The same override as for line plots, on the third swept axis."""
    file = tmp_path / "run.nc"
    file.write_bytes(b"x")

    async def load(_path):
        return xr.Dataset(
            {"signal": (("field", "sweep", "x"), np.arange(24.0).reshape(2, 3, 4))},
            coords={
                "x": [0.0, 1.0, 2.0, 3.0],
                "sweep": [0.0, 1.0, 2.0],
                "field": [0.0, 1.0],
            },
            attrs={"path": "/data/run.nc"},
        )

    monkeypatch.setattr(plots, "load_dataset_async", load)

    result = await plots.create_plots(
        PlotRequest(
            fpaths=[str(file)],
            indeps=["x", "sweep"],
            deps=["signal"],
            plotType="HeatMap",
            slider={"field": {"value": 1.0}},
        )
    )

    assert result.success is True
    assert result.plots[0]["slider_config"]["field"]["value"] == 1.0


def test_a_path_that_is_neither_file_nor_directory_is_rejected(monkeypatch):
    """A socket, device node or similar exists but cannot hold a dataset."""

    class _OddPath:
        def __init__(self, _value):
            pass

        def exists(self):
            return True

        def is_dir(self):
            return False

        def is_file(self):
            return False

    monkeypatch.setattr(plots, "Path", _OddPath)

    assert plots._validate_paths(["/dev/null"]) is False


def test_a_dimension_carrying_labels_rather_than_numbers_gets_no_slider():
    """
    A slider needs numbers; some datasets carry string labels on a dimension.

    The dimension is skipped rather than aborting the whole slider config.

    """
    dataset = xr.Dataset(
        {"signal": (("mode", "x"), np.zeros((1, 4)))},
        coords={"x": [0.0, 1.0, 2.0, 3.0], "mode": ["fast"]},
    )

    config = plots.gen_slider_config(dataset, ["x"])

    assert config == {}


def test_a_coordinate_with_gaps_still_gets_a_usable_step():
    """A NaN in the sweep makes the median difference NaN; the step must not be."""
    dataset = xr.Dataset(
        {"signal": (("sweep", "x"), np.zeros((3, 4)))},
        coords={"x": [0.0, 1.0, 2.0, 3.0], "sweep": [0.0, np.nan, 2.0]},
    )

    config = plots.gen_slider_config(dataset, ["x"])

    assert config["sweep"]["step"] == 1.0


def test_slicing_a_non_numeric_duplicate_coordinate_returns_the_dataset_whole():
    """
    Both the nearest-neighbour path and the manual fallback fail here.

    Duplicate values defeat sel(method="nearest"), and string labels defeat the
    arithmetic the fallback uses -- the request must still return data.

    """
    dataset = xr.Dataset(
        {"signal": (("mode", "x"), np.zeros((3, 4)))},
        coords={"x": [0.0, 1.0, 2.0, 3.0], "mode": ["a", "a", "b"]},
    )

    result = plots.apply_data_slicing(dataset, ["x"], {"mode": {"value": 1.0}})

    assert result.sizes == {"mode": 3, "x": 4}


@pytest.mark.asyncio
@pytest.mark.parametrize("plot_type", ["LinePlot", "HeatMap"])
async def test_a_slider_for_a_dimension_being_plotted_is_ignored(
    tmp_path, monkeypatch, plot_type
):
    """
    A stale LineCut slider can name an axis that is now an independent.

    Those dimensions have no slider of their own, so the entry must be dropped
    rather than injected into the config.

    """
    file = tmp_path / "run.nc"
    file.write_bytes(b"x")

    async def load(_path):
        return xr.Dataset(
            {"signal": (("field", "sweep", "x"), np.arange(24.0).reshape(2, 3, 4))},
            coords={
                "x": [0.0, 1.0, 2.0, 3.0],
                "sweep": [0.0, 1.0, 2.0],
                "field": [0.0, 1.0],
            },
            attrs={"path": "/data/run.nc"},
        )

    monkeypatch.setattr(plots, "load_dataset_async", load)

    result = await plots.create_plots(
        PlotRequest(
            fpaths=[str(file)],
            indeps=["x", "sweep"] if plot_type == "HeatMap" else ["x"],
            deps=["signal"],
            plotType=plot_type,
            slider={"x": {"value": 3.0}, "field": {"value": 1.0}},
        )
    )

    assert result.success is True
    assert "x" not in result.plots[0]["slider_config"]
    assert result.plots[0]["slider_config"]["field"]["value"] == 1.0


@pytest.mark.asyncio
async def test_an_unexpected_failure_becomes_a_response_not_a_traceback(
    tmp_path, monkeypatch
):
    """The endpoint answers the SPA even when something outside plotting breaks."""
    file = tmp_path / "run.nc"
    file.write_bytes(b"x")

    async def load(_path):
        return _dataset()

    def explode(*_args, **_kwargs):
        raise RuntimeError("validator exploded")

    monkeypatch.setattr(plots, "load_dataset_async", load)
    monkeypatch.setattr(plots, "validate_variables", explode)

    result = await plots.create_plots(
        PlotRequest(
            fpaths=[str(file)],
            indeps=["x"],
            deps=["signal"],
            plotType="LinePlot",
        )
    )

    assert result.success is False
    assert "validator exploded" in result.message


def test_slicing_a_dimension_that_has_no_coordinate_leaves_the_dataset_alone():
    """
    A QCoDeS run can have a dimension with no coordinate to select along.

    xarray refuses a nearest-neighbour lookup there, and the manual fallback
    has no values to search, so the dataset comes back unsliced.

    """
    dataset = xr.Dataset(
        {"signal": (("repeat", "x"), np.zeros((2, 4)))},
        coords={"x": [0.0, 1.0, 2.0, 3.0]},
    )
    assert "repeat" not in dataset.coords

    result = plots.apply_data_slicing(dataset, ["x"], {"repeat": {"value": 1.0}})

    assert result.sizes == {"repeat": 2, "x": 4}


def test_heatmap_colour_range_does_not_leak_between_plots():
    def heatmap(values):
        dataset = xr.Dataset(
            {"z": (("x", "y"), values)},
            coords={"x": [0.0, 1.0], "y": [0.0, 1.0]},
        )
        created = plots.create_heat_maps([dataset], ["/run.nc"], ["x", "y"], ["z"])
        return created[0]["plotJson"]["layout"]["coloraxis"]

    heatmap(np.array([[-37.0, -30.0], [-25.0, -20.0]]))
    coloraxis = heatmap(np.array([[1e-10, 2e-10], [4e-10, 6e-10]]))

    assert (coloraxis["cmin"], coloraxis["cmax"]) == (1e-10, 6e-10)
    assert plots.DEFAULT_THEME["hmap"]["rangecolor"] is None


@pytest.mark.asyncio
async def test_live_polls_wait_their_turn_behind_user_requests():
    import asyncio

    lane = plots._UserFirst(max_wait=0.5)
    order: list[str] = []

    async def user_work():
        async with lane.user_request():
            await asyncio.sleep(0.05)
            order.append("user")

    async def live_poll():
        await lane.wait_turn()
        order.append("poll")

    user = asyncio.create_task(user_work())
    await asyncio.sleep(0)  # let the user request register
    await asyncio.gather(live_poll(), user)

    assert order == ["user", "poll"]

    # Poll immediately when no interactive request is running.
    order.clear()
    await live_poll()
    assert order == ["poll"]


@pytest.mark.asyncio
async def test_a_live_poll_is_not_held_back_forever():
    import asyncio
    import time

    lane = plots._UserFirst(max_wait=0.1)

    async def slow_user_work():
        async with lane.user_request():
            await asyncio.sleep(1.0)

    user = asyncio.create_task(slow_user_work())
    await asyncio.sleep(0)
    start = time.perf_counter()
    await lane.wait_turn()
    waited = time.perf_counter() - start

    assert 0.05 < waited < 0.5, f"poll waited {waited:.2f}s"
    user.cancel()


def test_a_dataset_that_cannot_be_plotted_says_what_it_has():
    dataset = _dataset()

    failure = plots._plot_failure("heat map", 0, dataset, KeyError("keithley_tg_volt"))
    assert failure.status_code == 400
    assert "keithley_tg_volt" in failure.detail
    assert "signal" in failure.detail and "sweep" in failure.detail

    dimensions = plots._plot_failure(
        "heat map", 0, dataset, ValueError("Dimensions {'f'} do not exist")
    )
    assert dimensions.status_code == 400

    # Unexpected failures remain server errors.
    assert (
        plots._plot_failure("line plot", 0, dataset, RuntimeError("boom")).status_code
        == 500
    )


def _shared_sweep_dataset():
    """Two measured quantities recorded along one swept axis."""
    return xr.Dataset(
        {
            "current": ("gate", np.array([1e-6, 2e-6, 3e-6, 2e-6])),
            "measured_gate": ("gate", np.array([0.0, 0.5, 1.0, 0.5])),
        },
        coords={"gate": np.array([0.0, 1.0, 2.0, 3.0])},
        attrs={"path": "/data/run.nc"},
    )


def test_a_dependent_can_be_an_axis():
    dataset = _shared_sweep_dataset()

    assert figures.axis_dimension(dataset, "measured_gate") == "gate"
    assert figures.axis_dimension(dataset, "gate") == "gate"
    assert figures.is_dependent(dataset, "measured_gate")
    assert not figures.is_dependent(dataset, "gate")
    np.testing.assert_allclose(
        figures.axis_values(dataset, "measured_gate"), [0.0, 0.5, 1.0, 0.5]
    )


def test_a_two_dimensional_dependent_is_not_an_axis():
    dataset = xr.Dataset(
        {"signal": (("sweep", "x"), np.arange(12.0).reshape(3, 4))},
        coords={"x": [0.0, 1.0, 2.0, 3.0], "sweep": [0.0, 1.0, 2.0]},
    )

    with pytest.raises(figures.AxisResolutionError):
        figures.axis_dimension(dataset, "signal")


def test_a_line_plot_of_one_dependent_against_another_keeps_sweep_order():
    dataset = _shared_sweep_dataset()

    figure = Line({}, dataset, ["measured_gate"], ["current"]).plot().to_dict()

    trace = figure["data"][0]
    assert trace["type"] == "scatter"
    assert figure["layout"]["meta"]["qimchi_axes"]["x"] == {
        "variable": "measured_gate",
        "dependent": True,
    }


def test_sliders_cover_the_dimensions_the_axes_leave_free():
    dataset = xr.Dataset(
        {
            "signal": (("sweep", "x"), np.arange(12.0).reshape(3, 4)),
            "measured_x": ("x", np.array([0.0, 0.5, 1.0, 1.5])),
        },
        coords={"x": [0.0, 1.0, 2.0, 3.0], "sweep": [0.0, 1.0, 2.0]},
    )

    config = plots.gen_slider_config(dataset, ["measured_x"])

    assert set(config) == {"sweep"}, (
        "the swept dimension behind x must not get a slider"
    )


def test_a_heat_map_needs_one_swept_axis():
    dataset = xr.Dataset(
        {
            "signal": (("sweep", "x"), np.arange(12.0).reshape(3, 4)),
            "measured_x": ("x", np.array([0.0, 0.5, 1.0, 1.5])),
            "measured_sweep": ("sweep", np.array([0.0, 1.0, 2.0])),
        },
        coords={"x": [0.0, 1.0, 2.0, 3.0], "sweep": [0.0, 1.0, 2.0]},
    )

    both_measured = plots.validate_axes(
        [dataset], ["measured_sweep", "measured_x"], ["signal"], "HeatMap"
    )
    assert not both_measured["valid"]
    assert "swept axis" in "; ".join(both_measured["errors"])

    # A measured axis and a swept axis can still form a grid.
    mixed = plots.validate_axes(
        [dataset], ["sweep", "measured_x"], ["signal"], "HeatMap"
    )
    assert mixed["valid"], mixed["errors"]

    figure = HeatMap({}, dataset, ["sweep", "measured_x"], ["signal"]).plot().to_dict()
    assert figure["layout"]["meta"]["qimchi_axes"]["x"]["dependent"] is True
    assert figure["layout"]["meta"]["qimchi_axes"]["y"]["dependent"] is False


def test_axes_must_have_been_swept_together():
    dataset = xr.Dataset(
        {
            "current": ("gate", np.array([1.0, 2.0])),
            "temperature": ("time", np.array([4.0, 5.0, 6.0])),
        },
        coords={"gate": [0.0, 1.0], "time": [0.0, 1.0, 2.0]},
    )

    result = plots.validate_axes([dataset], ["temperature"], ["current"], "LinePlot")

    assert not result["valid"]
    assert "not swept together" in "; ".join(result["errors"])


def test_a_heat_map_axis_pair_on_one_dimension_is_refused():
    dataset = xr.Dataset(
        {
            "signal": (("sweep", "x"), np.arange(12.0).reshape(3, 4)),
            "measured_x": ("x", np.array([0.0, 0.5, 1.0, 1.5])),
        },
        coords={"x": [0.0, 1.0, 2.0, 3.0], "sweep": [0.0, 1.0, 2.0]},
    )

    result = plots.validate_axes([dataset], ["x", "measured_x"], ["signal"], "HeatMap")

    assert not result["valid"]
    assert "both run along" in "; ".join(result["errors"])


def test_live_refresh_timing_is_written_to_the_app_log(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    written: list[str] = []
    # The qimchi logger does not propagate to caplog.
    monkeypatch.setattr(
        plots.logger, "info", lambda message, *args: written.append(message % args)
    )

    app = FastAPI()
    app.include_router(plots.router)
    client = TestClient(app)

    response = client.post(
        "/telemetry/live-refresh",
        json={
            "plotType": "HeatMap",
            "count": 60,
            "medianMs": 812,
            "p90Ms": 1240,
            "minMs": 640,
            "maxMs": 2100,
            "windowSeconds": 63,
            "points": 250000,
            "concurrentPlots": 3,
        },
    )

    assert response.status_code == 200
    line = chr(10).join(written)
    assert "live refresh | HeatMap" in line
    assert "median=812ms" in line and "p90=1240ms" in line
    assert "points=250000" in line and "live plots=3" in line


def test_a_dependent_axis_colours_the_line_by_the_sweep():
    dataset = _shared_sweep_dataset()

    figure = Line({}, dataset, ["measured_gate"], ["current"]).plot().to_dict()
    trace = figure["data"][0]

    assert trace["mode"] == "lines+markers"
    assert trace["marker"]["showscale"] is True
    # to_dict() hands numeric arrays over in Plotly's binary form.
    colour = trace["marker"]["color"]
    decoded = np.frombuffer(base64.b64decode(colour["bdata"]), dtype=colour["dtype"])
    np.testing.assert_allclose(decoded, dataset["gate"].values)
    assert "gate" in trace["marker"]["colorbar"]["title"]["text"].lower()
    # Hover labels survive frontend marker-colour overrides.
    assert "%{customdata}" in trace["hovertemplate"]
    assert trace["customdata"] == ["0", "1", "2", "3"]


def test_a_dependent_axis_hover_formats_the_sweep_value_with_its_unit():
    dataset = _shared_sweep_dataset().rename({"gate": "p1"})
    metadata = {"p1": {"label": "Plunger Gate 1", "unit": "V"}}
    dataset = dataset.assign_coords(p1=np.array([-0.5, -0.25, -0.005, 0.0]))

    trace = (
        Line(metadata, dataset, ["measured_gate"], ["current"])
        .plot()
        .to_dict()["data"][0]
    )

    assert "Plunger Gate 1: %{customdata}" in trace["hovertemplate"]
    assert trace["customdata"] == ["-500 mV", "-250 mV", "-5 mV", "0 V"]


def test_line_hover_values_use_no_more_than_two_decimal_places():
    dataset = _shared_sweep_dataset()
    dataset["current"].attrs = {"label": "Current", "unit": "A"}
    dataset["gate"].attrs = {"label": "Gate", "unit": "V"}

    template = (
        Line({}, dataset, ["gate"], ["current"])
        .plot()
        .to_dict()["data"][0]["hovertemplate"]
    )

    assert "Gate: %{x:.3~s}V" in template
    assert "Current: %{y:.3~s}A" in template


def test_an_ordinary_line_plot_is_left_alone():
    dataset = _shared_sweep_dataset()

    trace = Line({}, dataset, ["gate"], ["current"]).plot().to_dict()["data"][0]

    assert not trace.get("marker", {}).get("showscale")
    assert "customdata" not in trace
