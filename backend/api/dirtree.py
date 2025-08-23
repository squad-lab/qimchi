"""
FastAPI endpoint for many Explorer/DirTree related operations.

"""

import xarray as xr

from pathlib import Path
from typing import Dict
from datetime import datetime
from fastapi import APIRouter, HTTPException

# Local imports
from .models import PathData
from .logger import logger


router = APIRouter()

# TODONOW: HERE:
# NOTE: Live-dataset detection and websocket-based live updates were removed.


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


def get_directory_tree_zarr(
    path: str, current_level: int = 0, max_depth: int = 7
) -> Dict:
    """
    Recursively get the directory tree structure up to ``max_depth`` depth.
    Include .zarr directories as special file nodes.
    Returns data in TreeNode format for React frontend.

    Args:
        path (str): Path to the directory.
        current_level (int): Current depth level in the directory tree.
        max_depth (int): Maximum depth level to explore. Default is 7.

    Returns:
        Dict: Directory tree structure in TreeNode format.

    """
    path = Path(path)
    # logger.debug(f"get_directory_tree | {path=}")
    # logger.debug(f"get_directory_tree | {path.resolve()=}")

    if not path.exists():
        return {"error": "Path does not exist"}

    if not path.is_dir():
        return {"error": "Path is not a folder"}

    if current_level >= max_depth:
        return {
            "id": f"folder-{hash(str(path)) % 100000}",
            "name": path.name,
            "path": str(path),
            "type": "folder",
            "timestamp": _get_file_timestamp(path),
            "children": [],
        }

    # Generate unique ID based on path
    item_id = (
        f"folder-{hash(str(path)) % 100000}"
        if path.is_dir()
        else f"file-{hash(str(path)) % 100000}"
    )

    result = {
        "id": item_id,
        "name": path.name or path.parts[-1] or "root",
        "path": str(path),
        "type": "folder",
        "timestamp": _get_file_timestamp(path),
        "children": [],
    }

    # Check if current directory is a zarr file
    if path.name.endswith(".zarr") or (path / ".zarray").exists():
        result["type"] = "file"
        result["size"] = _get_folder_size(path)
        result["tags"] = ["zarr"]
        result["lastModified"] = _get_dataset_last_modified(path)
        # Remove children for files
        del result["children"]
        return result

    try:
        items = list(path.iterdir())
        # Sort items for consistent ordering
        items.sort(key=lambda x: x.name)

        for item in items:
            # Handle .zarr directories as files
            if item.name.endswith(".zarr") and item.is_dir():
                last_modified = _get_dataset_last_modified(item)
                result["children"].append(
                    {
                        "id": f"file-{hash(str(item)) % 100000}",
                        "name": item.name,
                        "path": str(item),
                        "type": "file",
                        "size": _get_folder_size(item),
                        "timestamp": _get_file_timestamp(item),
                        "tags": ["zarr"],
                        "lastModified": last_modified,
                    }
                )

            # Handle .txt files
            elif item.suffix == ".txt" and item.is_file():
                result["children"].append(
                    {
                        "id": f"file-{hash(str(item)) % 100000}",
                        "name": item.name,
                        "path": str(item),
                        "type": "file",
                        "size": _get_file_size(item),
                        "timestamp": _get_file_timestamp(item),
                        "tags": ["text"],
                    }
                )

            # Handle regular directories
            elif item.is_dir():
                child_tree = get_directory_tree_zarr(
                    str(item), current_level + 1, max_depth
                )
                if "error" not in child_tree:
                    result["children"].append(child_tree)

    except PermissionError:
        result["children"].append(
            {
                "id": f"error-{hash(str(path)) % 100000}",
                "name": "Permission denied",
                "path": str(path),
                "type": "file",
                "timestamp": _get_file_timestamp(path),
                "tags": ["error"],
            }
        )

    return result


def _get_file_size(path: Path) -> int:
    """
    Get file size in bytes.

    """
    try:
        return path.stat().st_size
    except (OSError, IOError):
        return 0


def _get_folder_size(path: Path) -> int:
    """
    # TODOLATER: Unused on frontend
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

    """
    try:
        import datetime

        timestamp = path.stat().st_mtime
        return datetime.datetime.fromtimestamp(timestamp).isoformat()

    except (OSError, IOError):
        import datetime

        # TODO: Fallback. Handle this better.
        return datetime.datetime.now().isoformat()


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
        tree = get_directory_tree_zarr(path)

        # Post-process the tree to ensure:
        # 1. Empty directories are removed
        # 2. Dirs containing "exports/" are removed
        # 3. Only .zarr files are included as leaf nodes
        def _post_process_tree(node):
            if "children" in node:
                # First recursively process children
                processed_children = []
                for child in node["children"]:
                    # Skip directories containing "exports/"
                    if "exports/" not in child.get("path", ""):
                        processed_child = _post_process_tree(child)
                        # Only keep if it's a file or has non-empty children
                        if processed_child.get("type") == "file" or processed_child.get(
                            "children"
                        ):
                            processed_children.append(processed_child)

                node["children"] = processed_children
            return node

        tree = _post_process_tree(tree)

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
async def get_dataset_status(data: PathData):
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

        if not (path.name.endswith(".zarr") or (path / ".zarray").exists()):
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
