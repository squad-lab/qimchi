"""
FastAPI endpoints for downloading datasets, folders, and multiple files as zip files.

"""

import json
import os
import shutil
import sqlite3
import tempfile
import zipfile
from collections.abc import Callable
from pathlib import Path
from urllib.parse import quote

import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from . import background
from .data_loader import (
    DataLoaderError,
    _load_qcodes_xarray_dataset,
    _parse_qcodes_reference,
    is_memory_reference,
    list_qcodes_runs,
    resolve_to_disk_path,
)
from .dirtree import qcodes_run_day
from .logger import logger

# Local imports
from .models import PathData, PathsData

router = APIRouter()


# Extension of the sidecar written beside every downloaded dataset.
LIBRARY_SIDECAR_SUFFIX = ".qimchi.json"

# Number of QCoDeS runs an archive holds as NetCDF files, so the SPA can say so.
QCODES_RUNS_HEADER = "X-Qimchi-Qcodes-Runs"

QCODES_SUFFIXES = {".db", ".sqlite"}
SQLITE_SUFFIXES = {".db", ".sqlite", ".sqlite3"}
SQLITE_SIDE_FILES = ("-wal", "-shm", "-journal")

DATASET_EXTENSIONS = {".zarr", ".nc", ".h5", ".hdf5", ".csv", ".txt", ".dat", ".mat"}

DATASET_GLOBS = [f"*{ext}" for ext in DATASET_EXTENSIONS]

# QCoDeS runs to download, as run IDs per database.
QcodesRuns = dict[Path, set[int]]


def _resolve_reference(path_ref: str) -> str:
    """Resolve a live measurement reference to its on-disk dataset."""
    if is_memory_reference(path_ref):
        try:
            return resolve_to_disk_path(path_ref)
        except Exception as exc:
            raise HTTPException(
                status_code=404,
                detail=f"Live dataset path is unavailable: {exc}",
            ) from exc
    return path_ref


def _qcodes_selection(ref: str) -> tuple[Path, list[int], str] | None:
    """
    Resolve a QCoDeS run or date reference to a database and run IDs.

    Args:
        ref (str): An Explorer reference such as ``exp.db#run_id=5`` or
            ``exp.db#date=2026-11-10``.

    Returns:
        tuple[Path, list[int], str] | None: The database, its run IDs and a
        name for the archive, or None when ``ref`` is not such a reference.

    Raises:
        HTTPException: If the database or the runs cannot be found.

    """
    if "#" not in ref:
        return None
    base, fragment = ref.split("#", 1)
    db_path = Path(base)
    if db_path.suffix.lower() not in QCODES_SUFFIXES:
        return None
    if not db_path.is_file():
        raise HTTPException(
            status_code=404, detail=f"QCoDeS database not found: {db_path}"
        )

    if fragment.startswith("date="):
        day = fragment.split("=", 1)[1]
        try:
            runs = list_qcodes_runs(db_path)
        except DataLoaderError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        run_ids = [
            run["run_id"]
            for run in runs
            if qcodes_run_day(run.get("run_timestamp")) == day
        ]
        if not run_ids:
            raise HTTPException(
                status_code=404,
                detail=f"No QCoDeS runs from {day} in {db_path.name}",
            )
        return db_path, run_ids, f"{db_path.stem}_{day}"

    try:
        _, run_id = _parse_qcodes_reference(ref)
    except DataLoaderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if run_id is None:
        return None
    return db_path, [run_id], f"{db_path.stem}_run-{run_id}"


def _safe_name(name: str) -> str:
    """Make a run name usable as a file name on every platform."""
    cleaned = "".join("_" if c in '<>:"/\\|?*' or ord(c) < 32 else c for c in name)
    return cleaned.strip(" .") or "run"


def _netcdf_attr(value):
    """Turn an attribute NetCDF cannot store into one it can."""
    if isinstance(value, (bool, np.bool_)):
        return int(value)
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, default=str)
    return value


def _write_qcodes_netcdf(db_path: Path, run_id: int, target: Path) -> str | None:
    """Write one QCoDeS run as a NetCDF file laid out as Qimchi displays it.

    Args:
        db_path (Path): The QCoDeS database.
        run_id (int): The run to write.
        target (Path): The NetCDF file to create.

    Returns:
        str | None: The run's GUID, which identifies it in the library.
    """
    dataset = _load_qcodes_xarray_dataset(db_path, run_id)
    _write_netcdf(dataset, target)
    return dataset.attrs.get("guid")


def _write_netcdf(dataset, target: Path) -> None:
    """Write a dataset as NetCDF, turning what NetCDF cannot store into what it can."""
    dataset.attrs = {
        key: _netcdf_attr(value)
        for key, value in dataset.attrs.items()
        if value is not None
    }
    for variable in dataset.variables.values():
        variable.attrs = {
            key: _netcdf_attr(value)
            for key, value in variable.attrs.items()
            if value is not None
        }
    # NetCDF has no complex type; h5netcdf writes it anyway when allowed, as QCoDeS does.
    has_complex = any(
        np.issubdtype(variable.dtype, np.complexfloating)
        for variable in dataset.variables.values()
    )
    dataset.to_netcdf(target, engine="h5netcdf", invalid_netcdf=has_complex)


def _write_qcodes_runs(zipf, runs: QcodesRuns, work_dir: Path) -> int:
    """Write selected QCoDeS runs as NetCDF files in an open archive.

    Args:
        zipf: The open archive.
        runs (QcodesRuns): Run IDs grouped by database.
        work_dir (Path): Scratch directory for the NetCDF files.

    Returns:
        int: The number of runs written.
    """
    count = 0
    for db_path, run_ids in runs.items():
        names = {run["run_id"]: run.get("name") for run in list_qcodes_runs(db_path)}
        prefix = Path(db_path.stem)
        for run_id in sorted(run_ids):
            stem = _safe_name(f"{run_id}-{names.get(run_id) or 'run'}")
            target = work_dir / f"run-{count}.nc"
            guid = _write_qcodes_netcdf(db_path, run_id, target)
            zipf.write(target, prefix / f"{stem}.nc")
            target.unlink()
            _write_library_sidecar(
                zipf,
                Path(f"{db_path}#run_id={run_id}"),
                prefix / stem,
                dataset_uuid=guid,
                name=stem,
            )
            count += 1
    return count


def _snapshot_sqlite(source: Path, target: Path) -> None:
    """Copy a SQLite database through SQLite, so its ``-wal`` content comes too."""
    src = sqlite3.connect(f"{source.as_uri()}?mode=ro", uri=True)
    try:
        dst = sqlite3.connect(target)
        try:
            src.backup(dst)
            dst.execute("PRAGMA journal_mode=DELETE")
        finally:
            dst.close()
    finally:
        src.close()


def _is_sqlite_side_file(path: Path) -> bool:
    """Whether ``path`` is the WAL, shared-memory or journal file of a database."""
    for suffix in SQLITE_SIDE_FILES:
        if path.name.endswith(suffix):
            base = path.with_name(path.name[: -len(suffix)])
            return base.suffix.lower() in SQLITE_SUFFIXES and base.exists()
    return False


def _write_file(zipf, file_path: Path, arcname: Path | str, work_dir: Path) -> None:
    """Add a file to the archive, taking a consistent copy of SQLite databases."""
    if file_path.suffix.lower() in SQLITE_SUFFIXES:
        snapshot = work_dir / "snapshot.sqlite"
        try:
            _snapshot_sqlite(file_path, snapshot)
        except sqlite3.Error as exc:
            # Not every .db file is a SQLite database.
            logger.info(f"Copying {file_path} as it is: {exc}")
        else:
            zipf.write(snapshot, arcname)
            return
        finally:
            snapshot.unlink(missing_ok=True)
    zipf.write(file_path, arcname)


def _write_tree(zipf, root: Path, arc_root: Path, work_dir: Path) -> None:
    """Add every file under ``root`` to the archive, below ``arc_root``."""
    for dirpath, _dirs, files in os.walk(root):
        for file in files:
            file_path = Path(dirpath) / file
            if _is_sqlite_side_file(file_path):
                continue
            arcname = arc_root / file_path.relative_to(root)
            _write_file(zipf, file_path, arcname, work_dir)


def _write_library_sidecar(
    zipf,
    dataset_path: Path,
    prefix: Path,
    dataset_uuid: str | None = None,
    name: str | None = None,
) -> None:
    """
    Write a dataset's library record into the archive, beside its notes.

    A downloaded zip otherwise leaves every annotation behind: the tags, the
    heart, the measurement UUID. It goes in the dataset's notes folder, which
    every download endpoint already builds, so Qimchi's own files stay in one
    place rather than scattered beside the data.

    Written even when the record is empty: an absent file is ambiguous -- it
    could mean untagged, or a download that predates this -- and an explicit
    empty list is not.

    Args:
        zipf: The open archive.
        dataset_path (Path): Dataset on disk the record describes.
        prefix (Path): Archive folder to write into, matching where this
            endpoint puts that dataset's notes.
        dataset_uuid (str | None): The dataset's UUID, when its file name is
            not it.
        name (str | None): Sidecar name, when it is not the dataset's stem.

    """
    try:
        from .library import library_metadata

        record = library_metadata(dataset_path, dataset_uuid)
        arcname = prefix / f"{name or dataset_path.stem}{LIBRARY_SIDECAR_SUFFIX}"
        zipf.writestr(str(arcname), json.dumps(record, indent=2))
    except Exception as exc:
        # Annotations are a bonus; losing them must never lose the download.
        logger.info(f"Library sidecar unavailable for {dataset_path}: {exc}")


def _write_notes(zipf, dataset_path: Path, arc_prefix: Path, work_dir: Path) -> None:
    """Add a dataset's library record and notes folder, below ``arc_prefix``."""
    dataset_uuid = dataset_path.stem
    _write_library_sidecar(zipf, dataset_path, arc_prefix / dataset_uuid)
    notes_folder = dataset_path.parent / dataset_uuid
    if notes_folder.is_dir():
        _write_tree(zipf, notes_folder, arc_prefix / dataset_uuid, work_dir)


def _desktop_download_dir() -> Path | None:
    """Return the local download directory used by the desktop shell."""
    if os.environ.get("QIMCHI_DESKTOP", "").lower() not in ("1", "true", "yes"):
        return None

    override = os.environ.get("QIMCHI_DOWNLOAD_DIR")
    target = Path(override).expanduser() if override else (Path.home() / "Downloads")
    try:
        target.mkdir(parents=True, exist_ok=True)
        return target
    except OSError:
        logger.exception("Could not create desktop download dir %s", target)
        return None


def _unique_destination(directory: Path, filename: str) -> Path:
    """Choose a destination without replacing a previous download."""
    destination = directory / filename
    counter = 2
    while destination.exists():
        destination = (
            directory / f"{Path(filename).stem} ({counter}){Path(filename).suffix}"
        )
        counter += 1
    return destination


def _download_response(
    zip_path: Path, zip_filename: str, qcodes_runs: int = 0
) -> FileResponse:
    """Return an archive and persist it directly when running in pywebview."""
    headers = {"Content-Disposition": f"attachment; filename={zip_filename}"}
    if qcodes_runs:
        headers[QCODES_RUNS_HEADER] = str(qcodes_runs)
    save_dir = _desktop_download_dir()
    if save_dir is not None:
        destination = _unique_destination(save_dir, zip_filename)
        shutil.copy2(zip_path, destination)
        # Keep the response header ASCII-safe; the frontend decodes it before
        # showing the destination and skips its unsupported blob download.
        headers["X-Qimchi-Saved-To"] = quote(str(destination), safe="")
        logger.info("Saved desktop download to %s", destination)

    return FileResponse(
        path=zip_path,
        filename=zip_filename,
        media_type="application/zip",
        headers=headers,
    )


def _archive(
    caller: str,
    zip_filename: str,
    fill: Callable[[zipfile.ZipFile, Path], int | None],
) -> FileResponse:
    """Build and return a ZIP archive.

    Args:
        caller (str): Endpoint name used in log messages.
        zip_filename (str): Name of the resulting archive.
        fill: Callback that writes the archive contents and optionally returns
            the number of converted QCoDeS runs.

    Returns:
        FileResponse: The completed archive.
    """
    try:
        temp_dir = Path(tempfile.mkdtemp())
        zip_path = temp_dir / zip_filename
        work_dir = temp_dir / "work"
        work_dir.mkdir()

        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            qcodes_runs = fill(zipf, work_dir) or 0

        logger.debug(f"{caller} | Created zip file: {zip_path}")
        return _download_response(zip_path, zip_filename, qcodes_runs)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"{caller} | Error creating zip file: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Error creating zip file: {str(e)}"
        )


def _download_qcodes_runs(
    caller: str, db_path: Path, run_ids: list[int], name: str
) -> FileResponse:
    """Download QCoDeS runs from one database as NetCDF files."""
    return _archive(
        caller,
        f"{name}.zip",
        lambda zipf, work_dir: _write_qcodes_runs(
            zipf, {db_path: set(run_ids)}, work_dir
        ),
    )


@router.post("/download/")
async def download_dataset(path: PathData) -> FileResponse:
    """
    Download a dataset at the given path.

    QCoDeS runs are downloaded as NetCDF files.

    Args:
        path (PathData): Path to the dataset to download.

    Returns:
        FileResponse: Zipped dataset file for download

    """
    logger.debug(f"download_dataset | POST path={path}")
    return await background.run(_download_dataset, path.path)


def _download_dataset(ref: str) -> FileResponse:
    ref = _resolve_reference(ref)
    selection = _qcodes_selection(ref)
    if selection is not None:
        return _download_qcodes_runs("download_dataset", *selection)

    path = Path(ref)
    if not path.exists():
        logger.error(f"download_dataset | Path does not exist: {path}")
        raise HTTPException(status_code=404, detail="Path does not exist")

    def fill(zipf, work_dir: Path) -> None:
        if path.is_dir():
            _write_tree(zipf, path, Path(path.name), work_dir)
        else:
            _write_file(zipf, path, path.name, work_dir)
        _write_notes(zipf, path, Path(), work_dir)

    return _archive("download_dataset", f"{path.stem}.zip", fill)


def _split_references(caller: str, refs: list[str]) -> tuple[QcodesRuns, list[Path]]:
    """Separate QCoDeS runs from paths, skipping unavailable ones."""
    runs: QcodesRuns = {}
    paths: list[Path] = []
    for ref in refs:
        try:
            resolved = _resolve_reference(ref)
            selection = _qcodes_selection(resolved)
        except HTTPException as exc:
            logger.warning(f"{caller} | Unavailable: {ref} ({exc.detail})")
            continue
        if selection is not None:
            db_path, run_ids, _ = selection
            runs.setdefault(db_path, set()).update(run_ids)
            continue
        path = Path(resolved)
        if not path.exists():
            logger.warning(f"{caller} | Path does not exist: {path}")
            continue
        paths.append(path)
    return runs, paths


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
    return await background.run(_download_selected_datasets, [p.path for p in paths])


def _download_selected_datasets(refs: list[str]) -> FileResponse:
    caller = "download_selected_datasets"
    runs, valid_paths = _split_references(caller, refs)
    if not runs and not valid_paths:
        raise HTTPException(status_code=404, detail="No valid paths found")

    def fill(zipf, work_dir: Path) -> int:
        for dataset_path in valid_paths:
            if dataset_path.is_dir():
                _write_tree(zipf, dataset_path, Path(dataset_path.name), work_dir)
            else:
                _write_file(zipf, dataset_path, dataset_path.name, work_dir)
            _write_notes(zipf, dataset_path, Path(), work_dir)
        return _write_qcodes_runs(zipf, runs, work_dir)

    count = len(valid_paths) + sum(len(ids) for ids in runs.values())
    return _archive(caller, f"selected_datasets_{count}_files.zip", fill)


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
    return await background.run(_download_multiple_datasets, data.paths)


def _download_multiple_datasets(refs: list[str]) -> FileResponse:
    caller = "download_multiple_datasets"
    runs, paths = _split_references(caller, refs)
    valid_files = [path for path in paths if path.is_file()]
    valid_dirs = [path for path in paths if path.is_dir()]
    if not runs and not valid_files and not valid_dirs:
        raise HTTPException(status_code=404, detail="No valid paths found")

    def fill(zipf, work_dir: Path) -> int:
        for file_path in valid_files:
            _write_file(zipf, file_path, file_path.name, work_dir)
            if file_path.suffix in DATASET_EXTENSIONS:
                _write_notes(zipf, file_path, Path(), work_dir)

        for dir_path in valid_dirs:
            _write_tree(zipf, dir_path, Path(dir_path.name), work_dir)
            if dir_path.name.endswith(".zarr"):
                _write_notes(zipf, dir_path, Path(), work_dir)
            else:
                for pattern in DATASET_GLOBS:
                    for ds_file in dir_path.glob(pattern):
                        _write_notes(zipf, ds_file, Path(dir_path.name), work_dir)

        return _write_qcodes_runs(zipf, runs, work_dir)

    item_count = (
        len(valid_files) + len(valid_dirs) + sum(len(ids) for ids in runs.values())
    )
    return _archive(caller, f"items_{item_count}_files.zip", fill)


@router.post("/download-folder/")
async def download_folder(path: PathData) -> FileResponse:
    """
    Download a folder at the given path as a zip file.

    QCoDeS databases and date groups follow the same folder download path as
    the Explorer.

    Args:
        path (PathData): Path to the folder to download.

    Returns:
        FileResponse: Zipped folder file for download

    """
    logger.debug(f"download_folder | POST path={path}")
    return await background.run(_download_folder, path.path)


def _download_folder(ref: str) -> FileResponse:
    selection = _qcodes_selection(ref)
    if selection is not None:
        return _download_qcodes_runs("download_folder", *selection)

    path = Path(ref)
    if path.is_file() and path.suffix.lower() in QCODES_SUFFIXES:
        return _download_dataset(ref)

    if not path.exists() or not path.is_dir():
        logger.error(
            f"download_folder | Path does not exist or is not a directory: {path}"
        )
        raise HTTPException(
            status_code=404, detail="Path does not exist or is not a directory"
        )

    def fill(zipf, work_dir: Path) -> None:
        _write_tree(zipf, path, Path(path.name), work_dir)
        for pattern in DATASET_GLOBS:
            for ds_path in path.glob(pattern):
                _write_notes(zipf, ds_path, Path(path.name), work_dir)

    return _archive("download_folder", f"{path.name}.zip", fill)
