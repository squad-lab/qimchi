"""Kaleido helpers isolated from the data stack to save memory in export workers.

Limit imports to the standard library, Plotly, and Kaleido.
"""

import atexit
import base64
import os
import queue
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict

import plotly.io as pio
from plotly import graph_objects as go

from .logger import logger

PLOTLY_DEFAULT_WIDTH = int(getattr(pio.defaults, "default_width", 700) or 700)
PLOTLY_DEFAULT_HEIGHT = int(getattr(pio.defaults, "default_height", 500) or 500)

_FIRA_SANS_WEIGHTS = (400, 500, 600, 700)
_MATHJAX_FIRA_SVG_URL = (
    "https://cdn.jsdelivr.net/npm/@mathjax/mathjax-fira-font@4.1.3/"
    "tex-mml-svg-mathjax-fira.js"
)


def _find_fira_sans_fonts() -> dict[int, Path]:
    """Locate bundled frontend fonts in development, Docker, and packaged builds."""
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
    """Embed Fira Sans in an SVG export."""
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
    """Build a Kaleido page with Qimchi's Fira text and math fonts."""
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


def write_plotly_image(
    fig: go.Figure | Dict,
    path: str | Path,
    *,
    width: int | None = None,
    height: int | None = None,
    scale: float | None = None,
) -> None:
    """Render through Kaleido without reconfiguring an active server.

    One-shot renders use the same page to keep fonts and MathJax consistent.
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
        or PLOTLY_DEFAULT_WIDTH,
        "height": height
        or figure_layout.get("height")
        or template_layout.get("height")
        or PLOTLY_DEFAULT_HEIGHT,
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
    """Render on the sync server, closing it if Chrome exits."""
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


def write_image_worker(
    fig_dict: Dict, path_str: str, scale: float | None = None
) -> tuple[str, float]:
    """Write a figure dict to an image and return its path and elapsed time."""
    fig = go.Figure(fig_dict)
    start = time.perf_counter()
    write_plotly_image(
        fig,
        path_str,
        scale=scale,
    )
    return path_str, time.perf_counter() - start


def warm_export_worker() -> float:
    """Warm an export worker by rendering a temporary PNG."""
    figure = go.Figure({"data": [{"x": [0, 1], "y": [0, 1]}]})
    with tempfile.TemporaryDirectory(prefix="qimchi-warmup-") as tmp:
        _, elapsed = write_image_worker(figure.to_dict(), str(Path(tmp) / "warmup.png"))
    return elapsed


# Reuse Kaleido's sync server across renders.
def _sync_server_enabled() -> bool:
    # Read when called: main.py loads .env after importing this module.
    return os.environ.get("ENABLE_KALEIDO_SYNC_SERVER", "true").lower() in (
        "1",
        "true",
        "yes",
    )


def start_kaleido_sync_server(context: str) -> bool:
    if not _sync_server_enabled():
        logger.info("Kaleido sync server disabled for %s", context)
        return False
    try:
        import kaleido

        kaleido.start_sync_server(page_generator=export_page_generator())
        logger.info("Kaleido sync server started for %s", context)
        return True
    except Exception:
        logger.exception("Failed to start Kaleido sync server for %s", context)
        return False


def stop_kaleido_sync_server(context: str) -> None:
    if not _sync_server_enabled():
        return
    try:
        import kaleido

        kaleido.stop_sync_server()
        logger.info("Kaleido sync server stopped for %s", context)
    except Exception:
        logger.exception("Failed to stop Kaleido sync server for %s", context)


def init_export_worker() -> None:
    """Initialize image rendering in a process-pool worker."""
    if start_kaleido_sync_server("export-worker"):
        atexit.register(stop_kaleido_sync_server, "export-worker")
