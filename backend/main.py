import os
from typing import List
from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from concurrent.futures import ProcessPoolExecutor
import logging
import plotly.io as pio
from plotly import graph_objects as go
from dotenv import load_dotenv
from contextlib import asynccontextmanager

# Local imports
from api import (
    dirtree,
    notes,
    download,
    plots,
    filters,
    export,
)

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


app.include_router(router)
app.include_router(dirtree.router)
app.include_router(notes.router)
app.include_router(download.router)
app.include_router(plots.router)
app.include_router(filters.router)
app.include_router(export.router)


# CORS configuration
# For production (LAN-only) you should set the ALLOWED_ORIGINS environment
# variable to a comma-separated list of allowed origins, e.g.:
#   ALLOWED_ORIGINS=http://192.168.1.42:5173,https://example.local
# If ALLOWED_ORIGINS is not provided we fall back to a restricted developer
# localhosts list so a dev frontend on the same machine will work.
def parse_allowed_origins(env_val: str | None) -> List[str]:
    """Parse a comma-separated ALLOWED_ORIGINS env var into a list.

    Empty entries and whitespace are ignored. If env_val is None or empty,
    caller can decide to use a safe default.
    """
    if not env_val:
        return []
    return [o.strip() for o in env_val.split(",") if o.strip()]


# Read from environment. For LAN/production set this to the exact origins
# that should be allowed. Avoid using ['*'] in production.
env_allowed = os.environ.get("ALLOWED_ORIGINS")
origins = parse_allowed_origins(env_allowed)

if not origins:
    # Fallback: restrict to localhost origins only
    origins = [
        "http://localhost:80",
        "http://127.0.0.1:80",
        "http://0.0.0.0:80",  # FastAPI prod uses 0.0.0.0 as --host.
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://0.0.0.0:5173",  # FastAPI prod uses 0.0.0.0 as --host.
    ]

app.add_middleware(
    CORSMiddleware,
    # Allow explicit origins from env and also match common localhost variants
    allow_origins=origins,
    # Accept localhost and 127.0.0.1 with or without ports
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Emit the resolved CORS configuration on startup for easier debugging in logs
try:
    logging.info(
        f"CORS configured allow_origins={origins} allow_origin_regex='^https?://(localhost|127.0.0.1)(:\\d+)?$'"
    )
except Exception:
    # Logging must never crash the app
    pass
