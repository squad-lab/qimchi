"""
FastAPI endpoints for downloading datasets, folders, and multiple files as zip files.

"""

import os
import zipfile
import tempfile

from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

# Local imports
from .models import PathData, PathsData
from .logger import logger


router = APIRouter()


@router.post("/download/")
async def download_dataset(path: PathData) -> FileResponse:
    """
    Download a dataset at the given path.

    Args:
        path (PathData): Path to the dataset to download.

    Returns:
        FileResponse: Zipped dataset file for download

    """
    logger.debug(f"download_dataset | POST path={path}")

    # Ensure path is a full path to the directory
    path = Path(path.path)

    # NOTE: The datasets are .zarr folders, so we need to zip them before downloading

    if not path.exists() or not path.is_dir():
        logger.error(
            f"download_dataset | Path does not exist or is not a directory: {path}"
        )
        raise HTTPException(
            status_code=404, detail="Path does not exist or is not a directory"
        )

    try:
        # Create a temporary zip file
        temp_dir = tempfile.mkdtemp()
        zip_filename = f"{path.stem}.zip"
        zip_path = Path(temp_dir) / zip_filename

        # Create the zip file
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            # Add the main dataset (.zarr folder)
            for root, dirs, files in os.walk(path):
                for file in files:
                    file_path = Path(root) / file
                    arcname = file_path.relative_to(path.parent)
                    zipf.write(file_path, arcname)

            # Add the associated notes/metadata folder if it exists
            # Following the same pattern as load_notes function
            dataset_uuid = path.stem
            notes_folder = path.parent / dataset_uuid

            if notes_folder.exists() and notes_folder.is_dir():
                logger.debug(f"download_dataset | Adding notes folder: {notes_folder}")
                for root, dirs, files in os.walk(notes_folder):
                    for file in files:
                        file_path = Path(root) / file
                        arcname = file_path.relative_to(path.parent)
                        zipf.write(file_path, arcname)

        logger.debug(f"download_dataset | Created zip file: {zip_path}")

        # Return the zip file for download
        return FileResponse(
            path=zip_path,
            filename=zip_filename,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={zip_filename}"},
        )

    except Exception as e:
        logger.error(
            f"download_dataset | Error creating zip file: {str(e)}", exc_info=True
        )
        raise HTTPException(
            status_code=500, detail=f"Error creating zip file: {str(e)}"
        )


@router.post("/download-selected/")
async def download_selected_datasets(paths: list[PathData]) -> FileResponse:
    """
    Download multiple datasets as a single zip file.

    Args:
        paths (list[PathData]): List of paths to datasets to download.

    Returns:
        FileResponse: Zipped datasets file for download

    """
    logger.debug(f"download_selected_datasets | POST paths={[p.path for p in paths]}")

    if not paths:
        raise HTTPException(status_code=400, detail="No paths provided")

    # Validate all paths exist and are directories
    valid_paths = []
    for path_data in paths:
        path = Path(path_data.path)
        if not path.exists() or not path.is_dir():
            logger.warning(f"download_selected_datasets | Invalid path: {path}")
            continue
        valid_paths.append(path)

    if not valid_paths:
        raise HTTPException(status_code=404, detail="No valid paths found")

    try:
        # Create a temporary zip file
        temp_dir = tempfile.mkdtemp()
        zip_filename = f"selected_datasets_{len(valid_paths)}_files.zip"
        zip_path = Path(temp_dir) / zip_filename

        # Create the zip file containing all datasets
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            for dataset_path in valid_paths:
                # Add each dataset as a folder in the zip
                for root, dirs, files in os.walk(dataset_path):
                    for file in files:
                        file_path = Path(root) / file
                        # Use dataset name as folder prefix to avoid conflicts
                        arcname = Path(dataset_path.name) / file_path.relative_to(
                            dataset_path
                        )
                        zipf.write(file_path, arcname)

                # Add the associated notes/metadata folder if it exists
                # Following the same pattern as load_notes function
                dataset_uuid = dataset_path.stem
                notes_folder = dataset_path.parent / dataset_uuid

                if notes_folder.exists() and notes_folder.is_dir():
                    logger.debug(
                        f"download_selected_datasets | Adding notes folder: {notes_folder}"
                    )
                    for root, dirs, files in os.walk(notes_folder):
                        for file in files:
                            file_path = Path(root) / file
                            # Use dataset name as folder prefix to avoid conflicts
                            arcname = Path(dataset_uuid) / file_path.relative_to(
                                notes_folder
                            )
                            zipf.write(file_path, arcname)

        logger.debug(
            f"download_selected_datasets | Created zip file: {zip_path} with {len(valid_paths)} datasets"
        )

        # Return the zip file for download
        return FileResponse(
            path=zip_path,
            filename=zip_filename,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={zip_filename}"},
        )

    except Exception as e:
        logger.error(
            f"download_selected_datasets | Error creating zip file: {str(e)}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500, detail=f"Error creating zip file: {str(e)}"
        )


@router.post("/download-multiple/")
async def download_multiple_datasets(data: PathsData) -> FileResponse:
    """
    Download multiple files and/or folders as a single zip file.
    This endpoint can handle any combination of files and directories.

    Args:
        data (PathsData): Object containing a list of paths to files/folders to download.

    Returns:
        FileResponse: Zipped files/folders for download

    """
    logger.debug(f"download_multiple_datasets | POST paths={data.paths}")

    if not data.paths:
        raise HTTPException(status_code=400, detail="No paths provided")

    # Validate all paths exist and categorize them
    valid_files = []
    valid_dirs = []
    for path_str in data.paths:
        path = Path(path_str)
        if not path.exists():
            logger.warning(f"download_multiple_datasets | Path does not exist: {path}")
            continue
        elif path.is_file():
            valid_files.append(path)
        elif path.is_dir():
            valid_dirs.append(path)

    if not valid_files and not valid_dirs:
        raise HTTPException(status_code=404, detail="No valid paths found")

    try:
        # Create a temporary zip file
        temp_dir = tempfile.mkdtemp()
        item_count = len(valid_files) + len(valid_dirs)
        zip_filename = f"items_{item_count}_files.zip"
        zip_path = Path(temp_dir) / zip_filename

        # Create the zip file containing all files and directories
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            # Add individual files
            for file_path in valid_files:
                # Add file directly to zip root
                zipf.write(file_path, file_path.name)

                # If it's a .zarr file, also add the associated notes/metadata folder if it exists
                if file_path.suffix == ".zarr":
                    dataset_uuid = file_path.stem
                    notes_folder = file_path.parent / dataset_uuid

                    if notes_folder.exists() and notes_folder.is_dir():
                        logger.debug(
                            f"download_multiple_datasets | Adding notes folder for file: {notes_folder}"
                        )
                        for root, dirs, files in os.walk(notes_folder):
                            for file in files:
                                notes_file_path = Path(root) / file
                                # Place notes in a folder named after the dataset
                                arcname = Path(
                                    dataset_uuid
                                ) / notes_file_path.relative_to(notes_folder)
                                zipf.write(notes_file_path, arcname)

            # Add directories
            for dir_path in valid_dirs:
                # Add each directory as a folder in the zip
                for root, dirs, files in os.walk(dir_path):
                    for file in files:
                        file_path = Path(root) / file
                        # Use directory name as folder prefix to avoid conflicts
                        arcname = Path(dir_path.name) / file_path.relative_to(dir_path)
                        zipf.write(file_path, arcname)

                # If the directory itself is a .zarr dataset, add its notes folder
                if dir_path.name.endswith(".zarr"):
                    dataset_uuid = dir_path.stem
                    notes_folder = dir_path.parent / dataset_uuid

                    if notes_folder.exists() and notes_folder.is_dir():
                        logger.debug(
                            f"download_multiple_datasets | Adding notes folder for .zarr directory: {notes_folder}"
                        )
                        for root, dirs, files in os.walk(notes_folder):
                            for file in files:
                                notes_file_path = Path(root) / file
                                # Place notes in a folder named after the dataset
                                arcname = Path(
                                    dataset_uuid
                                ) / notes_file_path.relative_to(notes_folder)
                                zipf.write(notes_file_path, arcname)
                else:
                    # If directory contains .zarr files, also add associated notes/metadata folders
                    for zarr_file in dir_path.glob("*.zarr"):
                        dataset_uuid = zarr_file.stem
                        notes_folder = dir_path / dataset_uuid

                        if notes_folder.exists() and notes_folder.is_dir():
                            logger.debug(
                                f"download_multiple_datasets | Adding notes folder for directory: {notes_folder}"
                            )
                            for root, dirs, files in os.walk(notes_folder):
                                for file in files:
                                    notes_file_path = Path(root) / file
                                    # Place notes in a folder structure matching the directory
                                    arcname = (
                                        Path(dir_path.name)
                                        / dataset_uuid
                                        / notes_file_path.relative_to(notes_folder)
                                    )
                                    zipf.write(notes_file_path, arcname)

        logger.debug(
            f"download_multiple_datasets | Created zip file: {zip_path} with {len(valid_files)} files and {len(valid_dirs)} directories"
        )

        # Return the zip file for download
        return FileResponse(
            path=zip_path,
            filename=zip_filename,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={zip_filename}"},
        )

    except Exception as e:
        logger.error(
            f"download_multiple_datasets | Error creating zip file: {str(e)}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500, detail=f"Error creating zip file: {str(e)}"
        )


@router.post("/download-folder/")
async def download_folder(path: PathData) -> FileResponse:
    """
    Download a folder at the given path as a zip file.

    Args:
        path (PathData): Path to the folder to download.

    Returns:
        FileResponse: Zipped folder file for download

    """
    logger.debug(f"download_folder | POST path={path}")

    # Ensure path is a full path to the directory
    path = Path(path.path)

    if not path.exists() or not path.is_dir():
        logger.error(
            f"download_folder | Path does not exist or is not a directory: {path}"
        )
        raise HTTPException(
            status_code=404, detail="Path does not exist or is not a directory"
        )

    try:
        # Create a temporary zip file
        temp_dir = tempfile.mkdtemp()
        zip_filename = f"{path.name}.zip"
        zip_path = Path(temp_dir) / zip_filename

        # Create the zip file containing the entire folder
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            # Add all files in the folder
            for root, dirs, files in os.walk(path):
                for file in files:
                    file_path = Path(root) / file
                    # Preserve the folder structure in the zip
                    arcname = file_path.relative_to(path.parent)
                    zipf.write(file_path, arcname)

            # Also add notes folders for any .zarr datasets found in the folder
            for zarr_path in path.glob("*.zarr"):
                dataset_uuid = zarr_path.stem
                notes_folder = path / dataset_uuid

                if notes_folder.exists() and notes_folder.is_dir():
                    logger.debug(
                        f"download_folder | Adding notes folder: {notes_folder}"
                    )
                    for root, dirs, files in os.walk(notes_folder):
                        for file in files:
                            file_path = Path(root) / file
                            # Preserve the folder structure in the zip
                            arcname = file_path.relative_to(path.parent)
                            zipf.write(file_path, arcname)

        logger.debug(f"download_folder | Created zip file: {zip_path}")

        # Return the zip file for download
        return FileResponse(
            path=zip_path,
            filename=zip_filename,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={zip_filename}"},
        )

    except Exception as e:
        logger.error(
            f"download_folder | Error creating zip file: {str(e)}", exc_info=True
        )
        raise HTTPException(
            status_code=500, detail=f"Error creating zip file: {str(e)}"
        )
