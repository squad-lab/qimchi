"""
Centralized dataset loading with provider-based dispatch.

This module is the single loader entrypoint for API modules in Qimchi.
It defines a provider protocol and implements built-in providers for
common dataset types (e.g., live datasets, NetCDF/HDF5 files). It also
provides utility functions for detecting dataset formats, loading
datasets through xarray, and annotating loaded datasets with source
metadata. This design allows for extensible support of various dataset
formats and sources while maintaining a consistent loading interface
for the rest of the application.

"""

from __future__ import annotations

import asyncio
import re
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Literal, Optional, Protocol

import numpy as np
import xarray as xr
from qimchi_connect import client as live_client
from qimchi_connect import registry as live_db

# Local imports
from .logger import logger

MEMORY_PROTOCOL = "memory://"

SupportedKind = Literal["dataset", "datatree"]


class DataLoaderError(Exception):
    """Base class for dataset loader errors."""


class DatasetResolutionError(DataLoaderError):
    """Raised when a dataset reference cannot be resolved."""


class UnsupportedDatasetFormatError(DataLoaderError):
    """Raised when a path format is not supported by active providers."""


class MissingBackendDependencyError(DataLoaderError):
    """Raised when a file format backend dependency is unavailable."""


class DatasetKindMismatchError(DataLoaderError):
    """Raised when a consumer requires Dataset but provider returned DataTree."""


@dataclass(slots=True)
class LoadedData:
    """
    Structured result of loading a dataset reference.

    Attributes:
        kind (SupportedKind): The kind of the loaded data (e.g., "dataset" or "datatree").
        obj (Any): The loaded dataset object (e.g., xarray.Dataset or xarray.DataTree).
        source_ref (str): The original reference string used to load the dataset.
        actual_path (Optional[str]): The resolved filesystem path if the dataset was loaded from disk, otherwise None.
        format (str): The detected format of the dataset (e.g., "zarr", "netcdf", "hdf5").
        loaded_from (str): Indicates whether the dataset was loaded from "memory" or "disk".
        metadata (Dict[str, Any]): Additional metadata about the loaded dataset, such as measurement info.

    """

    kind: SupportedKind
    obj: Any
    source_ref: str
    actual_path: Optional[str]
    format: str
    loaded_from: str
    metadata: Dict[str, Any] = field(default_factory=dict)


def is_memory_reference(ref: str) -> bool:
    """
    Check if a reference is a memory reference.

    Args:
        ref (str): The reference string to check.

    Returns:
        bool: True if the reference is a memory reference, False otherwise.

    """

    return ref.startswith(MEMORY_PROTOCOL)


def normalize_memory_reference(ref: str) -> Optional[str]:
    """
    Normalize a memory reference by ensuring it starts with the MEMORY_PROTOCOL
    and has a measurement ID.

    Args:
        ref (str): The input reference string to normalize.

    Returns:
        Optional[str]: The normalized memory reference if valid, otherwise None.

    """

    if ref.startswith(MEMORY_PROTOCOL):
        return ref

    stripped = ref.rstrip("/")
    if stripped == MEMORY_PROTOCOL.rstrip("/"):
        return MEMORY_PROTOCOL

    return None


def extract_measurement_id(ref: str) -> str:
    """
    Extract the measurement ID from a memory reference.

    Args:
        ref (str): The memory reference string, expected to be in the form "memory://<measurement_id>".

    Returns:
        str: The extracted measurement ID, or an empty string if the reference is not valid.

    """

    return ref[len(MEMORY_PROTOCOL) :].strip("/")


def get_live_dataset_entries() -> Dict[str, Dict[str, Any]]:
    """
    Return mapping of measurement ids to live dataset info from SQLite DB.

    Args:
        None

    Returns:
        Dict[str, Dict[str, Any]]: A dictionary containing the resolved metadata.
            The returned dictionary maps measurement IDs to their metadata, which includes:
            - "disk_path": The filesystem path to the dataset on disk, if available.
            - "ws_url": The WebSocket URL for live access, if available.
            - "ws_port": The WebSocket port for live access, if available.
            - "started_at": Timestamp of when the measurement started.
            - "ended_at": Timestamp of when the measurement ended, if applicable.

    """
    if not live_db:
        logger.debug("Live database not available")
        return {}

    try:
        maintenance = live_db.maintain_registry(
            retention_days=7,
            # Long enough to outlast a refused connection to a closed
            # localhost port (~2s on Windows), which is what tells a dead
            # producer apart from a busy one.
            timeout=2.0,
            retries=2,
        )
        if maintenance.stale_measurement_ids or maintenance.deleted_count:
            logger.info(
                "Live registry maintenance marked %d stale and deleted %d old "
                "dataset record(s)",
                len(maintenance.stale_measurement_ids),
                maintenance.deleted_count,
            )
        live_db.init_database()
        measurements = live_db.get_live_measurements()
        entries: Dict[str, Dict[str, Any]] = {}
        for m in measurements:
            entries[m.measurement_id] = {
                "disk_path": m.fpath,
                "ws_url": m.ws_url,
                "ws_port": m.ws_port,
                "started_at": m.started_at,
                "ended_at": m.ended_at,
            }
        return entries
    except Exception as exc:
        logger.error("Failed to query live dataset entries: %s", exc)
        return {}


def resolve_live_dataset(measurement_id: str) -> Dict[str, Any]:
    """
    Resolve measurement metadata from SQLite DB.

    Args:
        measurement_id (str): The ID of the measurement to resolve.

    Returns:
        Dict[str, Any]: A dictionary containing the resolved metadata.
            The returned dictionary includes:
            - "disk_path": The filesystem path to the dataset on disk, if available.
            - "ws_url": The WebSocket URL for live access, if available.
            - "ws_port": The WebSocket port for live access, if available.
            - "live_status": A boolean indicating if the measurement is currently live.
            - "started_at": Timestamp of when the measurement started.
            - "ended_at": Timestamp of when the measurement ended, if applicable.

    """
    default = {
        "disk_path": None,
        "ws_url": None,
        "ws_port": None,
        "live_status": None,
        "started_at": None,
        "ended_at": None,
    }

    if not live_db:
        logger.debug("Live database not available")
        return default

    try:
        live_db.init_database()
        measurement = live_db.get_measurement(measurement_id)
        if measurement is None:
            return default
        return {
            "disk_path": measurement.fpath,
            "ws_url": measurement.ws_url,
            "ws_port": measurement.ws_port,
            "live_status": bool(measurement.live_status),
            "started_at": measurement.started_at,
            "ended_at": measurement.ended_at,
        }
    except Exception as exc:
        logger.error("Failed to resolve measurement %s: %s", measurement_id, exc)
        return default


class DataProvider(Protocol):
    name: str

    def supports(self, ref: str) -> bool: ...

    def load_sync(self, ref: str) -> LoadedData: ...

    async def load_async(self, ref: str) -> LoadedData: ...

    def resolve_disk_path(self, ref: str) -> str: ...


def _annotate_dataset(
    dataset: xr.Dataset,
    *,
    source_ref: str,
    actual_path: Optional[str],
    loaded_from: str,
    measurement_id: Optional[str] = None,
    measurement_live_status: Optional[bool] = None,
    measurement_ended_at: Optional[str] = None,
) -> None:
    """
    Annotate a loaded xarray Dataset with source and measurement metadata.

    This adds attributes to the Dataset to track where it was loaded from,
    the original reference, and any associated measurement metadata.
    This is useful for provenance and debugging.

    Attributes added include:
    - "path": The original source reference used to load the dataset.
    - "actual_path": The resolved filesystem path if different from the source reference.
    - "loaded_from": Indicates whether the dataset was loaded from "memory" or "disk".
    - "measurement_id": The associated measurement ID if applicable.
    - "measurement_live_status": Whether the measurement is currently live (if applicable).
    - "measurement_ended_at": Timestamp of when the measurement ended (if applicable).

    Args:
        dataset (xr.Dataset): The loaded dataset to annotate.
        source_ref (str): The original source reference used to load the dataset.
        actual_path (Optional[str]): The resolved filesystem path if different from the source reference.
        loaded_from (str): Indicates whether the dataset was loaded from "memory" or "disk".
        measurement_id (Optional[str]): The associated measurement ID if applicable.
        measurement_live_status (Optional[bool]): Whether the measurement is currently live (if applicable).
        measurement_ended_at (Optional[str]): Timestamp of when the measurement ended (if applicable).

    Returns:
        None

    """

    dataset.attrs["path"] = source_ref
    dataset.attrs["loaded_from"] = loaded_from
    if actual_path and actual_path != source_ref:
        dataset.attrs["actual_path"] = actual_path
    if measurement_id:
        dataset.attrs.setdefault("measurement_id", measurement_id)
    if measurement_live_status is not None:
        dataset.attrs["measurement_live_status"] = measurement_live_status
    if measurement_ended_at is not None:
        dataset.attrs["measurement_ended_at"] = measurement_ended_at

    _normalize_cf_label_attrs(dataset)


def _normalize_cf_label_attrs(dataset: xr.Dataset) -> None:
    """
    Mirror CF-convention `long_name`/`units` attrs into Qimchi's own
    `label`/`unit` attrs on every coordinate and data variable, in place.

    figures.py only ever reads `label`/`unit` (qanary' own convention) when
    deriving axis titles; sources that follow the more common CF convention
    instead -- QCoDeS's native `to_xarray_dataset()` output and Quantify
    datasets both do -- would otherwise silently fall back to bare variable
    names. Existing `label`/`unit` attrs are left untouched.

    Args:
        dataset (xr.Dataset): The dataset to normalize, mutated in place.

    Returns:
        None

    """
    for var in (*dataset.coords.values(), *dataset.data_vars.values()):
        if "long_name" in var.attrs:
            var.attrs.setdefault("label", var.attrs["long_name"])
        if "units" in var.attrs:
            var.attrs.setdefault("unit", var.attrs["units"])


def _load_xarray_dataset(path: Path, fmt: str) -> xr.Dataset:
    """
    Load dataset through xarray's load APIs.

    Args:
        path (Path): The filesystem path to the dataset.
        fmt (str): The detected format of the dataset (e.g., "zarr", "netcdf", "hdf5").

    Returns:
        xr.Dataset: The loaded dataset.

    Raises:
        UnsupportedDatasetFormatError: If the format is not supported.
        MissingBackendDependencyError: If a required backend dependency is missing.
        DatasetResolutionError: If the dataset cannot be loaded.

    """
    try:
        if fmt == "zarr":
            return xr.load_dataset(str(path), engine="zarr")

        if fmt == "netcdf":
            # Try available netCDF engines in deterministic order.
            # scipy handles netCDF3 files; h5netcdf/netcdf4 handle netCDF4.
            last_exc: Optional[Exception] = None
            for engine in ("h5netcdf", "scipy", "netcdf4"):
                try:
                    return xr.load_dataset(str(path), engine=engine)
                except Exception as exc:  # pragma: no cover - backend-dependent
                    last_exc = exc
            if last_exc is not None:
                raise last_exc

        if fmt == "hdf5":
            # Prefer h5netcdf, then netcdf4 for HDF5-like files.
            last_exc: Optional[Exception] = None
            for engine in ("h5netcdf", "netcdf4"):
                try:
                    return xr.load_dataset(str(path), engine=engine)
                except Exception as exc:  # pragma: no cover - backend-dependent
                    last_exc = exc
            if last_exc is not None:
                raise last_exc

        raise UnsupportedDatasetFormatError(
            f"Unsupported dataset format '{fmt}' for path: {path}"
        )
    except ModuleNotFoundError as exc:
        raise MissingBackendDependencyError(
            f"Missing dependency while loading '{path}': {exc}"
        ) from exc
    except ImportError as exc:
        raise MissingBackendDependencyError(
            f"Missing dependency while loading '{path}': {exc}"
        ) from exc
    except UnsupportedDatasetFormatError:
        raise
    except Exception as exc:
        # Normalize backend/engine errors so callers can return stable API errors.
        if "engine" in str(exc).lower() and "installed" in str(exc).lower():
            raise MissingBackendDependencyError(
                f"No compatible xarray backend engine available for '{path}': {exc}"
            ) from exc
        raise DatasetResolutionError(f"Failed to load dataset '{path}': {exc}") from exc


def load_xarray_dataset(path: str | Path, fmt: str) -> xr.Dataset:
    """
    Public helper for custom providers to use Qimchi's normalized xarray loading.

    Args:
        path (str | Path): The filesystem path to the dataset.
        fmt (str): The detected format of the dataset (e.g., "zarr", "netcdf", "hdf5").

    Returns:
        xr.Dataset: The loaded dataset.

    Raises:
        DatasetResolutionError: If the dataset cannot be loaded.

    """
    return _load_xarray_dataset(Path(path), fmt)


_QUANTIFY_SETTABLE_COORD_RE = re.compile(r"x(\d+)$")


def _grid_quantify_settables(dataset: xr.Dataset) -> xr.Dataset:
    """
    Reshape a Quantify sparse dataset's flat settables into real dimensions.

    Quantify (quantify-core and its successor `quantify` package) stores
    multi-settable sweeps as flat `x0`, `x1`, ... coordinate arrays along a
    single `dim_0`, and tags a genuinely rectangular sweep with the dataset
    attr `grid_2d=True` -- reshaping is only ever applied when that attr is
    set, matching Quantify's own `to_gridded_dataset()` (which uses the same
    signal and is likewise never set for more than two settables). A single
    settable is already directly plottable via its `dim_0` coordinate and is
    left untouched.

    This mirrors `to_gridded_dataset()`'s pandas-MultiIndex-based reshape
    without depending on the `quantify`/`quantify-core` package -- verified
    against real quantify-core output, including for a partially-completed
    (mid-run) sweep, where the untouched settables still cover the full grid
    and only the measured variable is short, leaving NaNs in the gaps.

    Args:
        dataset (xr.Dataset): The dataset to reshape.

    Returns:
        xr.Dataset: The gridded dataset, or the original dataset unchanged
            if it is not a rectangular multi-settable Quantify sweep.

    """
    if not dataset.attrs.get("grid_2d"):
        return dataset

    settable_coords = sorted(
        (
            name
            for name in dataset.coords
            if _QUANTIFY_SETTABLE_COORD_RE.fullmatch(name)
        ),
        key=lambda name: int(_QUANTIFY_SETTABLE_COORD_RE.fullmatch(name).group(1)),
    )
    if len(settable_coords) < 2:
        return dataset

    flat_dims = {dataset[name].dims for name in settable_coords}
    if len(flat_dims) != 1:
        return dataset
    (only_dims,) = flat_dims
    if len(only_dims) != 1:
        return dataset
    (flat_dim,) = only_dims

    try:
        gridded = dataset.set_index({flat_dim: settable_coords}).unstack(flat_dim)
    except Exception as exc:
        logger.warning(
            "Failed to grid Quantify dataset '%s': %s",
            dataset.attrs.get("tuid", "<unknown>"),
            exc,
        )
        return dataset

    gridded.attrs["grid_2d"] = False
    gridded.attrs["qimchi_quantify_gridded"] = True
    return gridded


def _prepare_quantify_dataset(dataset: xr.Dataset, fmt: str) -> tuple[xr.Dataset, str]:
    """
    Grid and tag a dataset if it is a Quantify dataset, otherwise pass through.

    Detection relies on Quantify's `tuid` attribute, which every Quantify
    dataset carries and which no other format in Qimchi's loader sets.

    Args:
        dataset (xr.Dataset): The loaded dataset to inspect.
        fmt (str): The format detected so far (e.g. "hdf5", "netcdf", "live").

    Returns:
        tuple[xr.Dataset, str]: The (possibly gridded) dataset, and "quantify"
            in place of `fmt` if it was a Quantify dataset.

    """
    if not dataset.attrs.get("tuid"):
        return dataset, fmt
    return _grid_quantify_settables(dataset), "quantify"


def _detect_filesystem_format(path: Path) -> str:
    """
    Detect dataset format based on filesystem path characteristics.

    Args:
        path (Path): The filesystem path to analyze.

    Returns:
        str: Detected format string (e.g., "zarr", "netcdf",

    """

    if path.is_dir():
        zarr_markers = {
            "zarr.json",  # zarr v3 marker
            ".zgroup",  # zarr v2 group marker
            ".zarray",  # zarr v2 array marker
            ".zmetadata",  # consolidated v2 metadata
        }
        if path.name.endswith(".zarr") or any(
            (path / marker).exists() for marker in zarr_markers
        ):
            return "zarr"

    suffix = path.suffix.lower()
    if suffix == ".nc":
        return "netcdf"
    if suffix in {".h5", ".hdf5"}:
        return "hdf5"
    if suffix == ".csv":
        return "csv"
    if suffix == ".txt":
        return "txt"
    if suffix == ".dat":
        return "dat"
    if suffix in {".sqlite", ".db"}:
        return "sqlite"
    return "unknown"


def _load_flat_table_dataset(path: Path) -> xr.Dataset:
    """
    Load a flat tabular file through polars and expose each column as a coordinate.

    Args:
        path (Path): Path to the flat tabular file.

    Returns:
        xr.Dataset: The loaded dataset.

    Raises:
        MissingBackendDependencyError: If polars is not available.
        DatasetResolutionError: If the flat table cannot be loaded.

    """
    try:
        import polars as pl
    except Exception as exc:
        raise MissingBackendDependencyError(
            f"Polars is required to load flat tabular files: {exc}"
        ) from exc

    try:
        frame = pl.read_csv(str(path))
    except Exception as exc:
        raise DatasetResolutionError(
            f"Failed to read flat table '{path}' with polars: {exc}"
        ) from exc

    if frame.width == 0:
        raise DatasetResolutionError(f"Flat table has no columns: {path}")

    row_dim = "row"
    dataset = xr.Dataset(coords={row_dim: np.arange(frame.height, dtype=np.int64)})

    columns = list(frame.columns)
    for column in columns:
        values = frame.get_column(column).to_numpy()
        dataset = dataset.assign_coords({column: (row_dim, values)})

    dataset.attrs["qimchi_tabular"] = True
    dataset.attrs["qimchi_tabular_row_dim"] = row_dim
    dataset.attrs["qimchi_all_columns"] = columns

    return dataset


def _parse_qcodes_reference(ref: str) -> tuple[Path, Optional[int]]:
    """
    Parse a QCoDeS SQLite reference.

    Supported forms:
    - /path/to/db.sqlite
    - /path/to/db.sqlite#123
    - /path/to/db.sqlite#run_id=123

    Args:
        ref (str): The QCoDeS SQLite reference.

    Returns:
        tuple[Path, Optional[int]]: A tuple containing the Path to the SQLite DB and an optional run_id.

    Raises:
        DatasetResolutionError: If the reference cannot be parsed.
        UnsupportedDatasetFormatError: If the path does not point to a supported QCoDeS SQLite file.

    """
    raw = ref.strip()
    path_part = raw
    fragment: Optional[str] = None

    if "#" in raw:
        path_part, fragment = raw.split("#", 1)

    db_path = Path(path_part)
    if db_path.suffix.lower() not in {".db", ".sqlite"}:
        raise UnsupportedDatasetFormatError(f"Not a QCoDeS sqlite reference: {ref}")

    run_id: Optional[int] = None
    if fragment:
        frag = fragment.strip()
        if frag.lower().startswith("run_id="):
            frag = frag.split("=", 1)[1]
        if frag:
            try:
                run_id = int(frag)
            except ValueError as exc:
                raise DatasetResolutionError(
                    f"Invalid QCoDeS run id fragment '{fragment}' in reference: {ref}"
                ) from exc

    return db_path, run_id


def _parse_datatree_reference(ref: str) -> tuple[Path, Optional[str]]:
    """
    Parse a DataTree reference.

    Supported forms:
    - /path/to/store.zarr
    - /path/to/store.zarr#dt_path=/group/subgroup
    - /path/to/store.zarr#node=/group/subgroup
    - /path/to/store.zarr#/group/subgroup

    Args:
        ref (str): The DataTree reference.

    Returns:
        tuple[Path, Optional[str]]: A tuple containing the Path to the DataTree store and an optional node path.

    Raises:
        DatasetResolutionError: If the reference cannot be parsed.
        UnsupportedDatasetFormatError: If the path does not point to a supported DataTree store.

    """
    raw = ref.strip()
    path_part = raw
    fragment: Optional[str] = None

    if "#" in raw:
        path_part, fragment = raw.split("#", 1)

    store_path = Path(path_part)
    if store_path.suffix.lower() not in {".zarr", ".nc", ".h5", ".hdf5"}:
        raise UnsupportedDatasetFormatError(f"Not a DataTree reference: {ref}")

    node_path: Optional[str] = None
    if fragment:
        frag = fragment.strip()
        lower_frag = frag.lower()
        if lower_frag.startswith("dt_path="):
            node_path = frag.split("=", 1)[1].strip()
        elif lower_frag.startswith("node="):
            node_path = frag.split("=", 1)[1].strip()
        elif frag.startswith("/"):
            node_path = frag

    if node_path:
        if not node_path.startswith("/"):
            node_path = f"/{node_path}"

    return store_path, node_path


def _open_xarray_datatree(path: Path, fmt: str) -> xr.DataTree:
    """
    Open DataTree through xarray's open_datatree API.

    This function attempts to open the given path as a DataTree using xarray's
    `open_datatree` function. It tries different backend engines based on the
    detected format and provides detailed error handling to surface meaningful
    exceptions if loading fails due to unsupported formats or missing dependencies.

    Args:
        path (Path): The filesystem path to the DataTree store.
        fmt (str): The detected format of the DataTree (e.g., "zarr", "netcdf", "hdf5").

    Returns:
        xr.DataTree: The opened DataTree object.

    Raises:
        UnsupportedDatasetFormatError: If the format is not supported for DataTrees.
        MissingBackendDependencyError: If a required backend dependency for opening DataTrees is missing.
        DatasetResolutionError: If the DataTree cannot be opened due to other errors.

    """
    open_datatree = getattr(xr, "open_datatree", None)
    if open_datatree is None:
        raise MissingBackendDependencyError(
            "xarray.open_datatree is unavailable. Install a compatible xarray with DataTree support."
        )

    try:
        if fmt == "zarr":
            return open_datatree(str(path), engine="zarr")

        if fmt == "netcdf":
            last_exc: Optional[Exception] = None
            for engine in ("h5netcdf", "scipy", "netcdf4"):
                try:
                    return open_datatree(str(path), engine=engine)
                except Exception as exc:  # pragma: no cover - backend-dependent
                    last_exc = exc
            if last_exc is not None:
                raise last_exc

        if fmt == "hdf5":
            last_exc: Optional[Exception] = None
            for engine in ("h5netcdf", "netcdf4"):
                try:
                    return open_datatree(str(path), engine=engine)
                except Exception as exc:  # pragma: no cover - backend-dependent
                    last_exc = exc
            if last_exc is not None:
                raise last_exc

        raise UnsupportedDatasetFormatError(
            f"Unsupported datatree format '{fmt}' for path: {path}"
        )
    except ModuleNotFoundError as exc:
        raise MissingBackendDependencyError(
            f"Missing dependency while loading datatree '{path}': {exc}"
        ) from exc
    except ImportError as exc:
        raise MissingBackendDependencyError(
            f"Missing dependency while loading datatree '{path}': {exc}"
        ) from exc
    except UnsupportedDatasetFormatError:
        raise
    except Exception as exc:
        if "engine" in str(exc).lower() and "installed" in str(exc).lower():
            raise MissingBackendDependencyError(
                f"No compatible xarray backend engine available for datatree '{path}': {exc}"
            ) from exc
        raise DatasetResolutionError(
            f"Failed to load datatree '{path}': {exc}"
        ) from exc


def _extract_dataset_from_datatree(dtree: Any, node_path: Optional[str]) -> xr.Dataset:
    """
    Extract xr.Dataset from a DataTree node path.

    Args:
        dtree (Any): The loaded DataTree object.
        node_path (Optional[str]): The path to the node within the DataTree to extract the dataset from. If None, the root node is used.

    Returns:
        xr.Dataset: The extracted dataset from the specified DataTree node.

    Raises:
        DatasetResolutionError: If the specified node path does not exist in the DataTree.
        DatasetKindMismatchError: If the specified node does not contain a dataset payload.

    """
    selected_path = node_path or "/"
    try:
        node = dtree[selected_path] if selected_path != "/" else dtree
    except Exception as exc:
        raise DatasetResolutionError(
            f"DataTree node not found at '{selected_path}'"
        ) from exc

    dataset = getattr(node, "ds", None)
    if dataset is None:
        raise DatasetKindMismatchError(
            f"DataTree node '{selected_path}' has no dataset payload"
        )

    return dataset


def list_datatree_nodes(ref: str | Path) -> list[dict[str, Any]]:
    """
    List nodes from a DataTree-backed store for discovery/tree views.

    Args:
        ref (str | Path): The reference to the DataTree store, which may include an optional node path fragment.

    Returns:
        list[dict[str, Any]]: A list of dictionaries containing metadata about each node in
            the DataTree. Each dictionary includes:
            - "path": The path of the node within the DataTree.
            - "name": The name of the node (derived from the path).
            - "has_dataset": A boolean indicating whether the node contains a dataset payload.

    Raises:
        DatasetResolutionError: If the DataTree path does not exist or cannot be loaded.

    """
    raw = str(ref)
    path, _ = _parse_datatree_reference(raw if "#" in raw else str(ref))
    if not path.exists():
        raise DatasetResolutionError(f"DataTree path does not exist: {path}")

    fmt = _detect_filesystem_format(path)
    dtree = _open_xarray_datatree(path, fmt)
    try:
        subtree = getattr(dtree, "subtree", None)
        nodes = list(subtree) if subtree is not None else [dtree]
        out: list[dict[str, Any]] = []
        for node in nodes:
            node_path = str(getattr(node, "path", "/") or "/")
            node_name = str(getattr(node, "name", "") or "")
            if not node_name:
                node_name = "root" if node_path == "/" else Path(node_path).name
            node_ds = getattr(node, "ds", None)
            has_dataset = node_ds is not None
            out.append(
                {
                    "path": node_path,
                    "name": node_name,
                    "has_dataset": has_dataset,
                }
            )
        return out
    finally:
        close_fn = getattr(dtree, "close", None)
        if callable(close_fn):
            close_fn()


def _get_latest_qcodes_run_id(db_path: Path) -> int:
    """
    Return the latest run_id from a QCoDeS sqlite DB.

    Args:
        db_path (Path): Path to the QCoDeS sqlite database file.

    Returns:
        int: The latest run_id in the database.

    Raises:
        DatasetResolutionError: If the QCoDeS DB cannot be queried.

    """
    try:
        conn = sqlite3.connect(str(db_path))
        try:
            row = conn.execute("SELECT MAX(run_id) FROM runs").fetchone()
        finally:
            conn.close()
    except Exception as exc:
        raise DatasetResolutionError(
            f"Failed to query runs from QCoDeS DB '{db_path}': {exc}"
        ) from exc

    run_id = row[0] if row else None
    if run_id is None:
        raise DatasetResolutionError(f"No runs found in QCoDeS DB: {db_path}")

    return int(run_id)


def list_qcodes_runs(db_path: str | Path) -> list[dict[str, Any]]:
    """
    List QCoDeS runs from a sqlite DB for tree/discovery use.

    Args:
        db_path (str | Path): Path to the QCoDeS sqlite database file.

    Returns:
        list[dict[str, Any]]: List of run metadata.

    Raises:
        DatasetResolutionError: If the QCoDeS DB cannot be read.

    """
    path = Path(db_path)
    if not path.exists() or not path.is_file():
        raise DatasetResolutionError(f"QCoDeS database file not found: {path}")

    try:
        conn = sqlite3.connect(str(path))
        try:
            rows = conn.execute(
                """
                SELECT run_id, name, result_table_name, run_timestamp
                FROM runs
                ORDER BY run_id DESC
                """
            ).fetchall()
        finally:
            conn.close()
    except Exception as exc:
        raise DatasetResolutionError(
            f"Failed to read runs from QCoDeS DB '{path}': {exc}"
        ) from exc

    runs: list[dict[str, Any]] = []
    for row in rows:
        run_id, name, result_table_name, run_timestamp = row
        runs.append(
            {
                "run_id": int(run_id),
                "name": name,
                "result_table_name": result_table_name,
                "run_timestamp": run_timestamp,
            }
        )
    return runs


def _load_qcodes_xarray_dataset(db_path: Path, run_id: int) -> xr.Dataset:
    """
    Load a QCoDeS run and convert to xarray Dataset.

    Args:
        db_path (Path): Path to the QCoDeS sqlite database file.
        run_id (int): The run_id of the QCoDeS run to load.

    Returns:
        xr.Dataset: The loaded QCoDeS run as an xarray Dataset.

    Raises:
        DatasetResolutionError: If the QCoDeS run cannot be loaded.
        MissingBackendDependencyError: If QCoDeS or its dependencies are not available.

    """
    try:
        from qcodes.dataset import initialised_database_at, load_by_id
    except Exception as exc:
        raise MissingBackendDependencyError(
            f"QCoDeS is required to load sqlite datasets: {exc}"
        ) from exc

    try:
        with initialised_database_at(str(db_path)):
            qcodes_dataset = load_by_id(run_id)
            dataset = qcodes_dataset.to_xarray_dataset()
    except Exception as exc:
        raise DatasetResolutionError(
            f"Failed to load QCoDeS run_id={run_id} from '{db_path}': {exc}"
        ) from exc

    dataset.attrs.setdefault("run_id", run_id)
    dataset.attrs.setdefault("qcodes_db_path", str(db_path))

    return dataset


# Measurements whose live server answered that it does not host them, keyed to
# the registration they were disowned under. That answer is authoritative, so
# re-asking once per plot refresh only costs a connection -- which is what
# happens when a run ends and a later producer inherits its port. Keying on
# ``started_at`` means a re-registration under the same id is tried afresh.
_WS_DISOWNED: Dict[str, Any] = {}


def _ws_worth_trying(measurement_id: str, info: Dict[str, Any]) -> bool:
    """
    Return whether a live snapshot is worth requesting over the WebSocket.

    A finished measurement whose data is on disk is read from there: its
    producer has normally exited, so dialling the endpoint on every refresh
    only delays the plot behind a connection that cannot succeed. One without
    a disk path is still tried, because there is nothing to fall back to.

    Args:
        measurement_id (str): Measurement the reference points at.
        info (Dict[str, Any]): Registry row for that measurement.

    Returns:
        bool: True when the WebSocket should be tried.

    """
    if not info.get("ws_url"):
        return False
    if measurement_id in _WS_DISOWNED and _WS_DISOWNED[measurement_id] == info.get(
        "started_at"
    ):
        return False
    return not (info.get("ended_at") and info.get("disk_path"))


def _note_ws_failure(measurement_id: str, info: Dict[str, Any], exc: Exception) -> None:
    """
    Record an authoritative "no such measurement" answer from a live server.

    Only the server denying the measurement is conclusive. A refused or timed
    out connection can mean a producer that is merely starting up or busy, and
    that is worth asking again.

    Args:
        measurement_id (str): Measurement the request was for.
        info (Dict[str, Any]): Registry row the request was built from.
        exc (Exception): Failure raised while fetching the snapshot.

    """
    if isinstance(exc, RuntimeError) and "not found" in str(exc):
        _WS_DISOWNED[measurement_id] = info.get("started_at")


# Live measurements accumulated row by row, keyed by measurement id: the grid
# received so far and how many of its rows are trusted. A poll then asks only
# for the rows past that point, so following a long sweep costs what was
# measured since the last refresh rather than the whole run every time.
# Bounded, because each entry holds a complete measurement in memory.
_LIVE_ACCUM: Dict[str, Dict[str, Any]] = {}
_LIVE_ACCUM_MAX = 2


def forget_live_rows(measurement_id: str) -> None:
    """
    Drop an accumulated measurement, releasing its arrays.

    Args:
        measurement_id (str): Measurement to forget.

    """
    _LIVE_ACCUM.pop(measurement_id, None)


def _remember_live_rows(
    measurement_id: str, info: Dict[str, Any], dataset: xr.Dataset
) -> xr.Dataset:
    """
    Keep a whole snapshot as the base that later rows are folded into.

    A producer that cannot describe its rows -- no shared leading dimension,
    or a server too old to answer row requests -- is not accumulated at all,
    and every poll fetches it whole as before.

    Args:
        measurement_id (str): Measurement the snapshot belongs to.
        info (Dict[str, Any]): Registry row it was fetched under.
        dataset (xr.Dataset): The snapshot.

    Returns:
        xr.Dataset: The same dataset, for use as an expression.

    """
    rows = dataset.encoding.get("qimchi_connect_rows") or {}
    if not rows.get("append_dim"):
        forget_live_rows(measurement_id)
        return dataset

    while len(_LIVE_ACCUM) >= _LIVE_ACCUM_MAX and measurement_id not in _LIVE_ACCUM:
        _LIVE_ACCUM.pop(next(iter(_LIVE_ACCUM)))
    _LIVE_ACCUM[measurement_id] = {
        "dataset": dataset,
        "dim": rows["append_dim"],
        "rows": int(rows.get("rows_written", 0)),
        "started_at": info.get("started_at"),
    }
    return dataset


def _merge_live_rows(
    measurement_id: str,
    info: Dict[str, Any],
    dataset: xr.Dataset,
    cached: Optional[Dict[str, Any]],
) -> Optional[xr.Dataset]:
    """
    Fold newly fetched rows into the measurement accumulated so far.

    The rows are written into the existing arrays rather than concatenated,
    which keeps the cost proportional to what was measured since the last
    poll. A refresh running concurrently may therefore read a row while it is
    being filled -- the same half-written row a live plot shows anyway.

    Args:
        measurement_id (str): Measurement being followed.
        info (Dict[str, Any]): Registry row the fetch was made under.
        dataset (xr.Dataset): Rows returned by the producer.
        cached (Optional[Dict[str, Any]]): Accumulator entry, if any.

    Returns:
        Optional[xr.Dataset]: The accumulated measurement, or None when the
            two cannot be reconciled -- another run, a resized grid, or a
            variable that was not there before -- and the caller should fetch
            the whole measurement instead.

    """
    rows = dataset.encoding.get("qimchi_connect_rows") or {}
    start = int(rows.get("rows_from", 0))
    if not start or cached is None:
        return None
    if cached.get("started_at") != info.get("started_at"):
        return None

    dim = rows.get("append_dim")
    base = cached["dataset"]
    if dim != cached.get("dim") or dim not in base.sizes:
        return None
    if int(rows.get("rows_total", -1)) != int(base.sizes[dim]):
        return None

    stop = int(rows.get("rows_written", start))
    for name, var in dataset.data_vars.items():
        if name not in base.data_vars:
            return None
        if stop > start:
            base[name].values[start:stop] = var.transpose(*base[name].dims).values

    cached["rows"] = stop
    base.encoding["qimchi_connect_rows"] = rows
    logger.debug(
        "[live] %s: folded rows %d:%d of %s",
        measurement_id,
        start,
        stop,
        rows.get("rows_total"),
    )
    return base


def _live_since_rows(measurement_id: str, info: Dict[str, Any]) -> Optional[int]:
    """
    Return how many rows of this measurement are already held, if any.

    Args:
        measurement_id (str): Measurement about to be fetched.
        info (Dict[str, Any]): Registry row for it.

    Returns:
        Optional[int]: Rows to ask from, or None to fetch the whole thing.

    """
    cached = _LIVE_ACCUM.get(measurement_id)
    if cached is None or cached.get("started_at") != info.get("started_at"):
        return None
    return cached["rows"] or None


class LiveMemoryProvider:
    """
    Provider for live datasets loaded through memory/WebSocket.

    This provider detects memory references with the "memory://" protocol and
    resolves them to live datasets based on measurement IDs. It attempts to load
    the dataset through a WebSocket connection for real-time access, and falls back
    to disk loading if the WebSocket is unavailable. The provider annotates the
    loaded dataset with source and measurement metadata for provenance. This allows
    users to access live datasets in a seamless way through Qimchi's dataset APIs,
    even if the underlying data is changing in real time or only partially available on disk.

    """

    name = "live_memory_provider"

    def supports(self, ref: str) -> bool:
        return normalize_memory_reference(ref) is not None

    def resolve_disk_path(self, ref: str) -> str:
        normalized = normalize_memory_reference(ref)
        if normalized is None:
            raise DatasetResolutionError(f"Not a memory reference: {ref}")

        measurement_id = extract_measurement_id(normalized)
        if not measurement_id:
            raise DatasetResolutionError(
                "Memory path must include a measurement id (memory://<id>)"
            )

        info = resolve_live_dataset(measurement_id)
        disk_path = info.get("disk_path")

        if not disk_path:
            try:
                from . import live_measurements

                measurement_info = live_measurements.get_measurement_info(
                    measurement_id
                )
                if measurement_info and measurement_info.fpath:
                    disk_path = measurement_info.fpath
            except Exception:
                disk_path = None

        if not disk_path:
            raise DatasetResolutionError(
                f"Live dataset {measurement_id} has no disk path available"
            )

        return str(disk_path)

    def _load_from_disk(
        self, ref: str, measurement_id: str, info: Dict[str, Any]
    ) -> LoadedData:
        if info.get("ended_at"):
            # The run is over and its data is on disk, so the rows held for
            # incremental polling are dead weight.
            forget_live_rows(measurement_id)

        disk_path = self.resolve_disk_path(ref)
        path = Path(disk_path)
        if not path.exists():
            raise DatasetResolutionError(
                f"Resolved disk path does not exist for {measurement_id}: {path}"
            )
        fmt = _detect_filesystem_format(path)
        dataset = _load_xarray_dataset(path, fmt)
        dataset, fmt = _prepare_quantify_dataset(dataset, fmt)
        _annotate_dataset(
            dataset,
            source_ref=ref,
            actual_path=str(path),
            loaded_from="disk",
            measurement_id=measurement_id,
            measurement_live_status=info.get("live_status"),
            measurement_ended_at=info.get("ended_at"),
        )
        return LoadedData(
            kind="dataset",
            obj=dataset,
            source_ref=ref,
            actual_path=str(path),
            format=fmt,
            loaded_from="disk",
            metadata={
                "measurement_id": measurement_id,
                "ws_url": info.get("ws_url"),
                "live_status": info.get("live_status"),
                "ended_at": info.get("ended_at"),
            },
        )

    def load_sync(self, ref: str) -> LoadedData:
        normalized = normalize_memory_reference(ref)
        if normalized is None:
            raise DatasetResolutionError(f"Not a memory reference: {ref}")

        measurement_id = extract_measurement_id(normalized)
        if not measurement_id:
            raise DatasetResolutionError(
                "Memory path must include a measurement id (memory://<id>)"
            )

        info = resolve_live_dataset(measurement_id)
        ws_url = info.get("ws_url")

        if _ws_worth_trying(measurement_id, info):
            try:
                since_rows = _live_since_rows(measurement_id, info)
                # Only sent when rows are actually held, which never happens
                # against a producer whose qimchi-connect cannot describe
                # them -- so an older one is asked exactly as it was before.
                extra = {"since_rows": since_rows} if since_rows else {}
                dataset = live_client.open_live_measurement_sync(
                    measurement_id, ws_url=ws_url, **extra
                )
                merged = _merge_live_rows(
                    measurement_id, info, dataset, _LIVE_ACCUM.get(measurement_id)
                )
                if merged is not None:
                    dataset = merged
                else:
                    if since_rows and (
                        dataset.encoding.get("qimchi_connect_rows") or {}
                    ).get("rows_from"):
                        # Rows that cannot be folded into what is held: start
                        # again from a whole snapshot rather than plot a gap.
                        dataset = live_client.open_live_measurement_sync(
                            measurement_id, ws_url=ws_url
                        )
                    dataset = _remember_live_rows(measurement_id, info, dataset)
                source = dataset.encoding.get("qimchi_connect_source", {})
                fmt = source.get("source_format", "live")
                dataset, fmt = _prepare_quantify_dataset(dataset, fmt)
                _annotate_dataset(
                    dataset,
                    source_ref=normalized,
                    actual_path=info.get("disk_path"),
                    loaded_from="memory",
                    measurement_id=measurement_id,
                    measurement_live_status=info.get("live_status"),
                    measurement_ended_at=info.get("ended_at"),
                )
                return LoadedData(
                    kind="dataset",
                    obj=dataset,
                    source_ref=normalized,
                    actual_path=info.get("disk_path"),
                    format=fmt,
                    loaded_from="memory",
                    metadata={
                        "measurement_id": measurement_id,
                        "ws_url": ws_url,
                        "live_status": info.get("live_status"),
                        "ended_at": info.get("ended_at"),
                        "source": source,
                    },
                )
            except Exception as exc:
                _note_ws_failure(measurement_id, info, exc)
                logger.info(
                    "WebSocket unavailable for '%s': %s. Falling back to disk.",
                    measurement_id,
                    exc,
                )

        return self._load_from_disk(normalized, measurement_id, info)

    async def load_async(self, ref: str) -> LoadedData:
        normalized = normalize_memory_reference(ref)
        if normalized is None:
            raise DatasetResolutionError(f"Not a memory reference: {ref}")

        measurement_id = extract_measurement_id(normalized)
        if not measurement_id:
            raise DatasetResolutionError(
                "Memory path must include a measurement id (memory://<id>)"
            )

        info = resolve_live_dataset(measurement_id)
        ws_url = info.get("ws_url")

        if _ws_worth_trying(measurement_id, info):
            try:
                since_rows = _live_since_rows(measurement_id, info)
                # See the note in load_sync: not sent unless rows are held.
                extra = {"since_rows": since_rows} if since_rows else {}
                dataset = await live_client.open_live_measurement(
                    measurement_id, ws_url=ws_url, **extra
                )
                merged = _merge_live_rows(
                    measurement_id, info, dataset, _LIVE_ACCUM.get(measurement_id)
                )
                if merged is not None:
                    dataset = merged
                else:
                    if since_rows and (
                        dataset.encoding.get("qimchi_connect_rows") or {}
                    ).get("rows_from"):
                        # Rows that cannot be folded into what is held: start
                        # again from a whole snapshot rather than plot a gap.
                        dataset = await live_client.open_live_measurement(
                            measurement_id, ws_url=ws_url
                        )
                    dataset = _remember_live_rows(measurement_id, info, dataset)
                source = dataset.encoding.get("qimchi_connect_source", {})
                fmt = source.get("source_format", "live")
                dataset, fmt = _prepare_quantify_dataset(dataset, fmt)
                _annotate_dataset(
                    dataset,
                    source_ref=normalized,
                    actual_path=info.get("disk_path"),
                    loaded_from="memory",
                    measurement_id=measurement_id,
                    measurement_live_status=info.get("live_status"),
                    measurement_ended_at=info.get("ended_at"),
                )
                return LoadedData(
                    kind="dataset",
                    obj=dataset,
                    source_ref=normalized,
                    actual_path=info.get("disk_path"),
                    format=fmt,
                    loaded_from="memory",
                    metadata={
                        "measurement_id": measurement_id,
                        "ws_url": ws_url,
                        "live_status": info.get("live_status"),
                        "ended_at": info.get("ended_at"),
                        "source": source,
                    },
                )
            except Exception as exc:
                _note_ws_failure(measurement_id, info, exc)
                logger.info(
                    "WebSocket unavailable for '%s': %s. Falling back to disk.",
                    measurement_id,
                    exc,
                )

        return self._load_from_disk(normalized, measurement_id, info)


class NetcdfHdf5Provider:
    """
    Provider for NetCDF/HDF5 files loaded through xarray.

    This provider detects references to NetCDF or HDF5 files based on their suffix
    and attempts to load them through xarray's supported backends. It annotates
    the loaded dataset with source metadata for provenance. This allows users to
    load common scientific data formats in a consistent way through Qimchi's dataset APIs.

    """

    name = "netcdf_hdf5_provider"
    _suffixes = {".nc", ".h5", ".hdf5"}

    def supports(self, ref: str) -> bool:
        if is_memory_reference(ref):
            return False
        return Path(ref).suffix.lower() in self._suffixes

    def resolve_disk_path(self, ref: str) -> str:
        path = Path(ref)
        if not path.exists() or not path.is_file():
            raise DatasetResolutionError(f"Dataset file not found: {path}")
        return str(path)

    def _load(self, ref: str) -> LoadedData:
        path = Path(ref)
        if not path.exists() or not path.is_file():
            raise DatasetResolutionError(f"Dataset file not found: {path}")

        fmt = _detect_filesystem_format(path)
        dataset = _load_xarray_dataset(path, fmt)
        dataset, fmt = _prepare_quantify_dataset(dataset, fmt)
        _annotate_dataset(
            dataset,
            source_ref=ref,
            actual_path=str(path),
            loaded_from="disk",
        )
        return LoadedData(
            kind="dataset",
            obj=dataset,
            source_ref=ref,
            actual_path=str(path),
            format=fmt,
            loaded_from="disk",
            metadata={},
        )

    def load_sync(self, ref: str) -> LoadedData:
        return self._load(ref)

    async def load_async(self, ref: str) -> LoadedData:
        # Opening a dataset is blocking file I/O. Awaiting it inline pinned the
        # event loop for the whole read, which is what makes a basket of ~90
        # datasets stall unrelated requests while the Metadata tab loads.
        return await asyncio.to_thread(self._load, ref)


class DataTreeProvider:
    """
    Provider for DataTree node references.

    This provider is intentionally fragment-driven and activates when the
    reference contains a DataTree node selector fragment:
    - #dt_path=/group/subgroup
    - #node=/group/subgroup
    - #/group/subgroup

    """

    name = "datatree_provider"
    _suffixes = {".zarr", ".nc", ".h5", ".hdf5"}

    def supports(self, ref: str) -> bool:
        if is_memory_reference(ref):
            return False
        if "#" not in ref:
            return False
        try:
            path, node_path = _parse_datatree_reference(ref)
        except Exception:
            return False
        return path.suffix.lower() in self._suffixes and node_path is not None

    def resolve_disk_path(self, ref: str) -> str:
        path, _ = _parse_datatree_reference(ref)
        return str(path)

    def load_sync(self, ref: str) -> LoadedData:
        path, node_path = _parse_datatree_reference(ref)
        if not path.exists():
            raise DatasetResolutionError(f"DataTree path does not exist: {path}")

        fmt = _detect_filesystem_format(path)
        dtree = _open_xarray_datatree(path, fmt)
        try:
            dataset = _extract_dataset_from_datatree(dtree, node_path)
            _annotate_dataset(
                dataset,
                source_ref=ref,
                actual_path=str(path),
                loaded_from="disk",
            )
            return LoadedData(
                kind="dataset",
                obj=dataset,
                source_ref=ref,
                actual_path=str(path),
                format=fmt,
                loaded_from="disk",
                metadata={"dt_path": node_path or "/"},
            )
        finally:
            # Dataset is loaded in-memory; safe to close underlying DataTree store.
            close_fn = getattr(dtree, "close", None)
            if callable(close_fn):
                close_fn()

    async def load_async(self, ref: str) -> LoadedData:
        return self.load_sync(ref)


class FilesystemXarrayProvider:
    """
    Provider for generic filesystem paths that can be loaded through xarray.

    This provider detects references that are not memory references and attempts
    to load them through xarray's supported backends based on filesystem heuristics.

    """

    name = "filesystem_xarray_provider"

    def supports(self, ref: str) -> bool:
        return not is_memory_reference(ref)

    def resolve_disk_path(self, ref: str) -> str:
        return str(Path(ref))

    def _load(self, ref: str) -> LoadedData:
        path = Path(ref)
        if not path.exists():
            raise DatasetResolutionError(f"Dataset path does not exist: {path}")

        fmt = _detect_filesystem_format(path)
        if fmt == "unknown":
            raise UnsupportedDatasetFormatError(
                f"Unsupported dataset path/format: {path}"
            )
        if fmt in {"sqlite"}:
            raise UnsupportedDatasetFormatError(
                f"Format '{fmt}' support is scaffolded but not implemented yet: {path}"
            )

        dataset = _load_xarray_dataset(path, fmt)
        dataset, fmt = _prepare_quantify_dataset(dataset, fmt)
        _annotate_dataset(
            dataset,
            source_ref=ref,
            actual_path=str(path),
            loaded_from="disk",
        )
        return LoadedData(
            kind="dataset",
            obj=dataset,
            source_ref=ref,
            actual_path=str(path),
            format=fmt,
            loaded_from="disk",
            metadata={},
        )

    def load_sync(self, ref: str) -> LoadedData:
        return self._load(ref)

    async def load_async(self, ref: str) -> LoadedData:
        # Opening a dataset is blocking file I/O. Awaiting it inline pinned the
        # event loop for the whole read, which is what makes a basket of ~90
        # datasets stall unrelated requests while the Metadata tab loads.
        return await asyncio.to_thread(self._load, ref)


class QcodesSqliteProvider:
    """
    Provider for QCoDeS SQLite database files.

    This provider detects references to QCoDeS SQLite databases
    based on their file suffix and an optional run_id fragment.
    It loads the specified run (or the latest run if no run_id is
    provided) from the database and converts it to an xarray Dataset.

    """

    name = "qcodes_sqlite_provider"
    _suffixes = {".db", ".sqlite"}

    def supports(self, ref: str) -> bool:
        if is_memory_reference(ref):
            return False
        try:
            path, _ = _parse_qcodes_reference(ref)
        except Exception:
            return False
        return path.suffix.lower() in self._suffixes

    def resolve_disk_path(self, ref: str) -> str:
        db_path, _ = _parse_qcodes_reference(ref)
        return str(db_path)

    def load_sync(self, ref: str) -> LoadedData:
        db_path, requested_run_id = _parse_qcodes_reference(ref)
        if not db_path.exists() or not db_path.is_file():
            raise DatasetResolutionError(f"QCoDeS database file not found: {db_path}")

        run_id = requested_run_id or _get_latest_qcodes_run_id(db_path)
        dataset = _load_qcodes_xarray_dataset(db_path, run_id)
        _annotate_dataset(
            dataset,
            source_ref=ref,
            actual_path=str(db_path),
            loaded_from="disk",
        )
        return LoadedData(
            kind="dataset",
            obj=dataset,
            source_ref=ref,
            actual_path=str(db_path),
            format="sqlite",
            loaded_from="disk",
            metadata={"run_id": run_id},
        )

    async def load_async(self, ref: str) -> LoadedData:
        return self.load_sync(ref)


class FlatFmtProvider:
    """
    Provider for flat tabular files like CSV, TXT, and DAT loaded through polars.

    This provider detects flat files based on their suffix and loads
    them into an xarray Dataset where each column is exposed as a
    coordinate.

    This allows simple tabular data to be easily loaded and accessed
    in a consistent way through Qimchi's dataset APIs, even if they
    don't conform to more complex formats like Zarr or NetCDF. The
    provider relies on the polars library for efficient CSV parsing
    and supports basic annotation of the loaded dataset with source
    metadata.

    """

    name = "flat_fmt_provider"
    _suffixes = {".csv", ".txt", ".dat"}

    def supports(self, ref: str) -> bool:
        return Path(ref).suffix.lower() in self._suffixes and not is_memory_reference(
            ref
        )

    def resolve_disk_path(self, ref: str) -> str:
        path = Path(ref)
        if not path.exists() or not path.is_file():
            raise DatasetResolutionError(f"Dataset file not found: {path}")
        return str(path)

    def load_sync(self, ref: str) -> LoadedData:
        path = Path(ref)
        if not path.exists() or not path.is_file():
            raise DatasetResolutionError(f"Dataset file not found: {path}")

        fmt = _detect_filesystem_format(path)
        dataset = _load_flat_table_dataset(path)
        _annotate_dataset(
            dataset,
            source_ref=ref,
            actual_path=str(path),
            loaded_from="disk",
        )

        return LoadedData(
            kind="dataset",
            obj=dataset,
            source_ref=ref,
            actual_path=str(path),
            format=fmt,
            loaded_from="disk",
            metadata={"columns": dataset.attrs.get("qimchi_all_columns", [])},
        )

    async def load_async(self, ref: str) -> LoadedData:
        return self.load_sync(ref)


# NOTE: These are the default built-in providers.
# NOTE: Custom providers can be registered at runtime and
# will take precedence over these based on registration order.
_BUILTIN_PROVIDERS: list[DataProvider] = [
    LiveMemoryProvider(),
    QcodesSqliteProvider(),
    FlatFmtProvider(),
    DataTreeProvider(),
    NetcdfHdf5Provider(),
    FilesystemXarrayProvider(),
]
_CUSTOM_PROVIDERS: list[DataProvider] = []


def register_provider(provider: DataProvider, *, prepend: bool = False) -> None:
    if prepend:
        _CUSTOM_PROVIDERS.insert(0, provider)
    else:
        _CUSTOM_PROVIDERS.append(provider)


def clear_custom_providers() -> None:
    _CUSTOM_PROVIDERS.clear()


def _iter_providers() -> list[DataProvider]:
    return [*_CUSTOM_PROVIDERS, *_BUILTIN_PROVIDERS]


def _select_provider(ref: str) -> DataProvider:
    for provider in _iter_providers():
        try:
            if provider.supports(ref):
                return provider
        except Exception as exc:
            logger.warning(
                "Provider '%s' errored during supports(%s): %s",
                getattr(provider, "name", provider.__class__.__name__),
                ref,
                exc,
            )
    raise UnsupportedDatasetFormatError(
        f"No provider supports dataset reference: {ref}"
    )


def resolve_to_disk_path(ref: str) -> str:
    provider = _select_provider(ref)
    return provider.resolve_disk_path(ref)


def load_data_sync(ref: str) -> LoadedData:
    provider = _select_provider(ref)
    return provider.load_sync(ref)


async def load_data_async(ref: str) -> LoadedData:
    provider = _select_provider(ref)
    return await provider.load_async(ref)


def load_dataset_sync(ref: str) -> xr.Dataset:
    loaded = load_data_sync(ref)
    if loaded.kind != "dataset":
        raise DatasetKindMismatchError(f"Reference {ref} resolved to {loaded.kind}")
    return loaded.obj


async def load_dataset_async(ref: str) -> xr.Dataset:
    loaded = await load_data_async(ref)
    if loaded.kind != "dataset":
        raise DatasetKindMismatchError(f"Reference {ref} resolved to {loaded.kind}")
    return loaded.obj
