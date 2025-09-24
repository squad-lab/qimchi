"""
FastAPI endpoint for many Explorer/DirTree related operations.

"""

import asyncio
import time
import xarray as xr

from pathlib import Path
from typing import Dict
from datetime import datetime
from fastapi import APIRouter, HTTPException

# Local tool execs
from .config import FD_EXEC, DU_EXEC, XARGS_EXEC

# Local imports
from .models import PathData
from .logger import logger


router = APIRouter()

# FIXME: Live-dataset detection and websocket-based live updates were removed.


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


async def get_directory_tree_zarr(path: str, max_depth: int = 7) -> Dict:
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
        raise FileNotFoundError("Path does not exist")

    if not path.is_dir():
        raise NotADirectoryError("Path is not a folder")

    # Check fd availability from config
    # Require command-line utilities
    missing_tools = []
    if not FD_EXEC:
        missing_tools.append("fd")
    if not DU_EXEC:
        missing_tools.append("du")
    if not XARGS_EXEC:
        missing_tools.append("xargs")

    if missing_tools:
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

    # Use fd to list directories up to specified depth.
    cmd = [
        FD_EXEC,
        "--hidden",
        "--no-ignore-vcs",
        "--absolute-path",
        "--color=never",
        "--max-depth",
        str(max_depth),
        "-t",
        "d",
        ".",
        str(path),
    ]

    rc, out, err = await _run_subprocess(cmd)
    if rc != 0:
        raise RuntimeError(f"fd error: {err.strip() or out.strip()}")

    paths = [line.strip() for line in out.splitlines() if line.strip()]

    # Build nodes map and only include directories (and .zarr dirs).
    nodes: Dict[str, Dict] = {}
    nodes[str(path)] = root_node

    # Sort paths so parents come before children
    paths_sorted = sorted(paths, key=lambda s: (s.count("/"), s))

    for p in paths_sorted:
        try:
            item = Path(p)
        except Exception:
            continue

        # Ensure the path is under root
        try:
            item.relative_to(path)
        except Exception:
            continue

        # Only directories should be returned by fd with -t d, but guard anyway
        if not item.is_dir():
            continue

        # Only include folders and .zarr folders
        if item.name.endswith(".zarr"):
            node = {
                "id": f"file-{hash(str(item)) % 100000}",
                "name": item.name,
                "path": str(item),
                "type": "file",
                "size": _get_folder_size(item),
                "timestamp": _get_file_timestamp(item),
                "tags": ["zarr"],
                "lastModified": _get_dataset_last_modified(item),
            }
            nodes[str(item)] = node
        else:
            # TODOLATER: Maybe attach a .export or some standard suffix for exports directory
            # Skip directories that have a corresponding .zarr sibling
            # (these are export/companion directories for zarr datasets)
            zarr_sibling = item.parent / f"{item.name}.zarr"
            if zarr_sibling.exists() and zarr_sibling.is_dir():
                continue

            nodes[str(item)] = {
                "id": f"folder-{hash(str(item)) % 100000}",
                "name": item.name,
                "path": str(item),
                "type": "folder",
                "timestamp": _get_file_timestamp(item),
                "children": [],
            }

    # Attach nodes to parents
    for p_str, node in list(nodes.items()):
        if p_str == str(path):
            continue

        try:
            p_path = Path(p_str)
            parent = p_path.parent
            parent_str = str(parent)

            if parent_str not in nodes:
                # create missing parent(s)
                nodes[parent_str] = {
                    "id": f"folder-{hash(parent_str) % 100000}",
                    "name": parent.name,
                    "path": parent_str,
                    "type": "folder",
                    "timestamp": _get_file_timestamp(parent),
                    "children": [],
                }

            parent_node = nodes[parent_str]
            if parent_node.get("children") is None:
                parent_node["children"] = []

            if not any(
                ch.get("path") == node.get("path") for ch in parent_node["children"]
            ):
                parent_node["children"].append(node)

        except Exception:
            continue

    # Sort children lists for consistent ordering
    def sort_children(node):
        if node.get("children"):
            node["children"].sort(key=lambda c: c.get("name", ""))
            for c in node["children"]:
                sort_children(c)

    sort_children(nodes[str(path)])

    # --- Compute sizes for .zarr nodes using fast external tool (du) if available ---
    # Collect zarr paths
    # Compute sizes for zarr paths using du + xargs in parallel. We expect
    # GNU du with -b to be available on the user's linux host. Use xargs to
    # parallelize work. Any missing utility is an error which we already
    # checked above.
    zarr_paths = [p for p, n in nodes.items() if n.get("tags") == ["zarr"]]

    sizes_from_du = {}

    if zarr_paths:
        # Check cache first
        now = time.time()
        to_query = []
        for p in zarr_paths:
            ent = _SIZE_CACHE.get(p)
            if ent and ent.get("expires_at", 0) > now:
                sizes_from_du[p] = ent["value"]
            else:
                to_query.append(p)

        if to_query:
            # Build null-separated input and run: xargs -0 -n50 -P4 du -sb
            input_data = "\0".join(to_query).encode("utf-8") + b"\0"
            cmd = [XARGS_EXEC, "-0", "-n", "50", "-P", "4", DU_EXEC, "-sb"]
            rc, out, err = await _run_subprocess(cmd, input_data=input_data)
            if rc != 0:
                raise RuntimeError(
                    f"Error running du/xargs: {err.strip() or out.strip()}"
                )

            for line in out.splitlines():
                parts = line.strip().split(None, 1)
                if len(parts) == 2:
                    size_str, pth = parts
                    try:
                        size = int(size_str)
                        sizes_from_du[str(Path(pth))] = size
                        # store in cache for 30s
                        _SIZE_CACHE[str(Path(pth))] = {
                            "value": size,
                            "expires_at": now + 30,
                        }
                    except ValueError:
                        continue

    # Attach computed sizes to nodes
    for pth, size in sizes_from_du.items():
        if pth in nodes and nodes[pth].get("tags") == ["zarr"]:
            nodes[pth]["size"] = size

    return nodes[str(path)]


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
    logger.debug(f"load_directory | POST path={path}")

    path = Path(path.path)
    logger.debug(f"load_directory | Resolved path={path.resolve()}")

    if not path.exists() or not path.is_dir():
        logger.error(
            f"load_directory | Path does not exist or is not a directory: {path}"
        )
        raise HTTPException(
            status_code=404, detail="Path does not exist or is not a directory"
        )

    try:
        tree = await get_directory_tree_zarr(path=str(path))

        return tree

    except Exception as e:
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
    # Ensure path is a full path to the .zarr directory
    path = Path(path.path)

    logger.debug(f"get_meta_attrs | POST path={path}")
    if not path.exists() or not path.is_dir():
        logger.error(
            f"get_meta_attrs | Path does not exist or is not a directory: {path}"
        )
        raise HTTPException(
            status_code=404, detail="Path does not exist or is not a directory"
        )

    # If path exists, load the zarr file using xarray
    try:
        # Load the zarr file using xarray.open_dataset for lazy loading
        data = xr.open_dataset(path, engine="zarr")
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
        # NOTE: Remaining keys:
        # 'Code Archive',  'Extra Metadata', 'Instruments Snapshot', 'Parameters Snapshot', 'Requirements', 'Sweeps',

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


@router.post("/load-meta/")
async def get_metadata(path: PathData) -> Dict:
    """
    Get collapsible metadata key-vals for a .zarr dataset.

    Args:
        path (PathData): Path to the .zarr dataset directory.

    Returns:
        Dict: Collapsible metadata key-vals from the zarr dataset

    """
    # Ensure path is a full path to the .zarr directory
    path = Path(path.path)

    logger.debug(f"get_metadata | POST path={path}")
    if not path.exists() or not path.is_dir():
        logger.error(
            f"get_metadata | Path does not exist or is not a directory: {path}"
        )
        raise HTTPException(
            status_code=404, detail="Path does not exist or is not a directory"
        )

    # If path exists, load the zarr file using xarray
    try:
        # Load the zarr file using xarray.open_dataset for lazy loading
        data = xr.open_dataset(path, engine="zarr")
        metadata: dict = data.attrs  # Metadata
        # logger.debug(f"get_metadata | {metadata.keys()=}")
        # logger.debug(f"get_metadata | {metadata=}")

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
            raise HTTPException(status_code=404, detail="Dataset not found")

        if not path.name.endswith(".zarr"):
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
        raise

    except Exception as e:
        logger.error(f"Error getting dataset status for {data.path}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error getting dataset status: {str(e)}"
        )
