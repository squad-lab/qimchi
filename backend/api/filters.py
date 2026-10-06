"""
FastAPI endpoints for applying filters to Plotly figures.
The filters are adapted from the Qimchi Dash app.

"""

import base64
import math
from copy import deepcopy

import numpy as np
from fastapi import APIRouter, HTTPException
from numpy.polynomial.polynomial import Polynomial
from plotly import graph_objects as go

from .json_utils import sanitize_for_json

# Local imports
from .logger import logger
from .models import (
    TransformPlotRequest,
    TransformPlotResponse,
)
from .units import (
    SCALE_QUANTITIES,
    TITLE_TEMPLATE_KEY,
    UNIT_META_KEY,
    Unit,
    axis_definition,
    axis_definition_from_figure,
    axis_title_template_from_figure,
    divide_units,
    figure_axis_is_dependent,
    inverse_unit,
    latex_text,
    multiply_units,
    parse_unit,
    render_unit,
    scale_quantity_label_suffix,
    set_figure_axis_definition,
    set_figure_derivative_axis_definition,
)


# Load scientific dependencies only when a filter needs them.
def savgol_filter(*args, **kwargs):
    from scipy.signal import savgol_filter as _savgol_filter

    return _savgol_filter(*args, **kwargs)


def affine_transform(*args, **kwargs):
    from scipy.ndimage import affine_transform as _affine_transform

    return _affine_transform(*args, **kwargs)


class _Exposure:
    def __getattr__(self, name: str):
        from skimage import exposure

        return getattr(exposure, name)


exposure = _Exposure()

# FastAPI Router
router = APIRouter()

# Default filter options
DEFAULT_SAVGOL_OPTS = {
    "window": 5,
    "polyorder": 2,
    # NOTE: -1 is default for savgol_filter AKA column-wise for 2D heatmap. "2" here means along both axes.
    # NOTE: See filters.py::Smooth.apply_2d() for more details.
    "axis": 0,
    "deriv": 0,
    "delta": 1.0,
    "mode": "interp",
    "cval": 0.0,
}

DEFAULT_SMA_WINDOW = 5

DEFAULT_NORM_AXIS = "z"

DEFAULT_GC_OPTS = {
    "gamma": 2.0,  # skimage default is 1.0
    "gain": 2.0,  # skimage default is 1.0
}

DEFAULT_LC_OPTS = {
    "gain": 1.0,
    "inv": False,
}

DEFAULT_SC_OPTS = {
    "cutoff": 0.5,
    "gain": 10.0,
}

DEFAULT_POLYFIT_OPTS = {
    "deg": 2,
    "window": [0, 1],  # TODOLATER: window
}

POLYFIT_META_KEY = "qimchi_polyfit"
POLYFIT_ANNOTATION_NAME = "qimchi-polyfit-equation"

# TODOLATER: Can allow specifying the range to scale to.
# TODOLATER: See: https://scikit-image.org/docs/stable/api/skimage.exposure.html#skimage.exposure.rescale_intensity
DEFAULT_RI_OPTS = {
    "in_range": "image",  # skimage default is "image"
}

DEFAULT_ROTA_OPTS = {
    "angle": 0,
}

DEFAULT_R_IN_CORRECTION_OPTS = {
    "r_in": 0.0,
    "r_in_unit": "kΩ",
    "bias_axis": "x",
}

# Supported resistance units in ohms.
_RESISTANCE_UNITS = {"Ω": 1.0, "kΩ": 1e3, "MΩ": 1e6, "GΩ": 1e9}


def _format_number(value: float, default_precision: float = 3) -> str:
    """Format extreme values in scientific notation and others at fixed precision."""
    if abs(value) < 0.001 or abs(value) >= 10000:
        return f"{value:.3e}"
    else:
        precision = default_precision
        return f"{value:.{precision}f}"


def _safe_init(options: dict, key: str, default: dict) -> dict:
    """Read an option or return its default."""
    return options.get(key, default) if options else default


def _format_latex_coefficient(value: float, notation: str = "scientific") -> str:
    """Format a coefficient to two significant figures in the chosen notation."""
    if value == 0 or not math.isfinite(value):
        return f"{value:.2g}"

    exponent = math.floor(math.log10(abs(value)))
    if notation == "engineering":
        exponent = 3 * math.floor(exponent / 3)
        upper_limit = 1000
    else:
        upper_limit = 10

    significand = value / (10.0**exponent)
    leading_power = math.floor(math.log10(abs(significand)))
    rounding_places = 1 - leading_power
    decimal_places = max(0, rounding_places)
    significand = round(significand, rounding_places)

    # Rounding 9.96 or 999.6 can move the significand into the next range.
    if abs(significand) >= upper_limit:
        exponent += 3 if notation == "engineering" else 1
        significand /= upper_limit
        leading_power = math.floor(math.log10(abs(significand)))
        rounding_places = 1 - leading_power
        decimal_places = max(0, rounding_places)
        significand = round(significand, rounding_places)

    rendered = f"{significand:.{decimal_places}f}"
    if "." in rendered:
        rendered = rendered.rstrip("0").rstrip(".")
    if exponent == 0:
        return rendered
    return rf"{rendered}\times 10^{{{exponent}}}"


def _physical_polynomial_coefficients(poly: Polynomial) -> list[float]:
    physical = poly.convert()
    coefficient_scale = max((abs(float(value)) for value in physical.coef), default=0.0)
    zero_tolerance = np.finfo(float).eps * max(1.0, coefficient_scale) * 100
    return [
        0.0 if abs(float(value)) <= zero_tolerance else float(value)
        for value in physical.coef
    ]


def _pprint_poly(poly: Polynomial, notation: str = "scientific") -> str:
    """Render a polynomial as LaTeX."""

    # Convert mapped coefficients back to the plot's physical x coordinate.
    coefficients = _physical_polynomial_coefficients(poly)
    terms: list[str] = []
    for power in range(len(coefficients) - 1, -1, -1):
        coefficient = coefficients[power]
        if coefficient == 0 and power > 0:
            continue
        sign = "-" if coefficient < 0 else "+"
        rendered_coefficient = _format_latex_coefficient(abs(coefficient), notation)
        variable = ""
        if power == 1:
            variable = r"\,x"
        elif power > 1:
            variable = rf"\,x^{{{power}}}"
        term = f"{rendered_coefficient}{variable}"
        if not terms:
            terms.append(("-" if sign == "-" else "") + term)
        else:
            terms.append(f" {sign} {term}")

    expression = "".join(terms) or "0"
    poly_str = f"${expression}$"
    logger.debug(f"Pretty-printed polynomial equation: {poly_str}")
    return poly_str


def _extract_axis_data(data_dict: dict, axis_name: str) -> np.ndarray:
    """Extract an axis from direct, React ``_inputArray``, or encoded data."""
    if axis_name not in data_dict:
        raise ValueError(f"No {axis_name}-axis data found in figure")

    axis_data = data_dict[axis_name]

    # Handle the encoded format from go.Figure.to_dict()
    # This happens when a figure has been processed and converted back to dict
    if isinstance(axis_data, np.ndarray) and axis_data.dtype == object:
        # Check if it's the encoded format with dtype and bdata
        if len(axis_data) > 0 and isinstance(axis_data[0], dict):
            encoded_data = axis_data[0]
            if "dtype" in encoded_data and "bdata" in encoded_data:
                logger.debug(
                    f"Decoding {axis_name}-axis data from go.Figure encoded format"
                )
                # Decode the base64 encoded binary data
                binary_data = base64.b64decode(encoded_data["bdata"])
                # Create numpy array from binary data with the specified dtype
                dtype = encoded_data["dtype"]
                return np.frombuffer(binary_data, dtype=dtype)

    # Handle _inputArray format from React frontend
    if isinstance(axis_data, dict) and "_inputArray" in axis_data:
        # Extract from _inputArray if available - filter out metadata keys
        input_array = axis_data["_inputArray"]
        # Only include numeric keys (array indices), exclude metadata keys
        numeric_keys = [k for k in input_array.keys() if k.isdigit()]
        # Sort by numeric value to ensure correct order
        numeric_keys.sort(key=int)
        return np.array([input_array[k] for k in numeric_keys])

    # Handle direct array format
    elif isinstance(axis_data, (list, np.ndarray)):
        return np.array(axis_data)

    # Handle single encoded dict format (alternative encoding)
    elif isinstance(axis_data, dict) and "dtype" in axis_data and "bdata" in axis_data:
        logger.debug(f"Decoding {axis_name}-axis data from direct encoded dict format")
        # Decode the base64 encoded binary data
        binary_data = base64.b64decode(axis_data["bdata"])
        # Create numpy array from binary data with the specified dtype
        dtype = axis_data["dtype"]
        return np.frombuffer(binary_data, dtype=dtype)

    else:
        raise ValueError(
            f"Unable to extract {axis_name}-axis data: unsupported format {type(axis_data)}"
        )


class Filter:
    def __init__(
        self,
        figure: dict,
        num_axes: int,
        options: dict = None,
    ) -> None:
        """Initialize shared figure data and axis definitions."""
        self._name = self.__class__.__name__

        # Store original dict for data extraction
        self.figure = figure
        self.data = figure["data"]
        self.num_axes = num_axes
        self.options = options
        self.warnings = []

        # Extract axis data from the dict first
        dat = figure["data"][0]
        self.x_axis = _extract_axis_data(dat, "x")
        self.y_axis = _extract_axis_data(dat, "y")

        # Extract labels and title from the dict
        self.x_label = figure["layout"]["xaxis"]["title"]["text"]
        self.y_label = figure["layout"]["yaxis"]["title"]["text"]
        self.x_definition = axis_definition_from_figure(figure, "x")
        self.y_definition = axis_definition_from_figure(figure, "y")
        # Handle title that might be a string or a dict with 'text' key
        title_obj = figure["layout"].get("title", "")
        if isinstance(title_obj, dict):
            self.title = title_obj.get("text", "")
        else:
            self.title = str(title_obj) if title_obj else ""
        if self.num_axes == 2:
            # Extract z-axis data for 2D plots
            self.z_axis = _extract_axis_data(dat, "z")
            # Reshape z_axis if it's a 1D array
            if self.z_axis.ndim == 1:
                # Reshape to 2D array if it's a 1D array
                self.z_axis = self.z_axis.reshape((self.y_axis.size, self.x_axis.size))
            self.z_definition = axis_definition_from_figure(figure, "z")
            self.z_label = self.z_definition["label"]

        # Convert dict to go.Figure object after extracting data
        self.new_fig = go.Figure(figure)
        # Attach semantic metadata without flattening an existing MathJax axis
        # title (for example, a derivative produced by an earlier filter).
        set_figure_axis_definition(
            self.new_fig, "x", self.x_definition, update_title=False
        )
        set_figure_axis_definition(
            self.new_fig, "y", self.y_definition, update_title=False
        )
        if self.num_axes == 2:
            set_figure_axis_definition(
                self.new_fig, "z", self.z_definition, update_title=False
            )

    def apply(self, *args, **kwargs):
        """Apply the 1D or 2D implementation and return the figure and warnings."""
        try:
            match self.num_axes:
                case 1:
                    self.apply_1d(*args)  # ignore kwargs
                case 2:
                    self.apply_2d(*args, **kwargs)
                case _:
                    logger.error(
                        f"Filtering not supported for {self.num_axes}D plots. Only 1D and 2D plots are supported."
                    )
                    raise NotImplementedError(
                        f"Filtering not supported for {self.num_axes}D plots. Only 1D and 2D plots are supported."
                        # Re-scale the colorbar
                    )
        except (NotImplementedError, Exception) as err:
            # TODOLATER: Connect to Toast notifications
            logger.error(err, exc_info=True)

        # Convert go.Figure back to dict for API response
        return self.new_fig.to_dict(), self.warnings

    def _update_title(self, fil: str) -> None:
        """Leave the plot title unchanged; filter provenance is stored elsewhere."""
        del fil

    def _hmap_update(
        self,
        z_data: np.ndarray,
        fil: str,
        definition: dict[str, str] | None = None,
    ) -> None:
        """Replace heat-map values and rescale the color axis."""
        # Update the coloraxis properties
        self.new_fig.update_layout(
            coloraxis=dict(cmin=np.nanmin(z_data), cmax=np.nanmax(z_data))
        )
        # Update the z data for the first trace
        self.new_fig.data[0].z = z_data
        if definition is not None:
            set_figure_axis_definition(self.new_fig, "z", definition)
        self._update_title(fil)


class FlipHeatMap(Filter):
    def __init__(self, figure: dict, num_axes: int, options: dict = None) -> None:
        """Initialize a filter that negates heat-map values."""
        super().__init__(figure, num_axes, options)

    def apply_1d(self):
        """
        Not supported for 1D plots.

        """
        raise NotImplementedError("Flip  not supported for 1D plots.")

    def apply_2d(self):
        """
        Applies the flip heatmap filter to a 2D plot.

        """
        self._hmap_update(-self.z_axis, fil="Flip")


class Differentiate(Filter):
    def __init__(self, figure: dict, num_axes: int, options: dict = None) -> None:
        """Initialize numerical differentiation."""
        super().__init__(figure, num_axes, options)

    def apply_1d(self):
        """
        Applies the differentiation filter to a 1D plot.

        """
        # Update y data and y-axis label
        self.new_fig.data[0].y = np.gradient(self.y_axis, self.x_axis)
        definition = axis_definition(
            f"d{self.y_definition['label']}/d{self.x_definition['label']}",
            render_unit(
                divide_units(self.y_definition["unit"], self.x_definition["unit"])
            ),
        )
        set_figure_derivative_axis_definition(
            self.new_fig,
            "y",
            self.y_definition["label"],
            self.x_definition["label"],
            definition,
        )
        self._update_title("d")

    def apply_2d(self, twod_axis=0):
        """
        Apples the differentiation filter to a 2D plot.

        Args:
            twod_axis (int): Axis along which to differentiate

        """
        # For np.gradient with 2D data, we need to specify spacing for each axis
        # axis=0 corresponds to rows (y-direction), axis=1 corresponds to columns (x-direction)
        match twod_axis:
            case 0:
                # Differentiate along axis 0 (rows/y-direction)
                # Use y_axis spacing since axis 0 corresponds to y-direction
                z_data = np.gradient(self.z_axis, self.y_axis, axis=0)
                denominator = self.y_definition
                compact_denominator = "y"
                twod_axis_label = (
                    f"d{self.z_definition['label']}/d{denominator['label']}"
                )
            case 1:
                # Differentiate along axis 1 (columns/x-direction)
                # Use x_axis spacing since axis 1 corresponds to x-direction
                z_data = np.gradient(self.z_axis, self.x_axis, axis=1)
                denominator = self.x_definition
                compact_denominator = "x"
                twod_axis_label = (
                    f"d{self.z_definition['label']}/d{denominator['label']}"
                )
            case _:
                err = f"Invalid value of `twod_axis={twod_axis}` for differentiation."
                logger.error(err)
                raise ValueError(err)

        # Update the figure
        definition = axis_definition(
            twod_axis_label,
            render_unit(divide_units(self.z_definition["unit"], denominator["unit"])),
        )
        self._hmap_update(z_data, fil=twod_axis_label)
        set_figure_derivative_axis_definition(
            self.new_fig,
            "z",
            self.z_definition["label"],
            denominator["label"],
            definition,
            compact=True,
            compact_denominator=compact_denominator,
        )


class Scale(Filter):
    """Apply a user-requested scalar or quantity transformation to Y/Z."""

    def __init__(self, figure: dict, num_axes: int, options: dict = None) -> None:
        super().__init__(figure, num_axes, options)
        self.operation = _safe_init(options, "operation", "multiply")
        self.factor = float(_safe_init(options, "factor", 1.0))
        self.factor_unit = str(_safe_init(options, "factor_unit", "") or "")
        self.result_unit = str(_safe_init(options, "result_unit", "") or "")
        self.result_label = str(_safe_init(options, "result_label", "") or "")

    def _transform(self, values: np.ndarray, definition: dict[str, str]):
        operation = self.operation
        if operation == "inverse":
            transformed = np.reciprocal(values.astype(float))
            inferred = inverse_unit(definition["unit"])
            label = f"1/{definition['label']}"
        elif operation == "multiply":
            transformed = values * self.factor
            inferred = multiply_units(definition["unit"], self.factor_unit)
            label = definition["label"]
        elif operation in SCALE_QUANTITIES:
            # Quantity scales express the data *in units of* the constant, so
            # they divide: a conductance in S over G0 (S) is dimensionless.
            quantity = SCALE_QUANTITIES[operation]
            transformed = values / float(quantity["value"])
            inferred = divide_units(definition["unit"], str(quantity["unit"]))
            label = (
                f"{self.result_label or definition['label']}"
                f"{scale_quantity_label_suffix(quantity['expression'])}"
            )
        else:
            raise ValueError(f"Unsupported scale operation: {operation}")

        if inferred.is_dimensionless and not math.isclose(inferred.scale, 1.0):
            transformed = transformed * inferred.scale
            inferred = Unit()
        unit = self.result_unit or render_unit(inferred)
        result_label = (
            label if operation in SCALE_QUANTITIES else self.result_label or label
        )
        return transformed, axis_definition(result_label, unit)

    def _set_axis_definition(self, axis: str, definition: dict[str, str]) -> None:
        template = axis_title_template_from_figure(self.new_fig, axis)
        if (
            not self.result_label
            and template is not None
            and template.get("kind") == "derivative"
        ):
            numerator = template.get("numerator_label", "Y")
            denominator = template.get("denominator_label", "X")
            if self.operation == "inverse":
                numerator, denominator = denominator, numerator
            set_figure_derivative_axis_definition(
                self.new_fig,
                axis,
                numerator,
                denominator,
                definition,
                compact=bool(template.get("compact", False)),
                compact_denominator=str(template.get("compact_denominator", "x")),
            )
            return
        set_figure_axis_definition(self.new_fig, axis, definition)

    def apply_1d(self):
        values, definition = self._transform(self.y_axis, self.y_definition)
        self.new_fig.data[0].y = values
        self._set_axis_definition("y", definition)

    def apply_2d(self):
        values, definition = self._transform(self.z_axis, self.z_definition)
        self._hmap_update(values, fil="Scale")
        self._set_axis_definition("z", definition)


class Smooth(Filter):
    def __init__(self, figure: dict, num_axes: int, options: dict = None) -> None:
        """Initialize Savitzky-Golay smoothing."""
        super().__init__(figure, num_axes, options)
        self.window = _safe_init(options, "window", DEFAULT_SAVGOL_OPTS["window"])
        self.polyorder = _safe_init(
            options, "polyorder", DEFAULT_SAVGOL_OPTS["polyorder"]
        )
        self.smooth_axis = _safe_init(options, "axis", DEFAULT_SAVGOL_OPTS["axis"])
        self.deriv = _safe_init(options, "deriv", DEFAULT_SAVGOL_OPTS["deriv"])
        self.mode = _safe_init(options, "mode", DEFAULT_SAVGOL_OPTS["mode"])
        self.cval = _safe_init(options, "cval", DEFAULT_SAVGOL_OPTS["cval"])
        self.delta = _safe_init(options, "delta", DEFAULT_SAVGOL_OPTS["delta"])

    def _fill_nans(self, data, axis=-1):
        if not np.any(np.isnan(data)) and not np.any(np.isinf(data)):
            return data

        data = np.copy(data)
        # Convert infs to nans for interpolation
        data[np.isinf(data)] = np.nan

        warning_text = "Interpolated missing data for Smoothing"
        if warning_text not in self.warnings:
            self.warnings.append(warning_text)

        def _fill_1d(arr):
            nans = np.isnan(arr)
            if not np.any(nans):
                return arr
            if np.all(nans):
                return np.zeros_like(arr)

            def nonzero_indices(values):
                return values.nonzero()[0]

            arr[nans] = np.interp(
                nonzero_indices(nans), nonzero_indices(~nans), arr[~nans]
            )
            return arr

        if data.ndim == 1:
            return _fill_1d(data)
        else:
            return np.apply_along_axis(_fill_1d, axis, data)

    def apply_1d(self):
        """
        Applies the smoothing filter to a 1D plot.

        """
        # Ensure window size doesn't exceed data length
        data_length = len(self.y_axis)
        safe_window = min(self.window, data_length)
        if safe_window % 2 == 0:
            safe_window -= 1  # Make it odd
        if safe_window < 3:
            safe_window = 3 if data_length >= 3 else data_length

        # Ensure polyorder is less than window length
        safe_polyorder = min(self.polyorder, safe_window - 1)

        # Log warnings if values were adjusted
        if safe_window != self.window:
            logger.warning(
                f"1D Smooth: Window size adjusted from {self.window} to {safe_window} (data has {data_length} points)"
            )
        if safe_polyorder != self.polyorder:
            logger.warning(
                f"1D Smooth: Polyorder adjusted from {self.polyorder} to {safe_polyorder}"
            )

        logger.debug(
            f"1D Smooth: Original window={self.window}, safe_window={safe_window}, polyorder={safe_polyorder}"
        )

        clean_y = self._fill_nans(self.y_axis)

        self.new_fig.data[0].y = savgol_filter(
            clean_y,
            window_length=safe_window,
            polyorder=safe_polyorder,
            deriv=self.deriv,
            delta=self.delta,
            mode=self.mode,
            cval=self.cval,
        )
        self._update_title("Sm")

    def apply_2d(self):
        """
        Applies the smoothing filter to a 2D plot.

        """
        logger.debug(
            f"Applying Smooth Filter (SavGol) with window={self.window}, polyorder={self.polyorder}, axis={self.smooth_axis}..."
        )

        def _get_safe_window_size(data_shape, axis, window_size):
            """Helper function to get a safe window size that doesn't exceed data dimensions."""
            if axis < len(data_shape):
                max_size = data_shape[axis]
                # Ensure window size is odd and less than or equal to data size
                safe_window = min(window_size, max_size)
                if safe_window % 2 == 0:
                    safe_window -= 1  # Make it odd
                if safe_window < 3:
                    safe_window = 3 if max_size >= 3 else max_size

                # Log warning if window size was adjusted
                if safe_window != window_size:
                    logger.warning(
                        f"Window size adjusted from {window_size} to {safe_window} (axis {axis} has {max_size} points)"
                    )

                return safe_window
            return window_size

        if self.smooth_axis == 2:
            # Smooth along the z-axis (depth) by applying Savitzky-Golay filter twice
            # First, smooth along the x-axis (rows) and then along the y-axis (columns)

            # Get safe window sizes for both axes
            window_x = _get_safe_window_size(self.z_axis.shape, 0, self.window)
            window_y = _get_safe_window_size(self.z_axis.shape, 1, self.window)

            # Ensure polyorder is valid for both windows
            safe_polyorder_x = min(self.polyorder, window_x - 1)
            safe_polyorder_y = min(self.polyorder, window_y - 1)

            if safe_polyorder_x != self.polyorder:
                logger.warning(
                    f"2D Smooth: Polyorder adjusted from {self.polyorder} to {safe_polyorder_x} for axis 0"
                )
            if safe_polyorder_y != self.polyorder:
                logger.warning(
                    f"2D Smooth: Polyorder adjusted from {self.polyorder} to {safe_polyorder_y} for axis 1"
                )

            logger.debug(
                f"Original window: {self.window}, Safe window for axis 0: {window_x}, axis 1: {window_y}"
            )

            # Axis 2 smooths each heat-map dimension in sequence.
            clean_z = self._fill_nans(self.z_axis, axis=0)

            z_data_x = savgol_filter(
                clean_z,
                window_length=window_x,
                polyorder=safe_polyorder_x,  # Use validated polyorder
                axis=0,
                deriv=self.deriv,
                delta=self.delta,
                mode=self.mode,
                cval=self.cval,
            )
            z_data = savgol_filter(
                z_data_x,
                window_length=window_y,
                polyorder=safe_polyorder_y,  # Use validated polyorder
                axis=1,
                deriv=self.deriv,
                delta=self.delta,
                mode=self.mode,
                cval=self.cval,
            )
        else:
            # Get safe window size for the specified axis
            safe_window = _get_safe_window_size(
                self.z_axis.shape, self.smooth_axis, self.window
            )
            safe_polyorder = min(self.polyorder, safe_window - 1)

            if safe_polyorder != self.polyorder:
                logger.warning(
                    f"2D Smooth: Polyorder adjusted from {self.polyorder} to {safe_polyorder} for axis {self.smooth_axis}"
                )

            logger.debug(
                f"Original window: {self.window}, Safe window for axis {self.smooth_axis}: {safe_window}"
            )

            clean_z = self._fill_nans(self.z_axis, axis=self.smooth_axis)

            z_data = savgol_filter(
                clean_z,
                window_length=safe_window,
                polyorder=safe_polyorder,  # Use validated polyorder
                axis=self.smooth_axis,
                deriv=self.deriv,
                delta=self.delta,
                mode=self.mode,
                cval=self.cval,
            )

        axis_label = "z"
        if self.smooth_axis == 0:
            axis_label = "x"
        elif self.smooth_axis == 1:
            axis_label = "y"

        # Update the figure
        self._hmap_update(z_data, fil=f"Sm({axis_label})")


class SimpleMovingAverage(Filter):
    def __init__(self, figure: dict, num_axes: int, options: dict = None) -> None:
        """
        Initialize a same-length simple moving average.
        # NOTE: Output length is same as the input length because of `mode="same"` in `np.convolve()`

        """
        super().__init__(figure, num_axes, options)
        self.window = _safe_init(options, "window", DEFAULT_SMA_WINDOW)

    def apply_1d(self):
        """
        Applies the simple moving average filter to a 1D plot.

        """
        logger.debug(f"{self.y_axis=}")

        # Ensure window size doesn't exceed data length
        data_length = len(self.y_axis)
        safe_window = min(self.window, data_length)

        if safe_window != self.window:
            logger.warning(
                f"SMA: Window size adjusted from {self.window} to {safe_window} (data has {data_length} points)"
            )

        logger.debug(
            f"SMA: Original window={self.window}, safe_window={safe_window}, data_length={data_length}"
        )

        self.new_fig.data[0].y = np.convolve(
            self.y_axis, np.ones(safe_window) / safe_window, mode="same"
        )
        self._update_title("SMA")

    def apply_2d(self):
        """
        Not supported for 2D plots.

        """
        raise NotImplementedError("Simple Moving Average not supported for 2D plots.")


class Normalize(Filter):
    def __init__(self, figure: dict, num_axes: int, options: dict = None) -> None:
        """Initialize normalization along the selected axis."""
        super().__init__(figure, num_axes, options)
        # str: "x" or "y" or "z"
        self.axis = _safe_init(options, "axis", DEFAULT_NORM_AXIS)

    def apply_1d(self):
        """
        Applies the normalization filter to a 1D plot.

        """
        self.new_fig.data[0].y = self.y_axis / np.nanmax(np.abs(self.y_axis))
        self._update_title("Norm")

    def apply_2d(self):
        """
        Applies the normalization filter to a 2D plot.

        """
        logger.debug(f"Normalizing 2D plot along axis `{self.axis}`.")

        match self.axis:
            case "z":
                z_data = self.z_axis / np.nanmax(np.abs(self.z_axis))
            # NOTE: [i, j] = [row, col] = [y, x]
            case "x":
                # Normalize each column (along x-axis)
                z_data = self.z_axis / np.nanmax(np.abs(self.z_axis), axis=0)
            case "y":
                # Normalize each row (along y-axis)
                z_data = (
                    self.z_axis
                    / np.nanmax(np.abs(self.z_axis), axis=1)[..., np.newaxis]
                )
            case _:
                err = f"Invalid value of `axis={self.axis}` for normalization."
                logger.error(err)

        # Update the figure
        self._hmap_update(z_data, fil=f"Norm({self.axis})")


class GammaCorrection(Filter):
    def __init__(self, figure: dict, num_axes: int, options: dict = None) -> None:
        """Gamma Correction Filter. Uses `skimage.exposure.adjust_gamma()`."""
        super().__init__(figure, num_axes, options)
        logger.debug(f"GammaCorrection | options: {options}")
        self.gamma = _safe_init(options, "gamma", DEFAULT_GC_OPTS["gamma"])
        self.gain = _safe_init(options, "gain", DEFAULT_GC_OPTS["gain"])

    def apply_1d(self):
        """
        Not supported for 1D plots.

        """
        raise NotImplementedError("Gamma Correction not supported for 1D plots.")

    def apply_2d(self):
        """
        Applies the gamma correction filter to a 2D plot.

        """
        logger.debug(
            f"Applying Gamma Correction with gamma={self.gamma}, gain={self.gain}..."
        )

        try:
            # Check if data has negative values
            if np.any(self.z_axis < 0):
                logger.warning(
                    "Gamma Correction: Data contains negative values. "
                    "Rescaling intensity to non-negative range for proper gamma correction."
                )
                # Rescale data to non-negative range first
                rescaled_data = exposure.rescale_intensity(
                    self.z_axis, out_range=(0, 1)
                )
                z_data = exposure.adjust_gamma(rescaled_data, self.gamma, self.gain)
            else:
                z_data = exposure.adjust_gamma(self.z_axis, self.gamma, self.gain)

            # Update the figure
            self._hmap_update(z_data, fil="γC")

        except Exception as e:
            logger.error(f"Failed to apply Gamma Correction: {e}")
            raise ValueError(f"Gamma Correction failed: {str(e)}")


class LogCorrection(Filter):
    def __init__(self, figure: dict, num_axes: int, options: dict = None) -> None:
        """Initialize logarithmic correction. Uses `skimage.exposure.adjust_log()`."""
        super().__init__(figure, num_axes, options)
        self.gain = _safe_init(options, "gain", DEFAULT_LC_OPTS["gain"])
        self.inv = _safe_init(options, "inv", DEFAULT_LC_OPTS["inv"])

    def apply_1d(self):
        """
        Not supported for 1D plots.

        """
        raise NotImplementedError("Logarithmic Correction not supported for 1D plots.")

    def apply_2d(self):
        """
        Applies the logarithmic correction filter to a 2D plot.

        """
        logger.debug(
            f"Applying Logarithmic Correction with gain={self.gain}, inv={self.inv}..."
        )

        try:
            # Check if data has negative values
            if np.any(self.z_axis < 0):
                logger.warning(
                    "Logarithmic Correction: Data contains negative values. "
                    "Rescaling intensity to non-negative range for proper log correction."
                )
                # Rescale data to non-negative range first
                rescaled_data = exposure.rescale_intensity(
                    self.z_axis, out_range=(0, 1)
                )
                z_data = exposure.adjust_log(
                    rescaled_data, gain=self.gain, inv=self.inv
                )
            else:
                z_data = exposure.adjust_log(self.z_axis, gain=self.gain, inv=self.inv)

            # Update the figure
            self._hmap_update(z_data, fil="logC")

        except Exception as e:
            logger.error(f"Failed to apply Logarithmic Correction: {e}")
            raise ValueError(f"Logarithmic Correction failed: {str(e)}")


class SigmoidCorrection(Filter):
    def __init__(self, figure: dict, num_axes: int, options: dict = None) -> None:
        """Initialize sigmoid correction. Uses `skimage.exposure.adjust_sigmoid()`."""
        super().__init__(figure, num_axes, options)
        self.cutoff = _safe_init(options, "cutoff", DEFAULT_SC_OPTS["cutoff"])
        self.gain = _safe_init(options, "gain", DEFAULT_SC_OPTS["gain"])

    def apply_1d(self):
        """
        Not supported for 1D plots.

        """
        raise NotImplementedError("Sigmoid Correction not supported for 1D plots.")

    def apply_2d(self):
        """
        Applies the sigmoid correction filter to a 2D plot.

        """
        logger.debug(
            f"Applying Sigmoid Correction with cutoff={self.cutoff}, gain={self.gain}..."
        )

        try:
            # Check if data has negative values
            if np.any(self.z_axis < 0):
                logger.warning(
                    "Sigmoid Correction: Data contains negative values. "
                    "Rescaling intensity to non-negative range for proper sigmoid correction."
                )
                # Rescale data to non-negative range first
                rescaled_data = exposure.rescale_intensity(
                    self.z_axis, out_range=(0, 1)
                )
                z_data = exposure.adjust_sigmoid(
                    rescaled_data, cutoff=self.cutoff, gain=self.gain
                )
            else:
                z_data = exposure.adjust_sigmoid(
                    self.z_axis, cutoff=self.cutoff, gain=self.gain
                )

            # Update the figure
            self._hmap_update(z_data, fil="σC")

        except Exception as e:
            logger.error(f"Failed to apply Sigmoid Correction: {e}")
            raise ValueError(f"Sigmoid Correction failed: {str(e)}")


class RescaleIntensity(Filter):
    def __init__(self, figure: dict, num_axes: int, options: dict = None) -> None:
        """Initialize min-max intensity rescaling. Uses `skimage.exposure.rescale_intensity()`."""
        super().__init__(figure, num_axes, options)
        self.in_range = _safe_init(options, "in_range", DEFAULT_RI_OPTS["in_range"])

    def apply_1d(self):
        """
        Not supported for 1D plots.

        """
        raise NotImplementedError("Rescale Intensity not supported for 1D plots.")

    def apply_2d(self):
        """
        Applies the rescale intensity filter to a 2D plot. Uses the min-max scaling method.
        # TODOLATER: Can allow specifying the range to scale to.
        # See: https://scikit-image.org/docs/stable/api/skimage.exposure.html#skimage.exposure.rescale_intensity

        """
        logger.debug("Applying Rescale Intensity...")
        z_data = exposure.rescale_intensity(self.z_axis)

        # Update the figure
        self._hmap_update(z_data, fil="ReC")


class LogScale(Filter):
    def __init__(self, figure: dict, num_axes: int, options: dict = None) -> None:
        """Initialize natural-log scaling."""
        super().__init__(figure, num_axes, options)

    def apply_1d(self):
        """
        Applies the logarithmic scaling filter to a 1D plot.

        """
        self.new_fig.data[0].y = np.log(self.y_axis)
        self._update_title("log")

    def apply_2d(self):
        """
        Applies the logarithmic scaling filter to a 2D plot.

        """
        self._hmap_update(np.log(self.z_axis), fil="log")


class PolyFit(Filter):
    def __init__(self, figure: dict, num_axes: int, options: dict = None) -> None:
        """Initialize polynomial fitting. Uses `numpy.polynomial.polynomial.Polynomial.fit()`."""
        super().__init__(figure, num_axes, options)
        self.deg = _safe_init(options, "deg", DEFAULT_POLYFIT_OPTS["deg"])
        self.window = _safe_init(options, "window", DEFAULT_POLYFIT_OPTS["window"])

    def apply_1d(self):
        """
        Applies the polynomial fitting filter to a 1D plot.

        """
        self.new_fig.update_layout(showlegend=False)

        # Fit the data to a polynomial
        poly = Polynomial.fit(
            self.x_axis,
            self.y_axis,
            deg=self.deg,
            window=self.window,
        )
        fit_line = poly(self.x_axis)
        current_meta = dict(self.new_fig.layout.meta or {})
        current_meta[POLYFIT_META_KEY] = {
            "coefficients": _physical_polynomial_coefficients(poly),
            "engineering": _pprint_poly(poly, "engineering"),
        }
        self.new_fig.update_layout(meta=current_meta)

        # Add the fit line to the plot
        self.new_fig.add_trace(
            go.Scatter(
                x=self.x_axis,
                y=fit_line,
                mode="lines",
                # TODOLATER: @s.anupam Standardize the color scheme & name etc.
                line=dict(color="rebeccapurple", width=2),
                # TODOLATER: Add to legend if needed. CUrrently hidden.
                showlegend=False,
                name=f"Fit (deg={self.deg})",
            )
        )

        # Add the fitted equation.
        self.new_fig.add_annotation(
            # Center
            x=0.95,
            y=0.95,
            xref="paper",
            yref="paper",
            name=POLYFIT_ANNOTATION_NAME,
            text=current_meta[POLYFIT_META_KEY]["engineering"],
            showarrow=False,
            font=dict(size=16, color="rebeccapurple"),
            bgcolor="white",
        )

    def apply_2d(self):
        """
        Not supported for 2D plots.

        """
        raise NotImplementedError("Polynomial Fitting not supported for 2D plots.")


class BackgroundCorrection(Filter):
    def __init__(self, figure: dict, num_axes: int, options: dict = None) -> None:
        """Initialize background correction from selected points."""
        super().__init__(figure, num_axes, options)
        self.mode = _safe_init(options, "mode", "constant")
        self.points = _safe_init(options, "points", [])

    def apply_1d(self):
        """
        Applies the background correction filter to a 1D plot.

        """
        if not self.points:
            logger.warning("Background Correction: No points provided.")
            return

        if self.mode == "constant":
            # Use the y-value of the first point as a baseline
            baseline = self.points[0]["y"]
            logger.debug(
                f"Applying constant background correction with value: {baseline}"
            )
            self.new_fig.data[0].y = self.y_axis - baseline
            self._update_title("BG(C)")

        elif self.mode == "linear":
            if len(self.points) < 2:
                logger.warning("Background Correction: Linear mode requires 2 points.")
                return

            p1, p2 = self.points[0], self.points[1]
            x1, y1 = p1["x"], p1["y"]
            x2, y2 = p2["x"], p2["y"]

            if x2 == x1:
                logger.warning(
                    "Background Correction: Linear mode points have same x value."
                )
                m = 0
            else:
                m = (y2 - y1) / (x2 - x1)
            c = y1 - m * x1

            logger.debug(f"Applying linear background correction: y = {m}x + {c}")
            baseline = m * self.x_axis + c
            self.new_fig.data[0].y = self.y_axis - baseline
            self._update_title("BG(L)")

        else:
            logger.error(f"Unknown background correction mode: {self.mode}")
            return

    def apply_2d(self):
        """Subtract a constant, row/column mean, or three-point plane."""
        if not self.points:
            logger.warning("Background Correction 2D: No points provided.")
            return

        z_data = self.z_axis.copy()

        if self.mode == "constant":
            baseline = self.points[0].get("z", 0)
            logger.debug(f"Applying 2D constant BG subtraction: {baseline}")
            z_data = z_data - baseline
            fil_name = "BG(C)"

        elif self.mode == "row_mean":
            # Assume points[0] has 'y' or 'row' index
            # In Plotly heatmaps, y usually maps to row index
            row_idx = self.points[0].get("row_idx")
            if row_idx is None:
                # Fallback: try to find index from y-value
                y_val = self.points[0].get("y")
                row_idx = np.abs(self.y_axis - y_val).argmin()
            logger.debug(f"Applying 2D row mean BG subtraction for row: {row_idx}")
            row_mean = np.nanmean(z_data[row_idx, :])
            z_data = z_data - row_mean
            fil_name = "BG(RM)"

        elif self.mode == "col_mean":
            # Assume points[0] has 'x' or 'col' index
            col_idx = self.points[0].get("col_idx")
            if col_idx is None:
                x_val = self.points[0].get("x")
                col_idx = np.abs(self.x_axis - x_val).argmin()
            logger.debug(
                f"Applying 2D column mean BG subtraction for column: {col_idx}"
            )
            col_mean = np.nanmean(z_data[:, col_idx])
            z_data = z_data - col_mean
            fil_name = "BG(CM)"

        elif self.mode == "plane":
            if len(self.points) < 3:
                logger.warning(
                    "Background Correction 2D: Plane mode requires 3 points."
                )
                return

            # Extract points
            p1, p2, p3 = self.points[:3]
            x_pts = np.array([p1["x"], p2["x"], p3["x"]])
            y_pts = np.array([p1["y"], p2["y"], p3["y"]])
            z_pts = np.array([p1["z"], p2["z"], p3["z"]])

            # Solve for plane z = Ax + By + C
            # Matrix M = [x y 1]
            M = np.column_stack((x_pts, y_pts, np.ones(3)))
            try:
                A, B, C = np.linalg.solve(M, z_pts)
                logger.debug(f"Applying 2D plane BG subtraction: z = {A}x + {B}y + {C}")

                # Create meshgrid for entire heatmap
                X, Y = np.meshgrid(self.x_axis, self.y_axis)
                plane = A * X + B * Y + C
                z_data = z_data - plane
                fil_name = "BG(P)"
            except np.linalg.LinAlgError:
                logger.error(
                    "Background Correction 2D: Points are collinear, cannot fit plane."
                )
                return
        else:
            logger.error(f"Unknown 2D background correction mode: {self.mode}")
            return

        self._hmap_update(z_data, fil_name)


def _tex_name(label: str) -> str:
    # Fall back to the TeX axis title when unit metadata is absent.
    if len(label) > 1 and label.startswith("$") and label.endswith("$"):
        return "{" + label[1:-1] + "}"
    escaped = latex_text(label).replace(" ", r"\ ")
    return rf"\mathrm{{{escaped}}}"


def _signed(value: float) -> str:
    return f"- {abs(value):.3g}" if value < 0 else f"+ {value:.3g}"


ROTATION_META_KEY = "qimchi_rotation"


def _axis_values(axis) -> np.ndarray:
    """Return numeric axis values, falling back to positional indices."""
    try:
        return np.asarray(axis, dtype=float).reshape(-1)
    except (TypeError, ValueError):
        return np.arange(np.size(axis), dtype=float)


def _centre_and_step(values: np.ndarray) -> tuple[float, float]:
    """Return an axis's midpoint value and average step."""
    n = values.size
    if n == 0:
        return 0.0, 1.0
    centre = float(np.interp((n - 1) / 2, np.arange(n), values))
    step = float(values[-1] - values[0]) / (n - 1) if n > 1 else 0.0
    return centre, step if np.isfinite(step) and step != 0 else 1.0


class RotateHeatMap(Filter):
    def __init__(self, figure: dict, num_axes: int, options: dict = None) -> None:
        """Initialize heat-map rotation."""
        super().__init__(figure, num_axes, options)
        self.angle = _safe_init(options, "angle", DEFAULT_ROTA_OPTS["angle"])

    def apply_1d(self):
        """
        Not supported for 1D plots.

        """
        raise NotImplementedError("Rotate HeatMap not supported for 1D plots.")

    def apply_2d(self):
        """
        Applies the rotate heatmap filter to a 2D plot.

        """
        logger.debug(f"Rotating HeatMap by {self.angle} degrees...")

        # Translate the data to the origin and then rotate
        z_data = self.z_axis

        # Rotation matrix
        angle_rad = np.deg2rad(self.angle)
        c, s = np.cos(angle_rad), np.sin(angle_rad)
        rota_mat = np.array([[c, s], [-s, c]])

        # New bounding box after rotation to prevent cropping
        # Thanks: rotate():https://github.com/scipy/scipy/blob/v1.14.1/scipy/ndimage/_interpolation.py#L865-L1001
        img_shape = np.asarray(z_data.shape)
        iy, ix = img_shape
        out_bounds = rota_mat @ [[0, 0, iy, iy], [0, ix, 0, ix]]

        # Shape of the transformed input plane
        out_plane_shape = (np.ptp(out_bounds, axis=1) + 0.5).astype(int)

        # Final output center after rotation
        out_center = rota_mat @ ((out_plane_shape - 1) / 2)
        in_center = (img_shape - 1) / 2
        final_offset = in_center - out_center

        # Use affine_transform to apply the rotation with the calculated offset and output shape
        z_rotated = affine_transform(
            z_data,
            rota_mat,
            offset=final_offset,
            output_shape=tuple(out_plane_shape),
            order=0,  # Nearest neighbor interpolation
            mode="constant",
            cval=np.nan,  # Empty space with np.nan (white)
            prefilter=False,
        )
        # Rotate about the input center while preserving axis spacing.
        x_values = _axis_values(self.x_axis)
        y_values = _axis_values(self.y_axis)
        x_centre, dx = _centre_and_step(x_values)
        y_centre, dy = _centre_and_step(y_values)
        n_rows, n_cols = (int(n) for n in out_plane_shape)
        columns = x_centre + dx * (np.arange(n_cols) - (n_cols - 1) / 2)
        rows = y_centre + dy * (np.arange(n_rows) - (n_rows - 1) / 2)
        self.new_fig.data[0].x = columns
        self.new_fig.data[0].y = rows

        # Build replacement titles from plain labels rather than existing TeX.
        x_name = _tex_name(self.x_definition["label"])
        y_name = _tex_name(self.y_definition["label"])
        unit = ""
        if self.x_definition["unit"] == self.y_definition["unit"]:
            latex_unit = render_unit(self.x_definition["unit"], latex=True)
            unit = rf"\;\left({latex_unit}\right)" if latex_unit else ""
        angle = rf"\;({self.angle}^{{\circ}})"
        self.new_fig["layout"]["xaxis"]["title"]["text"] = (
            rf"${c:.3g}\,{x_name} {_signed(s * dx / dy)}\,{y_name}{unit}{angle}$"
        )
        self.new_fig["layout"]["yaxis"]["title"]["text"] = (
            rf"${-s * dy / dx:.3g}\,{x_name} {_signed(c)}\,{y_name}{unit}{angle}$"
        )

        # Persist the titles so the page does not restore the unswapped values.
        meta = dict(self.new_fig.layout.meta or {})
        definitions = dict(meta.get(UNIT_META_KEY, {}))
        for axis in ("x", "y"):
            if isinstance(definitions.get(axis), dict):
                definitions[axis] = {
                    key: value
                    for key, value in definitions[axis].items()
                    if key not in ("engineering_titles", TITLE_TEMPLATE_KEY)
                }
        if definitions:
            meta[UNIT_META_KEY] = definitions
        # Store the inverse coordinate transform used by LineCut:
        # source index = matrix @ rotated index + offset.
        meta[ROTATION_META_KEY] = {
            "matrix": rota_mat.tolist(),
            "offset": [float(v) for v in final_offset],
            "columns": {"start": float(columns[0]), "step": dx},
            "rows": {"start": float(rows[0]), "step": dy},
            "x": x_values.tolist(),
            "y": y_values.tolist(),
        }
        self.new_fig.update_layout(meta=meta)

        # Update the figure
        self._hmap_update(z_rotated, fil=f"Rot({self.angle}°)")


class RInCorrection(Filter):
    def __init__(self, figure: dict, num_axes: int, options: dict = None) -> None:
        """
        Correct inline-resistor voltage drop and resample onto a shared grid.


        Uses ``V_S = V_b - I * R_in``, with the heat-map values as current. Each
        sweep is resampled to a shared V_S grid; out-of-range values remain empty.
        """

        super().__init__(figure, num_axes, options)
        defaults = DEFAULT_R_IN_CORRECTION_OPTS
        self.r_in = float(_safe_init(options, "r_in", defaults["r_in"]) or 0.0)
        self.r_in_unit = str(_safe_init(options, "r_in_unit", defaults["r_in_unit"]))
        self.bias_axis = str(_safe_init(options, "bias_axis", defaults["bias_axis"]))

    def apply_1d(self):
        raise NotImplementedError("R_in correction is only available for heat maps.")

    def apply_2d(self):
        along_x = self.bias_axis != "y"
        bias = _axis_values(self.x_axis if along_x else self.y_axis)
        definition = self.x_definition if along_x else self.y_definition

        # Normalize bias sweeps to rows for resampling.
        current = np.asarray(self.z_axis, dtype=float)
        lines = current if along_x else current.T

        bias_scale = parse_unit(definition["unit"]).scale or 1.0
        current_scale = parse_unit(self.z_definition["unit"]).scale or 1.0
        ohms = self.r_in * _RESISTANCE_UNITS.get(self.r_in_unit, 1.0)
        drop = lines * current_scale * ohms / bias_scale
        sample_bias = bias[np.newaxis, :] - drop

        finite = np.isfinite(sample_bias) & np.isfinite(lines)
        if not finite.any():
            raise ValueError("R_in correction needs measured points.")

        grid = np.linspace(
            np.min(sample_bias[finite]), np.max(sample_bias[finite]), bias.size
        )
        resampled = np.full((lines.shape[0], grid.size), np.nan)
        for index, (line_bias, line_values, keep) in enumerate(
            zip(sample_bias, lines, finite)
        ):
            if keep.sum() < 2:
                continue
            order = np.argsort(line_bias[keep])
            xs = line_bias[keep][order]
            resampled[index] = np.interp(
                grid, xs, line_values[keep][order], left=np.nan, right=np.nan
            )

        z_data = resampled if along_x else resampled.T
        if along_x:
            self.new_fig.data[0].x = grid
        else:
            self.new_fig.data[0].y = grid
        self._hmap_update(z_data, fil="R_in correction")
        set_figure_axis_definition(
            self.new_fig,
            "x" if along_x else "y",
            axis_definition("Sample bias", definition["unit"]),
        )


# These filters require an ordered, evenly sampled x sweep.
_NEEDS_A_SWEPT_X = {
    "diff": "a derivative",
    "savgol": "smoothing",
    "sma": "a moving average",
    "polyfit": "a fit",
}


def _refused_on_a_measured_axis(fil: str, fig: dict, fig_num_axes: int) -> str | None:
    """Return why a filter cannot use the figure's measured x axis."""
    if fig_num_axes != 1 or fil not in _NEEDS_A_SWEPT_X:
        return None
    if not figure_axis_is_dependent(fig, "x"):
        return None
    variable = (
        fig.get("layout", {})
        .get("meta", {})
        .get("qimchi_axes", {})
        .get("x", {})
        .get("variable", "the x axis")
    )
    return (
        f"{_NEEDS_A_SWEPT_X[fil].capitalize()} needs a swept x axis, and "
        f"'{variable}' is measured data -- the filter was skipped"
    )


def apply_filters(
    filters_order: list,
    filters_opts: dict,
    fig: dict,
    fig_num_axes: int,
) -> dict:
    """
    Apply the requested filters to a figure in order.

    Args:
        filters_order (list): List of filters to apply, in order.
        filters_opts (dict): Dict of filters to apply, with corresponding options.
        fig (dict): Dict representation of a Figure object to apply filters to.
        fig_num_axes (int): Number of axes in the figure. Only to tell the LinePlot and HeatMap apart.

    Returns:
        dict: Filtered figure dict.

    """
    logger.info(f"apply_filters called with filters_order: {filters_order}")
    logger.info(f"apply_filters filters_opts: {filters_opts}")

    filt_fig = None
    if filt_fig is None and not filters_order:
        # If no filters were applied, return the original figure
        logger.debug("No filters were applied.")
        return fig

    fig_tmp = deepcopy(fig)
    all_warnings = []
    for fil in filters_order:
        refusal = _refused_on_a_measured_axis(fil, fig, fig_num_axes)
        if refusal:
            logger.info("apply_filters | %s", refusal)
            all_warnings.append(refusal)
            continue

        # `filter_opts` is a nested dict. Get the required dict and then pass it
        opts = filters_opts[fil]
        logger.debug(f"apply_filters | Filter: {fil} | Options: {opts}")
        match fil:
            case "flip":
                logger.debug("apply_filters | Applying `Flip` filter...")
                filt_obj = FlipHeatMap(fig_tmp, fig_num_axes, opts)
                filt_fig, filter_warnings = filt_obj.apply()
                all_warnings.extend(filter_warnings)

            case "diff":
                logger.debug("apply_filters | Applying `Differentiate` (1D) filter...")
                filt_obj = Differentiate(fig_tmp, fig_num_axes, opts)
                filt_fig, filter_warnings = filt_obj.apply()
                all_warnings.extend(filter_warnings)
            case "diff_x":
                logger.debug(
                    "apply_filters | Applying `Differentiate` (2D - x) filter..."
                )
                filt_obj = Differentiate(fig_tmp, fig_num_axes, opts)
                filt_fig, filter_warnings = filt_obj.apply(twod_axis=0)
                all_warnings.extend(filter_warnings)
            case "diff_y":
                logger.debug(
                    "apply_filters | Applying `Differentiate` (2D - y) filter..."
                )
                filt_obj = Differentiate(fig_tmp, fig_num_axes, opts)
                filt_fig, filter_warnings = filt_obj.apply(twod_axis=1)
                all_warnings.extend(filter_warnings)

            case "transform":
                logger.debug("apply_filters | Applying user scale...")
                filt_obj = Scale(fig_tmp, fig_num_axes, opts)
                filt_fig, filter_warnings = filt_obj.apply()
                all_warnings.extend(filter_warnings)

            case "savgol":
                logger.debug("apply_filters | Applying `Smooth` filter...")
                filt_obj = Smooth(fig_tmp, fig_num_axes, opts)
                filt_fig, filter_warnings = filt_obj.apply()
                all_warnings.extend(filter_warnings)

            case "sma":
                logger.debug(
                    "apply_filters | Applying `Simple Moving Average` filter..."
                )
                filt_obj = SimpleMovingAverage(fig_tmp, fig_num_axes, opts)
                filt_fig, filter_warnings = filt_obj.apply()
                all_warnings.extend(filter_warnings)

            case "normalize":
                logger.debug("apply_filters | Applying `Normalize` filter...")
                filt_obj = Normalize(fig_tmp, fig_num_axes, opts)
                filt_fig, filter_warnings = filt_obj.apply()
                all_warnings.extend(filter_warnings)

            case "gamma_corr":
                logger.debug("apply_filters | Applying `Gamma Correction` filter...")
                filt_obj = GammaCorrection(fig_tmp, fig_num_axes, opts)
                filt_fig, filter_warnings = filt_obj.apply()
                all_warnings.extend(filter_warnings)

            case "log_corr":
                logger.debug(
                    "apply_filters | Applying `Logarithmic Correction` filter..."
                )
                filt_obj = LogCorrection(fig_tmp, fig_num_axes, opts)
                filt_fig, filter_warnings = filt_obj.apply()
                all_warnings.extend(filter_warnings)

            case "sig_corr":
                logger.debug("apply_filters | Applying `Sigmoid Correction` filter...")
                filt_obj = SigmoidCorrection(fig_tmp, fig_num_axes, opts)
                filt_fig, filter_warnings = filt_obj.apply()
                all_warnings.extend(filter_warnings)

            case "rescale_intensity":
                logger.debug("apply_filters | Applying `Rescale Intensity` filter...")
                filt_obj = RescaleIntensity(fig_tmp, fig_num_axes, opts)
                filt_fig, filter_warnings = filt_obj.apply()
                all_warnings.extend(filter_warnings)

            case "log_scale":
                logger.debug("apply_filters | Applying `Logarithmic Scaling` filter...")
                filt_obj = LogScale(fig_tmp, fig_num_axes, opts)
                filt_fig, filter_warnings = filt_obj.apply()
                all_warnings.extend(filter_warnings)

            case "r_in_correction":
                logger.debug("apply_filters | Applying `R_in Correction` filter...")
                filt_obj = RInCorrection(fig_tmp, fig_num_axes, opts)
                filt_fig, filter_warnings = filt_obj.apply()
                all_warnings.extend(filter_warnings)

            case "rotate":
                logger.debug("apply_filters | Applying `Rotate HeatMap` filter...")
                filt_obj = RotateHeatMap(fig_tmp, fig_num_axes, opts)
                filt_fig, filter_warnings = filt_obj.apply()
                all_warnings.extend(filter_warnings)

            case "polyfit":
                logger.debug("apply_filters | Applying `Polynomial Fitting` filter...")
                filt_obj = PolyFit(fig_tmp, fig_num_axes, opts)
                filt_fig, filter_warnings = filt_obj.apply()
                all_warnings.extend(filter_warnings)

            case (
                "bg_corr_constant"
                | "bg_corr_linear"
                | "bg_corr_row_mean"
                | "bg_corr_col_mean"
                | "bg_corr_plane"
            ):
                logger.debug(
                    f"apply_filters | Applying `Background Correction` filter ({fil})..."
                )
                opts["mode"] = fil.replace("bg_corr_", "")
                filt_obj = BackgroundCorrection(fig_tmp, fig_num_axes, opts)
                filt_fig, filter_warnings = filt_obj.apply()
                all_warnings.extend(filter_warnings)

            case _:
                err = f"No definition for Filter {fil} was found."
                logger.error(err)
                raise ValueError(err)

        logger.debug(f"apply_filters | {fil} applied.")
        fig_tmp = filt_fig

    # Return the original figure if every filter was refused.
    return (fig if filt_fig is None else filt_fig), list(set(all_warnings))


def _generate_plot_json_for_transform(
    *,
    fpath: str,
    indeps: list[str],
    deps: list[str],
    plot_type: str,
    slider: dict,
    filters_order: list[str],
    filters_opts: dict,
    swap_xy: bool,
    cut: dict | None = None,
) -> tuple[dict, list[str]]:
    """Generate a plot JSON from canonical plot context + transform settings."""
    from .data_loader import load_dataset_sync
    from .plots import create_heat_maps, create_line_plots

    dataset = load_dataset_sync(fpath)
    logger.debug(f"Loaded dataset with dims: {list(dataset.dims)}")

    effective_indeps = list(indeps)

    effective_filters_order = list(filters_order)
    effective_filters_opts = deepcopy(filters_opts)

    if plot_type == "LinePlot":
        plots_data = create_line_plots(
            datasets=[dataset],
            fpaths=[fpath],
            indeps=effective_indeps,
            deps=deps,
            slider=slider,
            cut=cut,
        )
    elif plot_type == "HeatMap":
        plots_data = create_heat_maps(
            datasets=[dataset],
            fpaths=[fpath],
            indeps=effective_indeps,
            deps=deps,
            slider=slider,
            swap_xy=swap_xy,
        )
    else:
        raise HTTPException(
            status_code=400, detail=f"Unsupported plot type: {plot_type}"
        )

    if not plots_data:
        raise HTTPException(status_code=500, detail="Failed to generate plot data")

    plot_json = plots_data[0]["plotJson"]

    warnings = []
    if effective_filters_order:
        num_axes = 2 if plot_type == "HeatMap" else 1
        plot_json, warnings = apply_filters(
            filters_order=effective_filters_order,
            filters_opts=effective_filters_opts,
            fig=plot_json,
            fig_num_axes=num_axes,
        )

    return plot_json, warnings


@router.post("/transform-plot", response_model=TransformPlotResponse)
async def transform_plot_endpoint(
    request: TransformPlotRequest,
) -> TransformPlotResponse:
    """Unified endpoint for plot transforms (filters + optional slider)."""
    try:
        from .plots import get_plot_context

        ctx = get_plot_context(request.plot_ref)
        if not ctx and request.context is not None:
            # Restore a released or evicted context from the client's copy.
            from .plots import register_plot_context

            ctx = request.context.model_dump(exclude_none=True)
            register_plot_context(request.plot_ref, ctx)
        if not ctx:
            raise HTTPException(status_code=404, detail="Unknown plot_ref")

        plot_json, warnings = _generate_plot_json_for_transform(
            fpath=ctx["fpath"],
            indeps=list(ctx["indeps"]),
            deps=list(ctx["deps"]),
            plot_type=str(ctx["plotType"]),
            slider=request.slider or {},
            filters_order=request.filters_order or [],
            filters_opts=request.filters_opts or {},
            swap_xy=bool(request.swap_xy),
            cut=ctx.get("cut"),
        )

        plot_json = sanitize_for_json(plot_json)

        return TransformPlotResponse(
            plot_json=plot_json, plot_ref=request.plot_ref, warnings=warnings
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error transforming plot: {str(e)}")
        logger.error(f"{e}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Failed to transform plot: {str(e)}"
        )
