"""
FastAPI endpoint for many Explorer/DirTree related operations.

"""

import asyncio
import subprocess  # Windows compat
import xarray as xr

from pathlib import Path
from typing import Dict, Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException

# Local tool execs
from .config import FD_EXEC, MAX_DEPTH  #  DU_EXEC, XARGS_EXEC | Windows compat

# Local imports
from .models import PathData
from .logger import logger
from .live_utils import get_live_dataset_entries, resolve_live_dataset
from . import live_client
from . import live_measurements


router = APIRouter()

# FIXME: Live-dataset detection and websocket-based live updates were removed.

MEMORY_PROTOCOL = "memory://"


def _normalize_memory_path(raw_path: str) -> Optional[str]:
    """Return a canonical memory:// path if applicable, otherwise None."""
    if raw_path.startswith(MEMORY_PROTOCOL):
        return raw_path

    stripped = raw_path.rstrip("/")
    if stripped == MEMORY_PROTOCOL.rstrip("/"):
        return MEMORY_PROTOCOL

    return None


def _extract_measurement_id(memory_path: str) -> str:
    """Extract the measurement identifier from a memory:// URI."""
    return memory_path[len(MEMORY_PROTOCOL) :].strip("/")


def _get_dataset_last_modified(path: Path) -> float:
    """
    Get the last modification time of a zarr dataset.

    Args:
        path (Path): Path to the zarr dataset

    Returns:
        float: Unix timestamp of last modification

    """
    try:
        latest_mtime = path.stat().st_mtime

        # Check all files and subdirectories for the most recent modification
        for item in path.rglob("*"):
            if item.is_file():
                item_mtime = item.stat().st_mtime
                latest_mtime = max(latest_mtime, item_mtime)

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
    Build a directory tree using the `fd` utility for fast traversal.

    - This function lists directories (not files) under `path` up to
    `max_depth` and returns a TreeNode-like dictionary suitable for the
    frontend.
    - Only directories and directories whose name ends with .zarr are included.
    - Detection of zarr datasets relies solely on the directory name ending with ".zarr".

    If `fd` is not available (FD_EXEC is None), the function
    returns an error dict so the caller can decide on fallback behavior.

    Args:
        path: str or Path-like root directory to scan.
        max_depth: maximum recursion depth to request from fd.

    Returns:
        Dict: TreeNode-style dict describing the directory tree, or an
        error dict when `fd` is unavailable or fails.

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
    cmd = [
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
    result = subprocess.run(
        cmd,
        input=None,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )

    rc = result.returncode
    out = result.stdout.decode("utf-8", errors="replace")
    err = result.stderr.decode("utf-8", errors="replace")

    if rc != 0:
        logger.error(
            f"get_directory_tree_zarr | fd error: {err.strip() or out.strip()}"
        )
        raise RuntimeError(f"fd error: {err.strip() or out.strip()}")

    paths = [line.strip() for line in out.splitlines() if line.strip()]

    # If paths is empty, raise an error
    if not paths:
        logger.error(
            "get_directory_tree_zarr | No .zarr dataset (sub-)directories found at this level."
        )
        raise RuntimeError(
            f"No .zarr dataset (sub-)directories found at this level. MAX_DEPTH={MAX_DEPTH} may be too low."
        )

    # Build nodes map - start with root node only
    nodes: Dict[str, Dict] = {}
    nodes[str(path)] = root_node

    # Sort paths so parents come before children
    paths_sorted = sorted(paths, key=lambda s: (s.count("/"), s))

    # Collect all unique parent paths first to minimize filesystem calls
    all_parent_paths = set()
    zarr_paths = []

    for p in paths_sorted:
        try:
            item = Path(p)
            item.relative_to(path)  # Ensure path is under root

            if item.is_dir():
                zarr_paths.append(item)
                # Collect all parent paths
                current = item.parent
                while current != path:
                    all_parent_paths.add(current)
                    current = current.parent
        except Exception:
            continue

    # Create all parent nodes first (batch filesystem operations)
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

    # Create zarr nodes
    for item in zarr_paths:
        try:
            zarr_node = {
                "id": f"file-{hash(str(item)) % 100000}",
                "name": item.name,
                "path": str(item),
                "type": "file",
                "size": _get_folder_size(item),
                "timestamp": _get_file_timestamp(item),
                "tags": ["zarr"],
                "lastModified": _get_dataset_last_modified(item),
            }
            nodes[str(item)] = zarr_node
        except Exception:
            continue

    # Build parent-child relationships
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

                if not any(
                    ch.get("path") == node.get("path") for ch in parent_node["children"]
                ):
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

    logger.debug(f"Directory tree built with these nodes:\n{nodes}")
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

    if not disk_path:
        logger.warning(
            "Live dataset %s is registered without a disk path",
            measurement_id,
        )
        return None

    timestamp_iso: Optional[str] = None
    last_modified: Optional[float] = None

    # Try to read metadata from disk path
    try:
        with xr.open_zarr(disk_path) as dataset:
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
    except Exception as exc:
        logger.debug(
            f"Could not read metadata for live dataset {measurement_id} from disk: {exc}"
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

    node = {
        "id": f"file-memory-{measurement_id}",
        "name": f"{measurement_id}.zarr",
        "path": path_value,
        "type": "file",
        "timestamp": timestamp_iso,
        "lastModified": last_modified,
        "tags": [
            "zarr",
            "live" if ended_at is None else "ended",
        ],
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

    """
    raw_path = path.path
    logger.debug(f"load_directory | POST path={raw_path}")

    memory_path = _normalize_memory_path(raw_path)
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

    if not fs_path.exists() or not fs_path.is_dir():
        logger.error(
            f"load_directory | Path does not exist or is not a directory: {fs_path}"
        )
        raise HTTPException(
            status_code=404, detail="Path does not exist or is not a directory"
        )

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

    memory_path = _normalize_memory_path(raw_path)
    data: Optional[xr.Dataset] = None

    if memory_path is not None:
        measurement_id = _extract_measurement_id(memory_path)
        if not measurement_id:
            logger.error("get_meta_attrs | Memory path must include a measurement id")
            raise HTTPException(
                status_code=400, detail="Memory path must include a measurement id"
            )

        # Get WebSocket URL from database first
        info = resolve_live_dataset(measurement_id)
        ws_url = info.get("ws_url")
        disk_path = info.get("disk_path")

        # Try WebSocket first for in-memory access
        if ws_url:
            try:
                data = await live_client.open_live_dataset(
                    measurement_id, ws_url=ws_url
                )
                logger.info(
                    f"Loaded live dataset '{measurement_id}' via WebSocket from memory"
                )
            except Exception as ws_error:
                logger.warning(
                    f"WebSocket load failed for '{measurement_id}': {ws_error}, trying disk fallback"
                )
                # Fall through to disk fallback
                data = None
        else:
            logger.info(f"No WebSocket URL for '{measurement_id}', using disk fallback")
            data = None

        # Fallback to disk path from SQLite DB
        if data is None:
            if not disk_path:
                logger.error(
                    f"get_meta_attrs | Live dataset {measurement_id} has no disk path available"
                )
                raise HTTPException(
                    status_code=404,
                    detail=f"Live dataset {measurement_id} has no disk path available",
                )

            try:
                fs_path = Path(disk_path)
                if not fs_path.exists() or not fs_path.is_dir():
                    logger.error(
                        f"get_meta_attrs | Disk path does not exist or is not a directory: {fs_path}"
                    )
                    raise HTTPException(
                        status_code=404,
                        detail="Disk path does not exist or is not a directory",
                    )
                data = xr.open_zarr(str(fs_path))
            except HTTPException:
                logger.error(
                    f"get_meta_attrs | HTTPException when loading dataset {measurement_id} from disk"
                )
                raise
            except Exception as exc:
                logger.error(
                    "get_meta_attrs | Failed to load dataset %s: %s",
                    measurement_id,
                    exc,
                )
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to load dataset {measurement_id}: {exc}",
                )
    else:
        fs_path = Path(raw_path)
        if not fs_path.exists() or not fs_path.is_dir():
            logger.error(
                f"get_meta_attrs | Path does not exist or is not a directory: {fs_path}"
            )
            raise HTTPException(
                status_code=404, detail="Path does not exist or is not a directory"
            )

        try:
            data = xr.open_dataset(fs_path, engine="zarr")
        except Exception as exc:
            logger.error("get_meta_attrs | Failed to open dataset %s: %s", fs_path, exc)
            raise HTTPException(
                status_code=400, detail=f"Failed to load dataset: {exc}"
            )

    try:
        metadata: dict = data.attrs  # Metadata
        coords: xr.core.coordinates.DatasetCoordinates = (
            data.coords
        )  # NOTE: Coordinates - Independents
        data_vars: xr.core.dataset_variables.DataVariables = (
            data.data_vars
        )  # NOTE: Data variables - Dependents

        indeps: list = list(coords.keys())
        deps: list = list(data_vars.keys())

        logger.debug(f"get_meta_attrs | {indeps=}")
        logger.debug(f"get_meta_attrs | {deps=}")

        # Convert metadata to a dictionary if it's not already
        if not isinstance(metadata, dict):
            metadata = dict(metadata)

        attr_keys: list = [
            "Timestamp",
            "Cryostat",
            "Wafer ID",
            "Device Type",
            "Sample Name",
            "Experiment Name",
            "Measurement ID",  # CONCERN: Already present in filename
            # "Instruments Snapshot"
        ]

        attr_dict: dict = {key: metadata.get(key, "N/A") for key in attr_keys}

        # Ensure metadata is JSON serializable
        attr_json = {}
        for k, v in attr_dict.items():
            if isinstance(v, (str, int, float, bool, list, dict)):
                attr_json[k] = v
            else:
                attr_json[k] = str(v)

        # Add indeps and deps to the metadata
        attr_json["independents"] = indeps
        attr_json["dependents"] = deps

        return attr_json

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

    memory_path = _normalize_memory_path(raw_path)
    data: Optional[xr.Dataset] = None

    if memory_path is not None:
        measurement_id = _extract_measurement_id(memory_path)
        if not measurement_id:
            logger.error(
                f"get_meta_attrs | Memory path must include a measurement id: {memory_path}"
            )
            raise HTTPException(
                status_code=400, detail="Memory path must include a measurement id"
            )

        # Get WebSocket URL from database first
        info = resolve_live_dataset(measurement_id)
        ws_url = info.get("ws_url")
        disk_path = info.get("disk_path")

        # Try WebSocket first for in-memory access
        if ws_url:
            try:
                data = await live_client.open_live_dataset(
                    measurement_id, ws_url=ws_url
                )
                logger.info(
                    f"Loaded live dataset '{measurement_id}' via WebSocket from memory"
                )
            except Exception as ws_error:
                logger.warning(
                    f"WebSocket load failed for '{measurement_id}': {ws_error}, trying disk fallback"
                )
                # Fall through to disk fallback
                data = None
        else:
            logger.info(f"No WebSocket URL for '{measurement_id}', using disk fallback")
            data = None

        # Fallback to disk path from SQLite DB
        if data is None:
            if not disk_path:
                logger.error(
                    f"get_metadata | Live dataset {measurement_id} has no disk path available"
                )
                raise HTTPException(
                    status_code=404,
                    detail=f"Live dataset {measurement_id} has no disk path available",
                )

            try:
                fs_path = Path(disk_path)
                if not fs_path.exists() or not fs_path.is_dir():
                    logger.error(
                        f"get_metadata | Disk path does not exist or is not a directory: {fs_path}"
                    )
                    raise HTTPException(
                        status_code=404,
                        detail="Disk path does not exist or is not a directory",
                    )
                data = xr.open_zarr(str(fs_path))
            except HTTPException:
                logger.error(
                    f"get_metadata | HTTPException when loading dataset {measurement_id} from disk"
                )
                raise
            except Exception as exc:
                logger.error(
                    "get_metadata | Failed to load dataset %s: %s",
                    measurement_id,
                    exc,
                )
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to load dataset {measurement_id}: {exc}",
                )
    else:
        fs_path = Path(raw_path)
        if not fs_path.exists() or not fs_path.is_dir():
            logger.error(
                f"get_metadata | Path does not exist or is not a directory: {fs_path}"
            )
            raise HTTPException(
                status_code=404, detail="Path does not exist or is not a directory"
            )

        try:
            data = xr.open_dataset(fs_path, engine="zarr")
        except Exception as exc:
            logger.error("get_metadata | Failed to open dataset %s: %s", fs_path, exc)
            raise HTTPException(
                status_code=400, detail=f"Failed to load dataset: {exc}"
            )

    try:
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

        return meta_json

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
        path = Path(data.path)

        if not path.exists():
            logger.error(f"get_dataset_status | Dataset path does not exist: {path}")
            raise HTTPException(status_code=404, detail="Dataset not found")

        if not path.name.endswith(".zarr"):
            logger.error(f"get_dataset_status | Path is not a zarr dataset: {path}")
            raise HTTPException(status_code=400, detail="Path is not a zarr dataset")

        last_modified = _get_dataset_last_modified(path)

        return {
            "success": True,
            "path": str(path),
            "last_modified": last_modified,
            "last_modified_iso": datetime.fromtimestamp(last_modified).isoformat(),
            "size": _get_folder_size(path),
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
