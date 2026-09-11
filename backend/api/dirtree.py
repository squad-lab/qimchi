"""
FastAPI endpoint for many Explorer/DirTree related operations.

"""

import asyncio
import hashlib
import os
import stat as stat_module
import subprocess  # Windows compat
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional

import xarray as xr
from fastapi import APIRouter, HTTPException


# Local tool execs
from .config import FD_EXEC, MAX_DEPTH  #  DU_EXEC, XARGS_EXEC | Windows compat
from . import live_measurements
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
from .json_utils import sanitize_for_json
from .logger import logger

# Local imports
from .models import PathData

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
    """
    Helper function to get approximate folder size in bytes.

    Args:
        path (Path): Path to the directory.

    Returns:
        int: Total size of files in the directory, limited to first 10 items.

    """
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


def _iso_from_mtime(mtime: float) -> str:
    """Format an already-read mtime as an ISO string, avoiding a second stat."""
    import datetime

    return datetime.datetime.fromtimestamp(mtime).isoformat()


def _get_file_timestamp(path: Path) -> str:
    """
    Helper function to get file modification timestamp as ISO string.

    Args:
        path (Path): Path to the file or directory.

    Returns:
        str: ISO formatted timestamp of the last modification.

    Raises:
        OSError: If the path cannot be accessed.

    """
    try:
        import datetime

        timestamp = path.stat().st_mtime
        return datetime.datetime.fromtimestamp(timestamp).isoformat()

    except (OSError, IOError):
        logger.error(f"_get_file_timestamp | Failed to stat path for timestamp: {path}")
        raise OSError(f"Failed to stat path {path}")


# Simple TTL cache for zarr sizes
_SIZE_CACHE: Dict[str, Dict] = {}
# cache entry: { 'value': int, 'expires_at': float }


async def _run_subprocess(cmd, input_data: bytes = None):
    """
    Run subprocess asynchronously and return (returncode, stdout, stderr).

    """
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
    """
    Build a dataset directory tree using the `fd` utility for fast traversal.

    Supported dataset items:
    - `.zarr` directories
    - `.nc`, `.h5`, `.hdf5` files
    - `.csv`, `.txt`, `.dat` files
    - `.db` - QCoDeS SQLite databases with special handling to list runs as children
    - `.sqlite` - Container SQLite databases with multiple measurements

    If `fd` is not available (FD_EXEC is None), the function
    returns an error dict so the caller can decide on fallback behavior.

    Args:
        path: str or Path-like root directory to scan.
        max_depth: maximum recursion depth to request from fd.

    Returns:
        Dict: TreeNode-style dict describing the directory tree, or an
        error dict when `fd` is unavailable or fails.

    Raises:
        FileNotFoundError: If the provided path does not exist.
        NotADirectoryError: If the provided path is not a directory.
        RuntimeError: If required system utilities are missing or if `fd` encounters an error.

    """
    path = Path(path)

    if not path.exists():
        logger.error(f"get_directory_tree_zarr | Path does not exist: {path}")
        raise FileNotFoundError("Path does not exist")

    if not path.is_dir():
        logger.error(f"get_directory_tree_zarr | Path is not a directory: {path}")
        raise NotADirectoryError("Path is not a folder")

    # Check fd availability from config
    # Require command-line utilities
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

    # Prepare root node
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

    # Windows compat - use subprocess.run instead of asyncio subprocess
    # rc, out, err = await _run_subprocess(cmd)
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
        ".",
        str(path),
    ]

    result_dirs = _run_fd_capture(cmd_zarr_dirs)
    result_files = _run_fd_capture(cmd_dataset_files)

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
            f"get_directory_tree_zarr | No supported datasets (.zarr/.nc/.h5/.hdf5/.db/.sqlite/.csv/.txt/.dat) found at this level. MAX_DEPTH={MAX_DEPTH} may be too low."
        )
        raise RuntimeError(
            f"No supported datasets (.zarr/.nc/.h5/.hdf5/.db/.sqlite/.csv/.txt/.dat) found at this level. MAX_DEPTH={MAX_DEPTH} may be too low."
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

            # One stat per entry: is_dir()/is_file() plus the later size,
            # mtime and timestamp lookups each stat-ed the same path again, so
            # a scan cost 3-4 syscalls per dataset instead of one.
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

    # Create dataset nodes
    for item, st in dataset_items:
        try:
            if stat_module.S_ISDIR(st.st_mode):
                fmt = "zarr"
                # Size still ships because the Basket displays it.
                size = _get_folder_size(item)
                last_modified = _get_dataset_last_modified(item, st.st_mtime)
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

    # Build parent-child relationships. The duplicate check is a per-parent set
    # rather than a scan of the children list, which made attaching a folder of
    # N siblings O(N^2) -- ~12M comparisons for a folder of 5k measurements.
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

    # Serialising every node here cost a full string build -- and a multi-MB
    # write, since the file handler runs at DEBUG -- on every single scan.
    # logger.debug(f"Directory tree built with these nodes:\n{nodes}")
    # print(f"Directory tree built with these nodes:\n{nodes}")  # DEBUG:

    # TODOLATER: Re-enable size computation using du/xargs if windows compat is ever resolved.
    # --- Compute sizes for .zarr nodes using fast external tool (du) if available ---
    # Collect zarr paths
    # Compute sizes for zarr paths using du + xargs in parallel. We expect
    # GNU du with -b to be available on the user's linux host. Use xargs to
    # parallelize work. Any missing utility is an error which we already
    # checked above.
    # zarr_paths = [p for p, n in nodes.items() if n.get("tags") == ["zarr"]]

    # sizes_from_du = {}

    # if zarr_paths:
    #     # Check cache first
    #     now = time.time()
    #     to_query = []
    #     for p in zarr_paths:
    #         ent = _SIZE_CACHE.get(p)
    #         if ent and ent.get("expires_at", 0) > now:
    #             sizes_from_du[p] = ent["value"]
    #         else:
    #             to_query.append(p)

    #     if to_query:
    #         # Build null-separated input and run: xargs -0 -n50 -P4 du -sb
    #         input_data = "\0".join(to_query).encode("utf-8") + b"\0"
    #         cmd = [XARGS_EXEC, "-0", "-n", "50", "-P", "4", DU_EXEC, "-sb"]
    #         rc, out, err = await _run_subprocess(cmd, input_data=input_data)
    #         if rc != 0:
    #             raise RuntimeError(
    #                 f"Error running du/xargs: {err.strip() or out.strip()}"
    #             )

    #         for line in out.splitlines():
    #             parts = line.strip().split(None, 1)
    #             if len(parts) == 2:
    #                 size_str, pth = parts
    #                 try:
    #                     size = int(size_str)
    #                     sizes_from_du[str(Path(pth))] = size
    #                     # store in cache for 30s
    #                     _SIZE_CACHE[str(Path(pth))] = {
    #                         "value": size,
    #                         "expires_at": now + 30,
    #                     }
    #                 except ValueError:
    #                     continue

    # # Attach computed sizes to nodes
    # for pth, size in sizes_from_du.items():
    #     if pth in nodes and nodes[pth].get("tags") == ["zarr"]:
    #         nodes[pth]["size"] = size

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
    """
    Build a virtual tree for a QCoDeS sqlite file. Children are run references.

    Each run reference has a path like "path/to/db.sqlite#run_id=123" which can be used
    to load that run's dataset. This allows users to explore runs within a sqlite file
    without needing to know the internal structure of the database. The frontend can use
    the run_id and db_path to load the dataset when the user clicks on a run node.

    Args:
        db_path (Path): Path to the sqlite file.

    Returns:
        Dict[str, object]: TreeNode-style dict representing the sqlite file and its runs.

    Raises:
        FileNotFoundError: If the sqlite file does not exist.

    """
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
        run_label = f"run_id={run_id} | {run_name}"
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
    """
    Build a virtual tree for a DataTree-backed store/file.

    Each leaf that has a dataset payload receives a dataset reference path:
    "<store>#dt_path=/node/path"

    Args:
        store_path (Path): Path to the DataTree store (e.g. .zarr directory or .nc file)

    Returns:
        Dict[str, object]: TreeNode-style dict representing the DataTree structure.

    Raises:
        FileNotFoundError: If the store path does not exist.
        ValueError: If the path is not a DataTree-capable format or if no nodes are found.

    """
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
    """
    Load the directory tree structure at the given path.
    Returns up to 3 levels of directories and includes .zarr files.

    Args:
        path (PathData): Path to the directory.

    Returns:
        Dict: Directory tree structure in TreeNode format.

    Raises:
        HTTPException: If the path does not exist, is not a directory, or if there
                    is an error loading the directory or its contents.

    """
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
    """
    Resolve and load a dataset for metadata endpoints.

    Args:
        path_ref (str): The path reference which can be a memory:// URI or a filesystem path.

    Returns:
        xr.Dataset: The loaded dataset ready for metadata extraction.

    Raises:
        HTTPException: If the path reference is invalid, if the dataset cannot be loaded, or if the dataset is not found.

    """
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


def build_attrs_payload(data: xr.Dataset) -> Dict:
    """
    Project a dataset onto the ``/load-attrs/`` response shape.

    Shared with the library's metadata cache so a cached payload is byte-for-byte
    what the endpoint would have produced -- if these ever diverged, a cache hit
    would return a different shape from a cache miss.

    Args:
        data (xr.Dataset): The xarray dataset from which to extract metadata.

    Returns:
        Dict: A dictionary containing the selected metadata attributes, independents, and dependents.

    """
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

    attr_json["independents"] = indeps
    attr_json["dependents"] = deps
    return attr_json


@router.post("/load-attrs/")
async def get_meta_attrs(path: PathData) -> Dict:
    """
    Get metadata attrs for a .zarr dataset.

    Args:
        path (PathData): Path to the .zarr dataset directory.

    Returns:
        Dict: Metadata attrs from the zarr dataset

    """
    raw_path = path.path
    logger.debug(f"get_meta_attrs | POST path={raw_path}")

    # NOTE: Read-through cache: metadata is assumed unchanging, so once a dataset has
    # been opened its attrs are served from the DB instead of re-reading the
    # file. The cached row is only used while its stat fingerprint still
    # matches (see api/library.py::get_cached_attrs).
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
            data.close()


@router.post("/load-meta/")
async def get_metadata(path: PathData) -> Dict:
    """
    Get collapsible metadata key-vals for a .zarr dataset.

    Args:
        path (PathData): Path to the .zarr dataset directory.

    Returns:
        Dict: Collapsible metadata key-vals from the zarr dataset

    """
    raw_path = path.path

    logger.debug(f"get_metadata | POST path={raw_path}")

    data: Optional[xr.Dataset] = None

    try:
        data = await _load_dataset_for_metadata(raw_path)
        metadata: dict = data.attrs  # Metadata

        # Convert metadata to a dictionary if it's not already
        if not isinstance(metadata, dict):
            metadata = dict(metadata)

        meta_keys: list = [
            "Sweeps",
            "Parameters Snapshot",
            "Extra Metadata",
            "Instruments Snapshot",
        ]

        meta_dict: dict = {key: metadata.get(key, "N/A") for key in meta_keys}

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
            data.close()


@router.post("/dataset-status/")
async def get_dataset_status(data: PathData) -> Dict:
    """
    Get live status and metadata for a dataset.

    Args:
        data (PathData): Path to the zarr dataset directory.

    Returns:
        dict: Live status, last modification time, and other metadata.

    """
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
