"""
FastAPI endpoints for creating and managing plots based on xarray datasets.

"""

import asyncio
import hashlib
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import xarray as xr
from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool

from .data_loader import MEMORY_PROTOCOL, load_dataset_async, resolve_to_disk_path
from .diagnostics import register_gauge

# Local imports
from .figures import (
    DEFAULT_THEME,
    AxisResolutionError,
    HeatMap,
    Line,
    axis_dimension,
    sweep_dimension,
)
from .filters import apply_filters
from .json_utils import sanitize_for_json
from .logger import logger
from .models import LiveRefreshSummary, PlotRequest, PlotResponse

# FastAPI router for plot endpoints
router = APIRouter()

# Runtime plot context registry used by unified transform endpoint.
_PLOT_CONTEXTS: Dict[str, Dict] = {}
register_gauge("plot contexts", lambda: len(_PLOT_CONTEXTS))


class _UserFirst:
    """Let interactive plot requests briefly take priority over live polls."""

    def __init__(self, max_wait: float = 1.0) -> None:
        self._in_flight = 0
        self._idle = asyncio.Event()
        self._idle.set()
        self._max_wait = max_wait

    @asynccontextmanager
    async def user_request(self):
        self._in_flight += 1
        self._idle.clear()
        try:
            yield
        finally:
            self._in_flight -= 1
            if self._in_flight <= 0:
                self._in_flight = 0
                self._idle.set()

    async def wait_turn(self) -> None:
        """Wait briefly for interactive work to finish."""
        if self._idle.is_set():
            return
        try:
            await asyncio.wait_for(self._idle.wait(), timeout=self._max_wait)
        except (TimeoutError, asyncio.TimeoutError):
            logger.debug("Live poll went ahead while user work was still running")


_user_first = _UserFirst()


def _build_plot_ref(context: Dict) -> str:
    """Create a stable reference key for a plot context."""
    payload = json.dumps(context, sort_keys=True, default=str)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:24]


def register_plot_context(plot_ref: str, context: Dict) -> None:
    _PLOT_CONTEXTS[plot_ref] = context


def get_plot_context(plot_ref: str) -> Dict | None:
    return _PLOT_CONTEXTS.get(plot_ref)


def _resolve_context_fpath(
    request_fpath: str, dataset: xr.Dataset, is_live: bool
) -> str:
    """
    Resolve the canonical dataset reference for plot context/transform.

    Important for sqlite/qcodes references like `<db>#run_id=<n>`:
    we must preserve the fragment so transform/filter stays on the same run.

    Args:
        request_fpath (str): The original dataset reference from the plot request
        dataset (xr.Dataset): The loaded dataset, which may have attributes indicating source paths
        is_live (bool): Whether this dataset is from a live measurement (memory://)

    Returns:
        str: The resolved dataset reference to use in plot context and transforms

    """
    if is_live:
        return request_fpath

    source_ref = str(dataset.attrs.get("path") or request_fpath)
    actual_path = str(dataset.attrs.get("actual_path") or "")

    # Ended live datasets may arrive as memory:// with a disk fallback.
    if source_ref.startswith(MEMORY_PROTOCOL) and actual_path:
        return actual_path

    # Keep explicit reference fragments (e.g. sqlite#run_id=...) intact.
    if "#" in source_ref:
        return source_ref

    return source_ref or actual_path or request_fpath


def _validate_paths(fpaths: List[str]) -> bool:
    """Return whether every dataset reference resolves to an existing path."""
    for fpath in fpaths:
        if fpath.startswith(MEMORY_PROTOCOL):
            # Memory-backed paths are validated at load time.
            continue
        try:
            # Supports reference-style paths like sqlite#run_id=...
            disk_path = resolve_to_disk_path(fpath)
        except Exception:
            return False
        path = Path(disk_path)
        if not path.exists():
            return False
        if not (path.is_dir() or path.is_file()):
            return False

    return True


def _validate_plot_type(plot_type: str) -> bool:
    """Return whether the plot type is supported."""
    supported_types = ["LinePlot", "HeatMap"]

    return plot_type in supported_types


def _apply_filters_sync(
    plots: List[Dict], filters_order: List, filters_opts: Dict
) -> List[Dict]:
    """Apply filters synchronously for execution in the thread pool."""
    filtered_plots = []
    for plot in plots:
        try:
            num_axes = 2 if plot["type"] == "HeatMap" else 1
            filtered_plot_json, warnings = apply_filters(
                filters_order=filters_order,
                filters_opts=filters_opts,
                fig=plot["plotJson"],
                fig_num_axes=num_axes,
            )
            filtered_plot = plot.copy()
            filtered_plot["plotJson"] = filtered_plot_json
            filtered_plot["warnings"] = warnings
            filtered_plot["title"] = f"{plot['title']} (Filtered)"
            filtered_plots.append(filtered_plot)
        except Exception as e:
            logger.error(f"Failed to apply filters to plot {plot['id']}: {e}")
            filtered_plots.append(plot)
    return filtered_plots


def validate_variables(
    datasets: List[xr.Dataset], indeps: List[str], deps: List[str]
) -> Dict:
    """
    Validate that independent and dependent variables exist in datasets.
    If bind is True, also check that variables have compatible dimensions.

    """
    validation_result = {"valid": True, "errors": []}

    # Check if variables exist in all datasets
    for i, dataset in enumerate(datasets):
        dataset_vars = list(dataset.data_vars) + list(dataset.coords)

        for indep in indeps:
            if indep not in dataset_vars:
                validation_result["valid"] = False
                validation_result["errors"].append(
                    f"Independent variable '{indep}' not found in dataset {i} at path {dataset.attrs.get('path', 'unknown')}"
                )

        for dep in deps:
            if dep not in dataset_vars:
                validation_result["valid"] = False
                validation_result["errors"].append(
                    f"Dependent variable '{dep}' not found in dataset {i} at path {dataset.attrs.get('path', 'unknown')}"
                )

    return validation_result


def plotted_dimensions(dataset: xr.Dataset, variables: List[str]) -> set:
    """Return the dataset dimensions used by the selected axes."""
    dimensions = set()
    for variable in variables:
        try:
            dimensions.add(sweep_dimension(dataset, variable))
        except AxisResolutionError:
            # Axis validation reports invalid variables separately.
            if variable in dataset.dims:
                dimensions.add(variable)
    return dimensions


def validate_axes(
    datasets: List[xr.Dataset], indeps: List[str], deps: List[str], plot_type: str
) -> Dict:
    """Check that axes share the dimensions required by the plot type."""
    errors: List[str] = []

    for index, dataset in enumerate(datasets):
        axes = indeps[:2] if plot_type == "HeatMap" else indeps[:1]

        if plot_type == "HeatMap" and all(
            variable in dataset.data_vars for variable in axes
        ):
            errors.append(
                f"A heat map needs at least one swept axis. '{axes[0]}' and "
                f"'{axes[1]}' are both measured, so together they trace a path "
                "rather than a grid."
            )
            continue

        # Heat-map axes must each map to one sweep. A line plot may use a measured
        # x-axis spanning several sweeps, with the remaining sweeps represented by sliders.
        resolve = axis_dimension if plot_type == "HeatMap" else sweep_dimension
        try:
            axis_dims = {variable: resolve(dataset, variable) for variable in axes}
        except AxisResolutionError as error:
            if plot_type == "HeatMap":
                errors.append(
                    f"{error}. A heat map axis must follow a single sweep; use "
                    "it as the Z value instead."
                )
            else:
                errors.append(str(error))
            continue

        if plot_type == "HeatMap" and len(set(axis_dims.values())) < len(axis_dims):
            errors.append(
                f"'{axes[0]}' and '{axes[1]}' both change along the "
                f"'{next(iter(axis_dims.values()))}' sweep, so together they "
                "trace a line rather than a grid. A heat map needs its two axes "
                "from different sweeps."
            )
            continue

        for dep in deps:
            dep_dims = set(dataset[dep].dims) if dep in dataset else set()
            for variable, dimension in axis_dims.items():
                if dimension not in dep_dims:
                    errors.append(
                        f"'{dep}' cannot be plotted against '{variable}': "
                        f"'{variable}' changes along '{dimension}', but '{dep}' "
                        f"varies over {', '.join(sorted(dep_dims)) or 'nothing'}."
                    )

    return {"valid": not errors, "errors": errors}


def _slides_by_position(dataset: xr.Dataset, dim: str) -> bool:
    """True when a dimension is sliced by index rather than by coordinate value."""
    if dim not in dataset.indexes:
        return True
    return dataset.indexes[dim].dtype.kind not in "iuf"


def _position_slider(dataset: xr.Dataset, dim: str) -> Dict:
    """An index slider over a dimension without numeric coordinates."""
    size = int(dataset.sizes[dim])
    config: Dict = {"min": 0, "max": max(size - 1, 0), "step": 1, "value": 0}
    if dim in dataset.coords:
        config["labels"] = [str(v) for v in dataset.coords[dim].values]
    return config


def variable_dimensions(dataset: xr.Dataset, variables: List[str]) -> set:
    """Return every dimension the given variables vary over."""
    return {
        dim
        for name in variables
        if name in dataset.variables
        for dim in dataset[name].dims
    }


def gen_slider_config(
    dataset: xr.Dataset, indeps: List[str], deps: Optional[List[str]] = None
) -> Dict:
    """Configure sliders for relevant dimensions that are not being plotted."""
    slider_config = {}
    plotted = plotted_dimensions(dataset, indeps)
    relevant = None if deps is None else variable_dimensions(dataset, deps)

    for dim in dataset.dims:
        # Only create sliders for dimensions not being plotted
        if dim in plotted or (relevant is not None and dim not in relevant):
            continue
        if _slides_by_position(dataset, dim):
            slider_config[dim] = _position_slider(dataset, dim)
            continue
        try:
            vals = dataset.coords[dim].values
            unique_vals = np.unique(vals)
            if len(unique_vals) > 1:
                # Derive the step from sorted values while tolerating floating-point noise.
                diffs = np.diff(unique_vals)
                # The median ignores small numerical deviations between intervals.
                step = float(np.median(diffs))
                # Clamp degenerate steps to zero.
                if step <= 0 or np.isnan(step):
                    step = 1.0
                slider_config[dim] = {
                    "min": float(unique_vals.min()),
                    "max": float(unique_vals.max()),
                    "step": step,
                    "value": float(unique_vals.min()),  # Initial slider position.
                }
                logger.debug(
                    f"Generated slider for dimension '{dim}': {slider_config[dim]}"
                )
            else:
                # Retain single-value dimensions as zero-range sliders.
                val = float(vals[0])
                slider_config[dim] = {
                    "min": val,
                    "max": val,
                    "step": 1.0,
                    "value": val,
                }

        except Exception as e:
            logger.warning(f"Could not generate slider for dimension '{dim}': {e}")
            continue

    logger.debug(f"gen_slider_config | {slider_config=}")

    return slider_config


def apply_data_slicing(
    dataset: xr.Dataset, indeps: List[str], slider: Dict
) -> xr.Dataset:
    """Slice non-plotted dimensions at their slider values."""
    if not slider:
        logger.debug("No slider configuration provided, returning original dataset")
        return dataset

    slider_vals = {}
    plotted = plotted_dimensions(dataset, indeps)

    # Build slider_vals dict for dimensions that exist in both dataset and slider config
    # and are not independent variables (not being plotted)
    positions = {}
    for dim in dataset.dims:
        if dim not in plotted and dim in slider:
            # Extract the value to select for this dimension
            slider_value = slider[dim]["value"]
            if _slides_by_position(dataset, dim):
                last = int(dataset.sizes[dim]) - 1
                positions[dim] = min(max(int(round(float(slider_value))), 0), last)
            else:
                slider_vals[dim] = slider_value
            logger.debug(f"Will slice dimension '{dim}' at value {slider_value}")

    if positions:
        dataset = dataset.isel(**positions)

    if slider_vals:
        logger.debug(f"Applying slider selection: {slider_vals}")
        try:
            # Use xarray's sel method with nearest neighbor to select specific slices
            return dataset.sel(**slider_vals, method="nearest")
        except Exception as e:
            logger.warning(
                f"sel(method='nearest') failed: {e}. Falling back to manual isel."
            )
            # Fall back to indexes for duplicate coordinates.
            isel_dict = {}
            for dim, val in slider_vals.items():
                if dim in dataset.coords:
                    arr = dataset.coords[dim].values
                    try:
                        idx = int(np.nanargmin(np.abs(arr - float(val))))
                        isel_dict[dim] = idx
                    except Exception as fallback_err:
                        logger.error(
                            f"Fallback indexing failed for dimension {dim}: {fallback_err}"
                        )
                        pass
                else:
                    logger.debug(
                        f"Dimension {dim} not in coords, skipping manual isel for this dim."
                    )

            if isel_dict:
                return dataset.isel(**isel_dict)
            return dataset
    else:
        logger.debug("No valid slider dimensions found, returning original dataset")
        return dataset


CUT_DIMENSION = "cut"
MAX_CUT_POINTS = 5000


def _cut_axis_values(dataset: xr.Dataset, variable: str) -> np.ndarray:
    """Return numeric coordinate values for a cut axis."""
    if variable in dataset.data_vars:
        raise ValueError(
            f"'{variable}' is measured, so a cut cannot follow it. Cuts need "
            "both heat map axes to be swept coordinates"
        )
    values = np.asarray(dataset.coords[variable].values)
    if values.dtype.kind not in "iuf":
        raise ValueError(f"'{variable}' has no numeric values to cut along")
    return values.astype(float)


def _with_cut_index(dataset: xr.Dataset, variable: str) -> xr.Dataset:
    """Index a cut dimension by its coordinate for interpolation."""
    dimension = axis_dimension(dataset, variable)
    if variable != dimension:
        dataset = dataset.swap_dims({dimension: variable})
    if not dataset.indexes[variable].is_unique:
        dataset = dataset.drop_duplicates(variable)
    return dataset


def _cells_spanned(values: np.ndarray, start: float, end: float) -> float:
    """Return the fractional number of grid intervals between two positions."""
    ordered = np.sort(values[np.isfinite(values)])
    if ordered.size < 2:
        return 0.0
    steps = np.arange(ordered.size, dtype=float)
    return abs(np.interp(end, ordered, steps) - np.interp(start, ordered, steps))


def _cut_extent(values: np.ndarray, start: float, end: float) -> float:
    """Return the cut length as a fraction of the axis range."""
    finite = values[np.isfinite(values)]
    span = float(finite.max() - finite.min()) if finite.size else 0.0
    return abs(end - start) / span if span > 0 else 0.0


def apply_line_cut(
    dataset: xr.Dataset, indeps: List[str], deps: List[str], cut: Dict
) -> tuple[xr.Dataset, str, str]:
    """Interpolate a line cut and choose its dominant variable as the x-axis."""
    if len(indeps) != 2:
        raise ValueError("A cut needs the heat map's two axes as its independents")
    start, end = cut.get("start") or {}, cut.get("end") or {}
    for variable in indeps:
        for point in (start, end):
            if not np.isfinite(float(point.get(variable, np.nan))):
                raise ValueError(f"The cut has no position for '{variable}'")

    values = {variable: _cut_axis_values(dataset, variable) for variable in indeps}
    extents = [
        _cut_extent(values[variable], start[variable], end[variable])
        for variable in indeps
    ]
    if max(extents) == 0:
        raise ValueError("The cut starts and ends at the same point")
    x_var, companion = indeps if extents[0] >= extents[1] else indeps[::-1]

    points = cut.get("points")
    if not points:
        spanned = max(
            _cells_spanned(values[variable], start[variable], end[variable])
            for variable in indeps
        )
        points = int(np.ceil(spanned)) + 1
    points = min(max(int(points), 2), MAX_CUT_POINTS)

    for variable in indeps:
        dataset = _with_cut_index(dataset, variable)

    t = np.linspace(0.0, 1.0, points)
    along = {
        variable: xr.DataArray(
            start[variable] + t * (end[variable] - start[variable]),
            dims=CUT_DIMENSION,
            attrs=dict(dataset[variable].attrs),
        )
        for variable in indeps
    }
    # Interpolate values and validity separately so zero-weight NaN neighbors do
    # not invalidate samples on the edge of a partially measured live scan.
    measured = dataset[list(deps)]
    options = {"kwargs": {"fill_value": np.nan}}
    sampled = measured.fillna(0).interp(along, **options)
    coverage = measured.notnull().astype(float).interp(along, **options)
    sampled = sampled.where(coverage > 1 - 1e-9)
    for variable in deps:
        sampled[variable].attrs = dict(dataset[variable].attrs)
    for variable in indeps:
        sampled[variable].attrs = dict(along[variable].attrs)
    sampled.attrs = dict(dataset.attrs)
    return sampled, x_var, companion


def create_line_plots(
    datasets: List[xr.Dataset],
    fpaths: List[str],
    indeps: List[str],
    deps: List[str],
    slider: Dict = None,
    cut: Optional[Dict] = None,
) -> List[Dict]:
    """Create line plots with sliders for unplotted dimensions."""
    plots = []

    # Create separate plots for each dataset and each dependent variable
    for i, (dataset, fpath) in enumerate(zip(datasets, fpaths)):
        try:
            metadata = dataset.attrs

            # Always generate accurate slider configuration from the dataset dimensions
            auto_slider_config = gen_slider_config(dataset, indeps, deps)

            # If a slider config is provided (e.g. from frontend LineCut), update the values
            if slider:
                for dim, config in slider.items():
                    if dim in auto_slider_config and "value" in config:
                        auto_slider_config[dim]["value"] = config["value"]

            slider_for_slicing = auto_slider_config

            # Apply data slicing if slider is provided
            if slider_for_slicing:
                logger.debug(
                    f"create_line_plots || Applying data slicing for dataset {i} with slider: {slider_for_slicing}"
                )
                dataset = apply_data_slicing(dataset, indeps, slider_for_slicing)

            plot_indeps, companion = list(indeps), None
            if cut:
                dataset, x_var, companion = apply_line_cut(dataset, indeps, deps, cut)
                plot_indeps = [x_var]

            # Create a separate plot for each dependent variable
            for dep in deps:
                line_plot = Line(
                    metadata=metadata,
                    data=dataset,
                    independents=plot_indeps,
                    dependents=[dep],  # Pass only one dependent at a time
                    theme=DEFAULT_THEME,
                    companion=companion,
                )

                plot_figure = line_plot.plot()
                plot_json = plot_figure.to_dict()

                is_memory_request = fpath.startswith(MEMORY_PROTOCOL)
                loaded_from_disk = dataset.attrs.get("loaded_from") == "disk"
                measurement_live_status = dataset.attrs.get("measurement_live_status")

                if is_memory_request:
                    if measurement_live_status is True:
                        is_live = True
                    elif measurement_live_status is False:
                        is_live = False
                    else:
                        # Fallback when DB state is unavailable.
                        is_live = not loaded_from_disk
                else:
                    is_live = False

                context_fpath = _resolve_context_fpath(fpath, dataset, is_live)
                dataset_name = Path(context_fpath).stem

                context = {
                    "fpath": context_fpath,
                    "indeps": list(indeps),
                    "deps": [dep],
                    "plotType": "LinePlot",
                }
                if cut:
                    context["cut"] = cut
                plot_ref = _build_plot_ref(context)
                register_plot_context(plot_ref, context)

                plots.append(
                    {
                        "id": f"line_plot_{i}_{dataset_name}_{dep}",
                        "plot_ref": plot_ref,
                        "plotJson": plot_json,
                        "title": f"Line Plot - {dataset_name}: {dep} vs {', '.join(indeps)}",
                        "type": "LinePlot",
                        "slider_config": auto_slider_config,  # Include auto-generated slider configuration for frontend
                        "is_live": is_live,  # Indicate if data is from live measurement or disk
                        "resolved_fpath": context_fpath,
                    }
                )

        except HTTPException:
            raise
        except Exception as e:
            logger.error(
                f"Failed to create line plot for dataset {i}: {e}", exc_info=True
            )
            raise _plot_failure("line plot", i, dataset, e) from e

    return plots


def _plot_failure(
    kind: str, index: int, dataset: xr.Dataset, error: Exception
) -> HTTPException:
    """Convert expected dataset errors into actionable bad requests."""
    if isinstance(error, (KeyError, ValueError)):
        available = ", ".join(
            sorted({*map(str, dataset.dims), *dataset.data_vars, *dataset.coords})
        )
        return HTTPException(
            status_code=400,
            detail=(
                f"This dataset cannot be drawn as a {kind}: {error}. "
                f"It has: {available}."
            ),
        )
    return HTTPException(
        status_code=500,
        detail=f"Failed to create {kind} for dataset {index}: {error}",
    )


def create_heat_maps(
    datasets: List[xr.Dataset],
    fpaths: List[str],
    indeps: List[str],
    deps: List[str],
    slider: Dict = None,
    swap_xy: bool = False,
) -> List[Dict]:
    """Create heat maps, interpreting independents as ``[y, x]``."""
    plots = []

    # For HeatMaps, always create separate plots (bind has no effect)
    for i, (dataset, fpath) in enumerate(zip(datasets, fpaths)):
        try:
            metadata = dataset.attrs

            # Always generate accurate slider configuration from the dataset dimensions
            auto_slider_config = gen_slider_config(dataset, indeps, deps)

            # If a slider config is provided (e.g. from frontend LineCut), update the values
            if slider:
                for dim, config in slider.items():
                    if dim in auto_slider_config and "value" in config:
                        auto_slider_config[dim]["value"] = config["value"]

            slider_for_slicing = auto_slider_config

            # Apply data slicing if slider is provided
            if slider_for_slicing:
                dataset = apply_data_slicing(dataset, indeps, slider_for_slicing)

            # For HeatMaps, we need 2 independents (X, Y) and 1 or more dependents (Z)
            if len(indeps) < 2:
                raise HTTPException(
                    status_code=400,
                    detail="HeatMap requires at least 2 independent variables (X and Y axes)",
                )

            # HeatMap maps independents as [y, x].
            if swap_xy:
                y_var, x_var = indeps[1], indeps[0]
            else:
                y_var, x_var = indeps[0], indeps[1]

            for dep in deps:
                heat_map = HeatMap(
                    metadata=metadata,
                    data=dataset,
                    independents=[y_var, x_var],
                    dependents=[dep],
                    theme=DEFAULT_THEME,
                )

                plot_figure = heat_map.plot()
                plot_json = plot_figure.to_dict()

                is_memory_request = fpath.startswith(MEMORY_PROTOCOL)
                loaded_from_disk = dataset.attrs.get("loaded_from") == "disk"
                measurement_live_status = dataset.attrs.get("measurement_live_status")

                if is_memory_request:
                    if measurement_live_status is True:
                        is_live = True
                    elif measurement_live_status is False:
                        is_live = False
                    else:
                        # Fallback when DB state is unavailable.
                        is_live = not loaded_from_disk
                else:
                    is_live = False

                context_fpath = _resolve_context_fpath(fpath, dataset, is_live)
                dataset_name = Path(context_fpath).stem

                context = {
                    "fpath": context_fpath,
                    "indeps": [indeps[0], indeps[1]],
                    "deps": [dep],
                    "plotType": "HeatMap",
                }
                plot_ref = _build_plot_ref(context)
                register_plot_context(plot_ref, context)

                plots.append(
                    {
                        "id": f"heat_map_{i}_{dataset_name}_{dep}",
                        "plot_ref": plot_ref,
                        "plotJson": plot_json,
                        "title": f"Heat Map - {dataset_name}: {dep} vs {x_var}, {y_var}",
                        "type": "HeatMap",
                        "slider_config": auto_slider_config,
                        "is_live": is_live,  # Indicate if data is from live measurement or disk
                        "resolved_fpath": context_fpath,
                    }
                )

        except HTTPException:
            raise
        except Exception as e:
            logger.error(
                f"Failed to create heat map for dataset {i}: {e}", exc_info=True
            )
            raise _plot_failure("heat map", i, dataset, e) from e

    return plots


@router.post("/plot/")
async def create_plots(request: PlotRequest) -> PlotResponse:
    """Create the plots described by a request."""
    is_live_poll = any(
        fpath.startswith(MEMORY_PROTOCOL) for fpath in (request.fpaths or [])
    )
    if is_live_poll:
        await _user_first.wait_turn()
        return await _create_plots(request)
    async with _user_first.user_request():
        return await _create_plots(request)


async def _create_plots(request: PlotRequest) -> PlotResponse:
    # Live polls make per-request details too noisy for the default log level.
    logger.debug("Received plot request: %s", request)
    logger.debug("Dependents requested: %s", request.deps)
    logger.debug("Independents requested: %s", request.indeps)

    if not request.fpaths or len(request.fpaths) == 0:
        logger.warning("Plot request missing fpaths")
        return PlotResponse(
            plots=[], success=False, message="No file paths provided in request"
        )
    if not request.indeps or len(request.indeps) == 0:
        logger.warning("Plot request missing indeps")
        return PlotResponse(
            plots=[],
            success=False,
            message="No independent variables provided in request",
        )
    if not request.deps or len(request.deps) == 0:
        logger.warning("Plot request missing deps")
        return PlotResponse(
            plots=[],
            success=False,
            message="No dependent variables provided in request",
            invalid=True,
        )

    try:
        # Validate paths
        if not _validate_paths(request.fpaths):
            return PlotResponse(
                plots=[],
                success=False,
                message="One or more paths are invalid or inaccessible",
            )

        # Validate plot type
        if not _validate_plot_type(request.plotType):
            return PlotResponse(
                plots=[],
                success=False,
                message=f"Unsupported plot type: {request.plotType}",
            )

        # Load datasets
        datasets = []
        for fpath in request.fpaths:
            try:
                dataset = await load_dataset_async(fpath)
                # Store the path in dataset attributes for reference
                dataset.attrs["path"] = fpath
                datasets.append(dataset)
            except Exception as e:
                # Keep the current live plot on transient read errors.
                if fpath.startswith(MEMORY_PROTOCOL):
                    logger.warning(
                        f"Transient file access error for live dataset {fpath}: {type(e).__name__}: {e}. Skipping update."
                    )
                    return PlotResponse(
                        plots=[],
                        success=True,
                        message="Skipping update due to transient file access error",
                        skip_update=True,
                    )
                # For disk measurements, return error as before
                return PlotResponse(
                    plots=[],
                    success=False,
                    message=f"Failed to load dataset from {fpath}: {e}",
                )

        # Validate variables
        effective_indeps = list(request.indeps)

        validation = validate_variables(datasets, effective_indeps, request.deps)
        if not validation["valid"]:
            # For live (memory://) datasets, this can be a transient read race:
            # open_live_measurement() fetches metadata and data in two separate WebSocket
            # round-trips. Under load, the server may return a partial/empty data_dict,
            # causing variables to be silently dropped from the assembled Dataset.
            # The dataset loads without error but contains no variables, failing validation.
            # Skip this poll cycle; the next one will succeed once the server is free.
            is_live_request = any(
                fpath.startswith(MEMORY_PROTOCOL) for fpath in request.fpaths
            )
            if is_live_request:
                logger.warning(
                    f"Transient variable validation failure for live dataset: "
                    f"{'; '.join(validation['errors'])}. Skipping update."
                )
                return PlotResponse(
                    plots=[],
                    success=True,
                    message="Skipping update due to transient variable unavailability",
                    skip_update=True,
                )
            return PlotResponse(
                plots=[],
                success=False,
                message=f"Variable validation failed: {'; '.join(validation['errors'])}",
                invalid=True,
            )

        # Coordinates and measured axes must belong to the same sweep.
        axes_check = validate_axes(
            datasets, effective_indeps, request.deps, request.plotType
        )
        if not axes_check["valid"]:
            return PlotResponse(
                plots=[],
                success=False,
                message="; ".join(axes_check["errors"]),
                invalid=True,
            )

        # Create plots based on type — run in a thread so numpy/plotly work
        # doesn't block the async event loop for other concurrent requests.
        plots = []
        if request.plotType == "LinePlot":
            plots = await run_in_threadpool(
                create_line_plots,
                datasets,
                request.fpaths,
                effective_indeps,
                request.deps,
                request.slider,
                request.cut.model_dump() if request.cut else None,
            )
        elif request.plotType == "HeatMap":
            plots = await run_in_threadpool(
                create_heat_maps,
                datasets,
                request.fpaths,
                effective_indeps,
                request.deps,
                request.slider,
                request.swap_xy,
            )

        # Apply filters if requested — also CPU-bound, run in a thread.
        if request.filters_order:
            plots = await run_in_threadpool(
                _apply_filters_sync,
                plots,
                request.filters_order,
                request.filters_opts,
            )

        if logger.isEnabledFor(logging.DEBUG):
            logger.debug("Created %d plots: %s", len(plots), [p["id"] for p in plots])
            for i, plot in enumerate(plots):
                logger.debug(
                    "Plot %d slider_config: %s", i, plot.get("slider_config", {})
                )

        # Return the response with all created plots
        if len(plots) == 0:
            return PlotResponse(
                plots=[],
                success=False,
                message="No plots were created. Please check your input parameters.",
            )
        else:
            plots = sanitize_for_json(plots)
            return PlotResponse(
                plots=plots,
                success=True,
                message=f"Successfully created {len(plots)} plot(s)",
            )

    except HTTPException as http_exc:
        logger.error(f"HTTP error: {http_exc.detail}")
        return PlotResponse(
            plots=[], success=False, message=f"Request error: {http_exc.detail}"
        )

    except Exception as e:
        logger.error(f"Unexpected error in create_plots: {e}")
        return PlotResponse(plots=[], success=False, message=f"Unexpected error: {e}")


@router.post("/telemetry/live-refresh")
async def record_live_refresh(summary: LiveRefreshSummary) -> dict:
    """Write a local live-refresh timing summary to the app log."""
    logger.info(
        "live refresh | %s | n=%d over %.0fs | median=%.0fms p90=%.0fms "
        "min=%.0fms max=%.0fms | points=%d | live plots=%d",
        summary.plotType or "unknown",
        summary.count,
        summary.windowSeconds,
        summary.medianMs,
        summary.p90Ms,
        summary.minMs,
        summary.maxMs,
        summary.points,
        summary.concurrentPlots,
    )
    return {"ok": True}
