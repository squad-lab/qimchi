import os
import atexit
import logging
import plotly.io as pio
from plotly import graph_objects as go
from dotenv import load_dotenv
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from concurrent.futures import ProcessPoolExecutor


# Local imports
from api import (
    dirtree,
    notes,
    download,
    plots,
    filters,
    export,
    live_measurements,
)

# Load environment variables from file
load_dotenv()
_export_max_workers_env = os.environ.get("EXPORT_MAX_WORKERS")
_export_timing_log = os.environ.get("EXPORT_TIMING_LOG", "false").lower() in (
    "1",
    "true",
    "yes",
)

# Feature flag: enable Kaleido warm-up on startup. Default: off.
# Set ENABLE_KALEIDO_WARMUP=1/true/yes to enable.
_enable_kaleido_warmup = os.environ.get("ENABLE_KALEIDO_WARMUP", "false").lower() in (
    "1",
    "true",
    "yes",
)

# Workaround for Kaleido v1 performance regression with the v0 API:
# explicitly manage the Kaleido sync server lifecycle.
_enable_kaleido_sync_server = os.environ.get(
    "ENABLE_KALEIDO_SYNC_SERVER", "true"
).lower() in (
    "1",
    "true",
    "yes",
)


def _start_kaleido_sync_server(context: str) -> bool:
    if not _enable_kaleido_sync_server:
        logging.info("Kaleido sync server disabled for %s", context)
        return False
    try:
        import kaleido

        kaleido.start_sync_server()
        logging.info("Kaleido sync server started for %s", context)
        return True
    except Exception:
        logging.exception("Failed to start Kaleido sync server for %s", context)
        return False


def _stop_kaleido_sync_server(context: str) -> None:
    if not _enable_kaleido_sync_server:
        return
    try:
        import kaleido

        kaleido.stop_sync_server()
        logging.info("Kaleido sync server stopped for %s", context)
    except Exception:
        logging.exception("Failed to stop Kaleido sync server for %s", context)


def _init_export_worker() -> None:
    """ProcessPool worker initializer for export image generation."""
    started = _start_kaleido_sync_server("export-worker")
    if started:
        atexit.register(_stop_kaleido_sync_server, "export-worker")


# Monitoring endpoints
router = APIRouter()


@router.get("/health")
async def export_health() -> dict:
    """
    Health check endpoint for the export_plot_images service.

    """
    return {"ok": True, "id": "qimchi"}


# FastAPI app instance with a lifespan handler to create/shutdown export workers
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create a ProcessPoolExecutor for export workers and warm kaleido on startup,
    then shut down the pool on application shutdown.
    """
    try:
        app.state.kaleido_sync_started = _start_kaleido_sync_server("api-process")

        # Pre-spawn worker processes; keep conservative worker count
        # Respect EXPORT_MAX_WORKERS env var if provided, else conservative default
        if _export_max_workers_env and _export_max_workers_env.isdigit():
            max_workers = max(1, int(_export_max_workers_env))
        else:
            max_workers = min(4, (os.cpu_count() or 1))
        app.state.export_pool = ProcessPoolExecutor(
            max_workers=max_workers,
            initializer=_init_export_worker,
        )

        # Optionally warm up kaleido on startup to reduce first-request latency.
        # Controlled by the ENABLE_KALEIDO_WARMUP environment variable; default
        # is off to avoid extra startup cost and platform issues in containers.
        if _enable_kaleido_warmup:
            try:
                tiny = go.Figure({"data": [{"x": [0, 1], "y": [0, 1]}]})
                pio.to_image(tiny, format="png")
                logging.info("Kaleido warm-up successful (enabled)")
            except Exception:
                logging.exception("Kaleido warm-up failed (enabled)")
        else:
            logging.info("Kaleido warm-up skipped (ENABLE_KALEIDO_WARMUP not set)")
    except Exception:
        logging.exception("Failed to create export ProcessPoolExecutor")

    try:
        yield
    finally:
        try:
            pool = getattr(app.state, "export_pool", None)
            if pool:
                pool.shutdown(wait=True)
                logging.info("Export ProcessPoolExecutor shut down")
        except Exception:
            logging.exception("Error shutting down export pool")
        finally:
            if getattr(app.state, "kaleido_sync_started", False):
                _stop_kaleido_sync_server("api-process")


app = FastAPI(lifespan=lifespan)

# Static file serving (optional - nginx handles this in production)
serve_static = os.environ.get("SERVE_STATIC_FILES", "true").lower() in (
    "1",
    "true",
    "yes",
)

# Always determine frontend dist path (needed for conditional root route)
if os.path.exists("/app/frontend/dist"):
    # Docker environment - frontend built into /app/frontend/dist
    frontend_dist_path = "/app/frontend/dist"
else:
    # Local development - frontend/dist relative to backend directory
    frontend_dist_path = os.path.join(
        os.path.dirname(os.path.dirname(__file__)), "frontend", "dist"
    )

if serve_static:
    # print(f"Serving static files from FastAPI backend from {frontend_dist_path}")
    # Set up static file serving for the React frontend

    # Serve static files from the React build
    if os.path.exists(frontend_dist_path):
        # Mount the assets directory at /assets/ to match Vite's build output
        assets_path = os.path.join(frontend_dist_path, "assets")
        if os.path.exists(assets_path):
            app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

        logging.info(f"Serving static files from: {frontend_dist_path}")
    else:
        logging.warning(f"Frontend dist directory not found at: {frontend_dist_path}")
else:
    logging.info("Static file serving disabled (handled by nginx)")

# API routes - nginx handles /* prefix routing
app.include_router(router)
app.include_router(dirtree.router)
app.include_router(notes.router)
app.include_router(download.router)
app.include_router(plots.router)
app.include_router(filters.router)
app.include_router(export.router)
app.include_router(live_measurements.router)


# Root route to serve the SPA (only when FastAPI serves static files)
if serve_static:
    # print(f"Serving static files from FastAPI backend from {frontend_dist_path}")

    @app.get("/qimchi-logo.png")
    async def get_favicon():
        """Serve the favicon/logo."""
        favicon_path = os.path.join(frontend_dist_path, "qimchi-logo.png")
        if os.path.exists(favicon_path):
            return FileResponse(favicon_path, media_type="image/png")
        else:
            return {"error": "Favicon not found"}

    @app.get("/SQUAD-logo-dark.webp")
    async def get_squad_logo():
        """Serve the SQUAD Lab logo."""
        logo_path = os.path.join(frontend_dist_path, "SQUAD-logo-dark.webp")
        if os.path.exists(logo_path):
            return FileResponse(logo_path, media_type="image/webp")
        else:
            return {"error": "SQUAD logo not found"}

    @app.get("/FZJ-logo.svg")
    async def get_fzj_logo():
        """Serve the FZJ logo."""
        logo_path = os.path.join(frontend_dist_path, "FZJ-logo.svg")
        if os.path.exists(logo_path):
            return FileResponse(logo_path, media_type="image/svg+xml")
        else:
            return {"error": "FZJ logo not found"}

    @app.get("/")
    async def read_root():
        """Serve the React SPA at the root route."""
        index_path = os.path.join(frontend_dist_path, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        else:
            return {
                "error": "Frontend not built. Please run 'npm run build' in the frontend directory."
            }
