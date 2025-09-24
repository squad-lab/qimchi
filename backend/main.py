import os
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
        # Pre-spawn worker processes; keep conservative worker count
        # Respect EXPORT_MAX_WORKERS env var if provided, else conservative default
        if _export_max_workers_env and _export_max_workers_env.isdigit():
            max_workers = max(1, int(_export_max_workers_env))
        else:
            max_workers = min(4, (os.cpu_count() or 1))
        app.state.export_pool = ProcessPoolExecutor(max_workers=max_workers)

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


# Root route to serve the SPA (only when FastAPI serves static files)
if serve_static:

    @app.get("/qimchi-logo.png")
    async def get_favicon():
        """Serve the favicon/logo."""
        favicon_path = os.path.join(frontend_dist_path, "qimchi-logo.png")
        if os.path.exists(favicon_path):
            return FileResponse(favicon_path, media_type="image/png")
        else:
            return {"error": "Favicon not found"}

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
