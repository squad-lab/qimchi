"""
Utility module for Qimchi figures, providing base classes for different plot types.
Includes Line and HeatMap classes for plotting line graphs and heatmaps using Plotly.

"""

import json
from abc import ABC, abstractmethod
from xarray import Dataset

from plotly.express import colors, imshow, line
from plotly.express.colors import named_colorscales
from plotly import graph_objects as go

# Local imports
from .logger import logger


# Default vars # TODOLATER: Remove?
# QIMCHI_HOME = Path("~/.qimchi").expanduser()
# DATA_REFRESH_INTERVAL = 1_000  # ms
SQUARIFY_SIZE = "450px"


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
DEFAULT_GRID_COLOR = DEFAULT_TICK_COLOR = "gray"
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
DEFAULT_TICK_LENGTH = 5  # px
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
            "gridcolor": DEFAULT_GRID_COLOR,
            "griddash": DEFAULT_GRID_DASH,
            "gridwidth": DEFAULT_GRID_WIDTH,
            "tickcolor": DEFAULT_TICK_COLOR,
            "tickwidth": DEFAULT_TICK_WIDTH,
            "ticklen": DEFAULT_TICK_LENGTH,
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
            "gridcolor": DEFAULT_GRID_COLOR,
            "griddash": DEFAULT_GRID_DASH,
            "gridwidth": DEFAULT_GRID_WIDTH,
            "tickcolor": DEFAULT_TICK_COLOR,
            "tickwidth": DEFAULT_TICK_WIDTH,
            "ticklen": DEFAULT_TICK_LENGTH,
        },
    },
}


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
        self.theme = theme
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
        dep_var = self.deps[0] if isinstance(self.deps, list) else self.deps

        if self.ind[0] in self.metadata and dep_var in self.metadata:
            # Update hover template to match the axis labels
            self.traces["hovertemplate"] = (
                f"{self.metadata[self.ind[0]]['label']} ({self.metadata[self.ind[0]]['unit']}): %{{x}}<br>"
                f"{self.metadata[dep_var]['label']} ({self.metadata[dep_var]['unit']}): %{{y}}<extra></extra>"
            )
        else:
            # Fallback hover template
            self.traces["hovertemplate"] = (
                f"{self.ind[0]}: %{{x}}<br>{dep_var}: %{{y}}<extra></extra>"
            )

        # logger.debug(
        # f"Line || independents: {independents} | dependent: {dependents}"  # | theme: {theme}"
        # )
        # logger.debug(
        #     f"Line || self.data.coords : {self.data.coords}"  # | self.data.data : {self.data.data}"
        # )

    def plot(self) -> go.Figure:
        theme = self.theme
        # Create safe titles for axes
        if self.ind[0] in self.metadata:
            x_title = f"{self.metadata[self.ind[0]]['label']} ({self.metadata[self.ind[0]]['unit']})"
        else:
            x_title = self.ind[0]

        dep_var = self.deps[0] if isinstance(self.deps, list) else self.deps
        if dep_var in self.metadata:
            y_title = (
                f"{self.metadata[dep_var]['label']} ({self.metadata[dep_var]['unit']})"
            )
        else:
            y_title = dep_var

        # Create safe plot title
        if "Device Type" in self.meta and "Wafer ID" in self.meta:
            plot_title = f"{self.meta.get('Device Type', '')} {self.meta.get('Wafer ID', '')} {self.meta.get('Sample Name', '')} {self.meta.get('Measurement ID', '')}"
        else:
            plot_title = "Line Plot"

        layout = {
            "title": {
                "text": plot_title,
                "font": dict(
                    family="Roboto, sans-serif",
                    size=14,
                    color="rgba(0,0,0,0.6)",
                ),
                "x": 0.5,
                "y": 0.97,
            },
            "xaxis": {
                "title": x_title,
                "ticks": "outside",
                "showline": True,
                "mirror": True,
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
                "title": y_title,
                "ticks": "outside",
                "showline": True,
                "mirror": True,
                "exponentformat": "e",
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
                "size": 16,
            },
            "margin": {"l": 50, "r": 10, "t": 40, "b": 50},
            "paper_bgcolor": "rgba(0,0,0,0)",
            "plot_bgcolor": "rgba(0,0,0,0)",
        }

        dep_var = self.deps[0] if isinstance(self.deps, list) else self.deps

        # Convert to pandas DataFrame for plotly express
        df = self.data[[dep_var]].to_dataframe().reset_index()

        fig = line(
            df,
            x=self.ind[0],
            y=dep_var,
        )
        fig.update_layout(layout)
        fig.update_traces(self.traces)

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
        self.rangecolor = theme["hmap"]["rangecolor"]

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

        # Create safe titles for axes
        if len(self.ind) >= 2:
            if self.ind[1] in self.metadata:
                x_title = f"{self.metadata[self.ind[1]]['label']} ({self.metadata[self.ind[1]]['unit']})"
            else:
                x_title = self.ind[1]

            if self.ind[0] in self.metadata:
                y_title = f"{self.metadata[self.ind[0]]['label']} ({self.metadata[self.ind[0]]['unit']})"
            else:
                y_title = self.ind[0]
        else:
            x_title = self.ind[0] if len(self.ind) > 0 else "X"
            y_title = "Y"

        dep_var = self.deps[0] if isinstance(self.deps, list) else self.deps
        if dep_var in self.metadata:
            z_title = (
                f"{self.metadata[dep_var]['label']} ({self.metadata[dep_var]['unit']})"
            )
        else:
            z_title = dep_var

        # Create safe plot title
        if "Device Type" in self.meta and "Wafer ID" in self.meta:
            plot_title = f"{self.meta.get('Device Type', '')} {self.meta.get('Wafer ID', '')} {self.meta.get('Sample Name', '')} {self.meta.get('Measurement ID', '')}"
        else:
            plot_title = "Heat Map"

        layout = {
            "title": {
                "text": plot_title,
                "font": dict(
                    family="Roboto, sans-serif",
                    size=14,
                    color="rgba(0,0,0,0.6)",
                ),
                "x": 0.5,
                "y": 0.97,
            },
            "xaxis": {
                "title": x_title,
                "ticks": "outside",
                "showline": True,
                "mirror": True,
                "automargin": True,
                "zeroline": False,
                "linewidth": 2,
                "showgrid": False,
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
                "title": y_title,
                "ticks": "outside",
                "showline": True,
                "mirror": True,
                "automargin": True,
                "zeroline": False,
                "linewidth": 2,
                "showgrid": False,
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
                "size": 16,
            },
            "coloraxis": {
                "colorbar_title": z_title,
                "colorscale": colors.get_colorscale(self.colorscale),
                "cmin": self.rangecolor[0],
                "cmax": self.rangecolor[1],
                "colorbar": {
                    "exponentformat": "e",  # TODOLATER: Autoscaling Units # CONCERN: Why not "SI"?
                    "ticklen": 5,
                    "outlinewidth": 2,
                    # Colorbar height settings
                    "lenmode": "fraction",
                    "len": 0.9,
                    "y": 0.5,
                    "yanchor": "middle",
                },
            },
            "margin": {"l": 50, "r": 10, "t": 40, "b": 50},
        }

        # TODOLATER: Squarify plots
        # if _state.squarify_plots:
        #     # NOTE: See: https://github.com/plotly/plotly.py/issues/70. They recommend setting height and width.
        #     # NOTE: Preset height-width pairs for squarify. Not responsive.
        #     layout["xaxis"]["constrain"] = "domain"
        #     layout["xaxis"]["scaleanchor"] = "y"
        #     layout["xaxis"]["scaleratio"] = 1
        #     layout["yaxis"]["constrain"] = "domain"
        #     layout["yaxis"]["scaleanchor"] = "x"
        #     layout["yaxis"]["scaleratio"] = 1
        #     # logger.debug("HeatMap || Squarified!")

        # Get the specific dependent variable
        dep_var = self.deps[0] if isinstance(self.deps, list) else self.deps
        data_array = self.data[dep_var]

        if data_array.shape[0] != self.data.coords[self.ind[0]].shape[0]:
            data_array = data_array.T

        fig = imshow(
            data_array.transpose(self.ind[0], self.ind[1]),
            x=self.data.coords[self.ind[1]],
            y=self.data.coords[self.ind[0]],
            origin="lower",  # Moves origin to lower left
        )
        fig.update_layout(layout)

        # Update hover template to match the axis labels
        fig.update_traces(
            # TODOLATER: Custom hover template
            # hoverinfo="none",
            # hovertemplate=None,  # No native hover box
            hovertemplate=f"{self.metadata[self.ind[1]]['label']} ({self.metadata[self.ind[1]]['unit']}): %{{x}}<br>"
            f"{self.metadata[self.ind[0]]['label']} ({self.metadata[self.ind[0]]['unit']}): %{{y}}<br>"
            f"{self.metadata[dep_var]['label']} ({self.metadata[dep_var]['unit']}): %{{z}}<extra></extra>",
            # NOTE: "<extra></extra>" is required to remove the trace index from the hover info
        )
        # logger.debug("HeatMap || PLOTTED")

        return fig
