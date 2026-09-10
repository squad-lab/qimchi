"""Tests for semantic plot-unit normalization, algebra, and formatting."""

from __future__ import annotations

import numpy as np
import xarray as xr

from api import units
from api.figures import HeatMap, Line
from api.units import (
    axis_definition_from_figure,
    coefficient_unit,
    divide_units,
    format_quantity,
    inverse_unit,
    multiply_units,
    render_unit,
    sanitize_label,
    sanitize_unit,
)


def test_labels_and_units_are_sanitized_centrally():
    assert sanitize_label(" <b>Drain&nbsp;current</b>  ") == "Drain current"
    assert sanitize_unit("Ohms") == "Ω"
    assert sanitize_unit("uA") == "µA"
    assert sanitize_unit("volts") == "V"


def test_unit_algebra_simplifies_compatible_compounds():
    assert render_unit(divide_units("V", "A")) == "Ω"
    assert render_unit(divide_units("A", "V")) == "S"
    assert render_unit(divide_units("V", "mA")) == "kΩ"
    assert render_unit(multiply_units("A", "V")) == "W"
    assert render_unit(inverse_unit("s")) == "Hz"
    assert render_unit(coefficient_unit("A", "V", 2)) == "S/V"


def test_fit_quantities_move_to_an_engineering_prefix_without_fixed_precision():
    assert format_quantity(1.2e-3, "V") == "1.2 mV"
    assert format_quantity(1.23456789e3, "Ω") == "1.2345679 kΩ"
    assert format_quantity(-2e-6, "A", latex=True) == r"-2\,\mu\mathrm{A}"


def test_line_figure_uses_instrument_attrs_and_preserves_semantic_metadata():
    dataset = xr.Dataset(
        {"current": ("gate", np.array([1e-6, 2e-6, 3e-6]))},
        coords={"gate": np.array([0.0, 1e-3, 2e-3])},
    )
    dataset["gate"].attrs = {"label": "<b>Gate&nbsp;bias</b>", "units": "volts"}
    dataset["current"].attrs = {"long_name": "Drain current", "unit": "uA"}
    metadata = {
        "gate": {"label": "metadata gate", "unit": "mV"},
        "current": {"label": "metadata current", "unit": "A"},
    }

    figure = Line(metadata, dataset, ["gate"], ["current"]).plot().to_dict()

    assert figure["layout"]["xaxis"]["title"]["text"] == (
        r"$\mathrm{Gate\ bias}\;\left(\mathrm{V}\right)$"
    )
    assert figure["layout"]["yaxis"]["title"]["text"] == (
        r"$\mathrm{Drain\ current}\;\left(\mu\mathrm{A}\right)$"
    )
    assert figure["layout"]["xaxis"]["exponentformat"] == "power"
    assert figure["layout"]["xaxis"]["tickformat"] == ""
    assert figure["layout"]["yaxis"]["showexponent"] == "last"
    assert axis_definition_from_figure(figure, "x") == {
        "label": "Gate bias",
        "unit": "V",
    }
    assert axis_definition_from_figure(figure, "y") == {
        "label": "Drain current",
        "unit": "µA",
    }
    assert figure["layout"]["meta"]["qimchi_units"]["x"]["engineering_scale"] == 1
    assert figure["layout"]["meta"]["qimchi_units"]["x"]["engineering_titles"][
        "-3"
    ] == (r"$\mathrm{Gate\ bias}\;\left(\mathrm{mV}\right)$")


def test_heatmap_carries_z_unit_metadata_and_latex_colorbar():
    dataset = xr.Dataset(
        {"voltage": (("gate", "bias"), np.arange(9.0).reshape(3, 3))},
        coords={"gate": [0.0, 1.0, 2.0], "bias": [0.0, 1.0, 2.0]},
    )
    dataset["gate"].attrs = {"label": "Gate", "unit": "V"}
    dataset["bias"].attrs = {"label": "Bias", "unit": "A"}
    dataset["voltage"].attrs = {"label": "Signal", "unit": "volts"}

    figure = HeatMap({}, dataset, ["gate", "bias"], ["voltage"]).plot().to_dict()

    assert axis_definition_from_figure(figure, "z") == {
        "label": "Signal",
        "unit": "V",
    }
    assert figure["layout"]["coloraxis"]["colorbar"]["title"]["text"] == ""
    colorbar_title = next(
        annotation
        for annotation in figure["layout"]["annotations"]
        if annotation["name"] == "qimchi-colorbar-title"
    )
    assert colorbar_title["text"] == (r"$\mathrm{Signal}\;\left(\mathrm{V}\right)$")
    assert colorbar_title["textangle"] == 0
    assert colorbar_title["font"]["size"] == units.COLORBAR_TITLE_FONT_SIZE
    assert figure["layout"]["coloraxis"]["colorbar"]["exponentformat"] == "power"
    # SI-suffixed labels keep a live colorbar from re-flowing the plot.
    assert figure["layout"]["coloraxis"]["colorbar"]["tickformat"] == "~s"
    assert figure["layout"]["coloraxis"]["colorbar"]["showexponent"] == "last"
    assert figure["layout"]["coloraxis"]["colorbar"]["title"]["side"] == "top"
    assert figure["layout"]["coloraxis"]["colorbar"]["x"] == 1.02
    assert figure["layout"]["coloraxis"]["colorbar"]["thickness"] == 20
    # The gutter is measured from the title so it is never clipped.
    assert figure["layout"]["margin"]["r"] == units.colorbar_gutter_px(
        colorbar_title["text"]
    )
    assert figure["layout"]["margin"]["r"] >= units.COLORBAR_GUTTER_MIN_PX


def test_inverse_units_carry_an_engineering_prefix():
    """A per-volt axis at 10^3 reads "per mV" -- the prefix inverts."""
    definition = units._axis_unit_layout_definition({"label": "dz/dx", "unit": "1/V"})
    titles = definition["engineering_titles"]

    assert titles["3"] != titles["0"]
    assert r"\frac{1}{\mathrm{mV}}" in titles["3"]
    assert r"\frac{1}{\mathrm{kV}}" in titles["-3"]


def test_units_that_cannot_carry_a_prefix_offer_no_engineering_scales():
    """Prefixing V^2 would scale by 10^6, so no exponent but 0 is offered.

    An entry here would let the frontend divide ticks by 10^n under a title
    still showing the unprefixed unit.

    """
    definition = units._axis_unit_layout_definition({"label": "P", "unit": "V^2"})

    assert list(definition["engineering_titles"]) == ["0"]


def test_hover_titles_are_plain_text():
    """Plotly renders hover text as HTML, so TeX would show as its source."""
    assert units.plain_axis_title({"label": "Voltage 1", "unit": "V"}) == (
        "Voltage 1 (V)"
    )
    assert units.plain_axis_title({"label": "Ratio", "unit": ""}) == "Ratio"


def test_figure_hover_templates_avoid_latex():
    dataset = xr.Dataset(
        {"voltage": (("gate", "bias"), np.arange(9.0).reshape(3, 3))},
        coords={"gate": [0.0, 1.0, 2.0], "bias": [0.0, 1.0, 2.0]},
    )
    dataset["gate"].attrs = {"label": "Voltage 1", "unit": "V"}
    dataset["bias"].attrs = {"label": "Voltage 2", "unit": "V"}
    dataset["voltage"].attrs = {"label": "Voltmeter", "unit": "V"}

    heatmap = HeatMap({}, dataset, ["gate", "bias"], ["voltage"]).plot().to_dict()
    template = heatmap["data"][0]["hovertemplate"]
    assert "$" not in template
    assert r"\mathrm" not in template
    assert template.startswith("Voltage 2 (V): %{x}")

    line = Line({}, dataset.isel(bias=0), ["gate"], ["voltage"]).plot().to_dict()
    line_template = line["data"][0]["hovertemplate"]
    assert "$" not in line_template
    assert line_template.startswith("Voltage 1 (V): %{x}")


def test_colorbar_gutter_grows_with_the_title_then_shrinks_the_type():
    """A long title must not be clipped, nor eat the plot without limit."""
    plain = r"$\mathrm{Voltmeter}\;\left(\mathrm{V}\right)$"
    everything = (
        r"$\frac{\mathrm{d}z}{\mathrm{d}x}"
        r"\;\left[\times \frac{2e^{2}}{h}\;(2G_{0})\right]"
        r"\;\left(\frac{1}{\mu\mathrm{A}}\right)$"
    )

    # A bare label needs no more than the minimum gutter.
    assert units.colorbar_gutter_px(r"$\mathrm{Z}$") == units.COLORBAR_GUTTER_MIN_PX
    # "Voltmeter (V)" overflowed the old fixed gutter; it now gets its own.
    assert units.colorbar_gutter_px(plain) > units.COLORBAR_GUTTER_MIN_PX
    assert units.colorbar_title_font_size(plain) == units.COLORBAR_TITLE_FONT_SIZE

    # Past the cap the type steps down instead of the plot shrinking further.
    assert units.colorbar_gutter_px(everything) <= units.COLORBAR_GUTTER_MAX_PX
    assert units.colorbar_title_font_size(everything) < units.COLORBAR_TITLE_FONT_SIZE
    assert (
        units.colorbar_title_font_size(everything) >= units.COLORBAR_TITLE_MIN_FONT_SIZE
    )


def test_filtering_a_heatmap_widens_its_gutter():
    dataset = xr.Dataset(
        {"voltage": (("gate", "bias"), np.arange(9.0).reshape(3, 3))},
        coords={"gate": [0.0, 1.0, 2.0], "bias": [0.0, 1.0, 2.0]},
    )
    dataset["gate"].attrs = {"label": "Voltage 1", "unit": "V"}
    dataset["bias"].attrs = {"label": "Voltage 2", "unit": "V"}
    dataset["voltage"].attrs = {"label": "Voltmeter", "unit": "V"}
    figure = HeatMap({}, dataset, ["gate", "bias"], ["voltage"]).plot()
    before = figure.layout.margin.r

    units.set_figure_colorbar_title(
        figure,
        r"$\frac{\mathrm{d}z}{\mathrm{d}x}"
        r"\;\left[\times \frac{2e^{2}}{h}\;(2G_{0})\right]"
        r"\;\left(\mathrm{S}\right)$",
    )

    assert figure.layout.margin.r > before
