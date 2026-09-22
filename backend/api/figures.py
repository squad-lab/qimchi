"""
Utility module for Qimchi figures, providing base classes for different plot types.
Includes Line and HeatMap classes for plotting line graphs and heatmaps using Plotly.

"""

import json
import re
from abc import ABC, abstractmethod
from copy import deepcopy

import numpy as np
from plotly import graph_objects as go
from plotly.express import colors
from plotly.express.colors import named_colorscales
from xarray import Dataset

# Local imports
from .logger import logger
from .units import (
    axes_layout_meta,
    axis_title,
    colorbar_gutter_px,
    colorbar_title_annotation,
    format_quantity,
    hover_entry,
    plain_axis_title,
    resolve_axis_definition,
    unit_layout_meta,
)

# Default vars # TODOLATER: Remove?
# QIMCHI_HOME = Path("~/.qimchi").expanduser()
# DATA_REFRESH_INTERVAL = 1_000  # ms
SQUARIFY_SIZE = "450px"

_QANARY_MEASUREMENT_ID_RE = re.compile(
    r"^(\d+-[0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _metadata_text(meta: dict, key: str) -> str:
    value = str(meta.get(key, "")).strip()
    return "" if value in ("", "N/A") else value


def format_measurement_plot_title(meta: dict, fallback: str) -> str:
    """Build the default display title without changing canonical metadata."""
    experiment_name = _metadata_text(meta, "Experiment Name")
    measurement_id = _metadata_text(meta, "Measurement ID")
    if not experiment_name or not measurement_id:
        return fallback

    match = _QANARY_MEASUREMENT_ID_RE.fullmatch(measurement_id)
    display_id = f"{match.group(1)}*" if match else measurement_id

    device_type = _metadata_text(meta, "Device Type")
    wafer_id = _metadata_text(meta, "Wafer ID")
    sample_name = _metadata_text(meta, "Sample Name")
    device_and_wafer = " ".join(part for part in (device_type, wafer_id) if part)
    context = (
        f"{device_and_wafer}_{sample_name}"
        if device_and_wafer and sample_name
        else device_and_wafer or sample_name
    )

    return f"{experiment_name}: {display_id}" + (f" ({context})" if context else "")


# Plot width options
DEFAULT_PLOT_WIDTH = "33%"  # Corresponds to Bulma's column width options
PLOT_WIDTH_OPTS_DICT = {
    "33%": "is-one-third",
    "50%": "is-half",
    "66%": "is-two-thirds",
    "100%": "is-full",
}
PLOT_WIDTH_OPTS = [{"label": key, "value": key} for key in PLOT_WIDTH_OPTS_DICT.keys()]
DEFAULT_HMAP_COLSCALE = "viridis"
DEFAULT_LINE_MODE = "lines+markers"
DEFAULT_LINE_COLOR = "#6acc64"
DEFAULT_LINE_WIDTH = 3
DEFAULT_LINE_OPACITY = 1.0
DEFAULT_LINE_DASH = "solid"
DEFAULT_LINE_SHAPE = "linear"
DEFAULT_SPLINE_SMOOTHING = 0.0
DEFAULT_MARKER_COLOR = "#6acc64"
DEFAULT_MARKER_SIZE = 6
DEFAULT_MARKER_OPACITY = 0.5
LINE_MODE_OPTS = [
    {"label": "Lines", "value": "lines"},
    {"label": "Markers", "value": "markers"},
    {"label": "Lines + Markers", "value": "lines+markers"},
]
LINE_COLOR_OPTS = MARKER_COLOR_OPTS = GRID_COLOR_OPTS = TICK_COLOR_OPTS = [
    "#6acc64",
    "#4878d0",
    "#ee854a",
    "#d65f5f",
    "#956cb4",
    "#8c613c",
    "#dc7ec0",
    "#797979",
    "#d5bb67",
    "#82c6e2",
]
LINE_DASH_OPTS = [
    {"label": "Solid", "value": "solid"},
    {"label": "Dash", "value": "dash"},
    {"label": "Dot", "value": "dot"},
    {"label": "Long Dash", "value": "longdash"},
    {"label": "Dash Dot", "value": "dashdot"},
    {"label": "Long Dash Dot", "value": "longdashdot"},
]
LINE_SHAPE_OPTS = [
    {"label": "Linear", "value": "linear"},
    {"label": "Spline", "value": "spline"},
    {"label": "Step", "value": "hv"},
    {"label": "Step Before", "value": "hvh"},
    {"label": "Step After", "value": "vhv"},
]
DEFAULT_MARKER_SYMBOL = "circle"
MARKER_SYMBOL_OPTS = [
    {"label": "Circle", "value": "circle"},
    {"label": "Square", "value": "square"},
    {"label": "Diamond", "value": "diamond"},
    {"label": "Cross", "value": "cross"},
    {"label": "X", "value": "x"},
    {"label": "Triangle-Down", "value": "triangle-down"},
    {"label": "Triangle-Left", "value": "triangle-left"},
    {"label": "Triangle-Right", "value": "triangle-right"},
    {"label": "Triangle-Up", "value": "triangle-up"},
    {"label": "Diamond-Tall", "value": "diamond-tall"},
    {"label": "Diamond-Tall-Open", "value": "diamond-tall-open"},
    {"label": "Diamond-Wide", "value": "diamond-wide"},
    {"label": "Diamond-Wide-Open", "value": "diamond-wide-open"},
    {"label": "Hourglass", "value": "hourglass"},
    {"label": "Hourglass-Open", "value": "hourglass-open"},
]
# Grid & tick options
DEFAULT_AXIS_TYPE = "linear"
# Keep minor divisions lighter than major ones.
DEFAULT_GRID_COLOR = DEFAULT_TICK_COLOR = "gray"
DEFAULT_MINOR_GRID_COLOR = DEFAULT_MINOR_TICK_COLOR = "lightgray"
DEFAULT_SHOWGRID = False
DEFAULT_NTICKS = 5
DEFAULT_GRID_WIDTH = 1  # px
DEFAULT_GRID_DASH = "solid"
AXIS_TYPE_OPTS = [
    {"label": "Linear", "value": "linear"},
    {"label": "Log", "value": "log"},
]
GRID_DASH_OPTS = [
    {"label": "Solid", "value": "solid"},
    {"label": "Dash", "value": "dash"},
    {"label": "Dot", "value": "dot"},
    {"label": "Long Dash", "value": "longdash"},
    {"label": "Dash Dot", "value": "dashdot"},
    {"label": "Long Dash Dot", "value": "longdashdot"},
]
DEFAULT_TICK_WIDTH = 2  # px
DEFAULT_TICK_LENGTH = 6  # px
DEFAULT_MINOR_TICK_WIDTH = 1  # px
DEFAULT_MINOR_TICK_LENGTH = 3  # px
DEFAULT_TICK_ANGLE = 0  # deg

# Default filter options
DEFAULT_SAVGOL_WINDOW_LENGTH = 5
DEFAULT_SAVGOL_POLYORDER = 2


DEFAULT_THEME = {
    # NOTE: Nesting structure is NOT indicative of the actual data structure in Plotly figures
    "hmap": {
        "colorscale": DEFAULT_HMAP_COLSCALE,
        "rangecolor": None,  # NOTE: Dynamically set via callback
    },
    "line": {
        "mode": DEFAULT_LINE_MODE,
        "color": DEFAULT_LINE_COLOR,
        "width": DEFAULT_LINE_WIDTH,
        "opacity": DEFAULT_LINE_OPACITY,
        "dash": DEFAULT_LINE_DASH,
        "shape": DEFAULT_LINE_SHAPE,
        "smoothing": DEFAULT_SPLINE_SMOOTHING,
    },
    "marker": {
        "color": DEFAULT_MARKER_COLOR,
        "size": DEFAULT_MARKER_SIZE,
        "symbol": DEFAULT_MARKER_SYMBOL,
        "opacity": DEFAULT_MARKER_OPACITY,
    },
    "x": {
        "maj": {
            "showgrid": DEFAULT_SHOWGRID,
            "type": DEFAULT_AXIS_TYPE,
            "nticks": DEFAULT_NTICKS,
            "gridcolor": DEFAULT_GRID_COLOR,
            "griddash": DEFAULT_GRID_DASH,
            "gridwidth": DEFAULT_GRID_WIDTH,
            "tickcolor": DEFAULT_TICK_COLOR,
            "tickwidth": DEFAULT_TICK_WIDTH,
            "ticklen": DEFAULT_TICK_LENGTH,
            "tickangle": DEFAULT_TICK_ANGLE,
        },
        "min": {
            "showgrid": DEFAULT_SHOWGRID,
            "nticks": DEFAULT_NTICKS,
            "gridcolor": DEFAULT_MINOR_GRID_COLOR,
            "griddash": DEFAULT_GRID_DASH,
            "gridwidth": DEFAULT_GRID_WIDTH,
            "tickcolor": DEFAULT_MINOR_TICK_COLOR,
            "tickwidth": DEFAULT_MINOR_TICK_WIDTH,
            "ticklen": DEFAULT_MINOR_TICK_LENGTH,
        },
    },
    "y": {
        "maj": {
            "showgrid": DEFAULT_SHOWGRID,
            "type": DEFAULT_AXIS_TYPE,
            "nticks": DEFAULT_NTICKS,
            "gridcolor": DEFAULT_GRID_COLOR,
            "griddash": DEFAULT_GRID_DASH,
            "gridwidth": DEFAULT_GRID_WIDTH,
            "tickcolor": DEFAULT_TICK_COLOR,
            "tickwidth": DEFAULT_TICK_WIDTH,
            "ticklen": DEFAULT_TICK_LENGTH,
            "tickangle": DEFAULT_TICK_ANGLE,
        },
        "min": {
            "showgrid": DEFAULT_SHOWGRID,
            "nticks": DEFAULT_NTICKS,
            "gridcolor": DEFAULT_MINOR_GRID_COLOR,
            "griddash": DEFAULT_GRID_DASH,
            "gridwidth": DEFAULT_GRID_WIDTH,
            "tickcolor": DEFAULT_MINOR_TICK_COLOR,
            "tickwidth": DEFAULT_MINOR_TICK_WIDTH,
            "ticklen": DEFAULT_MINOR_TICK_LENGTH,
        },
    },
}


class AxisResolutionError(ValueError):
    """Raised when a variable cannot serve as a plot axis."""


def is_dependent(data: Dataset, variable: str) -> bool:
    """True when the variable is measured data rather than a swept coordinate."""
    return variable in data.data_vars


def axis_dimension(data: Dataset, variable: str) -> str:
    """Return the single dimension along which an axis variable varies."""
    if variable in data.coords:
        dims = data.coords[variable].dims
    elif variable in data.data_vars:
        dims = data.data_vars[variable].dims
    else:
        raise AxisResolutionError(f"'{variable}' is not in this dataset")

    if len(dims) != 1:
        raise AxisResolutionError(
            f"'{variable}' varies over {len(dims)} dimensions "
            f"({', '.join(map(str, dims)) or 'none'}), so it cannot be an axis"
        )
    return str(dims[0])


def axis_values(data: Dataset, variable: str) -> np.ndarray:
    """The 1-D values to plot along an axis, from a coordinate or a dependent."""
    axis_dimension(data, variable)  # raises when it is not a usable axis
    source = data.coords if variable in data.coords else data.data_vars
    return source[variable].values


class QimchiFigure(ABC):
    def __init__(
        self,
        metadata: dict,
        data: Dataset,
        independents: list,
        dependents: list,
        num_axes: int,
        colors=None,
        theme: dict = DEFAULT_THEME,
    ) -> None:
        """
        Qimchi Figure Base Class

        Args:
            metadata (dict): Metadata for the figure, typically from the dataset.
            data (Dataset): Data to be plotted
            independents (list): Independent variables
            dependents (list): Dependent variables
            num_axes (int): Number of axes in the figure
            colors (list, optional): Colors for the plot. Defaults to None.
            theme (dict, optional): Theme dict for the plot. Defaults to None.

        Raises:
            ValueError: If the number of independent variables is greater than the number of axes.

        """
        self.data = data
        metadata = metadata if isinstance(metadata, dict) else json.loads(metadata)

        # Handle different metadata structures
        if "Parameters Snapshot" in metadata:
            param = metadata["Parameters Snapshot"]
            self.metadata = param if isinstance(param, dict) else json.loads(param)
        else:
            self.metadata = metadata

        self.meta = metadata

        # logger.debug(f"QimchiFigure || metadata: {self.metadata}")
        self.ind = independents
        self.deps = dependents
        self.colors = colors
        # HeatMap writes its colour range into the theme; the default is shared.
        self.theme = deepcopy(theme)
        self.num_axes = num_axes

        if len(self.ind) > self.num_axes:
            raise ValueError(
                f"Line plot can only have {self.num_axes} independent variable(s)"
            )
        # Allow multiple dependent variables for some plot types
        # if type(self.deps) is list and len(self.deps) > 1:
        #     err = "Plots can only have one dependent variable."
        #     # logger.error(err)
        #     raise ValueError(err)

    @abstractmethod
    def plot(self) -> go.Figure:
        """
        Abstract method to plot the figure.

        Returns:
            go.Figure: Plotly Figure object

        """


class Line(QimchiFigure):
    """
    Qimchi Line Plot Class

    """

    def __init__(
        self,
        metadata: dict,
        data: Dataset,
        independents: list,
        dependents: list,
        theme: dict = DEFAULT_THEME,
    ) -> None:
        super().__init__(
            metadata, data, independents, dependents, theme=theme, num_axes=1
        )
        # logger.debug(f"Line || metadata: {self.metadata}")
        # logger.debug(f"Line || type(metadata): {type(self.metadata)}")
        # logger.debug(f"Line || self.ind: {self.ind}")
        self.traces = {
            "mode": theme["line"]["mode"],
            "line": {
                "color": theme["line"]["color"],
                "width": theme["line"]["width"],
                "dash": theme["line"]["dash"],
                "shape": theme["line"]["shape"],
            },
            "marker": {
                "symbol": theme["marker"]["symbol"],
                "size": theme["marker"]["size"],
                "color": theme["marker"]["color"],
                "opacity": theme["marker"]["opacity"],
            },
            "opacity": theme["line"]["opacity"],
        }

        # Handle metadata access safely for hover template
        # dep_var = self.deps[0] if isinstance(self.deps, list) else self.deps

        # logger.debug(
        # f"Line || independents: {independents} | dependent: {dependents}"  # | theme: {theme}"
        # )
        # logger.debug(
        #     f"Line || self.data.coords : {self.data.coords}"  # | self.data.data : {self.data.data}"
        # )

    def _sweep_along_x(self):
        """Return the sweep behind a measured x axis, if any."""
        if not is_dependent(self.data, self.ind[0]):
            return None
        try:
            dimension = axis_dimension(self.data, self.ind[0])
        except AxisResolutionError:
            return None
        if dimension not in self.data.coords:
            return None
        definition = resolve_axis_definition(self.data, self.metadata, dimension)
        return self.data.coords[dimension].values, definition

    def plot(self) -> go.Figure:
        theme = self.theme
        dep_var = self.deps[0] if isinstance(self.deps, list) else self.deps
        x_definition = resolve_axis_definition(self.data, self.metadata, self.ind[0])
        y_definition = resolve_axis_definition(self.data, self.metadata, dep_var)
        self.x_title = axis_title(x_definition)
        self.y_title = axis_title(y_definition)
        # Hover text is HTML, so it needs the plain-text form of each title.
        self.x_hover = hover_entry(x_definition, "x")
        self.y_hover = hover_entry(y_definition, "y")

        # Plot titles are a display surface: Qanary IDs are shortened here only.
        plot_title = format_measurement_plot_title(
            self.meta, f"{dep_var} vs {self.ind[0]}"
        )

        layout = {
            "title": {
                "text": plot_title,
                "font": dict(
                    family="Fira Sans, Arial, sans-serif",
                    size=16,
                    color="rgba(0,0,0,0.6)",
                ),
                "x": 0.5,
                "y": 0.97,
            },
            "xaxis": {
                "title": self.x_title,
                "ticks": "outside",
                "showline": True,
                "mirror": True,
                "exponentformat": "power",
                "showexponent": "last",
                "tickformat": "",
                "minexponent": 0,
                "automargin": True,
                "zeroline": False,
                "linecolor": "black",
                "linewidth": 2,
                # Customizable
                "showgrid": theme["x"]["maj"]["showgrid"],
                "type": theme["x"]["maj"]["type"],
                "nticks": theme["x"]["maj"]["nticks"],
                "griddash": theme["x"]["maj"]["griddash"],
                "gridcolor": theme["x"]["maj"]["gridcolor"],
                "gridwidth": theme["x"]["maj"]["gridwidth"],
                "tickcolor": theme["x"]["maj"]["tickcolor"],
                "tickwidth": theme["x"]["maj"]["tickwidth"],
                "ticklen": theme["x"]["maj"]["ticklen"],
                "tickangle": theme["x"]["maj"]["tickangle"],
                "minor": {
                    "showgrid": theme["x"]["min"]["showgrid"],
                    "nticks": theme["x"]["min"]["nticks"],
                    "griddash": theme["x"]["min"]["griddash"],
                    "gridcolor": theme["x"]["min"]["gridcolor"],
                    "gridwidth": theme["x"]["min"]["gridwidth"],
                    "tickcolor": theme["x"]["min"]["tickcolor"],
                    "tickwidth": theme["x"]["min"]["tickwidth"],
                    "ticklen": theme["x"]["min"]["ticklen"],
                },
            },
            "yaxis": {
                "title": self.y_title,
                "ticks": "outside",
                "showline": True,
                "mirror": True,
                "exponentformat": "power",
                "showexponent": "last",
                "tickformat": "",
                "minexponent": 0,
                "automargin": True,
                "zeroline": False,
                "linecolor": "black",
                "linewidth": 2,
                # Customizable
                "showgrid": theme["y"]["maj"]["showgrid"],
                "type": theme["y"]["maj"]["type"],
                "nticks": theme["y"]["maj"]["nticks"],
                "griddash": theme["y"]["maj"]["griddash"],
                "gridcolor": theme["y"]["maj"]["gridcolor"],
                "gridwidth": theme["y"]["maj"]["gridwidth"],
                "tickcolor": theme["y"]["maj"]["tickcolor"],
                "tickwidth": theme["y"]["maj"]["tickwidth"],
                "ticklen": theme["y"]["maj"]["ticklen"],
                "tickangle": theme["y"]["maj"]["tickangle"],
                "minor": {
                    "showgrid": theme["y"]["min"]["showgrid"],
                    "nticks": theme["y"]["min"]["nticks"],
                    "griddash": theme["y"]["min"]["griddash"],
                    "gridcolor": theme["y"]["min"]["gridcolor"],
                    "gridwidth": theme["y"]["min"]["gridwidth"],
                    "tickcolor": theme["y"]["min"]["tickcolor"],
                    "tickwidth": theme["y"]["min"]["tickwidth"],
                    "ticklen": theme["y"]["min"]["ticklen"],
                },
            },
            "font": {
                "family": "Fira Sans, Arial, sans-serif",
                "size": 16,
            },
            "margin": {"l": 50, "r": 10, "t": 40, "b": 50},
            "paper_bgcolor": "rgba(0,0,0,0)",
            "plot_bgcolor": "rgba(0,0,0,0)",
            "meta": {
                **unit_layout_meta(x=x_definition, y=y_definition),
                **axes_layout_meta(
                    x={
                        "variable": self.ind[0],
                        "dependent": is_dependent(self.data, self.ind[0]),
                    },
                    y={"variable": dep_var, "dependent": True},
                ),
            },
        }

        dep_var = self.deps[0] if isinstance(self.deps, list) else self.deps

        # NOTE: Using go.Figure, as plotly.express.line() might be automatically sorting by x, which could be causing the data flipping issues
        # Read both axes in sweep order; a measured x axis may double back.
        x_data = axis_values(self.data, self.ind[0])
        y_data = self.data[dep_var].values

        # Create hover template
        hover_template = f"{self.x_hover}<br>{self.y_hover}<extra></extra>"

        traces = dict(self.traces)
        # Colour measured-vs-measured plots by their shared sweep.
        sweep = self._sweep_along_x()
        if sweep is not None:
            sweep_values, sweep_definition = sweep
            traces["marker"] = {
                **traces.get("marker", {}),
                "color": sweep_values,
                "colorscale": colors.get_colorscale(DEFAULT_HMAP_COLSCALE),
                "showscale": True,
                "colorbar": {
                    "title": {
                        "text": plain_axis_title(sweep_definition),
                        "side": "right",
                    },
                    "thickness": 14,
                    "len": 0.7,
                    "x": 1.02,
                    "xanchor": "left",
                    "exponentformat": "power",
                    "tickformat": "~s",
                },
            }
            traces["mode"] = "lines+markers"
            # Keep hover data separate from marker colours, which appearance
            # settings may replace. Plotly also misformats SI customdata.
            traces["customdata"] = [
                format_quantity(
                    float(value), sweep_definition.get("unit"), max_decimals=2
                )
                for value in np.asarray(sweep_values).reshape(-1)
            ]
            hover_template = (
                f"{self.x_hover}<br>{self.y_hover}<br>"
                f"{sweep_definition['label']}: %{{customdata}}<extra></extra>"
            )
            layout["margin"] = {**layout["margin"], "r": 90}

        # Create figure with go.Scatter to preserve data order
        fig = go.Figure(
            data=[
                go.Scatter(
                    x=x_data,
                    y=y_data,
                    hovertemplate=hover_template,
                    showlegend=False,
                    **traces,
                )
            ],
            layout=layout,
        )
        logger.debug("Line || PLOTTED")

        return fig


class HeatMap(QimchiFigure):
    """
    Qimchi HeatMap Plot Class

    """

    def __init__(
        self,
        metadata: dict,
        data: Dataset,
        independents: list,
        dependents: list,
        theme: dict = DEFAULT_THEME,
    ) -> None:
        super().__init__(
            metadata, data, independents, dependents, theme=theme, num_axes=2
        )
        self.colors = named_colorscales()
        self.colorscale = theme["hmap"]["colorscale"]
        self.rangecolor = self.theme["hmap"]["rangecolor"]

        # Handle deps properly - get the first dependent variable
        dep_var = self.deps[0] if isinstance(self.deps, list) else self.deps
        data_array = data[dep_var]

        data_min = float(data_array.min().values)
        data_max = float(data_array.max().values)

        if self.rangecolor is not None:
            # Convert values to float safely, falling back to data min/max if conversion fails
            try:
                min_range = (
                    float(self.rangecolor[0])
                    if self.rangecolor[0] is not None
                    else data_min
                )
                max_range = (
                    float(self.rangecolor[1])
                    if self.rangecolor[1] is not None
                    else data_max
                )
                self.rangecolor[0] = max(min_range, data_min)
                self.rangecolor[1] = min(max_range, data_max)
            except (TypeError, ValueError):
                self.rangecolor = [data_min, data_max]
        else:
            self.rangecolor = [data_min, data_max]
        self.theme["hmap"]["rangecolor"] = self.rangecolor

        # logger.debug(
        # f"HeatMap || independents: {independents} | dependent: {dependents}"  # | theme: {theme}"
        # )
        # logger.debug(
        #     f"HeatMap || self.data.coords : {self.data.coords}"  # | self.data.data : {self.data.data}"
        # )

    def plot(self) -> go.Figure:
        theme = self.theme

        if len(self.ind) >= 2:
            x_definition = resolve_axis_definition(
                self.data, self.metadata, self.ind[1]
            )
            y_definition = resolve_axis_definition(
                self.data, self.metadata, self.ind[0]
            )

        else:
            x_variable = self.ind[0] if len(self.ind) > 0 else "X"
            x_definition = resolve_axis_definition(self.data, self.metadata, x_variable)
            y_definition = {"label": "Y", "unit": ""}

        self.x_title = axis_title(x_definition)
        self.y_title = axis_title(y_definition)

        dep_var = self.deps[0] if isinstance(self.deps, list) else self.deps
        z_definition = resolve_axis_definition(self.data, self.metadata, dep_var)
        self.z_title = axis_title(z_definition)
        # Hover text is HTML, so it needs the plain-text form of each title.
        self.x_hover = hover_entry(x_definition, "x")
        self.y_hover = hover_entry(y_definition, "y")
        self.z_hover = hover_entry(z_definition, "z")

        # Plot titles are a display surface: Qanary IDs are shortened here only.
        plot_title = format_measurement_plot_title(
            self.meta, f"{dep_var} vs {self.ind[1]}, {self.ind[0]}"
        )

        layout = {
            "title": {
                "text": plot_title,
                "font": dict(
                    family="Fira Sans, Arial, sans-serif",
                    size=16,
                    color="rgba(0,0,0,0.6)",
                ),
                "x": 0.5,
                "y": 0.97,
            },
            "xaxis": {
                "title": self.x_title,
                "ticks": "outside",
                "showline": True,
                "mirror": True,
                "automargin": True,
                "zeroline": False,
                "linewidth": 2,
                "showgrid": False,
                "exponentformat": "power",
                "showexponent": "last",
                "tickformat": "",
                "minexponent": 0,
                # Customizable
                "nticks": theme["x"]["maj"]["nticks"],
                "tickcolor": theme["x"]["maj"]["tickcolor"],
                "tickwidth": theme["x"]["maj"]["tickwidth"],
                "ticklen": theme["x"]["maj"]["ticklen"],
                "tickangle": theme["x"]["maj"]["tickangle"],
                "minor": {
                    "nticks": theme["x"]["min"]["nticks"],
                    "tickcolor": theme["x"]["min"]["tickcolor"],
                    "tickwidth": theme["x"]["min"]["tickwidth"],
                    "ticklen": theme["x"]["min"]["ticklen"],
                },
            },
            "yaxis": {
                "title": self.y_title,
                "ticks": "outside",
                "showline": True,
                "mirror": True,
                "automargin": True,
                "zeroline": False,
                "linewidth": 2,
                "showgrid": False,
                "exponentformat": "power",
                "showexponent": "last",
                "tickformat": "",
                "minexponent": 0,
                # Customizable
                "nticks": theme["y"]["maj"]["nticks"],
                "tickcolor": theme["y"]["maj"]["tickcolor"],
                "tickwidth": theme["y"]["maj"]["tickwidth"],
                "ticklen": theme["y"]["maj"]["ticklen"],
                "tickangle": theme["y"]["maj"]["tickangle"],
                "minor": {
                    "nticks": theme["y"]["min"]["nticks"],
                    "tickcolor": theme["y"]["min"]["tickcolor"],
                    "tickwidth": theme["y"]["min"]["tickwidth"],
                    "ticklen": theme["y"]["min"]["ticklen"],
                },
            },
            "font": {
                "family": "Fira Sans, Arial, sans-serif",
                "size": 16,
            },
            "coloraxis": {
                "colorscale": colors.get_colorscale(self.colorscale),
                "cmin": self.rangecolor[0],
                "cmax": self.rangecolor[1],
                "colorbar": {
                    "title": {
                        "text": "",
                        "side": "top",
                    },
                    "exponentformat": "power",
                    "showexponent": "last",
                    "tickformat": "~s",
                    "minexponent": 0,
                    "ticklen": 5,
                    "outlinewidth": 2,
                    "thicknessmode": "pixels",
                    "thickness": 20,
                    "x": 1.02,
                    "xanchor": "left",
                    # Colorbar height settings
                    "lenmode": "fraction",
                    "len": 0.78,
                    "y": 0.45,
                    "yanchor": "middle",
                },
            },
            # MathJax colorbar titles do not contribute a reliable automatic
            # right margin in Plotly, so the gutter is measured here: wide
            # enough for this title -- a filtered one runs long -- in compact
            # plot cards and exports alike.
            "margin": {
                "l": 50,
                "r": colorbar_gutter_px(self.z_title),
                "t": 40,
                "b": 50,
            },
            "annotations": [colorbar_title_annotation(self.z_title)],
            "meta": {
                **unit_layout_meta(x=x_definition, y=y_definition, z=z_definition),
                **axes_layout_meta(
                    x={
                        "variable": self.ind[1],
                        "dependent": is_dependent(self.data, self.ind[1]),
                    },
                    y={
                        "variable": self.ind[0],
                        "dependent": is_dependent(self.data, self.ind[0]),
                    },
                    z={"variable": dep_var, "dependent": True},
                ),
            },
        }

        # Get the specific dependent variable
        dep_var = self.deps[0] if isinstance(self.deps, list) else self.deps
        data_array = self.data[dep_var]

        y_dimension = axis_dimension(self.data, self.ind[0])
        x_dimension = axis_dimension(self.data, self.ind[1])
        if x_dimension == y_dimension:
            raise AxisResolutionError(
                f"'{self.ind[0]}' and '{self.ind[1]}' both run along "
                f"'{x_dimension}', so they cannot be the two axes of a heat map"
            )
        missing = {y_dimension, x_dimension} - set(data_array.dims)
        if missing:
            raise AxisResolutionError(
                f"'{dep_var}' does not vary over {', '.join(sorted(missing))}"
            )

        # CONCERN: Cast to float32: halves payload size (~4 MB vs ~8 MB for 1000×1000) | @Spandan Check.
        # while retaining more than sufficient precision for colormapped display.
        data_array = data_array.astype("float32")

        # Build the trace directly to avoid repeated Plotly validation.
        # "<extra></extra>" removes the trace index from hover text.
        fig = go.Figure(
            data=[
                go.Heatmap(
                    z=data_array.transpose(y_dimension, x_dimension).values,
                    x=axis_values(self.data, self.ind[1]),
                    y=axis_values(self.data, self.ind[0]),
                    coloraxis="coloraxis",
                    hovertemplate=(
                        f"{self.x_hover}<br>{self.y_hover}<br>"
                        f"{self.z_hover}<extra></extra>"
                    ),
                )
            ],
            layout=layout,
        )

        return fig
