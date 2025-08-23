"""
FastAPI endpoint to export Plotly plots as PNG, PDF and SVG.

"""

import os
import time
import json
import zipfile
import tempfile
import plotly.io as pio

from typing import Dict
from datetime import datetime
from pathlib import Path
from plotly import graph_objects as go
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, FileResponse
from concurrent.futures import ThreadPoolExecutor, as_completed


# Local imports
from .logger import logger


router = APIRouter()


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
    plot_json, fpath, ts: str | None = None, only_light: bool = False
) -> Dict:
    """
    Save only PNGs for light and dark variants and return paths dict.

    Args:
        plot_json: Plotly figure JSON
        fpath: dataset .zarr path
        ts: optional timestamp string to include in filename; if None, use current time
        only_light: if True, only save the light variant PNG

    Returns:
        Dict: keys: 'png_light', 'png_dark' (if only_light is False)

    """
    dataset_path = Path(fpath)
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
        xaxis=axis_style_dark,
        yaxis=axis_style_dark,
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
    Endpoint to export Plotly plot images in multiple formats.

    Expects JSON payload with:
    - plot_json: JSON representation of the Plotly figure

    """
    data = await request.json()
    plot_json = data.get("plot_json")
    fpath = data.get("fpath")
    if not plot_json or not fpath:
        return JSONResponse(
            status_code=400,
            content={"success": False, "message": "Missing plot_json or fpath"},
        )

    try:
        # Determine folder to save - "extras" (same as notes.py logic)
        dataset_path = Path(fpath)
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

        # Ensure transparent background
        fig.update_layout(paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)")

        # Prepare output paths for light and dark variants
        saved_paths = {}
        outs = []
        for variant in ("light", "dark"):
            for fmt in ("png", "svg"):
                name = f"{base_filename.name}_{variant}.{fmt}"
                path = base_filename.with_name(name)
                # choose fig: dark uses dark_fig (constructed below)
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
            xaxis=axis_style_dark,
            yaxis=axis_style_dark,
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

        # figure metadata: trace count, total points (approx), serialized size and time
        timings = {}
        try:
            ser_start = time.perf_counter()
            fig_dict = fig.to_dict()
            ser_elapsed = time.perf_counter() - ser_start
            trace_count = len(fig_dict.get("data", []))
            total_points = 0
            for tr in fig_dict.get("data", []):
                # best-effort count points from common array fields
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
        # Submit all 6 writes concurrently. Prefer a pre-spawned ProcessPoolExecutor
        # available on the app state (created at startup) to avoid per-request spawn cost.
        future_map = {}
        pool = None
        try:
            pool = request.app.state.export_pool
        except Exception:
            pool = None

        if pool:
            # Submit picklable jobs to the process pool using fig.to_dict()
            fig_dict = fig.to_dict()
            for variant, fmt, path in outs:
                local_fig_dict = fig_dict if variant == "light" else dark_fig.to_dict()
                future = pool.submit(_write_image_worker, local_fig_dict, str(path))
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
                        f"Failed to write {variant} {fmt} via process pool: {e}"
                    )
                    timings[f"{fmt}_{variant}"] = None
        else:
            # Fallback to a local ThreadPoolExecutor
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

        # Create a zip archive of all exported images and send as a download
        try:
            tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
            tmp_zip.close()
            with zipfile.ZipFile(tmp_zip.name, "w", zipfile.ZIP_DEFLATED) as zf:
                # add written files and a timings.json to the archive
                for p in saved_paths.values():
                    # add file with just the filename inside the archive
                    zf.write(p, arcname=Path(p).name)

                # include timings.json for inspection
                try:
                    timings_bytes = json.dumps(timings, indent=2).encode("utf-8")
                    zf.writestr("timings.json", timings_bytes)
                except Exception as e:
                    logger.error(f"Failed to write timings.json into zip: {e}")

            zip_filename = f"{dataset_uuid}__{ts}__plot_images.zip"
            return FileResponse(
                path=tmp_zip.name, media_type="application/zip", filename=zip_filename
            )
        except Exception as e:
            logger.error(f"Failed to create zip archive: {e}")
            # Fall back to returning JSON paths if zipping failed
            return JSONResponse(
                status_code=200,
                content={
                    "success": True,
                    "message": "Plot images saved, but failed to create zip.",
                    "paths": saved_paths,
                },
            )

    except Exception as e:
        logger.error(f"Failed to export plot images: {e}")
        return JSONResponse(
            status_code=500, content={"success": False, "message": str(e)}
        )


@router.post("/export-plot-images/send-to-notes")
async def export_and_send_to_notes(request: Request) -> JSONResponse:
    """
    Save light/dark PNGs and append a markdown image link to the notes file for the dataset.

    Expects JSON payload with:
    - plot_json: Plotly figure JSON
    - fpath: dataset .zarr path

    """
    data = await request.json()
    plot_json = data.get("plot_json")
    fpath = data.get("fpath")
    if not plot_json or not fpath:
        return JSONResponse(
            status_code=400,
            content={"success": False, "message": "Missing plot_json or fpath"},
        )

    try:
        ts = datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
        saved = _save_light_dark_pngs(plot_json, fpath, ts=ts)

        # Append markdown image link for the light image to the notes.md
        dataset_path = Path(fpath)
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
        dataset_path = Path(fpath)
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
