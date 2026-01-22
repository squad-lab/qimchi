"""
FastAPI endpoint to export Plotly plots as PNG, PDF and SVG.

"""

import asyncio
import json
import os
import tempfile
import time
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict

import plotly.io as pio
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse
from plotly import graph_objects as go

from . import live_measurements

# Local imports
from .logger import logger

MEMORY_PROTOCOL = "memory://"


router = APIRouter()


# In-memory task registry for export tasks
# Structure: { task_id: { "status": "pending|completed|failed", "result": {...}, "error": str, "created_at": datetime, "zip_path": str } }
_export_tasks: Dict[str, Dict] = {}


def _cleanup_old_tasks() -> None:
    """
    Remove tasks older than 5 minutes to prevent memory leak.

    """
    cutoff = datetime.now() - timedelta(minutes=5)
    to_remove = [
        task_id
        for task_id, task in _export_tasks.items()
        if task.get("created_at", datetime.now()) < cutoff
    ]
    for task_id in to_remove:
        task = _export_tasks.pop(task_id, None)
        # Clean up zip file if exists
        if task and task.get("zip_path"):
            try:
                os.unlink(task["zip_path"])
            except Exception:
                pass
    if to_remove:
        logger.debug(f"Cleaned up {len(to_remove)} old export tasks")


def _export_plot_images_sync(
    plot_json: Dict,
    disk_fpath: str,
    relayout_data: Dict | None = None,
    export_pool=None,
) -> Dict:
    """
    Synchronous function to export plot images (runs in executor).

    Args:
        plot_json (Dict): Plotly figure JSON
        disk_fpath (str): dataset .zarr path on disk
        relayout_data (Dict | None): optional relayout data to apply
        export_pool: optional ProcessPoolExecutor for parallel writes

    Returns:
        Returns dict with:
        - zip_path: path to created zip file
        - saved_paths: dict of individual image paths
        - timings: performance metrics

    """
    # Determine folder to save - "extras" (same as notes.py logic)
    dataset_path = Path(disk_fpath)
    dataset_uuid = dataset_path.stem
    extras_dir = dataset_path.parent / dataset_uuid
    extras_dir.mkdir(parents=True, exist_ok=True)

    # Base filename with timestamp
    ts = datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
    base_filename = extras_dir / f"{dataset_uuid}__{ts}__plot"

    # Convert incoming JSON to a Figure
    try:
        fig = go.Figure(plot_json)
    except Exception:
        fig = go.Figure(plot_json)

    # Apply relayout data if provided (preserves zoom/pan state)
    if relayout_data:
        try:
            # Convert flat relayout keys to nested structure
            nested_layout: Dict = {}
            for key, value in relayout_data.items():
                # Handle array index notation like 'xaxis.range[0]'
                if "[" in key and "]" in key:
                    base_key, index_part = key.split("[", 1)
                    index = int(index_part.rstrip("]"))
                    # Handle nested keys like 'xaxis.range'
                    if "." in base_key:
                        parts = base_key.split(".")
                        current = nested_layout
                        for part in parts[:-1]:
                            if part not in current:
                                current[part] = {}
                            current = current[part]
                        if parts[-1] not in current:
                            current[parts[-1]] = []
                        array = current[parts[-1]]
                    else:
                        if base_key not in nested_layout:
                            nested_layout[base_key] = []
                        array = nested_layout[base_key]

                    # Extend array if needed
                    while len(array) <= index:
                        array.append(None)
                    array[index] = value
                else:
                    # Simple key-value pairs
                    nested_layout[key] = value

            fig.update_layout(nested_layout)
        except Exception as e:
            logger.error(f"Failed to apply relayout data: {e}")
            # Continue without relayout data

    # Ensure transparent background
    fig.update_layout(paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)")

    # Prepare output paths for light and dark variants
    saved_paths = {}
    outs = []
    for variant in ("light", "dark"):
        for fmt in ("png", "svg"):
            name = f"{base_filename.name}_{variant}.{fmt}"
            path = base_filename.with_name(name)
            outs.append((variant, fmt, path))

    # Build dark figure once
    axis_style_dark = {
        "title": {"font": {"color": "white"}},
        "linecolor": "white",
        "tickfont": {"color": "white"},
        "tickcolor": "white",
        "minor": {"tickcolor": "white"},
    }
    dark_fig = go.Figure(fig.to_dict())
    dark_fig.update_layout(
        title_font_color="white",
        font=dict(color="white"),
        xaxis=axis_style_dark,
        yaxis=axis_style_dark,
    )
    dark_fig.update_coloraxes(
        colorbar=dict(
            title=dict(font=dict(color="white")),
            tickfont=dict(color="white"),
            tickcolor="white",
            outlinecolor="white",
        )
    )

    # helper to write and time a single write
    def _write_and_time(local_fig, local_path_str):
        _width = 1920
        _height = 1080
        _scale = 300.0 / 96.0
        start = time.perf_counter()
        pio.write_image(
            local_fig, local_path_str, width=_width, height=_height, scale=_scale
        )
        elapsed = time.perf_counter() - start
        return local_path_str, elapsed

    # figure metadata
    timings = {}
    try:
        ser_start = time.perf_counter()
        fig_dict = fig.to_dict()
        ser_elapsed = time.perf_counter() - ser_start
        trace_count = len(fig_dict.get("data", []))
        total_points = 0
        for tr in fig_dict.get("data", []):
            for k in ("x", "y", "z", "value"):
                if k in tr and hasattr(tr[k], "__len__"):
                    try:
                        total_points += len(tr[k])
                    except Exception:
                        pass
        ser_size = len(json.dumps(fig_dict))
        timings["fig_trace_count"] = trace_count
        timings["fig_total_points"] = total_points
        timings["fig_serialization_size_bytes"] = ser_size
        timings["fig_serialization_time_s"] = ser_elapsed
    except Exception as e:
        logger.error(f"Failed to compute figure metadata: {e}")

    # Submit all 6 writes concurrently
    future_map = {}
    if export_pool:
        fig_dict = fig.to_dict()
        for variant, fmt, path in outs:
            local_fig_dict = fig_dict if variant == "light" else dark_fig.to_dict()
            future = export_pool.submit(_write_image_worker, local_fig_dict, str(path))
            future_map[future] = (variant, fmt, path)

        for fut in as_completed(future_map):
            variant, fmt, path = future_map[fut]
            try:
                path_str, elapsed = fut.result()
                key = f"{fmt}_{variant}"
                saved_paths[key] = path_str
                timings[key] = elapsed
            except Exception as e:
                logger.error(f"Failed to write {variant} {fmt} via process pool: {e}")
                timings[f"{fmt}_{variant}"] = None
    else:
        # Fallback to ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=min(6, (os.cpu_count() or 1))) as ex:
            for variant, fmt, path in outs:
                local_fig = dark_fig if variant == "dark" else fig
                future = ex.submit(_write_and_time, local_fig, str(path))
                future_map[future] = (variant, fmt, path)

            for fut in as_completed(future_map):
                variant, fmt, path = future_map[fut]
                try:
                    path_str, elapsed = fut.result()
                    key = f"{fmt}_{variant}"
                    saved_paths[key] = path_str
                    timings[key] = elapsed
                except Exception as e:
                    logger.error(
                        f"Failed to write {variant} {fmt} via thread pool: {e}"
                    )
                    timings[f"{fmt}_{variant}"] = None

    # Create a zip archive
    tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp_zip.close()
    with zipfile.ZipFile(tmp_zip.name, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in saved_paths.values():
            zf.write(p, arcname=Path(p).name)
        try:
            timings_bytes = json.dumps(timings, indent=2).encode("utf-8")
            zf.writestr("timings.json", timings_bytes)
        except Exception as e:
            logger.error(f"Failed to write timings.json into zip: {e}")

    return {
        "zip_path": tmp_zip.name,
        "zip_filename": f"{dataset_uuid}__{ts}__plot_images.zip",
        "saved_paths": saved_paths,
        "timings": timings,
    }


async def _run_export_task(
    task_id: str,
    plot_json: Dict,
    disk_fpath: str,
    relayout_data: Dict | None = None,
    export_pool=None,
) -> None:
    """
    Background task to run export in executor.

    """
    try:
        logger.info(f"Starting export task {task_id}")
        loop = asyncio.get_event_loop()

        # Run the blocking export function in executor
        result = await loop.run_in_executor(
            None,  # Use default executor
            _export_plot_images_sync,
            plot_json,
            disk_fpath,
            relayout_data,
            export_pool,
        )

        # Update task status
        _export_tasks[task_id]["status"] = "completed"
        _export_tasks[task_id]["result"] = result
        _export_tasks[task_id]["zip_path"] = result["zip_path"]
        _export_tasks[task_id]["zip_filename"] = result["zip_filename"]
        logger.info(f"Export task {task_id} completed successfully")

    except Exception as e:
        logger.error(f"Export task {task_id} failed: {e}", exc_info=True)
        _export_tasks[task_id]["status"] = "failed"
        _export_tasks[task_id]["error"] = str(e)


def _resolve_fpath_to_disk(fpath: str) -> str:
    """
    Resolve a file path to its disk location.

    For memory:// paths (live measurements), query the live_measurements DB
    to get the actual disk path. For regular paths, return as-is.

    Args:
        fpath: File path, may be memory://measurement_id or regular disk path

    Returns:
        Disk path to the dataset

    Raises:
        ValueError: If memory:// path cannot be resolved to disk

    """
    if fpath.startswith(MEMORY_PROTOCOL):
        # Extract measurement ID from memory://
        measurement_id = fpath[len(MEMORY_PROTOCOL) :]

        # Query DB for disk path
        info = live_measurements.get_measurement_info(measurement_id)
        if not info or not info.fpath:
            raise ValueError(
                f"Cannot resolve memory path '{measurement_id}' to disk. "
                f"Measurement not found in database or has no disk path."
            )

        disk_path = info.fpath
        logger.info(f"Resolved memory://{measurement_id} to disk path: {disk_path}")
        return disk_path

    # Regular disk path, return as-is
    return fpath


# NOTE: Worker function must be module-level (picklable) for ProcessPoolExecutor on Windows
def _write_image_worker(fig_dict: Dict, path_str: str) -> tuple[str, float]:
    """
    Reconstruct a figure from a dict and write image to path_str.

    Args:
        fig_dict (Dict): dict representation of a Plotly figure
        path_str (str): output file path

    Returns:
        tuple[str, float]: (path_str, elapsed_seconds)

    """
    import time

    import plotly.io as pio
    from plotly import graph_objects as go

    fig = go.Figure(fig_dict)
    # use same size/DPI targets as main process
    # TODOLATER: Optimize # CONCERN:
    # _width = 1920
    # _height = 1080
    # _scale = 300.0 / 96.0
    start = time.perf_counter()
    pio.write_image(
        fig,
        path_str,
        # width=_width,
        # height=_height,
        # scale=_scale,
    )
    return path_str, time.perf_counter() - start


def _save_light_dark_pngs(
    plot_json: Dict,
    fpath: str,
    ts: str | None = None,
    only_light: bool = False,
    relayout_data: Dict | None = None,
) -> Dict:
    """
    Save only PNGs for light and dark variants and return paths dict.

    Args:
        plot_json: Plotly figure JSON
        fpath: dataset .zarr path (may be memory:// path)
        ts: optional timestamp string to include in filename; if None, use current time
        only_light: if True, only save the light variant PNG
        relayout_data: optional relayout data to apply

    Returns:
        Dict: keys: 'png_light', 'png_dark' (if only_light is False)

    """
    # Resolve memory:// paths to disk paths
    disk_fpath = _resolve_fpath_to_disk(fpath)

    dataset_path = Path(disk_fpath)
    dataset_uuid = dataset_path.stem
    extras_dir = dataset_path.parent / dataset_uuid
    extras_dir.mkdir(parents=True, exist_ok=True)

    # timestamp
    if not ts:
        ts = datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
    base_filename = extras_dir / f"{dataset_uuid}__{ts}__plot"

    # Convert incoming JSON to a Figure
    try:
        fig = go.Figure(plot_json)
    except Exception:
        fig = go.Figure(plot_json)

    # Apply relayout data if provided (preserves zoom/pan state)
    if relayout_data:
        try:
            # Convert flat relayout keys to nested structure
            nested_layout: Dict = {}
            for key, value in relayout_data.items():
                # Handle array index notation like 'xaxis.range[0]'
                if "[" in key and "]" in key:
                    base_key, index_part = key.split("[", 1)
                    index = int(index_part.rstrip("]"))
                    # Handle nested keys like 'xaxis.range'
                    if "." in base_key:
                        parts = base_key.split(".")
                        current = nested_layout
                        for part in parts[:-1]:
                            if part not in current:
                                current[part] = {}
                            current = current[part]
                        if parts[-1] not in current:
                            current[parts[-1]] = []
                        array = current[parts[-1]]
                    else:
                        if base_key not in nested_layout:
                            nested_layout[base_key] = []
                        array = nested_layout[base_key]

                    # Extend array if needed
                    while len(array) <= index:
                        array.append(None)
                    array[index] = value
                else:
                    # Simple key-value pairs
                    nested_layout[key] = value

            fig.update_layout(nested_layout)
        except Exception as e:
            logger.error(f"Failed to apply relayout data: {e}")
            # Continue without relayout data

    # Ensure transparent background
    fig.update_layout(paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)")

    saved = {}
    # Prepare output paths
    out_light = base_filename.with_name(base_filename.name + "_light").with_suffix(
        ".png"
    )
    out_dark = base_filename.with_name(base_filename.name + "_dark").with_suffix(".png")

    # target size and DPI
    # TODOLATER: Optimize # CONCERN:
    # _width = 1920
    # _height = 1080
    # _scale = 300.0 / 96.0  # approximate scale to achieve 300 DPI from default 96

    if only_light:
        # Only write the light PNG
        try:
            pio.write_image(
                fig,
                str(out_light),
                # width=_width,
                # height=_height,
                # scale=_scale,
            )
            saved["png_light"] = str(out_light)
        except Exception as e:
            logger.error(f"Failed to write light png: {e}")
        return saved

    # Dark variant figure
    axis_style_dark = {
        "title": {"font": {"color": "white"}},
        "linecolor": "white",
        "tickfont": {"color": "white"},
        "tickcolor": "white",
        "minor": {"tickcolor": "white"},
    }
    dark_fig = go.Figure(fig.to_dict())  # Copy of the original
    dark_fig.update_layout(
        title_font_color="white",
        font=dict(
            color="white"
        ),  # Set global font color to white for all text including colorbar
        xaxis=axis_style_dark,
        yaxis=axis_style_dark,
    )
    # Update coloraxis for heatmap colorbar labels
    dark_fig.update_coloraxes(
        colorbar=dict(
            title=dict(font=dict(color="white")),
            tickfont=dict(color="white"),
            tickcolor="white",
            outlinecolor="white",
        )
    )

    # Write light & dark PNGs in parallel to avoid repeated engine startup overhead
    try:
        with ThreadPoolExecutor(max_workers=2) as ex:
            futures = {
                ex.submit(
                    pio.write_image,
                    fig,
                    str(out_light),
                    # width=_width,
                    # height=_height,
                    # scale=_scale,
                ): "light",
                ex.submit(
                    pio.write_image,
                    dark_fig,
                    str(out_dark),
                    # width=_width,
                    # height=_height,
                    # scale=_scale,
                ): "dark",
            }
            for fut in as_completed(futures):
                variant = futures[fut]
                try:
                    fut.result()
                    if variant == "light":
                        saved["png_light"] = str(out_light)
                    else:
                        saved["png_dark"] = str(out_dark)
                except Exception as e:
                    logger.error(f"Failed to write {variant} png: {e}")
    except Exception as e:
        # fallback: try sequential writes
        logger.error(f"Parallel PNG write failed, falling back to sequential: {e}")
        try:
            pio.write_image(
                fig,
                str(out_light),
                # width=_width,
                # height=_height,
                # scale=_scale,
            )
            saved["png_light"] = str(out_light)
        except Exception as e2:
            logger.error(f"Failed to write light png: {e2}")
        try:
            pio.write_image(
                dark_fig,
                str(out_dark),
                # width=_width,
                # height=_height,
                # scale=_scale,
            )
            saved["png_dark"] = str(out_dark)
        except Exception as e3:
            logger.error(f"Failed to write dark png: {e3}")

    return saved


@router.post("/export-plot-images")
async def export_plot_images(request: Request) -> JSONResponse:
    """
    Endpoint to export Plotly plot images in multiple formats (non-blocking).

    Returns immediately with a task_id. Client should poll /export-plot-images/status/{task_id}
    to check completion and get download URL.

    Expects JSON payload with:
    - plot_json: JSON representation of the Plotly figure
    - fpath: dataset path (supports memory:// paths)
    - relayout_data: Optional dict with zoom/pan layout changes to preserve in export

    """
    # Clean up old tasks periodically
    _cleanup_old_tasks()

    data = await request.json()
    plot_json = data.get("plot_json")
    fpath = data.get("fpath")
    relayout_data = data.get("relayout_data")
    if not plot_json or not fpath:
        return JSONResponse(
            status_code=400,
            content={"success": False, "message": "Missing plot_json or fpath"},
        )

    try:
        # Resolve memory:// paths to disk paths
        disk_fpath = _resolve_fpath_to_disk(fpath)

        # Create task
        task_id = str(uuid.uuid4())
        _export_tasks[task_id] = {
            "status": "pending",
            "created_at": datetime.now(),
            "result": None,
            "error": None,
            "zip_path": None,
        }

        # Get export pool if available
        export_pool = None
        try:
            export_pool = request.app.state.export_pool
        except Exception:
            pass

        # Start background task
        asyncio.create_task(
            _run_export_task(task_id, plot_json, disk_fpath, relayout_data, export_pool)
        )

        logger.info(f"Created export task {task_id} for {fpath}")

        return JSONResponse(
            status_code=202,  # Accepted
            content={
                "success": True,
                "task_id": task_id,
                "status": "pending",
                "message": "Export started. Poll /export-plot-images/status/{task_id} for status.",
            },
        )

    except ValueError as e:
        # Path resolution error
        logger.error(f"Failed to resolve path {fpath}: {e}")
        return JSONResponse(
            status_code=400, content={"success": False, "message": str(e)}
        )
    except Exception as e:
        logger.error(f"Failed to start export task: {e}", exc_info=True)
        return JSONResponse(
            status_code=500, content={"success": False, "message": str(e)}
        )


@router.get("/export-plot-images/status/{task_id}")
async def get_export_status(task_id: str) -> JSONResponse:
    """
    Check the status of an export task.

    Returns:
        - status: "pending", "completed", or "failed"
        - download_url: URL to download zip (if completed)
        - error: error message (if failed)
    """
    task = _export_tasks.get(task_id)
    if not task:
        return JSONResponse(
            status_code=404, content={"success": False, "message": "Task not found"}
        )

    response = {
        "success": True,
        "task_id": task_id,
        "status": task["status"],
    }

    if task["status"] == "completed":
        response["download_url"] = f"/export-plot-images/download/{task_id}"
        response["zip_filename"] = task.get("result", {}).get(
            "zip_filename", "plot_images.zip"
        )
    elif task["status"] == "failed":
        response["error"] = task.get("error", "Unknown error")

    return JSONResponse(content=response)


@router.get("/export-plot-images/download/{task_id}")
async def download_export(task_id: str):
    """
    Download the exported zip file for a completed task.
    """
    task = _export_tasks.get(task_id)
    if not task:
        return JSONResponse(
            status_code=404, content={"success": False, "message": "Task not found"}
        )

    if task["status"] != "completed":
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "message": f"Task status is {task['status']}, not completed",
            },
        )

    zip_path = task.get("zip_path")
    if not zip_path or not os.path.exists(zip_path):
        return JSONResponse(
            status_code=404,
            content={"success": False, "message": "Export file not found"},
        )

    zip_filename = task.get("zip_filename", "plot_images.zip")
    return FileResponse(
        path=zip_path, media_type="application/zip", filename=zip_filename
    )


@router.post("/export-plot-images/send-to-notes")
async def export_and_send_to_notes(request: Request) -> JSONResponse:
    """
    Save light/dark PNGs and append a markdown image link to the notes file for the dataset.

    Expects JSON payload with:
    - plot_json: Plotly figure JSON
    - fpath: dataset .zarr path
    - relayout_data: Optional dict with zoom/pan layout changes to preserve in export

    """
    data = await request.json()
    plot_json = data.get("plot_json")
    fpath = data.get("fpath")
    relayout_data = data.get("relayout_data")
    if not plot_json or not fpath:
        return JSONResponse(
            status_code=400,
            content={"success": False, "message": "Missing plot_json or fpath"},
        )

    try:
        ts = datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
        saved = _save_light_dark_pngs(
            plot_json, fpath, ts=ts, relayout_data=relayout_data
        )

        # Resolve memory:// paths to disk paths for notes file operations
        disk_fpath = _resolve_fpath_to_disk(fpath)

        # Append markdown image link for the light image to the notes.md
        dataset_path = Path(disk_fpath)
        dataset_uuid = dataset_path.stem
        notes_dir = dataset_path.parent / dataset_uuid
        notes_dir.mkdir(parents=True, exist_ok=True)
        notes_path = notes_dir / f"{dataset_uuid}.md"

        # Ensure notes file exists
        if not notes_path.exists():
            with open(notes_path, "w", encoding="utf-8") as f:
                f.write("")

        # Build image path like <dataset_uuid>/<image_filename>
        light_path = Path(saved.get("png_light"))
        md_path = f"{dataset_uuid}/{light_path.name}"
        md_line = f"![plot]({md_path})\n"

        with open(notes_path, "a", encoding="utf-8") as f:
            f.write("\n" + md_line)

        return JSONResponse(
            status_code=200,
            content={
                "success": True,
                "message": "Saved images and appended note link.",
                "paths": saved,
                "md_line": md_line,
            },
        )

    except Exception as e:
        logger.error(f"Failed to export and send to notes: {e}")
        return JSONResponse(
            status_code=500, content={"success": False, "message": str(e)}
        )


@router.get("/export-plot-images/send-to-notes")
async def export_send_to_notes_get(fpath: str) -> JSONResponse:
    """
    Return saved png paths for the given dataset extras folder (light/dark)

    Args:
        fpath (str): dataset .zarr path

    Returns:
        JSONResponse: success status and paths dict

    """
    try:
        # Resolve memory:// paths to disk paths
        disk_fpath = _resolve_fpath_to_disk(fpath)

        dataset_path = Path(disk_fpath)
        dataset_uuid = dataset_path.stem
        extras_dir = dataset_path.parent / dataset_uuid
        if not extras_dir.exists():
            return JSONResponse(status_code=200, content={"success": True, "paths": {}})

        # Find png files for this timestamped base name pattern
        pngs = {}
        for p in extras_dir.glob(f"{dataset_uuid}__*__plot*_light.png"):
            pngs["png_light"] = str(p)
        for p in extras_dir.glob(f"{dataset_uuid}__*__plot*_dark.png"):
            pngs["png_dark"] = str(p)

        return JSONResponse(status_code=200, content={"success": True, "paths": pngs})

    except Exception as e:
        logger.error(f"Failed to list saved pngs: {e}")
        return JSONResponse(
            status_code=500, content={"success": False, "message": str(e)}
        )
