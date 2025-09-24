"""
FastAPI endpoints for creating and managing plots based on xarray datasets.

"""

import xarray as xr
from pathlib import Path
from typing import Dict, List
from fastapi import APIRouter, HTTPException

# Local imports
from .figures import Line, HeatMap, DEFAULT_THEME
from .filters import apply_filters
from .models import PlotRequest, PlotResponse
from .logger import logger


# FastAPI router for plot endpoints
router = APIRouter()


def _validate_paths(fpaths: List[str]) -> bool:
    """
    Helper function to validate that all paths exist and are accessible.

    Args:
        fpaths (List[str]): List of file paths to validate.

    Returns:
        bool: True if all paths are valid, False otherwise.

    """
    for fpath in fpaths:
        path = Path(fpath)
        if not path.exists() or not path.is_dir():
            return False
        # Check if it's a valid zarr dataset
        if not (path.name.endswith(".zarr") or (path / ".zarray").exists()):
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


def load_dataset(fpath: str) -> xr.Dataset:
    """
    Loads a zarr dataset from the given path.

    Args:
        fpath (str): The file path to the zarr dataset.

    Returns:
        xr.Dataset: The loaded dataset.

    """
    try:
        dataset = xr.open_zarr(fpath)
        return dataset

    except Exception as e:
        logger.error(f"Failed to load dataset from {fpath}: {e}")

        raise HTTPException(status_code=400, detail=f"Failed to load dataset: {e}")


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
                if len(vals) > 1:
                    # Calculate step as difference between consecutive values - assumes regular spacing
                    step = float(vals[1] - vals[0])
                    slider_config[dim] = {
                        "min": float(vals.min()),
                        "max": float(vals.max()),
                        "step": step,
                        "value": float(vals.min()),  # Default to minimum value
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
        # Use xarray's sel method with nearest neighbor to select specific slices
        # Dash: data_array.sel(**slider_vals, method="nearest")
        return dataset.sel(**slider_vals, method="nearest")
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

            # Generate slider configuration for dimensions not being plotted (like Dash _update_slider())
            if not slider:  # Check for None or empty dict
                auto_slider_config = gen_slider_config(dataset, indeps)
                logger.debug(
                    f"create_line_plots || Auto-generated slider config for {fpath}: {auto_slider_config}"
                )
                slider_for_slicing = auto_slider_config
            else:
                auto_slider_config = slider
                slider_for_slicing = slider

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

                dataset_name = Path(fpath).stem

                plots.append(
                    {
                        "id": f"line_plot_{i}_{dataset_name}_{dep}",
                        "plotJson": plot_json,
                        "title": f"Line Plot - {dataset_name}: {dep} vs {', '.join(indeps)}",
                        "type": "LinePlot",
                        "slider_config": auto_slider_config,  # Include auto-generated slider configuration for frontend
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
) -> List[Dict]:
    """
    Creates HeatMap(s) based on the datasets and parameters.

    Args:
        datasets (List[xr.Dataset]): List of datasets to plot.
        fpaths (List[str]): List of file paths corresponding to datasets.
        indeps (List[str]): List of independent variable names (X, Y axes).
        deps (List[str]): List of dependent variable names (Z values).

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

            # Generate slider config for non-plotted dimensions (like Dash _update_slider())
            if not slider:  # Check for None or empty dict
                auto_slider_config = gen_slider_config(dataset, indeps)
                logger.debug(
                    f"Auto-generated slider config for heatmap {fpath}: {auto_slider_config}"
                )
                slider_for_slicing = auto_slider_config
            else:
                auto_slider_config = slider
                slider_for_slicing = slider

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

                dataset_name = Path(fpath).stem

                plots.append(
                    {
                        "id": f"heat_map_{i}_{dataset_name}_{dep}",
                        "plotJson": plot_json,
                        "title": f"Heat Map - {dataset_name}: {dep} vs {x_var}, {y_var}",
                        "type": "HeatMap",
                        "slider_config": auto_slider_config,
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
                dataset = load_dataset(fpath)
                # Store the path in dataset attributes for reference
                dataset.attrs["path"] = fpath
                datasets.append(dataset)
            except Exception as e:
                return PlotResponse(
                    plots=[],
                    success=False,
                    message=f"Failed to load dataset from {fpath}: {e}",
                )

        # Validate variables
        validation = validate_variables(datasets, request.indeps, request.deps)
        if not validation["valid"]:
            return PlotResponse(
                plots=[],
                success=False,
                message=f"Variable validation failed: {'; '.join(validation['errors'])}",
            )

        # Create plots based on type
        plots = []
        if request.plotType == "LinePlot":
            plots = create_line_plots(
                datasets, request.fpaths, request.indeps, request.deps, request.slider
            )
        elif request.plotType == "HeatMap":
            plots = create_heat_maps(
                datasets, request.fpaths, request.indeps, request.deps, request.slider
            )

        # Apply filters if requested
        if request.filters_order:
            filtered_plots = []
            for plot in plots:
                try:
                    # Determine number of axes based on plot type
                    num_axes = 2 if plot["type"] == "HeatMap" else 1

                    # Apply filters to the plot
                    filtered_plot_json = apply_filters(
                        filters_order=request.filters_order,
                        filters_opts=request.filters_opts,
                        fig=plot["plotJson"],
                        fig_num_axes=num_axes,
                    )

                    # Update the plot with filtered data
                    filtered_plot = plot.copy()
                    filtered_plot["plotJson"] = filtered_plot_json
                    filtered_plot["title"] = f"{plot['title']} (Filtered)"

                    filtered_plots.append(filtered_plot)

                except Exception as e:
                    logger.error(f"Failed to apply filters to plot {plot['id']}: {e}")
                    # If filtering fails, keep the original plot
                    filtered_plots.append(plot)

            plots = filtered_plots

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
