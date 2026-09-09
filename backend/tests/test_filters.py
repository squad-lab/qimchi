"""Behavioral tests for plot filters and transform orchestration."""

from __future__ import annotations

import base64

import numpy as np
import pytest
from fastapi import HTTPException
from numpy.polynomial import Polynomial

from api import figures, filters, plots
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
    rendered = filters._pprint_poly(Polynomial([1, -2, 3]), "GateVoltage(V)")
    assert "1.000" in rendered
    assert "- 2.000" in rendered


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


def test_generate_transform_plot_supports_both_plot_types(monkeypatch, line_figure, heat_figure):
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
async def test_transform_endpoint_success_missing_context_and_failure(monkeypatch, line_figure):
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
