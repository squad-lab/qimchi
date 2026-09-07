import os
import asyncio
import atexit
import logging
import threading
import time
from dotenv import load_dotenv
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, HTTPException
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
    library,
)
from api.shared.db import db_status, run_migrations, seed_local_user, set_db_status

# Load environment variables from file
load_dotenv()
_export_max_workers_env = os.environ.get("EXPORT_MAX_WORKERS")
_export_timing_log = os.environ.get("EXPORT_TIMING_LOG", "false").lower() in (
    "1",
    "true",
    "yes",
)

# Warm the export workers on startup so the first exported image does not pay
# for a worker process spawning and its Chrome booting. It runs off the event
# loop and its failures are logged, so set ENABLE_KALEIDO_WARMUP=0 only to opt
# out (a container with no usable Chrome, say).
_enable_kaleido_warmup = os.environ.get("ENABLE_KALEIDO_WARMUP", "true").lower() in (
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


def _warm_export_pool(pool: ProcessPoolExecutor, workers: int) -> None:
    """
    Warm every export worker, off the event loop.

    One task per worker, submitted together: the first render in a process
    takes long enough that the pool keeps spawning rather than reusing the one
    that is busy, so the tasks spread across the workers. Each renders an
    empty plot into a temp directory through the real export path
    (:func:`api.export.warm_export_worker`).

    Args:
        pool (ProcessPoolExecutor): The export pool to warm.
        workers (int): How many workers it was created with.

    """
    try:
        started = time.perf_counter()
        futures = [pool.submit(export.warm_export_worker) for _ in range(workers)]
        warmed = 0
        slowest = 0.0
        for future in futures:
            try:
                slowest = max(slowest, float(future.result(timeout=120) or 0.0))
                warmed += 1
            except Exception:
                logging.exception("Kaleido warm-up task failed")
        logging.info(
            "Kaleido warm-up finished: %d/%d export workers in %.1fs "
            "(slowest render %.1fs -- the wait the first export no longer pays)",
            warmed,
            workers,
            time.perf_counter() - started,
            slowest,
        )
    except Exception:
        logging.exception("Kaleido warm-up could not run")


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

    Also reports whether the library database came up, so the SPA can disable
    hearts/tags/notes with a reason instead of letting them fail on click.

    """
    db_ready, db_error = db_status()
    return {"ok": True, "id": "qimchi", "dbReady": db_ready, "dbError": db_error}


# FastAPI app instance with a lifespan handler to create/shutdown export workers
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create a ProcessPoolExecutor for export workers and warm kaleido on startup,
    then shut down the pool on application shutdown.
    """
    try:
        # Bring the Qimchi database up to head and seed the implicit local user.
        # Runs off the event loop. A DB failure must not stop the app from
        # serving plots -- that is Qimchi's core job and it needs no database --
        # but it must not be silent either: notes are DB-backed, so a quiet
        # failure would let the user type notes that are never persisted.
        # Record the reason so the routers can return 503 and the UI can
        # disable the library affordances instead of failing on click.
        try:
            await asyncio.to_thread(run_migrations)
            await asyncio.to_thread(seed_local_user)
            set_db_status(True, None)
        except Exception as exc:
            logging.exception("Qimchi DB init failed (library features disabled)")
            set_db_status(False, f"{type(exc).__name__}: {exc}")

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

        # Warm the pool in the background. Warming this process instead would
        # do nothing for exports: they run in the workers, which ProcessPool
        # only spawns once work arrives.
        if _enable_kaleido_warmup:
            threading.Thread(
                target=_warm_export_pool,
                args=(app.state.export_pool, max_workers),
                name="kaleido-warmup",
                daemon=True,
            ).start()
            logging.info("Kaleido warm-up started for %d export worker(s)", max_workers)
        else:
            logging.info("Kaleido warm-up skipped (ENABLE_KALEIDO_WARMUP=0)")
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
app.include_router(library.router)


# Root route to serve the SPA (only when FastAPI serves static files)
if serve_static:
    # print(f"Serving static files from FastAPI backend from {frontend_dist_path}")

    # Root-level assets from frontend/dist.
    # Only /assets is mounted as a static directory, 
    # so every file the SPA references from the dist 
    # root needs a route here
    _ROOT_ASSETS = {
        "qimchi-logo.png": "image/png",
        "SQUAD-logo-dark.webp": "image/webp",  # shown in light theme
        "SQUAD-logo-light.png": "image/png",  # shown in dark theme
        "FZJ-logo.svg": "image/svg+xml",
    }

    def _register_root_asset(filename: str, media_type: str) -> None:
        # Factory so each route closes over its own filename (not the loop var).
        @app.get(f"/{filename}", name=f"root_asset_{filename}")
        async def _serve_root_asset():
            asset_path = os.path.join(frontend_dist_path, filename)
            if os.path.exists(asset_path):
                return FileResponse(asset_path, media_type=media_type)
            raise HTTPException(status_code=404, detail=f"{filename} not found")

    for _asset_name, _asset_type in _ROOT_ASSETS.items():
        _register_root_asset(_asset_name, _asset_type)

    @app.get("/")
    async def read_root():
        """Serve the React SPA at the root route.

        index.html must never be cached. Vite content-hashes the JS/CSS under
        /assets (safe to cache forever), but the hashes only take effect if the
        shell that references them is re-fetched. A cached index.html keeps
        pointing at the previous build's filenames -- which is how an updated
        app can still render the old UI, and after an auto-update those files
        are gone entirely.
        """
        index_path = os.path.join(frontend_dist_path, "index.html")
        if os.path.exists(index_path):
            return FileResponse(
                index_path,
                headers={
                    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                    "Pragma": "no-cache",
                    "Expires": "0",
                },
            )
        else:
            return {
                "error": "Frontend not built. Please run 'npm run build' in the frontend directory."
            }
