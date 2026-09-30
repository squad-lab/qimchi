"""
Demo measurements for the walkthrough.

The walkthrough needs measurements that exist on every install, so they are
generated here rather than shipped as files: `POST /demo/prepare` writes them
into `<app home>/demo/`, and `POST /demo/live/start` publishes a live one
through qimchi-connect, exactly as a user's own measurement code would.

Everything is deterministic (fixed shapes and a seeded noise generator), so a
regenerated file has the same content identity and keeps its hearts and notes.

"""

import asyncio
import shutil
import threading
import time
import uuid
from pathlib import Path

import numpy as np
import xarray as xr
from fastapi import APIRouter, HTTPException

from .logger import logger
from .shared.paths import qimchi_home

router = APIRouter(prefix="/demo", tags=["demo"])

# Increment when demo content changes to invalidate existing generated files.
DEMO_VERSION = 4

LOGO_FILE = "qimchi_logo.nc"
# Keep the reveal file name neutral.
REVEAL_FILE = "measurement2.nc"
_OLD_FILES = ["whos_that_qubit.nc"]

LIVE_ROW_INTERVAL = 0.12  # Produces the full live logo in about 20 seconds.

_DEMO_ATTRS = {
    "Sample Name": "Qimchi demo",
    "Cryostat": "Walkthrough",
    "Device Type": "Demo device",
    "qimchi_demo_version": DEMO_VERSION,
}


def demo_dir() -> Path:
    folder = qimchi_home() / "demo"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


# --------------------------------------------------------------------------- #
# The Qimchi logo as a charge-stability-style map
# --------------------------------------------------------------------------- #

# The logo consists of mirrored trapezoids separated by a vertical gap.
# In normalized image coordinates, each narrows from full width to 0.52.
_LOGO_BAND = 0.375
_LOGO_NARROW = 0.26  # half-width at the inner edge


def _smooth_step(distance: np.ndarray, width: float) -> np.ndarray:
    """0 outside a shape, 1 inside, with an edge a few pixels wide."""
    return 0.5 * (1.0 + np.tanh(distance / width))


def logo_signal(size: int = 161) -> np.ndarray:
    """
    The logo as a 2-D array indexed [P2, P1], rows running bottom to top.

    Values sit where Viridis draws them closest to the logo: the green
    trapezoid near 0.8 (rising to 1 at its top edge), the cyan one at 0.5, on a
    dark background near 0.

    """
    u = np.linspace(0.0, 1.0, size)
    x, y_down = np.meshgrid(u, u)
    edge = 1.2 / size

    def trapezoid(top_band: bool) -> np.ndarray:
        # Normalized distance from the wide outer edge.
        depth = y_down if top_band else 1.0 - y_down
        half_width = 0.5 - (0.5 - _LOGO_NARROW) * depth / _LOGO_BAND
        inside_x = half_width - np.abs(x - 0.5)
        inside_y = _LOGO_BAND - depth
        return _smooth_step(np.minimum(inside_x, inside_y), edge)

    green = trapezoid(top_band=True)
    cyan = trapezoid(top_band=False)

    background = 0.04 * np.exp(-((x - 0.5) ** 2 + (y_down - 0.5) ** 2) / 0.18)
    green_level = 0.8 + 0.2 * np.clip(1.0 - y_down / _LOGO_BAND, 0.0, 1.0) ** 2
    signal = background * (1 - green - cyan) + green * green_level + cyan * 0.5

    noise = np.random.default_rng(7).normal(0.0, 0.006, signal.shape)
    return np.flipud(signal + noise)


def logo_dataset(size: int = 161) -> xr.Dataset:
    gate = np.linspace(-40.0, 40.0, size)
    dataset = xr.Dataset(
        data_vars={
            "signal": (
                ("P2", "P1"),
                logo_signal(size),
                {"label": "Sensor signal", "unit": "V"},
            )
        },
        # The default heat map maps the first two coordinates to [y, x].
        coords={
            "P2": ("P2", gate * 1e-3, {"label": "Plunger gate P2", "unit": "V"}),
            "P1": ("P1", gate * 1e-3, {"label": "Plunger gate P1", "unit": "V"}),
        },
        attrs={**_DEMO_ATTRS, "Experiment Name": "Qimchi logo"},
    )
    return dataset


# --------------------------------------------------------------------------- #
# "Who's that Poqémon?" -- a silhouette and its reveal
# --------------------------------------------------------------------------- #

# Use neutral slider labels to avoid revealing the second image.
REVEAL_LABELS = ["Who's that Poqémon?", "The big reveal"]

# Viridis levels for the parts of the picture.
_OUTLINE = 0.0
_DARK_LEAF = 0.7
_LIGHT_LEAF = 0.84
_VEIN = 0.92
_BODY = 1.0
_RAY_DARK = 0.24
_RAY_LIGHT = 0.34


def _qabbage_parts(size: int = 48) -> np.ndarray:
    """
    Qabbage, a napa cabbage, as a grid of part codes (row 0 at the top).

    0 background, 1 outline, 2 dark leaf, 3 light leaf, 4 vein, 5 body, 6 face.

    """
    rows, cols = np.mgrid[0:size, 0:size].astype(float)
    cx = (size - 1) / 2

    def disc(x: float, y: float, r: float) -> np.ndarray:
        return (cols - x) ** 2 + (rows - y) ** 2 <= r**2

    # Build the character from a central stalk, crown, arms, and feet.
    body = ((cols - cx) / 10.5) ** 2 + ((rows - 28.0) / 13.0) ** 2 <= 1.0
    crown = disc(cx - 8, 12, 6.5) | disc(cx, 8.5, 7.5) | disc(cx + 8, 12, 6.5)
    crown |= disc(cx - 12.5, 8.5, 2.8) | disc(cx + 12.5, 8.5, 2.8)
    arms = disc(cx - 12.5, 28, 2.6) | disc(cx + 12.5, 28, 2.6)
    feet = disc(cx - 5, 41.5, 2.6) | disc(cx + 5, 41.5, 2.6)
    shape = body | crown | arms | feet

    # Add a wavy boundary between the leaves and stalk.
    leaf_line = 19.0 + 1.5 * np.sin(cols * 0.8)
    parts = np.zeros((size, size), dtype=int)
    parts[shape & (rows <= leaf_line)] = 3
    parts[shape & (rows > leaf_line)] = 5
    parts[arms & ~body] = 3
    parts[feet & ~body] = 2

    # Add darker ribs radiating through the crown.
    for spread in (-9.0, 0.0, 9.0):
        rib_x = cx + spread * (leaf_line - rows) / 16.0
        rib = np.abs(cols - rib_x) < 0.75
        parts[shape & rib & (rows <= leaf_line - 1) & (rows > 2)] = 2

    # Veins down the stalk.
    for offset in (-6.0, 6.0):
        vein = np.abs(cols - (cx + offset) - 0.06 * (rows - 30) * np.sign(offset)) < 0.6
        parts[body & vein & (rows > leaf_line + 1) & (rows < 38)] = 4

    # Add eyes, highlights, and a smile.
    for eye_x in (cx - 4.5, cx + 3.5):
        x0 = int(round(eye_x))
        parts[26:29, x0 : x0 + 2] = 6
        parts[26, x0 + 1] = 5
    c0 = int(round(cx))
    for r, c in (
        (31, c0 - 3),
        (32, c0 - 2),
        (32, c0 - 1),
        (32, c0),
        (32, c0 + 1),
        (31, c0 + 2),
    ):
        parts[r, c] = 6

    # Outline every shape pixel that touches the background.
    padded = np.pad(shape, 1)
    touches_background = (
        ~padded[:-2, 1:-1] | ~padded[2:, 1:-1] | ~padded[1:-1, :-2] | ~padded[1:-1, 2:]
    )
    parts[shape & touches_background] = 1
    return parts


def reveal_dataset(size: int = 48) -> xr.Dataset:
    parts = _qabbage_parts(size)
    rows, cols = np.mgrid[0:size, 0:size].astype(float)
    angle = np.arctan2(rows - size / 2, cols - size / 2)
    rays = np.where(
        np.floor((angle + np.pi) / (np.pi / 8)) % 2 == 0, _RAY_DARK, _RAY_LIGHT
    )

    colours = {
        1: _OUTLINE,
        2: _DARK_LEAF,
        3: _LIGHT_LEAF,
        4: _VEIN,
        5: _BODY,
        6: _OUTLINE,
    }
    revealed = rays.copy()
    for code, level in colours.items():
        revealed[parts == code] = level
    # Per-image color scaling keeps the rays bright behind the dark silhouette.
    silhouette = np.where(parts > 0, _OUTLINE, rays)

    picture = np.stack([np.flipud(silhouette), np.flipud(revealed)], axis=-1)
    pixels = np.arange(size, dtype=float)
    return xr.Dataset(
        data_vars={
            "brightness": (
                ("y", "x", "reveal"),
                picture,
                {"label": "Brightness", "unit": ""},
            )
        },
        coords={
            "y": ("y", pixels, {"label": "y", "unit": "px"}),
            "x": ("x", pixels, {"label": "x", "unit": "px"}),
            "reveal": ("reveal", REVEAL_LABELS),
        },
        attrs={**_DEMO_ATTRS, "Experiment Name": "Measurement 2"},
    )


# --------------------------------------------------------------------------- #
# Writing the files
# --------------------------------------------------------------------------- #


def _is_current(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        with xr.open_dataset(path, engine="h5netcdf") as existing:
            return existing.attrs.get("qimchi_demo_version") == DEMO_VERSION
    except Exception:
        return False


def _write(dataset: xr.Dataset, path: Path) -> None:
    partial = path.with_suffix(".part")
    dataset.to_netcdf(partial, engine="h5netcdf")
    partial.replace(path)


def prepare_demo_files() -> dict:
    folder = demo_dir()
    files = {"logo": (LOGO_FILE, logo_dataset), "reveal": (REVEAL_FILE, reveal_dataset)}
    paths = {}
    for key, (name, build) in files.items():
        path = folder / name
        if not _is_current(path):
            _write(build(), path)
            logger.info("demo | wrote %s", path)
        paths[key] = str(path)
    # Remove files generated by earlier demo versions.
    shutil.rmtree(folder / "live", ignore_errors=True)
    for name in _OLD_FILES:
        (folder / name).unlink(missing_ok=True)
    return {"folder": str(folder), **paths}


@router.post("/prepare")
async def prepare() -> dict:
    """Make sure the demo measurements exist, and say where they are."""
    try:
        return await asyncio.to_thread(prepare_demo_files)
    except Exception as exc:
        logger.exception("demo | could not write the demo measurements")
        raise HTTPException(
            status_code=500, detail=f"Could not create the demo measurements: {exc}"
        ) from exc


# --------------------------------------------------------------------------- #
# The live demo: the logo, measured one row at a time
# --------------------------------------------------------------------------- #


class _LiveDemo:
    """One live logo at a time, published through qimchi-connect."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._published = threading.Event()
        self.measurement_id: str | None = None

    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self, row_interval: float = LIVE_ROW_INTERVAL) -> str:
        with self._lock:
            if self.running() and self.measurement_id:
                return self.measurement_id
            measurement_id = (
                f"qimchi-demo-{time.strftime('%H%M%S')}-{uuid.uuid4().hex[:4]}"
            )
            self._stop.clear()
            self._published.clear()
            self.measurement_id = measurement_id
            self._thread = threading.Thread(
                target=self._run,
                args=(measurement_id, row_interval),
                name="qimchi-live-demo",
                daemon=True,
            )
            self._thread.start()
        # Return only after the live measurement is discoverable.
        self._published.wait(10.0)
        return measurement_id

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout)

    def _run(self, measurement_id: str, row_interval: float) -> None:
        from qimchi_connect import producer

        full = logo_dataset()
        partial = full.copy(deep=True)
        partial["signal"][:] = np.nan
        partial.attrs["Experiment Name"] = "Qimchi logo (live)"
        state = {"dataset": partial}
        # Reuse the static logo file after the live measurement completes.
        disk_path = prepare_demo_files()["logo"]

        def snapshot() -> xr.Dataset:
            # The server owns the submitted arrays, so pass copies.
            return state["dataset"].copy(deep=True)

        try:
            with producer.live_measurement(
                measurement_id,
                snapshot,
                disk_path=disk_path,
                metadata={"source": "qimchi-demo"},
            ):
                self._published.set()
                # Sweep P2 upward so the default line-plot slice is populated first.
                for row in range(full.sizes["P2"]):
                    if self._stop.wait(row_interval):
                        break
                    updated = state["dataset"].copy(deep=True)
                    updated["signal"][{"P2": row}] = full["signal"][{"P2": row}]
                    state["dataset"] = updated
        except Exception:
            logger.exception("demo | live demo %s failed", measurement_id)
        finally:
            self._published.set()


_live_demo = _LiveDemo()


@router.post("/live/start")
async def start_live_demo() -> dict:
    """Start publishing the live logo, or report the one already running."""
    measurement_id = await asyncio.to_thread(_live_demo.start)
    return {
        "measurementId": measurement_id,
        "path": f"memory://{measurement_id}",
        "nodeId": f"file-memory-{measurement_id}",
        "name": measurement_id,
    }


@router.post("/live/stop")
async def stop_live_demo() -> dict:
    await asyncio.to_thread(_live_demo.stop)
    return {"stopped": True}


def shutdown() -> None:
    """Stop the live demo so it does not outlive the app."""
    _live_demo.stop(timeout=2.0)
