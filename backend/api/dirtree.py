"""
FastAPI endpoint for many Explorer/DirTree related operations.

"""

import asyncio
import hashlib
import json
import math
import os
import stat as stat_module
import subprocess  # Windows compat
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional

import xarray as xr
from fastapi import APIRouter, HTTPException

from . import live_measurements

# Local tool execs
from .config import FD_EXEC, MAX_DEPTH  #  DU_EXEC, XARGS_EXEC | Windows compat
from .data_loader import (
    MEMORY_PROTOCOL,
    extract_measurement_id,
    get_live_dataset_entries,
    list_datatree_nodes,
    list_qcodes_runs,
    load_dataset_async,
    load_dataset_sync,
    normalize_memory_reference,
    resolve_live_dataset,
    resolve_to_disk_path,
)
from .diagnostics import register_gauge
from .json_utils import sanitize_for_json
from .logger import logger

# Local imports
from .models import PathData, PinnedParametersRequest
from .units import format_quantity

router = APIRouter()


def _run_fd_capture(cmd: list[str]) -> subprocess.CompletedProcess[bytes]:
    """Run fd without flashing console windows in the packaged Windows app."""
    run_kwargs = {}
    if os.name == "nt":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE
        run_kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        run_kwargs["startupinfo"] = startupinfo
    return subprocess.run(
        cmd,
        input=None,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        **run_kwargs,
    )


def _extract_measurement_id(memory_path: str) -> str:
    """Extract the measurement identifier from a memory:// URI."""
    return extract_measurement_id(memory_path)


def _get_dataset_last_modified(path: Path, store_mtime: float | None = None) -> float:
    """
    Get the last modification time of a zarr dataset.

    Reads the store directory's own mtime plus its metadata file, instead of
    walking the store. A zarr store holds one file per chunk, so the previous
    rglob cost thousands of stat calls *per dataset* -- on a tree of a few
    thousand measurements that dominated the whole scan. Writing to a store
    rewrites its metadata, so the metadata mtime tracks appends without the
    walk.

    Args:
        path (Path): Path to the zarr dataset
        store_mtime (float | None): Already-known mtime of the store directory,
            to avoid re-stat-ing it.

    Returns:
        float: Unix timestamp of last modification

    """
    try:
        latest_mtime = path.stat().st_mtime if store_mtime is None else store_mtime

        # v3 writes zarr.json; v2 consolidated metadata writes .zmetadata.
        for meta_name in ("zarr.json", ".zmetadata"):
            try:
                latest_mtime = max(latest_mtime, (path / meta_name).stat().st_mtime)
            except OSError:
                continue

        return latest_mtime

    except (OSError, PermissionError):
        return 0.0


def _get_folder_size(path: Path) -> int:
    """Estimate folder size from its first ten entries."""
    try:
        total_size = 0

        # Only scan first level to avoid performance issues
        items = list(path.iterdir())[:10]  # Limit to first 10 items
        for item in items:
            if item.is_file():
                total_size += item.stat().st_size
        return total_size

    except (OSError, IOError):
        return 0


def _close_dataset(dataset) -> None:
    """Close a dataset when supported; DataTree views cannot close independently."""
    try:
        dataset.close()
    except Exception as exc:  # noqa: BLE001 - releasing must never fail a request
        logger.debug(f"_close_dataset | could not close dataset: {exc}")


def _iso_from_mtime(mtime: float) -> str:
    """Format an already-read mtime as an ISO string, avoiding a second stat."""
    import datetime

    return datetime.datetime.fromtimestamp(mtime).isoformat()


def _get_file_timestamp(path: Path) -> str:
    """Return a path's modification time as an ISO string."""
    try:
        import datetime

        timestamp = path.stat().st_mtime
        return datetime.datetime.fromtimestamp(timestamp).isoformat()

    except (OSError, IOError):
        logger.error(f"_get_file_timestamp | Failed to stat path for timestamp: {path}")
        raise OSError(f"Failed to stat path {path}")


def _store_fingerprint(st: os.stat_result) -> str:
    """Stat signature of a zarr store directory, matching library.py's form."""
    return f"{st.st_mtime_ns}:{st.st_size}"


def _read_scan_cache(paths: list[str]) -> Dict[str, tuple]:
    """Return cached scan metadata; treat database errors as cache misses."""
    if not paths:
        return {}

    try:
        from sqlmodel import select

        from .db_models import DatasetScanCache
        from .shared.db import session_scope

        found: Dict[str, tuple] = {}
        with session_scope() as session:
            # SQLite caps variables per statement; chunk well under the limit.
            for start in range(0, len(paths), 500):
                chunk = paths[start : start + 500]
                rows = session.exec(
                    select(DatasetScanCache).where(DatasetScanCache.abs_path.in_(chunk))
                ).all()
                for row in rows:
                    found[row.abs_path] = (
                        row.fingerprint,
                        row.size_bytes,
                        row.last_modified,
                    )
        return found
    except Exception as exc:
        logger.debug(f"_read_scan_cache | cache unavailable, computing instead: {exc}")
        return {}


def _write_scan_cache(entries: list[tuple]) -> None:
    """Upsert (abs_path, fingerprint, size, last_modified) rows; best-effort."""
    if not entries:
        return

    try:
        from .db_models import DatasetScanCache
        from .shared.db import session_scope

        with session_scope() as session:
            for abs_path, fingerprint, size_bytes, last_modified in entries:
                row = session.get(DatasetScanCache, abs_path)
                if row is None:
                    session.add(
                        DatasetScanCache(
                            abs_path=abs_path,
                            fingerprint=fingerprint,
                            size_bytes=size_bytes,
                            last_modified=last_modified,
                        )
                    )
                else:
                    row.fingerprint = fingerprint
                    row.size_bytes = size_bytes
                    row.last_modified = last_modified
    except Exception as exc:
        logger.debug(f"_write_scan_cache | could not persist scan cache: {exc}")


# Simple TTL cache for zarr sizes
_SIZE_CACHE: Dict[str, Dict] = {}
register_gauge("size cache", lambda: len(_SIZE_CACHE))
# cache entry: { 'value': int, 'expires_at': float }


async def _run_subprocess(cmd, input_data: bytes = None):
    """Run a subprocess and return its code, stdout, and stderr."""
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE if input_data is not None else None,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout, stderr = await proc.communicate(input=input_data)
        return (
            proc.returncode,
            stdout.decode("utf-8", errors="replace"),
            stderr.decode("utf-8", errors="replace"),
        )
    except FileNotFoundError as e:
        return 127, "", str(e)
    except Exception as e:
        return 1, "", str(e)


async def get_directory_tree_zarr(path: str, max_depth: int = None) -> Dict:
    """Build a dataset directory tree without blocking the event loop."""
    return await asyncio.to_thread(_build_directory_tree_zarr, path, max_depth)


def _build_directory_tree_zarr(path: str, max_depth: int = None) -> Dict:
    """Build a dataset tree with ``fd``, including supported files and zarr stores."""
    path = Path(path)

    if not path.exists():
        logger.error(f"get_directory_tree_zarr | Path does not exist: {path}")
        raise FileNotFoundError("Path does not exist")

    if not path.is_dir():
        logger.error(f"get_directory_tree_zarr | Path is not a directory: {path}")
        raise NotADirectoryError("Path is not a folder")

    missing_tools = []
    if not FD_EXEC:
        missing_tools.append("fd")
    # Windows compat - skip du/xargs checks
    # if not DU_EXEC:
    #     missing_tools.append("du")
    # if not XARGS_EXEC:
    #     missing_tools.append("xargs")

    if missing_tools:
        logger.error(
            f"get_directory_tree_zarr | Missing required system utilities: {', '.join(missing_tools)}"
        )
        raise RuntimeError(
            f"Missing required system utilities: {', '.join(missing_tools)}"
        )

    root_id = f"folder-{hash(str(path)) % 100000}"
    root_node = {
        "id": root_id,
        "name": path.name or path.parts[-1] or "root",
        "path": str(path),
        "type": "folder",
        "timestamp": _get_file_timestamp(path),
        "children": [],
    }

    if max_depth is None:
        max_depth = MAX_DEPTH

    # Use fd to list zarr directories up to specified depth.
    cmd_zarr_dirs = [
        FD_EXEC,
        "--hidden",
        # "--no-ignore-vcs",  # Commented out to respect .gitignore
        "--absolute-path",
        "--color=never",
        "--max-depth",
        str(max_depth),
        "-t",
        "d",
        "-e",
        "zarr",
        ".",
        str(path),
    ]

    cmd_dataset_files = [
        FD_EXEC,
        "--hidden",
        "--absolute-path",
        "--color=never",
        "--max-depth",
        str(max_depth),
        "-t",
        "f",
        "-e",
        "nc",
        "-e",
        "h5",
        "-e",
        "hdf5",
        "-e",
        "db",
        "-e",
        "sqlite",
        "-e",
        "csv",
        "-e",
        "txt",
        "-e",
        "dat",
        "-e",
        "mat",
        ".",
        str(path),
    ]

    # Run the two independent, blocking fd scans in parallel.
    with ThreadPoolExecutor(max_workers=2) as pool:
        future_dirs = pool.submit(_run_fd_capture, cmd_zarr_dirs)
        future_files = pool.submit(_run_fd_capture, cmd_dataset_files)
        result_dirs = future_dirs.result()
        result_files = future_files.result()

    if result_dirs.returncode != 0:
        err = result_dirs.stderr.decode("utf-8", errors="replace")
        out = result_dirs.stdout.decode("utf-8", errors="replace")
        logger.error(
            f"get_directory_tree_zarr | fd zarr error: {err.strip() or out.strip()}"
        )
        raise RuntimeError(f"fd zarr error: {err.strip() or out.strip()}")
    if result_files.returncode != 0:
        err = result_files.stderr.decode("utf-8", errors="replace")
        out = result_files.stdout.decode("utf-8", errors="replace")
        logger.error(
            f"get_directory_tree_zarr | fd file error: {err.strip() or out.strip()}"
        )
        raise RuntimeError(f"fd file error: {err.strip() or out.strip()}")

    zarr_paths = [
        line.strip()
        for line in result_dirs.stdout.decode("utf-8", errors="replace").splitlines()
        if line.strip()
    ]
    dataset_file_paths = [
        line.strip()
        for line in result_files.stdout.decode("utf-8", errors="replace").splitlines()
        if line.strip()
    ]
    paths = zarr_paths + dataset_file_paths

    # If paths is empty, raise an error
    if not paths:
        logger.error(
            f"get_directory_tree_zarr | No supported datasets (.zarr/.nc/.h5/.hdf5/.db/.sqlite/.csv/.txt/.dat/.mat) found at this level. MAX_DEPTH={MAX_DEPTH} may be too low."
        )
        raise RuntimeError(
            f"No supported datasets (.zarr/.nc/.h5/.hdf5/.db/.sqlite/.csv/.txt/.dat/.mat) found at this level. MAX_DEPTH={MAX_DEPTH} may be too low."
        )

    # Build nodes map - start with root node only
    nodes: Dict[str, Dict] = {}
    nodes[str(path)] = root_node

    # Sort paths so parents come before children
    paths_sorted = sorted(paths, key=lambda s: (s.count("/"), s))

    # Collect all unique parent paths first to minimize filesystem calls
    all_parent_paths = set()
    dataset_items = []

    for p in paths_sorted:
        try:
            item = Path(p)
            item.relative_to(path)  # Ensure path is under root

            # Reuse one stat result for type, size, mtime, and timestamp.
            st = item.stat()
            is_directory = stat_module.S_ISDIR(st.st_mode)

            if is_directory and item.name.endswith(".zarr"):
                dataset_items.append((item, st))
            elif not is_directory and item.suffix.lower() in {
                ".nc",
                ".h5",
                ".hdf5",
                ".db",
                ".sqlite",
                ".csv",
                ".txt",
                ".dat",
                ".mat",
            }:
                dataset_items.append((item, st))
            else:
                continue

            # Collect all parent paths
            current = item.parent
            while current != path:
                all_parent_paths.add(current)
                current = current.parent
        except Exception:
            continue

    # Create all parent nodes first (batched filesystem operations)
    for parent_path in sorted(all_parent_paths, key=lambda x: len(x.parts)):
        try:
            parent_str = str(parent_path)
            if parent_str not in nodes:
                nodes[parent_str] = {
                    "id": f"folder-{hash(parent_str) % 100000}",
                    "name": parent_path.name,
                    "path": parent_str,
                    "type": "folder",
                    "timestamp": _get_file_timestamp(parent_path),
                    "children": [],
                }
        except Exception:
            continue

    # Zarr stores are the only entries whose size and mtime cost more than the
    # stat we already have, so they are the only ones worth caching.
    zarr_paths = [
        str(item) for item, st in dataset_items if stat_module.S_ISDIR(st.st_mode)
    ]
    scan_cache = _read_scan_cache(zarr_paths)
    cache_writes: list[tuple] = []

    # Create dataset nodes
    for item, st in dataset_items:
        try:
            if stat_module.S_ISDIR(st.st_mode):
                fmt = "zarr"
                # Size still ships because the Basket displays it.
                item_str = str(item)
                fingerprint = _store_fingerprint(st)
                cached = scan_cache.get(item_str)
                if cached is not None and cached[0] == fingerprint:
                    size, last_modified = cached[1], cached[2]
                else:
                    size = _get_folder_size(item)
                    last_modified = _get_dataset_last_modified(item, st.st_mtime)
                    cache_writes.append((item_str, fingerprint, size, last_modified))
            else:
                suffix = item.suffix.lower()
                if suffix == ".nc":
                    fmt = "netcdf"
                elif suffix in {".h5", ".hdf5"}:
                    fmt = "hdf5"
                elif suffix in {".db", ".sqlite"}:
                    fmt = "sqlite"
                elif suffix in {".csv", ".txt", ".dat"}:
                    fmt = "csv"  # CONCERN: Or, we could use "flat" ?
                elif suffix == ".mat":
                    fmt = "matlab"
                else:
                    continue
                size = st.st_size
                last_modified = st.st_mtime

            dataset_node = {
                "id": f"file-{hash(str(item)) % 100000}",
                "name": item.name,
                "path": str(item),
                "type": "file",
                "size": size,
                "timestamp": _iso_from_mtime(st.st_mtime),
                "tags": [fmt],
                "lastModified": last_modified,
            }
            nodes[str(item)] = dataset_node
        except Exception:
            continue

    _write_scan_cache(cache_writes)

    # Use per-parent sets to build relationships in O(N).
    seen_child_paths: Dict[str, set] = {}

    for p_str, node in list(nodes.items()):
        if p_str == str(path):  # Skip root
            continue

        try:
            p_path = Path(p_str)
            parent = p_path.parent
            parent_str = str(parent)

            # Parent should exist at this point, but guard against edge cases
            if parent_str in nodes:
                parent_node = nodes[parent_str]
                if parent_node.get("children") is None:
                    parent_node["children"] = []

                seen = seen_child_paths.setdefault(
                    parent_str, {ch.get("path") for ch in parent_node["children"]}
                )
                node_path = node.get("path")
                if node_path not in seen:
                    seen.add(node_path)
                    parent_node["children"].append(node)

        except Exception:
            # logger.debug(f"Error attaching node: {p_str}")
            continue

    # Sort children lists for consistent ordering
    def sort_children(node):
        if node.get("children"):
            node["children"].sort(key=lambda c: c.get("name", ""))
            for c in node["children"]:
                sort_children(c)

    sort_children(nodes[str(path)])

    return nodes[str(path)]


def _memory_dataset_node(
    measurement_id: str, entry: Dict[str, object]
) -> Optional[Dict[str, object]]:
    """Return a TreeNode entry for a live dataset from SQLite DB info."""

    disk_path = entry.get("disk_path")
    ws_url = entry.get("ws_url")
    started_at = entry.get("started_at")
    ended_at = entry.get("ended_at")

    logger.debug(
        f"[_memory_dataset_node] measurement_id={measurement_id}, "
        f"disk_path={disk_path}, ws_url={ws_url}, ended_at={ended_at}"
    )

    timestamp_iso: Optional[str] = None
    last_modified: Optional[float] = None

    # Try to read metadata from disk path
    if disk_path:
        try:
            dataset = load_dataset_sync(str(disk_path))
            raw_ts = dataset.attrs.get("Timestamp")
            if isinstance(raw_ts, str):
                try:
                    dt = datetime.fromisoformat(raw_ts)
                except ValueError:
                    dt = datetime.utcnow()
                timestamp_iso = dt.isoformat()
                last_modified = dt.timestamp()
            elif raw_ts is not None:
                timestamp_iso = str(raw_ts)
            dataset.close()
        except Exception as exc:
            logger.debug(
                f"Could not read metadata for live dataset {measurement_id} "
                f"from disk: {exc}"
            )

    # Fallback to started_at from database
    if timestamp_iso is None and started_at:
        try:
            dt = datetime.fromisoformat(started_at)
            timestamp_iso = dt.isoformat()
            last_modified = dt.timestamp()
        except ValueError:
            pass

    # Final fallback to current time
    if timestamp_iso is None:
        now = datetime.utcnow()
        timestamp_iso = now.isoformat()
        last_modified = now.timestamp()

    # Always use memory:// path for live datasets in the tree
    # The load_dataset() function will handle WebSocket vs disk fallback
    path_value = f"{MEMORY_PROTOCOL}{measurement_id}"

    logger.debug(
        f"[_memory_dataset_node] Using memory:// path: {path_value} "
        f"(disk_path: {disk_path})"
    )

    suffix = Path(str(disk_path)).suffix.lower() if disk_path else ""
    display_name = f"{measurement_id}.zarr" if suffix == ".zarr" else measurement_id
    tags = ["live" if ended_at is None else "ended"]
    if suffix == ".zarr":
        tags.insert(0, "zarr")
    node = {
        "id": f"file-memory-{measurement_id}",
        "name": display_name,
        "path": path_value,
        "type": "file",
        "timestamp": timestamp_iso,
        "lastModified": last_modified,
        "tags": tags,
    }

    if disk_path:
        node["diskPath"] = disk_path
        try:
            node["size"] = _get_folder_size(Path(disk_path))
        except Exception:
            pass

    metadata: Dict[str, object] = {}
    if ws_url:
        metadata["ws_url"] = ws_url
    if started_at:
        metadata["started_at"] = started_at
    if ended_at:
        metadata["ended_at"] = ended_at
    if metadata:
        node["metadata"] = metadata

    return node


def _build_memory_tree(path_str: str) -> Dict[str, object]:
    """Build a TreeNode-style response for live datasets."""

    logger.debug(f"[_build_memory_tree] Called with path_str={path_str}")

    entries = get_live_dataset_entries()
    logger.debug(
        f"[_build_memory_tree] Got {len(entries)} entries from get_live_dataset_entries()"
    )

    if path_str == MEMORY_PROTOCOL:
        children = []
        for measurement_id, entry in entries.items():
            node = _memory_dataset_node(measurement_id, entry)
            if node:
                children.append(node)
        now = datetime.utcnow()
        return {
            "id": "folder-memory-root",
            "name": "Live Measurements",
            "path": MEMORY_PROTOCOL,
            "type": "folder",
            "timestamp": now.isoformat(),
            "children": children,
        }

    measurement_id = _extract_measurement_id(path_str)
    if not measurement_id:
        logger.error(f"_build_memory_tree | Missing measurement id in path: {path_str}")
        raise HTTPException(status_code=400, detail="Missing measurement id in path")

    entry = entries.get(measurement_id)
    if not entry:
        entry = resolve_live_dataset(measurement_id)

    node = _memory_dataset_node(measurement_id, entry)
    if node is None:
        logger.error(
            f"_build_memory_tree | Live dataset {measurement_id} is not available in memory"
        )
        raise HTTPException(
            status_code=404,
            detail=f"Live dataset {measurement_id} is not available in memory",
        )

    return node


def _build_sqlite_tree(db_path: Path) -> Dict[str, object]:
    """Build a virtual tree of QCoDeS runs grouped by date."""
    if not db_path.exists() or not db_path.is_file():
        raise FileNotFoundError(f"SQLite file does not exist: {db_path}")

    def _sqlite_node_id(prefix: str, value: str) -> str:
        digest = hashlib.sha1(value.encode("utf-8")).hexdigest()[:16]
        return f"{prefix}-{digest}"

    runs = list_qcodes_runs(db_path)
    timestamp = _get_file_timestamp(db_path)
    db_last_modified = db_path.stat().st_mtime

    grouped_runs: dict[str, list[dict[str, object]]] = {}
    for run in runs:
        run_id = run["run_id"]
        run_name = run.get("name") or f"run_{run_id}"
        run_ts = run.get("run_timestamp")
        try:
            # Use UTC for deterministic day buckets across server timezones.
            day_key = datetime.fromtimestamp(float(run_ts), timezone.utc).strftime(
                "%Y-%m-%d"
            )
        except Exception:
            day_key = "Unknown Date"

        run_ref = f"{db_path}#run_id={run_id}"
        run_label = f"{run_id} | {run_name}"
        child: Dict[str, object] = {
            "id": _sqlite_node_id("file-sqlite-run", run_ref),
            "name": run_label,
            "path": run_ref,
            "type": "file",
            "size": db_path.stat().st_size,
            "timestamp": timestamp,
            "tags": ["qcodes", "qcodes-run", "sqlite"],
            "lastModified": db_last_modified,
            "metadata": {
                "run_id": run_id,
                "result_table_name": run.get("result_table_name"),
                "run_timestamp": run.get("run_timestamp"),
            },
        }
        grouped_runs.setdefault(day_key, []).append(child)

    children: list[Dict[str, object]] = []
    for day_key in sorted(grouped_runs.keys(), reverse=True):
        day_runs = sorted(
            grouped_runs[day_key],
            key=lambda node: node.get("metadata", {}).get("run_id", 0),
            reverse=True,
        )
        day_folder_path = f"{db_path}#date={day_key}"
        children.append(
            {
                "id": _sqlite_node_id("folder-sqlite-date", day_folder_path),
                "name": day_key,
                "path": day_folder_path,
                "type": "folder",
                "timestamp": timestamp,
                "tags": ["qcodes", "qcodes-date", "sqlite"],
                "children": day_runs,
            }
        )

    return {
        "id": _sqlite_node_id("folder-sqlite", str(db_path)),
        "name": db_path.name,
        "path": str(db_path),
        "type": "folder",
        "timestamp": timestamp,
        "children": children,
        "tags": ["qcodes", "sqlite"],
    }


def _build_datatree_tree(store_path: Path) -> Dict[str, object]:
    """Build a virtual tree whose dataset leaves use ``#dt_path=`` references."""
    if not store_path.exists():
        raise FileNotFoundError(f"DataTree path does not exist: {store_path}")

    fmt_by_suffix = {
        ".zarr": "zarr",
        ".nc": "netcdf",
        ".h5": "hdf5",
        ".hdf5": "hdf5",
    }
    suffix = store_path.suffix.lower()
    if suffix not in fmt_by_suffix:
        raise ValueError(f"Not a DataTree-capable path: {store_path}")
    fmt = fmt_by_suffix[suffix]

    def _dt_node_id(prefix: str, value: str) -> str:
        digest = hashlib.sha1(value.encode("utf-8")).hexdigest()[:16]
        return f"{prefix}-{digest}"

    nodes = list_datatree_nodes(store_path)
    if not nodes:
        raise ValueError(f"No nodes found in DataTree store: {store_path}")
    non_root_nodes = [n for n in nodes if str(n.get("path") or "/") != "/"]
    if not non_root_nodes:
        raise ValueError(f"Path is not a hierarchical DataTree container: {store_path}")

    timestamp = _get_file_timestamp(store_path)
    root: Dict[str, object] = {
        "id": _dt_node_id("folder-datatree", str(store_path)),
        "name": store_path.name,
        "path": str(store_path),
        "type": "folder",
        "timestamp": timestamp,
        "tags": ["datatree", fmt],
        "children": [],
    }

    by_path: dict[str, Dict[str, object]] = {"/": root}
    for node in nodes:
        node_path = str(node.get("path") or "/")
        if node_path == "/":
            continue
        node_name = str(node.get("name") or Path(node_path).name or "node")
        has_dataset = bool(node.get("has_dataset"))
        created: Dict[str, object] = {
            "id": _dt_node_id(
                "file-datatree-node", f"{store_path}#dt_path={node_path}"
            ),
            "name": node_name,
            # Keep non-leaf path on container path to avoid invalid direct navigation.
            "path": f"{store_path}#dt_path={node_path}"
            if has_dataset
            else str(store_path),
            "type": "file" if has_dataset else "folder",
            "timestamp": timestamp,
            "tags": ["datatree-node", fmt],
        }
        if has_dataset:
            created["metadata"] = {"dt_path": node_path}
        else:
            created["children"] = []
        by_path[node_path] = created

    for node_path in sorted(by_path.keys(), key=lambda p: (p.count("/"), p)):
        if node_path == "/":
            continue
        parent_path = str(Path(node_path).parent).replace("\\", "/")
        if parent_path == ".":
            parent_path = "/"
        parent = by_path.get(parent_path, root)
        if parent.get("children") is None:
            parent["children"] = []
        parent["children"].append(by_path[node_path])

    def _sort_children(node: Dict[str, object]) -> None:
        children = node.get("children")
        if not isinstance(children, list):
            return
        children.sort(key=lambda c: str(c.get("name", "")))
        for child in children:
            if isinstance(child, dict):
                _sort_children(child)

    _sort_children(root)
    return root


@router.post("/load-live/")
async def load_live_measurements() -> Dict:
    """
    Load live measurements from the database as a tree structure.

    Returns:
        Dict: Tree structure containing only live measurements
    """
    measurements = live_measurements.get_live_measurements()

    if not measurements:
        return {
            "success": True,
            "children": [],
            "message": "No live measurements found",
        }

    # Build tree nodes for each live measurement
    children = []
    for measurement in measurements:
        # Create a memory:// path for the measurement
        memory_path = f"memory://{measurement.measurement_id}"

        # Create tree node
        node = {
            "id": measurement.measurement_id,
            "name": f"{measurement.measurement_id}",
            "path": memory_path,
            "type": "file",
            # NOTE: Omit size for live measurements - frontend handles missing sizes
            "timestamp": measurement.started_at,
            "tags": ["live", "zarr"],
            "live_status": True,
            "ws_url": measurement.ws_url,
            "ws_port": measurement.ws_port,
            "disk_path": measurement.fpath,
        }
        children.append(node)

    return {
        "success": True,
        "children": children,
        "count": len(children),
    }


@router.post("/load/")
async def load_directory(path: PathData) -> Dict:
    """Load a filesystem, live-memory, SQLite, or DataTree path as a tree."""
    raw_path = path.path
    logger.debug(f"load_directory | POST path={raw_path}")

    memory_path = normalize_memory_reference(raw_path)
    logger.debug(f"load_directory | memory_path={memory_path} (raw_path={raw_path})")

    if memory_path is not None:
        try:
            return _build_memory_tree(memory_path)
        except HTTPException:
            logger.error("load_directory | HTTPException raised in _build_memory_tree")
            raise
        except Exception as exc:
            logger.error("load_directory | Failed to build memory tree: %s", exc)
            raise HTTPException(
                status_code=500, detail=f"Error loading memory directory: {exc}"
            )

    fs_path = Path(raw_path)
    logger.debug(f"load_directory | Resolved path={fs_path.resolve()}")

    if not fs_path.exists():
        logger.error(f"load_directory | Path does not exist: {fs_path}")
        raise HTTPException(status_code=404, detail="Path does not exist")

    if fs_path.is_file() and fs_path.suffix.lower() in {".db", ".sqlite"}:
        try:
            return _build_sqlite_tree(fs_path)
        except Exception as exc:
            logger.error("load_directory | Failed to build sqlite tree: %s", exc)
            # Give disconnected shares and unreadable files an actionable error.
            if "unable to open database file" in str(exc):
                raise HTTPException(
                    status_code=502,
                    detail=(
                        f"Could not open '{fs_path.name}'. If it is on a network "
                        "drive, check that the drive is still connected and that "
                        "you can read the file."
                    ),
                )
            raise HTTPException(
                status_code=500, detail=f"Error loading sqlite file: {exc}"
            )

    if fs_path.suffix.lower() in {".zarr", ".nc", ".h5", ".hdf5"}:
        try:
            return _build_datatree_tree(fs_path)
        except Exception:
            # Not a DataTree-backed structure, fall through to existing behavior.
            pass

    if not fs_path.is_dir():
        logger.error(f"load_directory | Path is not a directory: {fs_path}")
        raise HTTPException(status_code=404, detail="Path is not a directory")

    try:
        tree = await get_directory_tree_zarr(path=str(fs_path))
        return tree
    except Exception as e:
        logger.error(
            f"load_directory | Error loading directory: {str(e)}", exc_info=True
        )
        raise HTTPException(
            status_code=500, detail=f"Error loading directory: {str(e)}"
        )


async def _load_dataset_for_metadata(path_ref: str) -> xr.Dataset:
    """Resolve a dataset reference for metadata endpoints."""
    normalized_ref = (path_ref or "").strip()
    if normalized_ref in {"", "/", "\\"}:
        raise HTTPException(
            status_code=400,
            detail="Please select a dataset file/run, not a folder/root node",
        )

    try:
        return await load_dataset_async(normalized_ref)
    except Exception as exc:
        msg = str(exc)
        lowered = msg.lower()
        if "does not exist" in lowered or "not found" in lowered:
            raise HTTPException(status_code=404, detail=msg) from exc
        raise HTTPException(status_code=400, detail=msg) from exc


# Attrs the loader injects to record how Qimchi read the file.
INTERNAL_META_KEYS: frozenset = frozenset(
    {
        "path",
        "actual_path",
        "loaded_from",
        "grid_2d",
        "qimchi_all_columns",
        "qimchi_tabular",
        "qimchi_tabular_row_dim",
        "qimchi_quantify_gridded",
        "qimchi_connect",
        "qimchi_connect_rows",
        "qimchi_connect_source",
    }
)

# Preferred qanary metadata sections.
PREFERRED_META_KEYS: list = [
    "Sweeps",
    "Parameters Snapshot",
    "Extra Metadata",
    "Instruments Snapshot",
]

# Expose stable QCoDeS metadata as one structured section.
QCODES_META_SECTION: str = "QCoDeS Metadata"
QCODES_META_KEYS: tuple[str, ...] = (
    "ds_name",
    "exp_name",
    "guid",
    "run_timestamp",
    "sample_name",
    "snapshot",
)


def _expand_json_string(text: str) -> object | None:
    """Parse a JSON object or array stored as a string."""
    stripped = text.lstrip()
    if not stripped.startswith(("{", "[")):
        return None
    try:
        parsed = json.loads(text)
    except (ValueError, TypeError):
        return None
    # Only containers: anything else would just be re-counted as a scalar.
    return parsed if isinstance(parsed, (dict, list)) else None


# The attrs surfaced by /load-attrs/ (the Explorer's metadata strip).
ATTR_KEYS: list = [
    "Timestamp",
    "Cryostat",
    "Wafer ID",
    "Device Type",
    "Sample Name",
    "Experiment Name",
    "Measurement ID",  # CONCERN: Already present in filename
    # "Instruments Snapshot"
]

# Identity and context attrs written by the other acquisition tools.
NON_QANARY_ATTR_KEYS: list = [
    # QCoDeS
    "run_id",
    "guid",
    "exp_name",
    "sample_name",
    "run_timestamp",
    "completed_timestamp",
    "qimchi_db_uuid",
    # Quantify
    "tuid",
    "name",
]


def build_attrs_payload(data: xr.Dataset) -> Dict:
    """Build the canonical ``/load-attrs/`` response for a dataset."""
    metadata: dict = data.attrs
    if not isinstance(metadata, dict):
        metadata = dict(metadata)

    indeps: list = list(data.coords.keys())  # Coordinates -> independents
    deps: list = list(data.data_vars.keys())  # Data variables -> dependents

    # Flat tables have no coord/var split: every column is both.
    tabular_columns = metadata.get("qimchi_all_columns")
    if isinstance(tabular_columns, list) and tabular_columns:
        indeps = [str(col) for col in tabular_columns]
        deps = [str(col) for col in tabular_columns]

    attr_json: dict = {}
    for key in ATTR_KEYS:
        value = metadata.get(key, "N/A")
        attr_json[key] = (
            value
            if isinstance(value, (str, int, float, bool, list, dict))
            else str(value)
        )

    # Scalars only: this payload is rendered as a flat key/value strip, so a
    # nested snapshot would either break the render or bury it.
    for key in NON_QANARY_ATTR_KEYS:
        if key in attr_json:
            continue
        value = metadata.get(key)
        if isinstance(value, (str, int, float, bool)):
            attr_json[key] = value

    # Which independents each dependent actually varies over, in coordinate order.
    var_indeps: dict = {}
    if not (isinstance(tabular_columns, list) and tabular_columns):
        coord_dims = {
            str(name): tuple(str(dim) for dim in coord.dims)
            for name, coord in data.coords.items()
        }
        for name, var in data.data_vars.items():
            dims = {str(dim) for dim in var.dims}
            var_indeps[str(name)] = [
                coord_name
                for coord_name, coord_dim_names in coord_dims.items()
                if coord_dim_names and dims.issuperset(coord_dim_names)
            ]

    attr_json["independents"] = indeps
    attr_json["dependents"] = deps
    attr_json["variable_independents"] = var_indeps
    return attr_json


@router.post("/load-attrs/")
async def get_meta_attrs(path: PathData) -> Dict:
    """Return a dataset's summary metadata and variables."""
    raw_path = path.path
    logger.debug(f"get_meta_attrs | POST path={raw_path}")

    # Serve cached attrs while the dataset's stat fingerprint matches.
    from .library import get_cached_attrs, store_cached_attrs

    cached = await get_cached_attrs(raw_path)
    if cached is not None:
        logger.debug(f"get_meta_attrs | cache hit for {raw_path}")
        return sanitize_for_json(cached)

    data: Optional[xr.Dataset] = None

    try:
        data = await _load_dataset_for_metadata(raw_path)
        attr_json = build_attrs_payload(data)
        # Pass the open dataset so a content-signature UUID can be derived
        # without re-reading the file.
        await store_cached_attrs(raw_path, attr_json, data)
        return sanitize_for_json(attr_json)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"get_meta_attrs | Error loading metadata: {str(e)}", exc_info=True
        )
        raise HTTPException(status_code=500, detail=f"Error loading metadata: {str(e)}")

    finally:
        if data is not None:
            _close_dataset(data)


@router.post("/load-meta/")
async def get_metadata(path: PathData) -> Dict:
    """Return a dataset's collapsible metadata sections."""
    raw_path = path.path

    logger.debug(f"get_metadata | POST path={raw_path}")

    data: Optional[xr.Dataset] = None

    try:
        data = await _load_dataset_for_metadata(raw_path)
        metadata: dict = data.attrs  # Metadata

        # Convert metadata to a dictionary if it's not already
        if not isinstance(metadata, dict):
            metadata = dict(metadata)

        is_qcodes = bool(metadata.get("guid")) and any(
            key in metadata for key in ("run_id", "ds_name", "qcodes_db_path")
        )
        if is_qcodes:
            qcodes_meta: dict = {}
            for key in QCODES_META_KEYS:
                if key not in metadata:
                    continue
                value = metadata[key]
                if key == "snapshot" and isinstance(value, str):
                    parsed_snapshot = _expand_json_string(value)
                    if parsed_snapshot is not None:
                        value = parsed_snapshot
                qcodes_meta[key] = value
            meta_dict: dict = {QCODES_META_SECTION: qcodes_meta}
        else:
            qanary_sections: list = [
                key for key in PREFERRED_META_KEYS if key in metadata
            ]
            if qanary_sections:
                # qanary reserves this pane for its four metadata sections.
                meta_dict = {key: metadata[key] for key in qanary_sections}
            else:
                # Other formats expose their remaining attrs directly.
                meta_dict = {
                    key: metadata[key]
                    for key in sorted(metadata)
                    if key not in INTERNAL_META_KEYS
                }

        # Ensure metadata is JSON serializable
        meta_json = {}
        for k, v in meta_dict.items():
            if isinstance(v, (str, int, float, bool, list, dict)):
                meta_json[k] = v
            else:
                meta_json[k] = str(v)

        return sanitize_for_json(meta_json)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_metadata | Error loading metadata: {str(e)}", exc_info=True)

        raise HTTPException(status_code=500, detail=f"Error loading metadata: {str(e)}")
    finally:
        if data is not None:
            _close_dataset(data)


def _parameter_display(value: object, unit: object) -> str:
    """Format a parameter to four significant digits with an SI prefix."""
    unit_text = str(unit or "").strip()
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        number = float(value)
        if math.isfinite(number):
            return format_quantity(float(f"{number:.4g}"), unit_text)
    text = "" if value is None else str(value)
    return f"{text} {unit_text}".strip()


@router.post("/load-meta/parameters/")
async def get_pinned_parameters(request: PinnedParametersRequest) -> Dict:
    """Return requested Parameters Snapshot entries in request order."""
    data: Optional[xr.Dataset] = None
    try:
        data = await _load_dataset_for_metadata(request.path)
        snapshot = data.attrs.get("Parameters Snapshot")
        if isinstance(snapshot, str):
            snapshot = _expand_json_string(snapshot)
        if not isinstance(snapshot, dict):
            snapshot = {}

        parameters = []
        for name in request.names:
            entry = snapshot.get(name)
            if not isinstance(entry, dict):
                parameters.append({"name": name, "missing": True})
                continue
            parameters.append(
                {
                    "name": name,
                    "label": str(entry.get("label") or name),
                    "display": _parameter_display(
                        entry.get("value"), entry.get("unit")
                    ),
                }
            )
        return sanitize_for_json({"parameters": parameters})
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("get_pinned_parameters | Error loading parameters")
        raise HTTPException(status_code=500, detail=f"Error loading parameters: {e}")
    finally:
        if data is not None:
            _close_dataset(data)


@router.post("/dataset-status/")
async def get_dataset_status(data: PathData) -> Dict:
    """Return a dataset's live status and modification metadata."""
    try:
        disk_path = (
            resolve_to_disk_path(data.path)
            if data.path.startswith(MEMORY_PROTOCOL)
            else data.path
        )
        path = Path(disk_path)

        if not path.exists():
            logger.error(f"get_dataset_status | Dataset path does not exist: {path}")
            raise HTTPException(status_code=404, detail="Dataset not found")

        if path.is_dir():
            last_modified = _get_dataset_last_modified(path)
            size = _get_folder_size(path)
        elif path.is_file():
            last_modified = path.stat().st_mtime
            size = path.stat().st_size
        else:
            raise HTTPException(status_code=400, detail="Path is not a dataset path")

        return {
            "success": True,
            "path": str(path),
            "last_modified": last_modified,
            "last_modified_iso": datetime.fromtimestamp(last_modified).isoformat(),
            "size": size,
            "timestamp": _get_file_timestamp(path),
        }

    except HTTPException:
        logger.error(f"get_dataset_status | HTTPException raised for path: {data.path}")
        raise

    except Exception as e:
        logger.error(
            f"get_dataset_status | Error getting dataset status for {data.path}: {str(e)}"
        )
        raise HTTPException(
            status_code=500, detail=f"Error getting dataset status: {str(e)}"
        )
