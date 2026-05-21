"""
FastAPI endpoints for creating and managing plots based on xarray datasets.

"""

import hashlib
import json
import numpy as np
import xarray as xr
from pathlib import Path
from typing import Dict, List
from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool

# Local imports
from .figures import Line, HeatMap, DEFAULT_THEME
from .filters import apply_filters
from .models import PlotRequest, PlotResponse
from .logger import logger
from .data_loader import MEMORY_PROTOCOL, load_dataset_async, resolve_to_disk_path
from .json_utils import sanitize_for_json


# FastAPI router for plot endpoints
router = APIRouter()

# Runtime plot context registry used by unified transform endpoint.
_PLOT_CONTEXTS: Dict[str, Dict] = {}


def _build_plot_ref(context: Dict) -> str:
    """
    Create a stable reference key for a plot context.

    """
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
    """
    Helper function to validate that all paths exist and are accessible.

    Args:
        fpaths (List[str]): List of file paths to validate.

    Returns:
        bool: True if all paths are valid, False otherwise.

    """
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
    """
    Helper function to validate that the plot type is supported.

    Args:
        plot_type (str): The type of plot to validate.

    Returns:
        bool: True if the plot type is supported, False otherwise.

    """
    supported_types = ["LinePlot", "HeatMap"]

    return plot_type in supported_types



def _apply_filters_sync(
    plots: List[Dict], filters_order: List, filters_opts: Dict
) -> List[Dict]:
    """
    Apply filters to a list of plot dicts synchronously.
    Intended to be called via run_in_threadpool so filter numpy work
    does not block the async event loop.

    """
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


def gen_slider_config(dataset: xr.Dataset, indeps: List[str]) -> Dict:
    """
    Generate slider configuration for dimensions not in independents.
    Adapted from ``Plot._base()`` in the Qimchi Dash app.

    Args:
        dataset: The xarray dataset
        indeps: List of independent variable names (dimensions being plotted)

    Returns:
        Dict: Slider configuration {dim: {min, max, step, value}}

    """
    slider_config = {}

    for dim in dataset.dims:
        # Only create sliders for dimensions not being plotted
        if dim not in indeps:
            try:
                vals = dataset.coords[dim].values
                unique_vals = np.unique(vals)
                if len(unique_vals) > 1:
                    # Calculate step as the median difference between consecutive sorted values to handle float noise reliably
                    diffs = np.diff(unique_vals)
                    # Use the median to avoid tiny differences from float imprecision
                    step = float(np.median(diffs))
                    # Ensure step is positive and not virtually zero
                    if step <= 0 or np.isnan(step):
                        step = 1.0
                    slider_config[dim] = {
                        "min": float(unique_vals.min()),
                        "max": float(unique_vals.max()),
                        "step": step,
                        "value": float(unique_vals.min()),  # Default to minimum value
                    }
                    logger.debug(
                        f"Generated slider for dimension '{dim}': {slider_config[dim]}"
                    )
                else:
                    # Single value dimension - still create slider but with zero range
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
    """
    Apply data slicing based on slider values for dimensions not in independents.

    Args:
        dataset: The xarray dataset
        indeps: List of independent variable names (dimensions being plotted)
        slider: Dict of slider configurations {dim: {min, max, step, value}}

    Returns:
        xr.Dataset: Sliced dataset with selected values for non-independent dimensions

    """
    if not slider:
        logger.debug("No slider configuration provided, returning original dataset")
        return dataset

    slider_vals = {}

    # Build slider_vals dict for dimensions that exist in both dataset and slider config
    # and are not independent variables (not being plotted)
    for dim in dataset.dims:
        if dim not in indeps and dim in slider:
            # Extract the value to select for this dimension
            slider_value = slider[dim]["value"]
            slider_vals[dim] = slider_value
            logger.debug(f"Will slice dimension '{dim}' at value {slider_value}")

    if slider_vals:
        logger.debug(f"Applying slider selection: {slider_vals}")
        try:
            # Use xarray's sel method with nearest neighbor to select specific slices
            return dataset.sel(**slider_vals, method="nearest")
        except Exception as e:
            logger.warning(f"sel(method='nearest') failed: {e}. Falling back to manual isel.")
            # Fallback for duplicate coordinate values ("reindexing only valid for uniquely valued Index objects")
            isel_dict = {}
            for dim, val in slider_vals.items():
                if dim in dataset.coords:
                    arr = dataset.coords[dim].values
                    # Extract the numerical value (handling datetimes or other types gracefully if needed, but assuming numerical)
                    try:
                        # Find the index of the closest value
                        idx = int(np.nanargmin(np.abs(arr - float(val))))
                        isel_dict[dim] = idx
                    except Exception as fallback_err:
                        logger.error(f"Fallback indexing failed for dimension {dim}: {fallback_err}")
                        pass
                else:
                    logger.debug(f"Dimension {dim} not in coords, skipping manual isel for this dim.")
            
            if isel_dict:
                return dataset.isel(**isel_dict)
            return dataset
    else:
        logger.debug("No valid slider dimensions found, returning original dataset")
        return dataset


def create_line_plots(
    datasets: List[xr.Dataset],
    fpaths: List[str],
    indeps: List[str],
    deps: List[str],
    slider: Dict = None,
) -> List[Dict]:
    """
    Creates LinePlot(s) based on the datasets and parameters.
    Automatically generates slider configurations for dimensions not being plotted.

    Args:
        datasets (List[xr.Dataset]): List of datasets to plot.
        fpaths (List[str]): List of file paths corresponding to datasets.
        indeps (List[str]): List of independent variable names.
        deps (List[str]): List of dependent variable names.
        slider (Dict): Optional slider configuration to override auto-generation.

    Returns:
        List[Dict]: List of plot dictionaries containing plot data and metadata.

    """
    plots = []

    # Create separate plots for each dataset and each dependent variable
    for i, (dataset, fpath) in enumerate(zip(datasets, fpaths)):
        try:
            # logger.debug(f"create_line_plots | dataset {i} dims={list(dataset.dims)} vars={list(dataset.data_vars)[:10]} coords={list(dataset.coords)[:10]}")
            # logger.debug(f"create_line_plots | indeps={indeps} deps={deps} slider={bool(slider)}")
            metadata = dataset.attrs

            # Always generate accurate slider configuration from the dataset dimensions
            auto_slider_config = gen_slider_config(dataset, indeps)
            
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

            # Create a separate plot for each dependent variable
            for dep in deps:
                line_plot = Line(
                    metadata=metadata,
                    data=dataset,
                    independents=indeps,
                    dependents=[dep],  # Pass only one dependent at a time
                    theme=DEFAULT_THEME,
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

                # DEBUG: Save plot to file for cging
                # plot_figure.write_html(f"line_plot_{i}_{dataset_name}_{dep}.html")
                # logger.debug(
                #     f"Created line plot for dataset {i} ({dataset_name}) with {dep} vs {', '.join(indeps)}"
                # )

        except Exception as e:
            logger.error(f"Failed to create line plot for dataset {i}: {e}")
            logger.error(f"{e}", exc_info=True)
            raise HTTPException(
                status_code=500,
                detail=f"Failed to create line plot for dataset {i}: {e}",
            )

    return plots


def create_heat_maps(
    datasets: List[xr.Dataset],
    fpaths: List[str],
    indeps: List[str],
    deps: List[str],
    slider: Dict = None,
    swap_xy: bool = False,
) -> List[Dict]:
    """
    Creates HeatMap(s) based on the datasets and parameters.

    Args:
        datasets (List[xr.Dataset]): List of datasets to plot.
        fpaths (List[str]): List of file paths corresponding to datasets.
        indeps (List[str]): List of independent variable names (X, Y axes).
        deps (List[str]): List of dependent variable names (Z values).
        slider (Dict, optional): Slider configuration for slicing data.
        swap_xy (bool, optional): Whether to swap the X and Y axes.

    Returns:
        List[Dict]: List of plot dictionaries containing plot data and metadata.

    """
    plots = []

    # For HeatMaps, always create separate plots (bind has no effect)
    for i, (dataset, fpath) in enumerate(zip(datasets, fpaths)):
        try:
            # logger.debug(
            #     f"create_heat_maps | dataset {i} dims={list(dataset.dims)} vars={list(dataset.data_vars)[:10]} coords={list(dataset.coords)[:10]}"
            # )
            # logger.debug(
            #     f"create_heat_maps | indeps={indeps} deps={deps} slider={bool(slider)}"
            # )
            metadata = dataset.attrs

            # Always generate accurate slider configuration from the dataset dimensions
            auto_slider_config = gen_slider_config(dataset, indeps)
            
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

            # Use first two independents as X, Y and all dependents as Z values
            if swap_xy:
                x_var, y_var = indeps[1], indeps[0]
            else:
                x_var, y_var = indeps[0], indeps[1]

            for dep in deps:
                heat_map = HeatMap(
                    metadata=metadata,
                    data=dataset,
                    independents=[x_var, y_var],
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

                # DEBUG: Save plot to file for debugging
                # plot_figure.write_html(f"heat_map_{i}_{dataset_name}_{dep}.html")
                # logger.debug(
                #     f"Created heat map for dataset {i} ({dataset_name}) with {dep} vs {x_var}, {y_var}"
                # )

        except Exception as e:
            logger.error(f"Failed to create heat map for dataset {i}: {e}")
            logger.error(f"{e}", exc_info=True)
            raise HTTPException(
                status_code=500,
                detail=f"Failed to create heat map for dataset {i}: {e}",
            )

    return plots


@router.post("/plot/")
async def create_plots(request: PlotRequest) -> PlotResponse:
    """
    Creates plots based on the provided parameters.

    Args:
        request: PlotRequest containing paths, variables, plot type, and bind option

    Returns:
        PlotResponse containing the generated plots or error information

    """
    logger.info(f"Received plot request: {request}")
    logger.info(f"Dependents requested: {request.deps}")
    logger.info(f"Independents requested: {request.indeps}")

    # Extra debug: ensure lists are present
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
                # For live measurements, silently skip update on transient errors (file locking, permission issues)
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
            # open_live_dataset() fetches metadata and data in two separate WebSocket
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
            )

        # Create plots based on type — run in a thread so numpy/plotly work
        # doesn't block the async event loop for other concurrent requests.
        plots = []
        if request.plotType == "LinePlot":
            plots = await run_in_threadpool(
                create_line_plots,
                datasets, request.fpaths, effective_indeps, request.deps, request.slider,
            )
        elif request.plotType == "HeatMap":
            plots = await run_in_threadpool(
                create_heat_maps,
                datasets, request.fpaths, effective_indeps, request.deps, request.slider, request.swap_xy
            )

        # Apply filters if requested — also CPU-bound, run in a thread.
        if request.filters_order:
            plots = await run_in_threadpool(
                _apply_filters_sync,
                plots, request.filters_order, request.filters_opts,
            )

        logger.info(f"Successfully created {len(plots)} plots")
        logger.info(f"Plot IDs: {[plot['id'] for plot in plots]}")

        # DEBUG: Log slider configs for each plot
        for i, plot in enumerate(plots):
            slider_config = plot.get("slider_config", {})
            logger.info(f"Plot {i} slider_config: {slider_config}")

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
