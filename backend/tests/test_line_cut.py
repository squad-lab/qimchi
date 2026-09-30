"""Tests for heat-map line cuts."""

from __future__ import annotations

import base64

import numpy as np
import pytest
import xarray as xr

from api import filters, plots
from api.models import LineCut, PlotRequest, TransformPlotRequest


def _grid(x_size: int = 11, y_size: int = 5) -> xr.Dataset:
    """Return a grid whose signal is linear in both coordinates."""
    gate = np.linspace(0.0, 1.0, x_size)
    # Use a descending axis to exercise reverse-order interpolation.
    field = np.linspace(0.0, 2.0, y_size)[::-1]
    return xr.Dataset(
        {"signal": (("field", "gate"), field[:, None] * 10 + gate[None, :])},
        coords={
            "gate": ("gate", gate, {"label": "Gate", "unit": "V"}),
            "field": ("field", field, {"label": "Field", "unit": "T"}),
        },
        attrs={"path": "/data/run.nc"},
    )


def _plotted(values) -> np.ndarray:
    """Decode Plotly's binary array representation when present."""
    if isinstance(values, dict):
        return np.frombuffer(base64.b64decode(values["bdata"]), dtype=values["dtype"])
    return np.asarray(values)


def _cut(start, end, **extra):
    return {
        "start": {"gate": start[0], "field": start[1]},
        "end": {"gate": end[0], "field": end[1]},
        **extra,
    }


def test_a_diagonal_cut_interpolates_between_grid_points():
    cut, x_var, companion = plots.apply_line_cut(
        _grid(), ["gate", "field"], ["signal"], _cut((0.0, 0.0), (1.0, 2.0))
    )

    gate = cut["gate"].values
    field = cut["field"].values
    np.testing.assert_allclose(cut["signal"].values, 10 * field + gate)
    assert (gate[0], gate[-1]) == (0.0, 1.0)
    assert (field[0], field[-1]) == (0.0, 2.0)
    assert cut["signal"].dims == (plots.CUT_DIMENSION,)
    assert (x_var, companion) == ("gate", "field")


def test_the_cut_keeps_each_axis_label_and_unit():
    cut, _, _ = plots.apply_line_cut(
        _grid(), ["gate", "field"], ["signal"], _cut((0.0, 0.0), (1.0, 2.0))
    )
    assert cut["gate"].attrs == {"label": "Gate", "unit": "V"}
    assert cut["field"].attrs == {"label": "Field", "unit": "T"}
    assert cut.attrs["path"] == "/data/run.nc"


def test_the_x_axis_is_the_variable_that_changes_most():
    # Field has the larger normalized change.
    _, x_var, companion = plots.apply_line_cut(
        _grid(), ["gate", "field"], ["signal"], _cut((0.2, 0.0), (0.7, 2.0))
    )
    assert (x_var, companion) == ("field", "gate")

    _, x_var, companion = plots.apply_line_cut(
        _grid(), ["gate", "field"], ["signal"], _cut((0.0, 1.0), (1.0, 1.5))
    )
    assert (x_var, companion) == ("gate", "field")


def test_a_cut_samples_about_one_point_per_grid_step():
    # The gate interval spans 10 grid steps; field spans 4.
    cut, _, _ = plots.apply_line_cut(
        _grid(), ["gate", "field"], ["signal"], _cut((0.0, 0.0), (1.0, 2.0))
    )
    assert cut.sizes[plots.CUT_DIMENSION] == 11

    short, _, _ = plots.apply_line_cut(
        _grid(), ["gate", "field"], ["signal"], _cut((0.0, 0.0), (0.2, 0.1))
    )
    assert short.sizes[plots.CUT_DIMENSION] == 3


def test_a_cut_can_ask_for_its_number_of_points():
    cut, _, _ = plots.apply_line_cut(
        _grid(),
        ["gate", "field"],
        ["signal"],
        _cut((0.0, 0.0), (1.0, 2.0), points=50),
    )
    assert cut.sizes[plots.CUT_DIMENSION] == 50


def test_a_cut_leaving_the_grid_has_no_values_outside_it():
    cut, _, _ = plots.apply_line_cut(
        _grid(),
        ["gate", "field"],
        ["signal"],
        _cut((0.0, 0.0), (2.0, 2.0), points=3),
    )
    values = cut["signal"].values
    assert np.isfinite(values[:2]).all()
    assert np.isnan(values[2])


def test_unmeasured_points_stay_unmeasured_along_the_cut():
    dataset = _grid()
    dataset["signal"][:2, :] = np.nan  # Two highest field values.
    cut, _, _ = plots.apply_line_cut(
        dataset, ["gate", "field"], ["signal"], _cut((0.0, 0.0), (1.0, 2.0))
    )
    values = cut["signal"].values
    assert np.isfinite(values[0])
    assert np.isnan(values[-1])


def test_a_cut_along_the_last_measured_row_keeps_its_values():
    # Simulate a live scan with rows above field = 1 still unmeasured.
    dataset = _grid()
    dataset["signal"][:2, :] = np.nan
    cut, _, _ = plots.apply_line_cut(
        dataset, ["gate", "field"], ["signal"], _cut((0.0, 1.0), (1.0, 1.0))
    )
    np.testing.assert_allclose(cut["signal"].values, 10 + cut["gate"].values)


def test_the_cut_keeps_the_dependents_label_and_unit():
    dataset = _grid()
    dataset["signal"].attrs = {"label": "Current", "unit": "A"}
    cut, _, _ = plots.apply_line_cut(
        dataset, ["gate", "field"], ["signal"], _cut((0.0, 0.0), (1.0, 2.0))
    )
    assert cut["signal"].attrs == {"label": "Current", "unit": "A"}


def test_a_cut_works_on_a_coordinate_that_is_not_its_dimensions_index():
    dataset = _grid().rename({"gate": "step"})
    dataset = dataset.assign_coords(gate=("step", dataset["step"].values))
    dataset = dataset.drop_vars("step")

    cut, x_var, _ = plots.apply_line_cut(
        dataset, ["gate", "field"], ["signal"], _cut((0.0, 0.0), (1.0, 2.0))
    )
    np.testing.assert_allclose(
        cut["signal"].values, 10 * cut["field"].values + cut["gate"].values
    )
    assert x_var == "gate"


def test_repeated_coordinate_values_do_not_break_a_cut():
    dataset = _grid(x_size=4)
    dataset = dataset.assign_coords(gate=[0.0, 0.5, 0.5, 1.0])
    cut, _, _ = plots.apply_line_cut(
        dataset, ["gate", "field"], ["signal"], _cut((0.0, 0.0), (1.0, 2.0))
    )
    assert np.isfinite(cut["signal"].values).all()


@pytest.mark.parametrize(
    ("indeps", "cut", "message"),
    [
        (["gate"], _cut((0.0, 0.0), (1.0, 2.0)), "two axes"),
        (["gate", "field"], {"start": {"gate": 0.0}, "end": {}}, "no position"),
        (["gate", "field"], _cut((0.5, 1.0), (0.5, 1.0)), "same point"),
        (["gate", "signal"], _cut((0.0, 0.0), (1.0, 2.0)), "no position"),
    ],
)
def test_a_cut_that_cannot_be_made_says_why(indeps, cut, message):
    with pytest.raises(ValueError, match=message):
        plots.apply_line_cut(_grid(), indeps, ["signal"], cut)


def test_a_cut_cannot_follow_a_measured_axis():
    dataset = _grid()
    dataset["bias"] = ("gate", dataset["gate"].values * 2)
    cut = {"start": {"bias": 0.0, "field": 0.0}, "end": {"bias": 2.0, "field": 2.0}}
    with pytest.raises(ValueError, match="measured"):
        plots.apply_line_cut(dataset, ["bias", "field"], ["signal"], cut)


def test_a_cut_through_a_three_dimensional_dataset_uses_the_slider():
    grid = _grid()
    dataset = xr.concat(
        [grid, grid.assign(signal=grid["signal"] + 100)],
        dim=xr.DataArray([0.0, 1.0], dims="temperature", name="temperature"),
    )

    result = plots.create_line_plots(
        [dataset],
        ["/data/run.nc"],
        ["gate", "field"],
        ["signal"],
        slider={"temperature": {"value": 1.0}},
        cut=_cut((0.0, 0.0), (1.0, 2.0)),
    )

    assert list(result[0]["slider_config"]) == ["temperature"]
    y = _plotted(result[0]["plotJson"]["data"][0]["y"])
    assert y[0] == pytest.approx(100.0)
    assert y[-1] == pytest.approx(121.0)


def test_a_cut_line_plot_shows_the_companion_on_hover():
    result = plots.create_line_plots(
        [_grid()],
        ["/data/run.nc"],
        ["gate", "field"],
        ["signal"],
        cut=_cut((0.0, 0.0), (1.0, 2.0)),
    )
    figure = result[0]["plotJson"]
    trace = figure["data"][0]

    assert "Field" in trace["hovertemplate"]
    assert "%{customdata" in trace["hovertemplate"]
    assert "Gate" in figure["layout"]["xaxis"]["title"]["text"]
    assert "cut" in figure["layout"]["title"]["text"]
    assert figure["layout"]["meta"]["qimchi_axes"]["x"]["variable"] == "gate"


@pytest.mark.asyncio
async def test_a_cut_plot_request_is_drawn_and_remembered_for_transforms(
    tmp_path, monkeypatch
):
    file = tmp_path / "run.nc"
    file.write_bytes(b"x")

    async def load(_path):
        return _grid()

    monkeypatch.setattr(plots, "load_dataset_async", load)
    plots._PLOT_CONTEXTS.clear()

    cut = _cut((0.0, 0.0), (1.0, 2.0))
    response = await plots.create_plots(
        PlotRequest(
            fpaths=[str(file)],
            indeps=["gate", "field"],
            deps=["signal"],
            plotType="LinePlot",
            cut=LineCut(**cut),
        )
    )

    assert response.success is True, response.message
    plot = response.plots[0]
    context = plots.get_plot_context(plot["plot_ref"])
    assert context["cut"] == {**cut, "points": None}

    # Transform redraws must retain the cut stored in plot context.
    monkeypatch.setattr("api.data_loader.load_dataset_sync", lambda _path: _grid())
    transformed = await filters.transform_plot_endpoint(
        TransformPlotRequest(plot_ref=plot["plot_ref"])
    )
    assert (
        transformed.plot_json["data"][0]["hovertemplate"]
        == (plot["plotJson"]["data"][0]["hovertemplate"])
    )


@pytest.mark.asyncio
async def test_a_plain_line_plot_is_not_affected_by_cut_support(tmp_path, monkeypatch):
    file = tmp_path / "run.nc"
    file.write_bytes(b"x")

    async def load(_path):
        return _grid()

    monkeypatch.setattr(plots, "load_dataset_async", load)
    plots._PLOT_CONTEXTS.clear()

    response = await plots.create_plots(
        PlotRequest(
            fpaths=[str(file)], indeps=["gate"], deps=["signal"], plotType="LinePlot"
        )
    )
    context = plots.get_plot_context(response.plots[0]["plot_ref"])
    assert "cut" not in context


@pytest.mark.asyncio
async def test_a_cut_without_its_second_axis_is_a_failed_response(
    tmp_path, monkeypatch
):
    file = tmp_path / "run.nc"
    file.write_bytes(b"x")

    async def load(_path):
        return _grid()

    monkeypatch.setattr(plots, "load_dataset_async", load)

    response = await plots.create_plots(
        PlotRequest(
            fpaths=[str(file)],
            indeps=["gate"],
            deps=["signal"],
            plotType="LinePlot",
            cut=LineCut(**_cut((0.0, 0.0), (1.0, 2.0))),
        )
    )
    assert response.success is False
    assert "two axes" in response.message


def test_a_cut_asks_for_a_sensible_number_of_points():
    with pytest.raises(ValueError):
        LineCut(**_cut((0.0, 0.0), (1.0, 2.0), points=1))
    with pytest.raises(ValueError):
        LineCut(**_cut((0.0, 0.0), (1.0, 2.0), points=5000))
