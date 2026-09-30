import asyncio
import atexit
import logging
import os
import sys
import threading
import time
from concurrent.futures import ProcessPoolExecutor
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# Local imports
from api import (
    demo,
    diagnostics,
    dirtree,
    download,
    export,
    filters,
    library,
    live_measurements,
    notes,
    plots,
    settings,
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

# Warm export workers off the event loop. Set ENABLE_KALEIDO_WARMUP=0 to disable.
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

        kaleido.start_sync_server(page_generator=export.export_page_generator())
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
    """Warm each export worker off the event loop with one real render."""
    try:
        started = time.perf_counter()
        futures = [pool.submit(export.warm_export_worker) for _ in range(workers)]
        warmed = 0
        slowest = 0.0
        # Use one deadline for the whole pool, not one timeout per worker.
        deadline = started + 120
        for future in futures:
            try:
                remaining = max(0.0, deadline - time.perf_counter())
                slowest = max(slowest, float(future.result(timeout=remaining) or 0.0))
                warmed += 1
            except Exception:
                # Kaleido usually times out here when Chrome cannot start.
                logging.exception(
                    "Kaleido warm-up task failed -- image export needs a Chrome "
                    "it can start; see BROWSER_PATH (%s) and the [chrome] lines "
                    "in the desktop log",
                    os.environ.get("BROWSER_PATH") or "unset",
                )
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
    """Report service and library-database health."""
    db_ready, db_error = db_status()
    return {"ok": True, "id": "qimchi", "dbReady": db_ready, "dbError": db_error}


# FastAPI app instance with a lifespan handler to create/shutdown export workers
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create a ProcessPoolExecutor for export workers and warm kaleido on startup,
    then shut down the pool on application shutdown.
    """
    diagnostics.install_exception_hooks()
    diagnostics.quiet_polling_access_log()
    asyncio.get_running_loop().set_exception_handler(
        diagnostics.asyncio_exception_handler
    )
    background: list[asyncio.Task] = [
        asyncio.create_task(diagnostics.watch_event_loop(), name="loop-watch")
    ]
    interval = diagnostics.resource_log_interval()
    if interval > 0:
        background.append(
            asyncio.create_task(diagnostics.sampler.run(interval), name="resources")
        )

    try:
        # Migrate the database off the event loop. Keep plotting available on
        # failure, but expose the reason so database-backed UI can be disabled.
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

        # Warm the worker processes in the background.
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
        for task in background:
            task.cancel()
        await asyncio.to_thread(diagnostics.sampler.snapshot, "shutdown")
        demo.shutdown()
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

# Requests slower than this are logged with their duration.
_SLOW_REQUEST_SECONDS = 1.0


@app.middleware("http")
async def log_slow_requests(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    elapsed = time.perf_counter() - started
    if elapsed > _SLOW_REQUEST_SECONDS:
        logging.getLogger("qimchi.requests").info(
            "Slow request: %s %s took %.1f s (status %d)",
            request.method,
            request.url.path,
            elapsed,
            response.status_code,
        )
    return response


# Static file serving (optional - nginx handles this in production)
serve_static = os.environ.get("SERVE_STATIC_FILES", "true").lower() in (
    "1",
    "true",
    "yes",
)

# Always determine frontend dist path (needed for conditional root route)
if getattr(sys, "frozen", False):
    # PyInstaller exposes bundled data under _MEIPASS.
    frontend_dist_path = os.path.join(sys._MEIPASS, "frontend", "dist")
elif os.path.exists("/app/frontend/dist"):
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

        # Plot titles load MathJax from this URL at runtime.
        mathjax_path = os.path.join(frontend_dist_path, "mathjax")
        if os.path.exists(mathjax_path):
            app.mount("/mathjax", StaticFiles(directory=mathjax_path), name="mathjax")
        else:
            logging.warning("MathJax not found at: %s", mathjax_path)

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
app.include_router(settings.router)
app.include_router(demo.router)
app.include_router(diagnostics.router)


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
        """Serve the uncached SPA shell so it always references current assets."""
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
