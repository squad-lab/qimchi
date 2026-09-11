"""
FastAPI endpoint to export Plotly plots as PNG, PDF and SVG.

"""

import asyncio
import base64
import json
import os
import shutil
import sys
import tempfile
import time
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from html import escape
from pathlib import Path
from typing import Any, Dict

import plotly.io as pio
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse
from plotly import graph_objects as go

from .data_loader import resolve_to_disk_path

# Local imports
from .logger import logger
from .notes import (
    _make_frontmatter,
    _measurement_notes_paths,
    _parse_frontmatter,
    append_sample_rollup,
)

router = APIRouter()


# In-memory task registry for export tasks
# Structure: { task_id: { "status": "pending|completed|failed", "result": {...}, "error": str, "created_at": datetime, "zip_path": str } }
_export_tasks: Dict[str, Dict] = {}

_FILTER_DISPLAY_NAMES = {
    "diff": "Differentiate",
    "diff_x": "Diff along Y",
    "diff_y": "Diff along X",
    "savgol": "Savitzky-Golay",
    "sma": "Moving Average",
    "normalize": "Normalize",
    "gamma_corr": "Gamma Correction",
    "log_corr": "Log Correction",
    "sig_corr": "Sigmoid Correction",
    "rescale_intensity": "Rescale Intensity",
    "log_scale": "Log Scale",
    "polyfit": "Polynomial Fit",
    "transform": "Scale",
    "rotate": "Rotate Heatmap",
    "flip": "Flip Heatmap",
    "bg_corr_constant": "BG Correction (Constant)",
    "bg_corr_linear": "BG Correction (Linear)",
    "bg_corr_row_mean": "BG Correction (Row Mean)",
    "bg_corr_col_mean": "BG Correction (Column Mean)",
    "bg_corr_plane": "BG Correction (Plane)",
}

_MEASUREMENT_INFO_FIELDS = (
    ("Timestamp", ("Timestamp", "timestamp")),
    ("Cryostat", ("Cryostat", "cryostat")),
    ("Wafer ID", ("Wafer ID", "wafer_id")),
    ("Device Type", ("Device Type", "device_type")),
    ("Sample Name", ("Sample Name", "sample_name")),
    ("Experiment Name", ("Experiment Name", "experiment_name")),
    ("Measurement ID", ("Measurement ID", "measurement_id")),
)

_PLOTLY_DEFAULT_WIDTH = int(getattr(pio.defaults, "default_width", 700) or 700)
_PLOTLY_DEFAULT_HEIGHT = int(getattr(pio.defaults, "default_height", 500) or 500)
_EXPORT_INFO_FONT_FAMILY = "monospace"
_FIRA_SANS_WEIGHTS = (400, 500, 600, 700)
_MATHJAX_FIRA_SVG_URL = (
    "https://cdn.jsdelivr.net/npm/@mathjax/mathjax-fira-font@4.1.3/"
    "tex-mml-svg-mathjax-fira.js"
)


def _find_fira_sans_fonts() -> dict[int, Path]:
    """Locate the bundled frontend font files in dev, Docker, and frozen builds."""
    project_root = Path(__file__).resolve().parents[2]
    asset_roots = [
        project_root / "frontend" / "dist" / "assets",
        Path("/app/frontend/dist/assets"),
    ]
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        asset_roots.insert(0, Path(sys._MEIPASS) / "frontend" / "dist" / "assets")  # type: ignore[attr-defined]

    for root in asset_roots:
        found: dict[int, Path] = {}
        for weight in _FIRA_SANS_WEIGHTS:
            matches = sorted(root.glob(f"fira-sans-latin-{weight}-normal*.woff2"))
            if matches:
                found[weight] = matches[0]
        if len(found) == len(_FIRA_SANS_WEIGHTS):
            return found

    source_root = (
        project_root
        / "frontend"
        / "node_modules"
        / "@fontsource"
        / "fira-sans"
        / "files"
    )
    source_fonts = {
        weight: source_root / f"fira-sans-latin-{weight}-normal.woff2"
        for weight in _FIRA_SANS_WEIGHTS
    }
    return source_fonts if all(path.is_file() for path in source_fonts.values()) else {}


def _fira_sans_font_faces(fonts: dict[int, Path]) -> str:
    """Return self-contained font-face rules suitable for HTML or SVG."""
    return "\n".join(
        (
            "@font-face {"
            "font-family:'Fira Sans';"
            "font-style:normal;"
            f"font-weight:{weight};"
            "font-display:block;"
            "src:url('data:font/woff2;base64,"
            f"{base64.b64encode(path.read_bytes()).decode('ascii')}"
            "') format('woff2');"
            "}"
        )
        for weight, path in fonts.items()
    )


def _embed_fira_sans_in_svg(path: str | Path) -> None:
    """Make an exported SVG portable instead of relying on installed fonts."""
    svg_path = Path(path)
    if svg_path.suffix.lower() != ".svg":
        return

    fonts = _find_fira_sans_fonts()
    if not fonts:
        logger.warning("Could not embed Fira Sans in SVG %s", svg_path)
        return

    svg = svg_path.read_text(encoding="utf-8")
    if 'id="qimchi-export-fonts"' in svg:
        return
    opening_tag_end = svg.find(">")
    if opening_tag_end < 0:
        logger.warning("Could not find the opening tag in SVG %s", svg_path)
        return

    embedded_style = (
        '<defs><style id="qimchi-export-fonts" type="text/css"><![CDATA['
        f"{_fira_sans_font_faces(fonts)}"
        "]]></style></defs>"
    )
    svg_path.write_text(
        f"{svg[: opening_tag_end + 1]}{embedded_style}{svg[opening_tag_end + 1 :]}",
        encoding="utf-8",
    )


def export_page_generator():
    """Build Kaleido's page with Qimchi's Fira text and mathematics fonts."""
    from kaleido import PageGenerator

    base = PageGenerator(mathjax=_MATHJAX_FIRA_SVG_URL)
    fonts = _find_fira_sans_fonts()
    if not fonts:
        logger.warning(
            "Bundled Fira Sans files were not found; exports may use a fallback"
        )
        return base

    font_faces = _fira_sans_font_faces(fonts)
    font_loads = ",".join(
        (
            f"document.fonts.load('{weight} 16px \"Fira Sans\"')"
            ".then((faces) => {"
            "if (!faces.length) throw new Error('Fira Sans did not load');"
            "return faces;"
            "})"
        )
        for weight in fonts
    )
    injection = f"""
        <style id="qimchi-export-fonts">{font_faces}</style>
        <script>
          (() => {{
            const qimchiFontsReady = Promise.all([{font_loads}])
              .then(() => document.fonts.ready);
            const qimchiMathReady = window.MathJax?.startup?.promise
              ?? Promise.resolve();
            const qimchiExportReady = Promise.all([
              qimchiFontsReady,
              qimchiMathReady,
            ]);
            const plotlyToImage = Plotly.toImage.bind(Plotly);
            Plotly.toImage = (...args) => qimchiExportReady
              .then(() => plotlyToImage(...args));
            window.qimchiFontsReady = qimchiFontsReady;
            window.qimchiExportReady = qimchiExportReady;
          }})();
        </script>
    """

    class QimchiExportPage:
        def generate_index(self) -> str:
            return base.generate_index().replace("</head>", f"{injection}</head>", 1)

    return QimchiExportPage()


def _write_plotly_image(
    fig: go.Figure | Dict,
    path: str | Path,
    *,
    width: int | None = None,
    height: int | None = None,
    scale: float | None = None,
) -> None:
    """Write through Kaleido without re-supplying options to its live server.

    Plotly's ``write_image`` currently always forwards a non-empty ``kopts``
    dictionary. Kaleido ignores that dictionary, and emits a warning, when its
    persistent sync server is running. Qimchi configures that server once with
    :func:`export_page_generator`, so forwarding the page options per render is
    both redundant and noisy.

    If this function is used without the persistent server, the same custom
    page is supplied to the one-shot Kaleido instance so font and MathJax
    rendering remain identical.
    """
    import kaleido

    target = Path(path)
    figure_layout = (
        fig.layout.to_plotly_json()
        if isinstance(fig, go.Figure)
        else fig.get("layout", {})
    )
    template_layout = figure_layout.get("template", {}).get("layout", {})
    opts = {
        "format": target.suffix.lstrip(".").lower()
        or getattr(pio.defaults, "default_format", "png"),
        "width": width
        or figure_layout.get("width")
        or template_layout.get("width")
        or _PLOTLY_DEFAULT_WIDTH,
        "height": height
        or figure_layout.get("height")
        or template_layout.get("height")
        or _PLOTLY_DEFAULT_HEIGHT,
        "scale": scale or getattr(pio.defaults, "default_scale", 1) or 1,
    }
    server = getattr(kaleido, "_global_server", None)
    server_running = bool(server and server.is_running())
    kwargs: Dict[str, Any] = {"topojson": getattr(pio.defaults, "topojson", None)}
    if not server_running:
        kwargs["kopts"] = {"page_generator": export_page_generator()}

    image_bytes = kaleido.calc_fig_sync(fig, opts=opts, **kwargs)
    if isinstance(image_bytes, str):
        image_bytes = image_bytes.encode("utf-8")
    target.write_bytes(image_bytes)
    _embed_fira_sans_in_svg(target)


def _add_export_info_footer(
    fig: go.Figure,
    applied_filters: list[Dict] | None,
    measurement_info: Dict | None = None,
    custom_tags: list[str] | None = None,
    *,
    dark: bool = False,
    base_width: int = _PLOTLY_DEFAULT_WIDTH,
    base_height: int = _PLOTLY_DEFAULT_HEIGHT,
) -> None:
    """Append export details without changing the original plot canvas."""
    info_lines = []
    if isinstance(measurement_info, dict):
        consumed_keys = set()
        for label, aliases in _MEASUREMENT_INFO_FIELDS:
            consumed_keys.update(aliases)
            value = next(
                (
                    measurement_info.get(alias)
                    for alias in aliases
                    if measurement_info.get(alias) not in (None, "", "N/A")
                ),
                None,
            )
            if value is not None:
                info_lines.append(f"<b>{label}:</b> {escape(str(value))}")

        for key, value in measurement_info.items():
            if key in consumed_keys or key in (
                "independents",
                "dependents",
                "Size",
                "size",
            ):
                continue
            if value in (None, "", "N/A"):
                continue
            label = str(key).replace("_", " ").title()
            info_lines.append(f"<b>{escape(label)}:</b> {escape(str(value))}")

    tag_names = sorted(
        {
            tag.strip()
            for tag in custom_tags or []
            if isinstance(tag, str) and tag.strip()
        },
        key=str.casefold,
    )

    entries = []
    for applied_filter in applied_filters or []:
        if not isinstance(applied_filter, dict):
            continue
        filter_name = str(applied_filter.get("name", "")).strip()
        if not filter_name:
            continue
        display_name = _FILTER_DISPLAY_NAMES.get(
            filter_name, filter_name.replace("_", " ").title()
        )
        entries.append(escape(display_name))

    if not info_lines and not entries and not tag_names:
        return

    current_bottom = (
        fig.layout.margin.b if fig.layout.margin and fig.layout.margin.b else 80
    )
    footer_lines = [
        *info_lines,
        f"<b>Custom Tags:</b> {', '.join(escape(tag) for tag in tag_names) if tag_names else 'None'}",
        f"<b>Applied Filters:</b> {' -> '.join(entries) if entries else 'None'}",
    ]
    footer_height = 42 + 19 * len(footer_lines)
    current_width = fig.layout.width or base_width
    current_height = fig.layout.height or base_height
    fig.update_layout(
        width=current_width,
        height=current_height + footer_height,
        margin=dict(b=current_bottom + footer_height),
    )
    fig.add_annotation(
        name="qimchi-export-info",
        text="<br>".join(footer_lines),
        x=0,
        y=0,
        xref="paper",
        yref="paper",
        xanchor="left",
        yanchor="top",
        yshift=-(current_bottom + 22),
        align="left",
        showarrow=False,
        font=dict(
            family=_EXPORT_INFO_FONT_FAMILY,
            size=15,
            color="#e5e7eb" if dark else "#374151",
        ),
    )


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
    applied_filters: list[Dict] | None = None,
    measurement_info: Dict | None = None,
) -> Dict:
    """
    Synchronous function to export plot images (runs in executor).

    Args:
        plot_json (Dict): Plotly figure JSON
        disk_fpath (str): dataset .zarr path on disk
        relayout_data (Dict | None): optional relayout data to apply
        export_pool: optional ProcessPoolExecutor for parallel writes
        applied_filters (list[Dict] | None): ordered filters to print below the plot
        measurement_info (Dict | None): Basket hover-card fields to print below the plot

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
    write_errors: list[str] = []
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
    # Process workers use Plotly's native export size. The thread
    # fallback historically requests 1920 x 1080. Reserve that exact original
    # canvas, then let the footer extend only the image height below it.
    base_width, base_height = (
        (_PLOTLY_DEFAULT_WIDTH, _PLOTLY_DEFAULT_HEIGHT) if export_pool else (1920, 1080)
    )
    export_meta = _library_metadata(dataset_path, dataset_uuid)
    custom_tags = export_meta.get("tags", [])
    _add_export_info_footer(
        fig,
        applied_filters,
        measurement_info,
        custom_tags,
        base_width=base_width,
        base_height=base_height,
    )
    _add_export_info_footer(
        dark_fig,
        applied_filters,
        measurement_info,
        custom_tags,
        dark=True,
        base_width=base_width,
        base_height=base_height,
    )

    # helper to write and time a single write
    def _write_and_time(local_fig, local_path_str):
        _width = int(local_fig.layout.width or 1920)
        _height = int(local_fig.layout.height or 1080)
        _scale = 300.0 / 96.0
        start = time.perf_counter()
        _write_plotly_image(
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
                write_errors.append(f"{variant} {fmt}: {e}")
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
                    write_errors.append(f"{variant} {fmt}: {e}")

    # Every variant failed. Zipping timings.json and metadata.json alone yields
    # an archive that looks like a successful export but contains no plot, and
    # the task would report success -- so fail the task instead.
    if not saved_paths:
        detail = "; ".join(write_errors) or "no writer produced a file"
        raise RuntimeError(f"Plot image export produced no images: {detail}")

    # Create a zip archive
    tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp_zip.close()
    if applied_filters:
        export_meta["applied_filters"] = applied_filters
    if measurement_info:
        export_meta["measurement_info"] = measurement_info
    for p in saved_paths.values():
        if str(p).lower().endswith(".png"):
            _embed_png_metadata(p, export_meta)

    with zipfile.ZipFile(tmp_zip.name, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in saved_paths.values():
            zf.write(p, arcname=Path(p).name)
        try:
            timings_bytes = json.dumps(timings, indent=2).encode("utf-8")
            zf.writestr("timings.json", timings_bytes)
        except Exception as e:
            logger.error(f"Failed to write timings.json into zip: {e}")
        try:
            # The same metadata the PNGs carry in their chunks, as a file --
            # greppable, and it survives anything that re-encodes the image.
            zf.writestr("metadata.json", json.dumps(export_meta, indent=2))
        except Exception as e:
            logger.error(f"Failed to write metadata.json into zip: {e}")

    return {
        "zip_path": tmp_zip.name,
        "zip_filename": f"{dataset_uuid}__{ts}__plot_images.zip",
        "saved_paths": saved_paths,
        "timings": timings,
    }


def _desktop_export_dir() -> Path | None:
    """
    Directory to save export zips into when running as the desktop app.

    The pywebview/WebView2 shell silently drops browser-initiated downloads,
    so in desktop mode the backend (which is local) writes the zip to disk
    itself. Returns None in server/Docker mode, where the browser handles the
    download as before. # TODO: Remove if webview is the only target.

    Controlled by env: QIMCHI_DESKTOP=1 enables it; QIMCHI_EXPORT_DIR overrides
    the destination (default: ~/Downloads). Set by the desktop launcher.

    """
    if os.environ.get("QIMCHI_DESKTOP", "").lower() not in ("1", "true", "yes"):
        return None
    override = os.environ.get("QIMCHI_EXPORT_DIR")
    target = Path(override).expanduser() if override else (Path.home() / "Downloads")
    try:
        target.mkdir(parents=True, exist_ok=True)
        return target
    except OSError:
        logger.exception("Could not create desktop export dir %s", target)
        return None


async def _run_export_task(
    task_id: str,
    plot_json: Dict,
    disk_fpath: str,
    relayout_data: Dict | None = None,
    export_pool=None,
    applied_filters: list[Dict] | None = None,
    measurement_info: Dict | None = None,
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
            applied_filters,
            measurement_info,
        )

        # Update task status
        _export_tasks[task_id]["status"] = "completed"
        _export_tasks[task_id]["result"] = result
        _export_tasks[task_id]["zip_path"] = result["zip_path"]
        _export_tasks[task_id]["zip_filename"] = result["zip_filename"]
        logger.info(f"Export task {task_id} completed successfully")

        # Desktop mode
        save_dir = _desktop_export_dir()
        if save_dir:
            try:
                dest = save_dir / result["zip_filename"]
                if dest.exists():
                    dest = save_dir / f"{dest.stem}__{task_id[:8]}{dest.suffix}"
                shutil.copy2(result["zip_path"], dest)
                _export_tasks[task_id]["saved_to"] = str(dest)
                logger.info(f"Export task {task_id} saved to {dest}")
            except Exception:
                logger.exception(f"Failed to save export zip into {save_dir}")

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
    try:
        return resolve_to_disk_path(fpath)
    except Exception as exc:
        raise ValueError(str(exc)) from exc


# NOTE: Worker function must be module-level (picklable) for ProcessPoolExecutor on Windows
def _library_metadata(dataset_path: Path, dataset_uuid: str) -> Dict[str, Any]:
    """
    What the library knows about the measurement being exported.

    Thin wrapper over library.library_metadata so plot exports and dataset
    downloads describe a measurement identically -- a tag list must mean the
    same thing wherever it lands.

    """
    from .library import library_metadata

    return library_metadata(dataset_path, dataset_uuid)


def _embed_png_metadata(path: str, meta: Dict[str, Any]) -> None:
    """
    Write the export metadata into a PNG's text chunks.

    PNG carries text rather than EXIF, and the keys land where any reader
    looks: ImageDescription for a human, plus one JSON blob so the tags come
    back out intact.

    Args:
        path (str): PNG file to annotate in place.
        meta (Dict[str, Any]): Metadata to embed.

    """
    try:
        from PIL import Image, PngImagePlugin

        info = PngImagePlugin.PngInfo()
        tags = ", ".join(meta.get("tags", []))
        info.add_text("Software", "Qimchi")
        info.add_text(
            "ImageDescription",
            f"Qimchi export of {meta.get('dataset_uuid', '')}"
            + (f" [tags: {tags}]" if tags else ""),
        )
        info.add_text("Qimchi", json.dumps(meta))
        with Image.open(path) as image:
            image.load()
            image.save(path, pnginfo=info)
    except Exception as exc:
        logger.info("Could not embed PNG metadata into %s: %s", path, exc)


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

    from plotly import graph_objects as go

    fig = go.Figure(fig_dict)
    # use same size/DPI targets as main process
    # TODOLATER: Optimize # CONCERN:
    # _width = 1920
    # _height = 1080
    # _scale = 300.0 / 96.0
    start = time.perf_counter()
    _write_plotly_image(
        fig,
        path_str,
        # width=_width,
        # height=_height,
        # scale=_scale,
    )
    return path_str, time.perf_counter() - start


def warm_export_worker() -> float:
    """
    Render a throwaway PNG through the real export path.

    Called in an export worker at startup: the first real export otherwise
    pays for the worker process spawning, Kaleido's sync server starting and
    Chrome booting, which is seconds of staring at a button. It writes an
    empty figure to a temporary directory through :func:`_write_image_worker`
    rather than rendering to bytes, so what gets warmed is exactly the path an
    export takes -- and the file goes away with the directory.

    Returns:
        float: Seconds the throwaway render took.

    """
    figure = go.Figure({"data": [{"x": [0, 1], "y": [0, 1]}]})
    with tempfile.TemporaryDirectory(prefix="qimchi-warmup-") as tmp:
        _, elapsed = _write_image_worker(
            figure.to_dict(), str(Path(tmp) / "warmup.png")
        )
    return elapsed


def _save_light_dark_pngs(
    plot_json: Dict,
    fpath: str,
    ts: str | None = None,
    only_light: bool = False,
    relayout_data: Dict | None = None,
    applied_filters: list[Dict] | None = None,
    measurement_info: Dict | None = None,
) -> Dict:
    """
    Save only PNGs for light and dark variants and return paths dict.

    Args:
        plot_json: Plotly figure JSON
        fpath: dataset .zarr path (may be memory:// path)
        ts: optional timestamp string to include in filename; if None, use current time
        only_light: if True, only save the light variant PNG
        relayout_data: optional relayout data to apply
        applied_filters: ordered filters to print below the plot
        measurement_info: Basket hover-card fields to print below the plot

    Returns:
        Dict: keys: 'png_light', 'png_dark' (if only_light is False)

    """
    # Resolve memory:// paths to disk paths
    disk_fpath = _resolve_fpath_to_disk(fpath)

    dataset_path = Path(disk_fpath)
    dataset_uuid = dataset_path.stem
    export_meta = _library_metadata(dataset_path, dataset_uuid)
    custom_tags = export_meta.get("tags", [])
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
        _add_export_info_footer(fig, applied_filters, measurement_info, custom_tags)
        try:
            _write_plotly_image(
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
    _add_export_info_footer(fig, applied_filters, measurement_info, custom_tags)
    _add_export_info_footer(
        dark_fig,
        applied_filters,
        measurement_info,
        custom_tags,
        dark=True,
    )

    # Write light & dark PNGs in parallel to avoid repeated engine startup overhead
    try:
        with ThreadPoolExecutor(max_workers=2) as ex:
            futures = {
                ex.submit(
                    _write_plotly_image,
                    fig,
                    str(out_light),
                    # width=_width,
                    # height=_height,
                    # scale=_scale,
                ): "light",
                ex.submit(
                    _write_plotly_image,
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
            _write_plotly_image(
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
            _write_plotly_image(
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
    applied_filters = data.get("applied_filters")
    if not isinstance(applied_filters, list):
        applied_filters = []
    measurement_info = data.get("measurement_info")
    if not isinstance(measurement_info, dict):
        measurement_info = {}
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
            _run_export_task(
                task_id,
                plot_json,
                disk_fpath,
                relayout_data,
                export_pool,
                applied_filters,
                measurement_info,
            )
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
        # Present only in desktop mode: the backend already wrote the zip here.
        if task.get("saved_to"):
            response["saved_to"] = task["saved_to"]
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
    applied_filters = data.get("applied_filters")
    if not isinstance(applied_filters, list):
        applied_filters = []
    measurement_info = data.get("measurement_info")
    if not isinstance(measurement_info, dict):
        measurement_info = {}
    if not plot_json or not fpath:
        return JSONResponse(
            status_code=400,
            content={"success": False, "message": "Missing plot_json or fpath"},
        )

    try:
        now = datetime.now(timezone.utc)
        ts = now.strftime("%Y-%m-%d-%H-%M-%S")
        saved = _save_light_dark_pngs(
            plot_json,
            fpath,
            ts=ts,
            relayout_data=relayout_data,
            applied_filters=applied_filters,
            measurement_info=measurement_info,
        )

        # Resolve memory:// paths to disk paths for notes file operations
        disk_fpath = _resolve_fpath_to_disk(fpath)

        # Append markdown image link for the light image to the notes.md
        dataset_path = Path(disk_fpath)
        dataset_uuid, notes_dir, notes_path = _measurement_notes_paths(dataset_path)
        notes_dir.mkdir(parents=True, exist_ok=True)

        # Ensure notes file exists with frontmatter
        if not notes_path.exists():
            with open(notes_path, "w", encoding="utf-8") as f:
                f.write(_make_frontmatter(dataset_uuid, now))

        # Build image path like <dataset_uuid>/<image_filename>
        light_path = Path(saved.get("png_light"))
        md_path = f"{dataset_uuid}/{light_path.name}"
        md_line = f"![plot]({md_path})\n"

        with open(notes_path, "r", encoding="utf-8") as f:
            existing_text = f.read()

        previous_body, _, _ = _parse_frontmatter(existing_text)
        previous_body = (previous_body or "").rstrip()

        body = previous_body
        if body:
            body = f"{body}\n\n{md_line.strip()}\n"
        else:
            body = md_line

        with open(notes_path, "w", encoding="utf-8") as f:
            f.write(_make_frontmatter(dataset_uuid, now) + body)

        sample_rollup = append_sample_rollup(
            dataset_path,
            body,
            now,
            previous_measurement_notes_body=previous_body,
        )

        return JSONResponse(
            status_code=200,
            content={
                "success": True,
                "message": "Saved images and appended note link.",
                "paths": saved,
                "md_line": md_line,
                "notes_path": str(notes_path),
                "sample_notes_path": sample_rollup.get("sample_notes_path"),
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
