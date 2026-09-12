"""Behavioral tests for plot filters and transform orchestration."""

from __future__ import annotations

import base64
import re

import numpy as np
import pytest
from fastapi import HTTPException
from numpy.polynomial import Polynomial

from api import figures, filters, plots, units
from api.models import TransformPlotRequest


@pytest.fixture
def line_figure():
    return {
        "data": [{"type": "scatter", "x": [0, 1, 2, 3, 4], "y": [1, 2, 4, 8, 16]}],
        "layout": {
            "title": {"text": "Device Wafer Sample Run"},
            "xaxis": {"title": {"text": "Gate (V)"}},
            "yaxis": {"title": {"text": "Current (A)"}},
        },
    }


@pytest.fixture
def heat_figure():
    return {
        "data": [
            {
                "type": "heatmap",
                "x": [0, 1, 2],
                "y": [0, 1, 2],
                "z": [[1.0, 2.0, 3.0], [2.0, 4.0, 6.0], [3.0, 6.0, 9.0]],
                "coloraxis": "coloraxis",
            }
        ],
        "layout": {
            "title": "Heat Map",
            "xaxis": {"title": {"text": "X"}},
            "yaxis": {"title": {"text": "Y"}},
            "coloraxis": {"colorbar": {"title": {"text": "Z"}}},
        },
    }


def _axis(figure, name):
    return filters._extract_axis_data(figure["data"][0], name)


def test_number_option_and_polynomial_helpers():
    assert filters._format_number(0.0001) == "1.000e-04"
    assert filters._format_number(12.3456, 2) == "12.35"
    assert filters._safe_init(None, "x", 3) == 3
    assert filters._safe_init({"x": 4}, "x", 3) == 4
    polynomial = Polynomial([1, -2e-3, 3.7e-10])
    scientific = filters._pprint_poly(polynomial, "scientific")
    engineering = filters._pprint_poly(polynomial, "engineering")
    assert scientific == r"$3.7\times 10^{-10}\,x^{2} - 2\times 10^{-3}\,x + 1$"
    assert engineering == r"$370\times 10^{-12}\,x^{2} - 2\times 10^{-3}\,x + 1$"


def test_extract_axis_data_supports_all_frontend_encodings():
    raw = np.array([1.0, 2.0], dtype=np.float64)
    encoded = {"dtype": "f8", "bdata": base64.b64encode(raw.tobytes()).decode()}

    assert np.array_equal(filters._extract_axis_data({"x": [1, 2]}, "x"), [1, 2])
    assert np.array_equal(
        filters._extract_axis_data(
            {"x": {"_inputArray": {"1": 20, "0": 10, "length": 2}}}, "x"
        ),
        [10, 20],
    )
    assert np.array_equal(filters._extract_axis_data({"x": encoded}, "x"), raw)
    assert np.array_equal(
        filters._extract_axis_data({"x": np.array([encoded], dtype=object)}, "x"),
        raw,
    )
    with pytest.raises(ValueError, match="No x-axis"):
        filters._extract_axis_data({}, "x")
    with pytest.raises(ValueError, match="unsupported format"):
        filters._extract_axis_data({"x": "bad"}, "x")


@pytest.mark.parametrize(
    ("name", "options"),
    [
        ("diff", {}),
        ("savgol", {"window": 3, "polyorder": 1}),
        ("sma", {"window": 2}),
        ("normalize", {"axis": "y"}),
        ("log_scale", {}),
        ("polyfit", {"deg": 2, "window": [0, 4]}),
        ("transform", {"operation": "multiply", "factor": 2}),
        ("bg_corr_constant", {"points": [{"x": 0, "y": 1}]}),
        (
            "bg_corr_linear",
            {"points": [{"x": 0, "y": 1}, {"x": 4, "y": 5}]},
        ),
    ],
)
def test_one_dimensional_filters_produce_plot_data(line_figure, name, options):
    result, warnings = filters.apply_filters(
        [name], {name: options}, line_figure, fig_num_axes=1
    )

    assert result["data"]
    assert isinstance(warnings, list)
    if name == "polyfit":
        assert len(result["data"]) == 2
    else:
        assert len(_axis(result, "y")) == 5


@pytest.mark.parametrize(
    ("name", "options"),
    [
        ("flip", {}),
        ("diff_x", {}),
        ("diff_y", {}),
        ("savgol", {"window": 3, "polyorder": 1, "axis": 2}),
        ("normalize", {"axis": "z"}),
        ("normalize", {"axis": "x"}),
        ("normalize", {"axis": "y"}),
        ("gamma_corr", {"gamma": 2, "gain": 1}),
        ("log_corr", {"gain": 1, "inv": False}),
        ("sig_corr", {"cutoff": 0.5, "gain": 5}),
        ("rescale_intensity", {}),
        ("log_scale", {}),
        ("rotate", {"angle": 90}),
        ("transform", {"operation": "multiply", "factor": 2}),
        ("bg_corr_constant", {"points": [{"z": 1}]}),
        ("bg_corr_row_mean", {"points": [{"row_idx": 0}]}),
        ("bg_corr_col_mean", {"points": [{"col_idx": 0}]}),
        (
            "bg_corr_plane",
            {
                "points": [
                    {"x": 0, "y": 0, "z": 0},
                    {"x": 1, "y": 0, "z": 1},
                    {"x": 0, "y": 1, "z": 1},
                ]
            },
        ),
    ],
)
def test_two_dimensional_filters_produce_heatmap_data(heat_figure, name, options):
    result, warnings = filters.apply_filters(
        [name], {name: options}, heat_figure, fig_num_axes=2
    )

    assert _axis(result, "z").size > 0
    assert isinstance(warnings, list)


def test_smoothing_interpolates_non_finite_values(line_figure):
    line_figure["data"][0]["y"] = [1, np.nan, np.inf, 4, 5]

    result, warnings = filters.apply_filters(
        ["savgol"],
        {"savgol": {"window": 3, "polyorder": 1}},
        line_figure,
        1,
    )

    assert np.isfinite(_axis(result, "y")).all()
    assert warnings == ["Interpolated missing data for Smoothing"]


def test_differentiation_infers_derived_units(line_figure):
    result, _warnings = filters.apply_filters(["diff"], {"diff": {}}, line_figure, 1)

    assert result["layout"]["yaxis"]["title"]["text"] == (
        r"$\frac{\mathrm{d}\,\mathrm{Current}}"
        r"{\mathrm{d}\,\mathrm{Gate}}\;\left(\mathrm{S}\right)$"
    )
    assert result["layout"]["meta"]["qimchi_units"]["y"]["label"] == "dCurrent/dGate"
    assert result["layout"]["meta"]["qimchi_units"]["y"]["unit"] == "S"
    assert result["layout"]["meta"]["qimchi_units"]["y"]["engineering_titles"][
        "-9"
    ] == (
        r"$\frac{\mathrm{d}\,\mathrm{Current}}"
        r"{\mathrm{d}\,\mathrm{Gate}}\;\left(\mathrm{nS}\right)$"
    )

    reverse = {
        **line_figure,
        "layout": {
            **line_figure["layout"],
            "xaxis": {"title": {"text": "Current (A)"}},
            "yaxis": {"title": {"text": "Voltage (V)"}},
        },
    }
    result, _warnings = filters.apply_filters(["diff"], {"diff": {}}, reverse, 1)
    assert result["layout"]["meta"]["qimchi_units"]["y"]["unit"] == "Ω"


def test_heatmap_differentiation_keeps_a_compact_colorbar_title(heat_figure):
    result, _warnings = filters.apply_filters(
        ["diff_x"], {"diff_x": {}}, heat_figure, 2
    )

    coloraxis = result["layout"]["coloraxis"]
    assert coloraxis["colorbar"]["title"]["text"] == ""
    title = next(
        annotation
        for annotation in result["layout"]["annotations"]
        if annotation["name"] == "qimchi-colorbar-title"
    )
    assert title["text"] == (r"$\frac{\mathrm{d}z}{\mathrm{d}y}$")
    assert coloraxis["cmin"] <= coloraxis["cmax"]


def test_differentiation_keeps_fraction_when_engineering_prefix_changes(line_figure):
    line_figure["layout"]["xaxis"]["title"]["text"] = "Plunger Gate 2 (V)"
    line_figure["layout"]["yaxis"]["title"]["text"] = "Top Gate Leakage (A)"

    result, _warnings = filters.apply_filters(["diff"], {"diff": {}}, line_figure, 1)

    titles = result["layout"]["meta"]["qimchi_units"]["y"]["engineering_titles"]
    assert titles["-9"] == (
        r"$\frac{\mathrm{d}\,\mathrm{Top\ Gate\ Leakage}}"
        r"{\mathrm{d}\,\mathrm{Plunger\ Gate\ 2}}"
        r"\;\left(\mathrm{nS}\right)$"
    )


def test_scale_preserves_latex_derivative_axis_title(line_figure):
    result, _warnings = filters.apply_filters(
        ["diff", "transform"],
        {"diff": {}, "transform": {"operation": "g0"}},
        line_figure,
        1,
    )

    title = result["layout"]["yaxis"]["title"]["text"]
    assert title.startswith(
        r"$\frac{\mathrm{d}\,\mathrm{Current}}{\mathrm{d}\,\mathrm{Gate}}"
    )
    # dI/dV is a conductance, so dividing it by G0 leaves a bare quantum count.
    assert r"\left[\times \frac{e^{2}}{h}\;(G_{0})\right]" in title
    assert r"\left(" not in title
    definition = result["layout"]["meta"]["qimchi_units"]["y"]
    assert definition["title_template"]["kind"] == "derivative"
    assert all(r"\frac" in value for value in definition["engineering_titles"].values())


def test_scale_preserves_compact_latex_heatmap_derivative_title(heat_figure):
    result, _warnings = filters.apply_filters(
        ["diff_x", "transform"],
        {"diff_x": {}, "transform": {"operation": "g0"}},
        heat_figure,
        2,
    )

    title = next(
        annotation["text"]
        for annotation in result["layout"]["annotations"]
        if annotation["name"] == "qimchi-colorbar-title"
    )
    assert title.startswith(r"$\frac{\mathrm{d}z}{\mathrm{d}y}")
    assert r"\left[\times \frac{e^{2}}{h}\;(G_{0})\right]" in title
    definition = result["layout"]["meta"]["qimchi_units"]["z"]
    assert definition["title_template"]["compact"] is True
    assert all(r"\frac" in value for value in definition["engineering_titles"].values())


def test_user_transform_infers_or_overrides_result_unit(line_figure):
    multiplied, _warnings = filters.apply_filters(
        ["transform"],
        {
            "transform": {
                "operation": "multiply",
                "factor": 2,
                "factor_unit": "V",
                "result_label": "Power",
            }
        },
        line_figure,
        1,
    )
    assert np.array_equal(_axis(multiplied, "y"), [2, 4, 8, 16, 32])
    assert multiplied["layout"]["yaxis"]["title"]["text"] == (
        r"$\mathrm{Power}\;\left(\mathrm{W}\right)$"
    )

    inverted, _warnings = filters.apply_filters(
        ["transform"],
        {"transform": {"operation": "inverse"}},
        line_figure,
        1,
    )
    assert np.allclose(_axis(inverted, "y"), [1, 0.5, 0.25, 0.125, 0.0625])
    assert inverted["layout"]["yaxis"]["title"]["text"] == (
        r"$\mathrm{1/Current}\;\left(\frac{1}{\mathrm{A}}\right)$"
    )


@pytest.fixture
def conductance_figure():
    return {
        "data": [{"type": "scatter", "x": [0, 1, 2, 3, 4], "y": [1, 2, 4, 8, 16]}],
        "layout": {
            "xaxis": {"title": {"text": "Gate (V)"}},
            "yaxis": {"title": {"text": "Conductance (S)"}},
        },
    }


@pytest.mark.parametrize(
    ("operation", "expression"),
    [
        ("g0", "e^2 / h (G_0)"),
        ("2g0", "2e^2 / h (2G_0)"),
    ],
)
def test_conductance_scaled_by_a_quantum_constant_is_dimensionless(
    conductance_figure, operation, expression
):
    """A conductance over G0 counts quanta, so it divides and loses its unit."""
    result, _warnings = filters.apply_filters(
        ["transform"],
        {"transform": {"operation": operation}},
        conductance_figure,
        1,
    )

    factor = float(filters.SCALE_QUANTITIES[operation]["value"])
    assert np.allclose(_axis(result, "y"), np.array([1, 2, 4, 8, 16]) / factor)
    definition = result["layout"]["meta"]["qimchi_units"]["y"]
    assert definition["unit"] == ""
    assert definition["label"].endswith(f"[x {expression}]")


def test_resistance_scaled_by_the_resistance_quantum_is_dimensionless():
    figure = {
        "data": [{"type": "scatter", "x": [0], "y": [1]}],
        "layout": {
            "xaxis": {"title": {"text": "Gate (V)"}},
            "yaxis": {"title": {"text": "Resistance (kΩ)"}},
        },
    }

    result, _warnings = filters.apply_filters(
        ["transform"],
        {"transform": {"operation": "r0"}},
        figure,
        1,
    )

    # 1 kΩ, so the prefix folds into the value before R0 divides it out.
    assert np.allclose(
        _axis(result, "y"),
        [1000.0 / float(filters.SCALE_QUANTITIES["r0"]["value"])],
    )
    definition = result["layout"]["meta"]["qimchi_units"]["y"]
    assert definition["unit"] == ""
    assert result["layout"]["yaxis"]["title"]["text"] == (
        r"$\mathrm{Resistance}\;\left[\times \frac{h}{e^{2}}\;(R_{0})\right]$"
    )


def test_scale_reads_a_legacy_multiplied_quantity_label(line_figure):
    """Plots saved before 0.7.0 recorded the suffix as "[x ...]"."""
    line_figure["layout"]["yaxis"]["title"]["text"] = (
        "Conductance [x e^2 / h (G_0)] (S)"
    )

    result, _warnings = filters.apply_filters(
        ["transform"],
        {"transform": {"operation": "multiply", "factor": 2.0}},
        line_figure,
        1,
    )

    assert result["layout"]["yaxis"]["title"]["text"] == (
        r"$\mathrm{Conductance}\;\left[\times \frac{e^{2}}{h}\;(G_{0})\right]"
        r"\;\left(\mathrm{S}\right)$"
    )


def test_polynomial_fit_renders_compact_descending_terms():
    figure = {
        "data": [
            {
                "type": "scatter",
                "x": [0.0, 1.0, 2.0, 3.0],
                "y": [1e-3, 3.003e-3, 7.006e-3, 13.009e-3],
            }
        ],
        "layout": {
            "xaxis": {"title": {"text": "Voltage (V)"}},
            "yaxis": {"title": {"text": "Current (A)"}},
        },
    }
    result, _warnings = filters.apply_filters(
        ["polyfit"], {"polyfit": {"deg": 2, "window": [0, 3]}}, figure, 1
    )
    equation = result["layout"]["annotations"][0]["text"]

    assert equation.startswith("$") and equation.endswith("$")
    assert result["layout"]["showlegend"] is False
    assert result["layout"]["annotations"][0]["name"] == (
        filters.POLYFIT_ANNOTATION_NAME
    )
    fit_meta = result["layout"]["meta"][filters.POLYFIT_META_KEY]
    assert equation == fit_meta["engineering"]
    assert "scientific" not in fit_meta
    assert all(
        int(exponent) % 3 == 0
        for exponent in re.findall(r"10\^{(-?\d+)}", fit_meta["engineering"])
    )
    assert equation.index("^{2}") < equation.rindex(r"\,x")
    assert "Voltage" not in equation
    assert "Current" not in equation
    assert r"\mathrm" not in equation
    assert "=" not in equation


def test_polynomial_fit_defaults_to_degree_two(line_figure):
    result, _warnings = filters.apply_filters(
        ["polyfit"], {"polyfit": {}}, line_figure, 1
    )
    assert result["data"][1]["name"] == "Fit (deg=2)"


def test_polynomial_fit_preserves_latex_title_from_prior_derivative(line_figure):
    result, _warnings = filters.apply_filters(
        ["diff", "polyfit"],
        {"diff": {}, "polyfit": {"deg": 2, "window": [0, 4]}},
        line_figure,
        1,
    )
    assert result["layout"]["yaxis"]["title"]["text"] == (
        r"$\frac{\mathrm{d}\,\mathrm{Current}}"
        r"{\mathrm{d}\,\mathrm{Gate}}"
        r"\;\left(\mathrm{S}\right)$"
    )
    assert result["layout"]["meta"]["qimchi_units"]["y"]["engineering_titles"][
        "-9"
    ] == (
        r"$\frac{\mathrm{d}\,\mathrm{Current}}"
        r"{\mathrm{d}\,\mathrm{Gate}}"
        r"\;\left(\mathrm{nS}\right)$"
    )


@pytest.mark.parametrize(
    ("filter_name", "options"),
    [
        ("savgol", {"window": 3, "polyorder": 1}),
        ("sma", {"window": 2}),
        ("normalize", {"axis": "y"}),
        ("log_scale", {}),
        ("bg_corr_constant", {"points": [{"x": 0, "y": 1}]}),
    ],
)
def test_data_filters_preserve_latex_title_from_prior_derivative(
    line_figure, filter_name, options
):
    result, _warnings = filters.apply_filters(
        ["diff", filter_name],
        {"diff": {}, filter_name: options},
        line_figure,
        1,
    )

    expected = (
        r"$\frac{\mathrm{d}\,\mathrm{Current}}"
        r"{\mathrm{d}\,\mathrm{Gate}}"
        r"\;\left(\mathrm{S}\right)$"
    )
    assert result["layout"]["yaxis"]["title"]["text"] == expected
    assert (
        result["layout"]["meta"]["qimchi_units"]["y"]["title_template"]["kind"]
        == "derivative"
    )


@pytest.mark.parametrize(
    ("filter_name", "options"),
    [
        ("flip", {}),
        ("normalize", {"axis": "z"}),
        ("bg_corr_constant", {"points": [{"z": 1}]}),
    ],
)
def test_heatmap_data_filters_preserve_compact_derivative_title(
    heat_figure, filter_name, options
):
    result, _warnings = filters.apply_filters(
        ["diff_x", filter_name],
        {"diff_x": {}, filter_name: options},
        heat_figure,
        2,
    )

    title = next(
        annotation["text"]
        for annotation in result["layout"]["annotations"]
        if annotation["name"] == "qimchi-colorbar-title"
    )
    assert title == r"$\frac{\mathrm{d}z}{\mathrm{d}y}$"
    assert (
        result["layout"]["meta"]["qimchi_units"]["z"]["title_template"]["compact"]
        is True
    )


def test_heatmap_x_derivative_uses_dz_over_dx(heat_figure):
    result, _warnings = filters.apply_filters(
        ["diff_y"], {"diff_y": {}}, heat_figure, 2
    )

    title = next(
        annotation["text"]
        for annotation in result["layout"]["annotations"]
        if annotation["name"] == "qimchi-colorbar-title"
    )
    assert title == r"$\frac{\mathrm{d}z}{\mathrm{d}x}$"


def test_filter_order_noop_and_unknown_filter(line_figure):
    assert filters.apply_filters([], {}, line_figure, 1) is line_figure
    result, _warnings = filters.apply_filters(
        ["diff", "normalize"],
        {"diff": {}, "normalize": {"axis": "y"}},
        line_figure,
        1,
    )
    assert result["layout"]["title"]["text"] == "Device Wafer Sample Run"

    with pytest.raises(ValueError, match="No definition"):
        filters.apply_filters(["unknown"], {"unknown": {}}, line_figure, 1)


def test_measurement_plot_title_shortens_only_qanary_ids():
    common = {
        "Experiment Name": "Single gate sweep",
        "Device Type": "IHPCVD6",
        "Wafer ID": "00602_A3",
        "Sample Name": "device-4",
    }
    qanary = {
        **common,
        "Measurement ID": "1-40d7d11d-cbd9-48f4-9921-1ae6ac3a67fa",
    }
    qcodes_like = {
        **common,
        "Measurement ID": "40d7d11d-cbd9-48f4-9921-1ae6ac3a67fa",
    }

    assert figures.format_measurement_plot_title(qanary, "fallback") == (
        "Single gate sweep: 1-40d7d11d* (IHPCVD6 00602_A3_device-4)"
    )
    assert figures.format_measurement_plot_title(qcodes_like, "fallback") == (
        "Single gate sweep: 40d7d11d-cbd9-48f4-9921-1ae6ac3a67fa "
        "(IHPCVD6 00602_A3_device-4)"
    )
    assert figures.format_measurement_plot_title({}, "fallback") == "fallback"


def test_generate_transform_plot_supports_both_plot_types(
    monkeypatch, line_figure, heat_figure
):
    dataset = type("Dataset", (), {"dims": {"x": 3}})()
    monkeypatch.setattr("api.data_loader.load_dataset_sync", lambda _path: dataset)
    monkeypatch.setattr(
        plots,
        "create_line_plots",
        lambda **_kwargs: [{"plotJson": line_figure}],
    )
    monkeypatch.setattr(
        plots,
        "create_heat_maps",
        lambda **_kwargs: [{"plotJson": heat_figure}],
    )

    line, warnings = filters._generate_plot_json_for_transform(
        fpath="run.nc",
        indeps=["x"],
        deps=["y"],
        plot_type="LinePlot",
        slider={},
        filters_order=["diff"],
        filters_opts={"diff": {}},
        swap_xy=False,
    )
    heat, _ = filters._generate_plot_json_for_transform(
        fpath="run.nc",
        indeps=["x", "y"],
        deps=["z"],
        plot_type="HeatMap",
        slider={},
        filters_order=[],
        filters_opts={},
        swap_xy=True,
    )
    assert line["data"] and warnings == []
    assert heat == heat_figure

    with pytest.raises(HTTPException) as unsupported:
        filters._generate_plot_json_for_transform(
            fpath="run.nc",
            indeps=[],
            deps=[],
            plot_type="Other",
            slider={},
            filters_order=[],
            filters_opts={},
            swap_xy=False,
        )
    assert unsupported.value.status_code == 400


@pytest.mark.asyncio
async def test_transform_endpoint_success_missing_context_and_failure(
    monkeypatch, line_figure
):
    request = TransformPlotRequest(plot_ref="ref", filters_order=[], filters_opts={})
    monkeypatch.setattr(
        plots,
        "get_plot_context",
        lambda _ref: {
            "fpath": "run.nc",
            "indeps": ["x"],
            "deps": ["y"],
            "plotType": "LinePlot",
        },
    )
    monkeypatch.setattr(
        filters,
        "_generate_plot_json_for_transform",
        lambda **_kwargs: (line_figure, ["warning"]),
    )
    response = await filters.transform_plot_endpoint(request)
    assert response.plot_ref == "ref"
    assert response.warnings == ["warning"]

    monkeypatch.setattr(plots, "get_plot_context", lambda _ref: None)
    with pytest.raises(HTTPException) as missing:
        await filters.transform_plot_endpoint(request)
    assert missing.value.status_code == 404

    monkeypatch.setattr(plots, "get_plot_context", lambda _ref: {"broken": True})
    with pytest.raises(HTTPException) as failed:
        await filters.transform_plot_endpoint(request)
    assert failed.value.status_code == 500


def test_filtered_colorbar_title_is_enlarged(heat_figure):
    """MathJax shrinks a fraction, so a derivative colorbar title sizes up."""
    plain = units.colorbar_title_annotation(
        r"$\mathrm{Signal}\;\left(\mathrm{V}\right)$"
    )
    assert plain["font"]["size"] == units.COLORBAR_TITLE_FONT_SIZE

    result, _warnings = filters.apply_filters(
        ["diff_x"], {"diff_x": {}}, heat_figure, 2
    )
    filtered = next(
        annotation
        for annotation in result["layout"]["annotations"]
        if annotation["name"] == "qimchi-colorbar-title"
    )
    assert filtered["font"]["size"] == units.COLORBAR_TITLE_MATH_FONT_SIZE
    assert units.COLORBAR_TITLE_MATH_FONT_SIZE > units.COLORBAR_TITLE_FONT_SIZE


def test_scaled_colorbar_title_keeps_the_plain_font_size(heat_figure):
    """A fraction inside the scale suffix sits beside a full-sized label."""
    result, _warnings = filters.apply_filters(
        ["transform"],
        {"transform": {"operation": "2g0"}},
        heat_figure,
        2,
    )

    scaled = next(
        annotation
        for annotation in result["layout"]["annotations"]
        if annotation["name"] == "qimchi-colorbar-title"
    )
    assert r"\frac" in scaled["text"]
    assert scaled["font"]["size"] == units.COLORBAR_TITLE_FONT_SIZE


def test_a_transform_slices_at_the_slider_position_before_filtering(monkeypatch):
    """
    The transform regenerates from the dataset, so the slider has to come with it.

    A LineCut is a slice at a position the user picked; re-running a filter on
    it without that position silently rebuilds the plot at the default slice --
    the minimum -- so PolyFit fitted a different line from the one on screen.
    """
    import numpy as np
    import xarray as xr

    # signal(field, x) -- a distinct line per field value.
    dataset = xr.Dataset(
        {"signal": (("field", "x"), np.array([[0.0, 1.0, 2.0], [10.0, 11.0, 12.0]]))},
        coords={"x": [0.0, 1.0, 2.0], "field": [0.0, 1.0]},
        attrs={"path": "/data/run.nc"},
    )
    monkeypatch.setattr("api.data_loader.load_dataset_sync", lambda _path: dataset)

    def y_of(slider):
        plot_json, _ = filters._generate_plot_json_for_transform(
            fpath="run.nc",
            indeps=["x"],
            deps=["signal"],
            plot_type="LinePlot",
            slider=slider,
            filters_order=[],
            filters_opts={},
            swap_xy=False,
        )
        # Plotly encodes the arrays as binary, so decode them the way the
        # filters themselves do.
        return list(filters._extract_axis_data(plot_json["data"][0], "y"))

    assert y_of({"field": {"value": 1.0}}) == [10.0, 11.0, 12.0]
    # No slider means the default slice, which is the lowest coordinate value.
    assert y_of({}) == [0.0, 1.0, 2.0]


def test_polyfit_fits_the_slice_the_slider_selects(monkeypatch):
    """The fitted coefficients follow the slice, not the default one."""
    import numpy as np
    import xarray as xr

    # Two lines with clearly different slopes: 1 at field=0, 5 at field=1.
    x = np.array([0.0, 1.0, 2.0, 3.0])
    dataset = xr.Dataset(
        {"signal": (("field", "x"), np.array([x * 1.0, x * 5.0]))},
        coords={"x": x, "field": [0.0, 1.0]},
        attrs={"path": "/data/run.nc"},
    )
    monkeypatch.setattr("api.data_loader.load_dataset_sync", lambda _path: dataset)

    def fitted_slope(slider):
        plot_json, _ = filters._generate_plot_json_for_transform(
            fpath="run.nc",
            indeps=["x"],
            deps=["signal"],
            plot_type="LinePlot",
            slider=slider,
            filters_order=["polyfit"],
            filters_opts={"polyfit": {"deg": 1}},
            swap_xy=False,
        )
        coefficients = plot_json["layout"]["meta"][filters.POLYFIT_META_KEY][
            "coefficients"
        ]
        return coefficients[1]

    assert fitted_slope({"field": {"value": 1.0}}) == pytest.approx(5.0)
    assert fitted_slope({}) == pytest.approx(1.0)
