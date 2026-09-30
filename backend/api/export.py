"""
FastAPI endpoint to export Plotly plots as PNG, PDF and SVG.

"""

import asyncio
import base64
import json
import os
import queue
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
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from plotly import graph_objects as go

from .data_loader import resolve_to_disk_path

# Local imports
from .diagnostics import register_gauge, sampler
from .logger import logger
from .notes import _measurement_notes_paths, _note_db_identity, append_measurement_note
from .settings import ExportSettings, export_settings

router = APIRouter()


# In-memory task registry for export tasks
# Export task state keyed by task ID.
_export_tasks: Dict[str, Dict] = {}
register_gauge("export tasks", lambda: len(_export_tasks))

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
    "r_in_correction": "R_in Correction",
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

    if server_running:
        image_bytes = _calc_fig_on_sync_server(server, fig, opts=opts, **kwargs)
    else:
        image_bytes = kaleido.calc_fig_sync(fig, opts=opts, **kwargs)
    if isinstance(image_bytes, str):
        image_bytes = image_bytes.encode("utf-8")
    target.write_bytes(image_bytes)
    _embed_fira_sans_in_svg(target)


def _calc_fig_on_sync_server(server: Any, *args: Any, **kwargs: Any) -> Any:
    """
    Render on Kaleido's sync server and fail if Chrome exits.

    Kaleido blocks if its server thread exits. Closing the dead server lets the
    next render start a new Chrome process.

    """
    from kaleido._sync_server import Task

    server._task_queue.put(Task("calc_fig", args, kwargs))
    while True:
        try:
            result = server._return_queue.get(timeout=0.5)
            break
        except queue.Empty:
            if not server._thread.is_alive():
                server.close(silence_warnings=True)
                raise RuntimeError(
                    "Chrome closed while starting for image export; "
                    "see the [chrome] lines in the desktop log"
                ) from None
    if isinstance(result, BaseException):
        raise result
    return result


def _timings_in_archive(options: ExportSettings) -> bool:
    """Return whether the export should include timings.json."""
    return options.timings or os.environ.get("EXPORT_TIMING_LOG", "false").lower() in (
        "1",
        "true",
        "yes",
    )


# Monospace glyphs are about 0.6 em wide; the footer is set at 15 px.
_EXPORT_INFO_FONT_SIZE = 15
_EXPORT_INFO_CHAR_PX = 0.6 * _EXPORT_INFO_FONT_SIZE


def _footer_entry_lines(
    label: str, parts: list[str], joiner: str, max_chars: int
) -> list[str]:
    """
    Wrap a labeled footer entry without splitting individual values.

    """
    prefix = f"{label}: "
    indent = len(prefix)
    lines: list[list[str]] = [[]]
    used = indent
    for part in parts:
        if not lines[-1]:
            lines[-1].append(part)
            used += len(part)
        elif used + len(joiner) + len(part) <= max_chars:
            lines[-1].append(part)
            used += len(joiner) + len(part)
        else:
            lines.append([part])
            used = indent + len(part)
    # Keep the separator on the preceding line when wrapping an entry.
    rendered = [joiner.join(escape(part) for part in line) for line in lines]
    rendered = [text + joiner.rstrip() for text in rendered[:-1]] + rendered[-1:]
    return [f"<b>{escape(label)}:</b> {rendered[0]}"] + [
        "&nbsp;" * indent + text for text in rendered[1:]
    ]


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
                info_lines.append((label, str(value).split(" "), " "))

        for key, value in measurement_info.items():
            if key in consumed_keys or key in (
                "independents",
                "dependents",
                "variable_independents",
                "Size",
                "size",
            ):
                continue
            if value in (None, "", "N/A"):
                continue
            label = str(key).replace("_", " ").title()
            info_lines.append((label, str(value).split(" "), " "))

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
        entries.append(display_name)

    if not info_lines and not entries and not tag_names:
        return

    current_bottom = (
        fig.layout.margin.b if fig.layout.margin and fig.layout.margin.b else 80
    )
    current_width = fig.layout.width or base_width
    current_height = fig.layout.height or base_height
    # Constrain the footer from the plot's left edge to the page margin.
    left_margin = (
        fig.layout.margin.l if fig.layout.margin and fig.layout.margin.l else 80
    )
    max_chars = max(20, int((current_width - left_margin - 16) / _EXPORT_INFO_CHAR_PX))
    entries_to_show = [
        *info_lines,
        ("Custom Tags", tag_names or ["None"], ", "),
        ("Applied Filters", entries or ["None"], " -> "),
    ]
    footer_lines = [
        line
        for label, parts, joiner in entries_to_show
        for line in _footer_entry_lines(label, parts, joiner, max_chars)
    ]
    footer_height = 42 + 19 * len(footer_lines)
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
            size=_EXPORT_INFO_FONT_SIZE,
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
        # Batch exports may exceed the default task timeout.
        and task.get("status") != "pending"
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
    options: ExportSettings | None = None,
    name_suffix: str = "",
) -> Dict:
    """Export plot variants and return the archive, image paths, and timings."""
    # Determine folder to save - "extras" (same as notes.py logic)
    dataset_path = Path(disk_fpath)
    dataset_uuid = dataset_path.stem
    extras_dir = dataset_path.parent / dataset_uuid
    extras_dir.mkdir(parents=True, exist_ok=True)

    # Base filename with timestamp
    ts = datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
    base_filename = extras_dir / f"{dataset_uuid}__{ts}__plot{name_suffix}"

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
    options = options or ExportSettings()
    outs = []
    for variant in options.variants:
        for fmt in options.formats:
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
    # Preserve the original canvas and extend only the height for the footer.
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
        _scale = options.scale or 300.0 / 96.0
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
            future = export_pool.submit(
                _write_image_worker, local_fig_dict, str(path), options.scale
            )
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

    # Do not report success when every image variant failed.
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
        if _timings_in_archive(options):
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
        "zip_filename": f"{dataset_uuid}__{ts}__plot{name_suffix}_images.zip",
        "saved_paths": saved_paths,
        "timings": timings,
    }


def _desktop_export_dir(folder: str | None = None) -> Path | None:
    """Return the desktop export directory, or ``None`` outside desktop mode."""
    if os.environ.get("QIMCHI_DESKTOP", "").lower() not in ("1", "true", "yes"):
        return None
    override = folder or os.environ.get("QIMCHI_EXPORT_DIR")
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
    options: ExportSettings | None = None,
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
            options,
        )

        # Update task status
        _export_tasks[task_id]["status"] = "completed"
        _export_tasks[task_id]["result"] = result
        _export_tasks[task_id]["zip_path"] = result["zip_path"]
        _export_tasks[task_id]["zip_filename"] = result["zip_filename"]
        logger.info(f"Export task {task_id} completed successfully")
        await asyncio.to_thread(sampler.snapshot, "after export")

        _save_to_desktop(task_id, result, options)

    except Exception as e:
        logger.error(f"Export task {task_id} failed: {e}", exc_info=True)
        _export_tasks[task_id]["status"] = "failed"
        _export_tasks[task_id]["error"] = str(e)


def _save_to_desktop(
    task_id: str, result: Dict, options: ExportSettings | None
) -> None:
    save_dir = _desktop_export_dir(options.folder if options else None)
    if not save_dir:
        return
    try:
        dest = save_dir / result["zip_filename"]
        if dest.exists():
            dest = save_dir / f"{dest.stem}__{task_id[:8]}{dest.suffix}"
        shutil.copy2(result["zip_path"], dest)
        _export_tasks[task_id]["saved_to"] = str(dest)
        logger.info(f"Export task {task_id} saved to {dest}")
    except Exception:
        logger.exception(f"Failed to save export zip into {save_dir}")


_MAX_BATCH_PLOTS = 100


def _plot_label(plot: Dict, index: int) -> str:
    title = plot.get("title") or Path(str(plot.get("fpath") or "")).name
    return f"plot {index} ({title})" if title else f"plot {index}"


def _export_many_plot_images_sync(
    plots: list[Dict],
    export_pool=None,
    options: ExportSettings | None = None,
) -> Dict:
    """Export plots into a batch archive, failing only if none succeed."""
    results: dict[int, Dict] = {}
    failures: list[str] = []

    def export_one(index: int, plot: Dict) -> Dict:
        return _export_plot_images_sync(
            plot["plot_json"],
            _resolve_fpath_to_disk(plot["fpath"]),
            plot.get("relayout_data"),
            export_pool,
            plot.get("applied_filters") or [],
            plot.get("measurement_info") or {},
            options,
            name_suffix=f"_{index:02d}",
        )

    workers = max(1, min(len(plots), os.cpu_count() or 1, 8))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(export_one, index, plot): index
            for index, plot in enumerate(plots, start=1)
        }
        for future in as_completed(futures):
            index = futures[future]
            try:
                results[index] = future.result()
            except Exception as e:
                logger.error(
                    f"Batch export of {_plot_label(plots[index - 1], index)} failed: {e}"
                )
                failures.append(f"{_plot_label(plots[index - 1], index)}: {e}")

    if not results:
        raise RuntimeError("No plot could be exported: " + "; ".join(sorted(failures)))

    ts = datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
    outer = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    outer.close()
    with zipfile.ZipFile(outer.name, "w", zipfile.ZIP_STORED) as zf:
        for index in sorted(results):
            result = results[index]
            zf.write(
                result["zip_path"], arcname=f"{index:02d}_{result['zip_filename']}"
            )
        if failures:
            zf.writestr("failed.txt", "\n".join(sorted(failures)) + "\n")
    for result in results.values():
        try:
            os.unlink(result["zip_path"])
        except OSError:
            pass

    return {
        "zip_path": outer.name,
        "zip_filename": f"qimchi_plots__{ts}.zip",
        "exported": len(results),
        "failures": sorted(failures),
    }


async def _run_batch_export_task(
    task_id: str,
    plots: list[Dict],
    export_pool=None,
    options: ExportSettings | None = None,
) -> None:
    try:
        logger.info(f"Starting batch export task {task_id} for {len(plots)} plots")
        result = await asyncio.to_thread(
            _export_many_plot_images_sync, plots, export_pool, options
        )
        task = _export_tasks[task_id]
        task.update(
            status="completed",
            result=result,
            zip_path=result["zip_path"],
            zip_filename=result["zip_filename"],
        )
        logger.info(f"Batch export task {task_id} completed")
        await asyncio.to_thread(sampler.snapshot, "after batch export")
        _save_to_desktop(task_id, result, options)
    except Exception as e:
        logger.error(f"Batch export task {task_id} failed: {e}", exc_info=True)
        _export_tasks[task_id]["status"] = "failed"
        _export_tasks[task_id]["error"] = str(e)


def _resolve_fpath_to_disk(fpath: str) -> str:
    """
    Resolve a dataset reference to its on-disk path.

    For memory:// paths (live measurements), query the live_measurements DB
    to get the actual disk path. For regular paths, return as-is.

    """
    try:
        return resolve_to_disk_path(fpath)
    except Exception as exc:
        raise ValueError(str(exc)) from exc


# NOTE: Worker function must be module-level (picklable) for ProcessPoolExecutor on Windows
def _library_metadata(dataset_path: Path, dataset_uuid: str) -> Dict[str, Any]:
    """Return the shared library metadata used by all exports."""
    from .library import library_metadata

    return library_metadata(dataset_path, dataset_uuid)


def _embed_png_metadata(path: str, meta: Dict[str, Any]) -> None:
    """Write human-readable and JSON metadata to a PNG's text chunks."""
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


def _write_image_worker(
    fig_dict: Dict, path_str: str, scale: float | None = None
) -> tuple[str, float]:
    """Write a figure dict to an image and return its path and elapsed time."""
    import time

    from plotly import graph_objects as go

    fig = go.Figure(fig_dict)
    start = time.perf_counter()
    _write_plotly_image(
        fig,
        path_str,
        scale=scale,
    )
    return path_str, time.perf_counter() - start


def warm_export_worker() -> float:
    """Warm an export worker with a temporary PNG and return the elapsed time."""
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
    """Save light and optional dark PNG variants and return their paths."""
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
    Start a plot export and return a task ID for status polling.

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

        options = await asyncio.to_thread(export_settings)

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
                options,
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


@router.post("/export-plot-images/batch")
async def export_many_plot_images(request: Request) -> JSONResponse:
    """
    Start a batch export and return a task ID for status polling.

    Expects JSON ``{"plots": [...]}``, each entry shaped like the body of
    ``POST /export-plot-images``. Poll the same status endpoint for the result.

    """
    _cleanup_old_tasks()

    data = await request.json()
    plots = data.get("plots") if isinstance(data, dict) else None
    if not isinstance(plots, list) or not plots:
        return JSONResponse(
            status_code=400, content={"success": False, "message": "No plots to export"}
        )
    if len(plots) > _MAX_BATCH_PLOTS:
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "message": f"At most {_MAX_BATCH_PLOTS} plots can be exported at once",
            },
        )
    if not all(
        isinstance(plot, dict) and plot.get("plot_json") and plot.get("fpath")
        for plot in plots
    ):
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "message": "Every plot needs plot_json and fpath",
            },
        )

    task_id = str(uuid.uuid4())
    _export_tasks[task_id] = {
        "status": "pending",
        "created_at": datetime.now(),
        "result": None,
        "error": None,
        "zip_path": None,
    }
    options = await asyncio.to_thread(export_settings)
    export_pool = getattr(request.app.state, "export_pool", None)
    asyncio.create_task(_run_batch_export_task(task_id, plots, export_pool, options))
    logger.info(f"Created batch export task {task_id} for {len(plots)} plots")

    return JSONResponse(
        status_code=202,
        content={"success": True, "task_id": task_id, "status": "pending"},
    )


@router.get("/export-plot-images/status/{task_id}")
async def get_export_status(task_id: str) -> JSONResponse:
    """Return an export task's status, download URL, or error."""
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
        result = task.get("result") or {}
        if "exported" in result:
            response["exported"] = result["exported"]
            response["failures"] = result.get("failures", [])
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
    """Save plot PNGs and append the light variant to the dataset notes."""
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

    # Resolve the note identity before writing images to avoid orphaned files.
    note_uuid = measurement_info.get("qimchi_db_uuid")
    try:
        _note_db_identity(fpath, note_uuid if isinstance(note_uuid, str) else None)
    except HTTPException as e:
        return JSONResponse(
            status_code=e.status_code, content={"success": False, "message": e.detail}
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

        # Link the light image as <dataset_uuid>/<image_filename>, relative to
        # the note's sidecar folder.
        dataset_path = Path(disk_fpath)
        dataset_uuid, _, _ = _measurement_notes_paths(dataset_path)
        light_path = Path(saved.get("png_light"))
        md_line = f"![plot]({dataset_uuid}/{light_path.name})\n"

        # Through the DB, not the .md alone: load_notes serves the DB first, so
        # a link appended only to the file never showed up once a note existed.
        appended = append_measurement_note(
            dataset_path,
            fpath,
            md_line,
            now,
            uuid=note_uuid if isinstance(note_uuid, str) else None,
        )
        sample_rollup = appended["sample_rollup"] or {}

        return JSONResponse(
            status_code=200,
            content={
                "success": True,
                "message": "Saved images and appended note link.",
                "paths": saved,
                "md_line": md_line,
                "notes_path": appended["notes_path"],
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
    """Return saved light and dark PNG paths for a dataset."""
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
