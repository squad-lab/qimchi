"""
FastAPI endpoints for loading and saving notes associated with .zarr datasets.

"""

import asyncio
import os
import re
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Tuple
from fastapi import APIRouter, Depends, HTTPException

# Local imports
from .models import PathData, NotesData
from .logger import logger
from .data_loader import load_xarray_dataset, _detect_filesystem_format
from .db_models import LOCAL_USER_ID, Note, _utcnow
from .shared.db import require_db, session_scope

# Notes are DB-backed, so both endpoints are guarded. Loading must 503 rather
# than return empty on a DB failure: an empty editor reads as "my notes are
# gone", inviting the user to retype them into a save that will also fail.
router = APIRouter(dependencies=[Depends(require_db)])

# Measurement notes are DB-backed (source of truth). When enabled (default), a
# ``.md`` sidecar mirror is also written and the pooled sample rollup is kept in
# sync -- this preserves the existing file-based workflow. Disable to run
# DB-only (e.g. for datasets with no writable sidecar location).
_MD_EXPORT_ENABLED = os.getenv("QIMCHI_NOTES_MD_EXPORT", "true").lower() in (
    "1",
    "true",
    "yes",
)


def _parse_iso(ts: str | None) -> datetime:
    """Best-effort parse of an ISO timestamp string, defaulting to now (UTC)."""
    if ts:
        try:
            return datetime.fromisoformat(ts)
        except ValueError:
            pass
    return _utcnow()


def _db_get_note(uuid: str) -> Tuple[str, datetime] | None:
    """Return (body, updated_at) for a measurement note, or None if absent."""
    with session_scope() as session:
        note = session.get(Note, (uuid, LOCAL_USER_ID))
        if note is None:
            return None
        return note.body, note.updated_at


def _db_upsert_note(uuid: str, body: str, when: datetime | None = None) -> datetime:
    """Insert or update a measurement note; returns the stored timestamp."""
    ts = when or _utcnow()
    with session_scope() as session:
        note = session.get(Note, (uuid, LOCAL_USER_ID))
        if note is None:
            session.add(Note(uuid=uuid, user_id=LOCAL_USER_ID, body=body, updated_at=ts))
        else:
            note.body = body
            note.updated_at = ts
    return ts


FRONTMATTER_TEMPLATE = '---\nLast Saved: "{timestamp}"\nFilename: "{filename}"\n\n---\n'


def _parse_frontmatter(text: str):
    """
    Parse a frontmatter block from the top of a markdown file.

    Args:
        text (str): Full text of the markdown file.

    Returns:
        Tuple[str, Optional[str], Optional[str]]: (body_text, last_saved_str_or_None, filename_or_None)

    """
    if not text:
        return "", None, None

    # Match a frontmatter block starting with --- and ending with ---
    m = re.match(r"^\s*---\s*(.*?)\s*---\s*(.*)$", text, re.DOTALL)
    if not m:
        return text, None, None

    fm = m.group(1)
    rest = m.group(2)

    last_saved = None
    filename = None
    for line in fm.splitlines():
        if line.strip().startswith("Last Saved:"):
            last_saved = line.split("Last Saved:", 1)[1].strip()
            # Strip surrounding quotes if present
            if (last_saved.startswith('"') and last_saved.endswith('"')) or (
                last_saved.startswith("'") and last_saved.endswith("'")
            ):
                last_saved = last_saved[1:-1]
        elif line.strip().startswith("Filename:"):
            filename = line.split("Filename:", 1)[1].strip()
            if (filename.startswith('"') and filename.endswith('"')) or (
                filename.startswith("'") and filename.endswith("'")
            ):
                filename = filename[1:-1]

    return rest, last_saved, filename


def _make_frontmatter(filename: str, when: datetime) -> str:
    """
    Create a frontmatter block with the given filename and timestamp.

    Args:
        filename (str): The filename to include in the frontmatter.
        when (datetime): The timestamp to include in the frontmatter.

    Returns:
        str: The formatted frontmatter string.

    """
    # Use ISO 8601 with timezone for maximum compatibility (e.g. 2025-08-17T14:23:05+00:00)
    ts = when.isoformat()
    return FRONTMATTER_TEMPLATE.format(timestamp=ts, filename=filename)


def _measurement_notes_paths(path: Path) -> Tuple[str, Path, Path]:
    """
    Build measurement notes paths from a .zarr dataset path.

    Returns:
        Tuple[str, Path, Path]: (dataset_uuid, notes_dir, notes_path)

    """
    dataset_uuid = path.stem
    notes_dir = path.parent / dataset_uuid
    notes_path = notes_dir / f"{dataset_uuid}.md"
    return dataset_uuid, notes_dir, notes_path


def _infer_sample_dir_from_measurement_path(path: Path) -> Path:
    """
    Infer sample directory from a measurement path with layout:
    .../<sample>/<experiment>/<measurement>.zarr

    """
    if path.parent and path.parent.parent:
        return path.parent.parent
    if path.parent:
        return path.parent
    return path


def _read_dataset_names(path: Path) -> Tuple[str | None, str | None]:
    """
    Read (sample_name, cryostat_name) from dataset metadata when possible.

    """
    try:
        fmt = _detect_filesystem_format(path)
        ds = load_xarray_dataset(path, fmt)
        attrs = ds.attrs if hasattr(ds, "attrs") else {}
        sample_name = attrs.get("Sample Name") or attrs.get("sample_name")
        cryostat_name = attrs.get("Cryostat") or attrs.get("cryostat")
        ds.close()
        return (
            str(sample_name).strip() if sample_name else None,
            str(cryostat_name).strip() if cryostat_name else None,
        )
    except Exception:
        return None, None


def _sample_notes_path(
    path: Path,
    sample_path: str | None = None,
    sample_name: str | None = None,
    cryostat_name: str | None = None,
) -> Tuple[str, Path, Path]:
    """
    Build pooled sample notes path from either a sample folder path or measurement path.

    Args:
        path (Path): Measurement path or sample path fallback.
        sample_path (str | None): Optional explicit sample folder path.

    Returns:
        Tuple[str, Path, Path]: (filename, sample_dir, sample_notes_path)

    """
    sample_dir = (
        Path(sample_path)
        if sample_path
        else _infer_sample_dir_from_measurement_path(path)
    )

    meta_sample_name, meta_cryostat_name = _read_dataset_names(path)
    resolved_sample_name = (
        (sample_name or "").strip()
        or (meta_sample_name or "").strip()
        or sample_dir.name
        or "sample"
    )
    resolved_cryostat_name = (
        (cryostat_name or "").strip()
        or (meta_cryostat_name or "").strip()
        or "cryostat"
    )

    filename = f"{resolved_cryostat_name}_{resolved_sample_name}.md"
    return filename, sample_dir, sample_dir / filename


def _ensure_notes_file(notes_path: Path, filename: str) -> None:
    """
    Ensure a notes file exists and has frontmatter.

    Args:
        notes_path (Path): Notes file path.
        filename (str): Filename value for frontmatter.

    """
    notes_path.parent.mkdir(parents=True, exist_ok=True)
    if not notes_path.exists():
        fm = _make_frontmatter(filename, datetime.now(timezone.utc))
        with open(notes_path, "w", encoding="utf-8") as f:
            f.write(fm)


def _format_sample_rollup_entry(
    when: datetime,
    measurement_path: Path,
    measurement_notes_path: Path,
    measurement_notes_body: str,
) -> str:
    """
    Build a pooled sample notes entry in the required markdown format.

    """
    ts = when.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M")
    header = (
        f"[{ts}] [Measurement]({measurement_path}) [Notes]({measurement_notes_path})"
    )
    body = (measurement_notes_body or "").rstrip()
    if body:
        return f"{header}\n\n{body}"
    return header


_ROLLOUT_HEADER_RE = re.compile(
    r"^\[(?P<ts>\d{4}-\d{2}-\d{2}T\d{2}:\d{2})\]\s+"
    r"\[(?P<mtext>[^\]]+)\]\((?P<mpath>[^)]+)\)\s+"
    r"\[(?P<ntext>[^\]]+)\]\((?P<npath>[^)]+)\)\s*$"
)


def _normalize_link_path(path: str) -> str:
    """Normalize path strings for robust comparisons across slash styles."""
    return path.replace("\\", "/").strip().lower()


def _find_last_synced_measurement_body(
    sample_notes_body: str,
    measurement_path: Path,
) -> str | None:
    """
    Return body of the latest pooled entry for this measurement path, if present.

    """
    if not sample_notes_body.strip():
        return None

    target_path = _normalize_link_path(str(measurement_path))
    lines = sample_notes_body.splitlines()

    entries: list[tuple[str, list[str]]] = []
    current_path: str | None = None
    current_body_lines: list[str] = []

    for line in lines:
        m = _ROLLOUT_HEADER_RE.match(line.strip())
        if m:
            if current_path is not None:
                entries.append((current_path, current_body_lines))
            current_path = _normalize_link_path(m.group("mpath"))
            current_body_lines = []
            continue

        if current_path is not None:
            current_body_lines.append(line)

    if current_path is not None:
        entries.append((current_path, current_body_lines))

    for entry_path, body_lines in reversed(entries):
        if entry_path == target_path:
            return "\n".join(body_lines).strip()

    return None


def _compute_incremental_body(prev_body: str | None, new_body: str) -> str:
    """
    Compute incremental body to append from previous -> current measurement note.

    If content is unchanged, returns empty string.
    If current starts with previous, returns only the appended suffix.
    Otherwise, returns full current body as a safe fallback.

    """
    current = (new_body or "").rstrip()
    previous = (prev_body or "").rstrip()

    if not current:
        return ""

    if not previous:
        return current

    if current == previous:
        return ""

    if current.startswith(previous):
        return current[len(previous) :].lstrip("\n")

    return current


def _build_initial_sample_pool_body(sample_dir: Path, when: datetime) -> str:
    """
    Build initial pooled sample body by collecting all existing measurement notes.

    The same initialization timestamp is used for all imported entries.

    """
    entries: list[str] = []

    try:
        measurement_paths = []
        for ext in ["*.zarr", "*.nc", "*.h5", "*.hdf5", "*.csv", "*.txt", "*.dat"]:
            for p in sample_dir.rglob(ext):
                if ext == "*.zarr" and not p.is_dir():
                    continue
                if ext != "*.zarr" and not p.is_file():
                    continue
                measurement_paths.append(p)
        measurement_paths.sort()
    except Exception:
        measurement_paths = []

    for measurement_path in measurement_paths:
        _, _, measurement_notes_path = _measurement_notes_paths(measurement_path)
        if not measurement_notes_path.exists() or not measurement_notes_path.is_file():
            continue

        try:
            with open(measurement_notes_path, "r", encoding="utf-8") as f:
                measurement_text = f.read()
            body, _, _ = _parse_frontmatter(measurement_text)
            body = (body or "").rstrip()
            if not body:
                continue

            entries.append(
                _format_sample_rollup_entry(
                    when,
                    measurement_path,
                    measurement_notes_path,
                    body,
                )
            )
        except Exception:
            continue

    if not entries:
        return ""

    return "\n\n".join(entries).rstrip() + "\n"


def append_sample_rollup(
    measurement_path: str | Path,
    measurement_notes_body: str,
    when: datetime | None = None,
    sample_path: str | None = None,
    sample_name: str | None = None,
    cryostat_name: str | None = None,
    previous_measurement_notes_body: str | None = None,
) -> Dict[str, str]:
    """
    Append a measurement snapshot to the pooled sample notes file.

    This function rewrites frontmatter on each append so Last Saved remains accurate.

    Args:
        measurement_path (str | Path): Path to the measurement .zarr folder.
        measurement_notes_body (str): Body of measurement notes (without frontmatter).
        when (datetime | None): Optional timestamp override.

    Returns:
        Dict[str, str]: paths for created/updated note files.

    """
    now = when or datetime.now(timezone.utc)
    path = Path(measurement_path)

    dataset_uuid, _, measurement_notes_path = _measurement_notes_paths(path)
    sample_filename, _, sample_notes_path = _sample_notes_path(
        path,
        sample_path=sample_path,
        sample_name=sample_name,
        cryostat_name=cryostat_name,
    )

    _ensure_notes_file(sample_notes_path, sample_filename)

    with open(sample_notes_path, "r", encoding="utf-8") as f:
        sample_text = f.read()

    existing_body, _, _ = _parse_frontmatter(sample_text)
    if previous_measurement_notes_body is not None:
        incremental_body = _compute_incremental_body(
            previous_measurement_notes_body,
            measurement_notes_body,
        )
    else:
        # Fallback for callers that do not provide previous measurement state.
        last_synced_body = _find_last_synced_measurement_body(existing_body, path)
        incremental_body = _compute_incremental_body(
            last_synced_body,
            measurement_notes_body,
        )

    if not incremental_body:
        return {
            "measurement_path": str(path),
            "measurement_notes_path": str(measurement_notes_path),
            "sample_notes_path": str(sample_notes_path),
            "dataset_uuid": dataset_uuid,
            "appended": "false",
        }

    new_entry = _format_sample_rollup_entry(
        now,
        path,
        measurement_notes_path,
        incremental_body,
    )

    existing_body = existing_body.rstrip()
    if existing_body:
        merged_body = f"{existing_body}\n\n{new_entry}\n"
    else:
        merged_body = f"{new_entry}\n"

    sample_frontmatter = _make_frontmatter(sample_filename, now)
    with open(sample_notes_path, "w", encoding="utf-8") as f:
        f.write(sample_frontmatter + merged_body)

    return {
        "measurement_path": str(path),
        "measurement_notes_path": str(measurement_notes_path),
        "sample_notes_path": str(sample_notes_path),
        "dataset_uuid": dataset_uuid,
        "appended": "true",
    }


@router.post("/load-notes/")
async def load_notes(path: PathData) -> Dict:
    """
    Load notes for a .zarr file at the given path.

    Args:
        path (PathData): Path to the .zarr dataset directory.

    Returns:
        Dict: Notes for the zarr dataset

    """
    # NOTE: Measurement notes are stored in: /.../{dataset_uuid}.zarr/../{dataset_uuid}/{dataset_uuid}.md
    # NOTE: Sample notes are stored in sample folder: /.../{sample}/{cryostat}_{sample}.md
    resolved_path = Path(path.path)

    if path.note_scope == "sample":
        filename, sample_dir, notes_path = _sample_notes_path(
            resolved_path,
            path.sample_path,
            path.sample_name,
            path.cryostat_name,
        )
        frontmatter_filename = filename
    else:
        sample_dir = None
        dataset_uuid, _, notes_path = _measurement_notes_paths(resolved_path)
        frontmatter_filename = dataset_uuid

    logger.debug(
        f"load_notes | POST scope={path.note_scope} path={resolved_path}, notes_path={notes_path}"
    )

    # Measurement notes are DB-backed, with a one-time read-through import from
    # the legacy .md sidecar (then served from the DB).
    if path.note_scope != "sample":
        try:
            db = await asyncio.to_thread(_db_get_note, dataset_uuid)
            if db is not None:
                body, updated = db
                return {
                    "notes": body,
                    "last_saved": updated.isoformat(),
                    "filename": dataset_uuid,
                }
            # Import an existing sidecar once, if present.
            if notes_path.exists() and notes_path.is_file():
                with open(notes_path, "r", encoding="utf-8") as f:
                    file_text = f.read()
                body, last_saved, filename = _parse_frontmatter(file_text)
                await asyncio.to_thread(
                    _db_upsert_note, dataset_uuid, body or "", _parse_iso(last_saved)
                )
                logger.debug(
                    f"load_notes | imported sidecar into DB for {dataset_uuid}"
                )
                return {
                    "notes": body,
                    "last_saved": last_saved,
                    "filename": filename or dataset_uuid,
                }
            # No note yet. Optionally seed an empty .md mirror (file workflow).
            if _MD_EXPORT_ENABLED:
                try:
                    _ensure_notes_file(notes_path, dataset_uuid)
                except Exception:
                    logger.debug(
                        "load_notes | could not seed .md sidecar (DB-only ok)",
                        exc_info=True,
                    )
            return {
                "notes": "",
                "last_saved": None,
                "filename": dataset_uuid,
                "note_scope": "measurement",
                "notes_path": str(notes_path),
            }
        except Exception as e:
            logger.error(f"load_notes | DB error: {str(e)}", exc_info=True)
            return {"notes": "", "error": f"Error loading notes: {str(e)}"}

    try:
        if notes_path.exists() and notes_path.is_file():
            with open(notes_path, "r", encoding="utf-8") as f:
                file_text = f.read()

            body, last_saved, filename = _parse_frontmatter(file_text)

            logger.debug(f"load_notes | Successfully loaded notes from {notes_path}")
            return {"notes": body, "last_saved": last_saved, "filename": filename}

        else:
            # Create a new notes file if it doesn't exist
            logger.debug(
                f"load_notes | No notes file found at {notes_path}, creating new one"
            )
            if path.note_scope == "sample" and sample_dir is not None:
                now = datetime.now(timezone.utc)
                initial_body = _build_initial_sample_pool_body(sample_dir, now)
                notes_path.parent.mkdir(parents=True, exist_ok=True)
                with open(notes_path, "w", encoding="utf-8") as f:
                    f.write(_make_frontmatter(frontmatter_filename, now) + initial_body)
            else:
                _ensure_notes_file(notes_path, frontmatter_filename)
            logger.debug(f"load_notes | Created empty notes file: {notes_path}")

            return {
                "notes": "",
                "last_saved": None,
                "filename": frontmatter_filename,
                "note_scope": path.note_scope,
                "notes_path": str(notes_path),
            }

    except Exception as e:
        logger.error(f"load_notes | Error loading notes: {str(e)}", exc_info=True)
        return {"notes": "", "error": f"Error loading notes: {str(e)}"}


@router.post("/save-notes/")
async def save_notes(data: NotesData) -> Dict:
    """
    Save notes for a .zarr file at the given path.

    Args:
        data (NotesData): Path to the .zarr dataset directory and notes content.

    Returns:
        Dict: Confirmation message

    """
    resolved_path = Path(data.path)

    if data.note_scope == "sample":
        filename, notes_dir, notes_path = _sample_notes_path(
            resolved_path,
            data.sample_path,
            data.sample_name,
            data.cryostat_name,
        )
        frontmatter_filename = filename
    else:
        dataset_uuid, notes_dir, notes_path = _measurement_notes_paths(resolved_path)
        frontmatter_filename = dataset_uuid

    logger.debug(
        f"save_notes | POST scope={data.note_scope} path={resolved_path}, notes_path={notes_path}"
    )

    # Measurement notes: DB is the source of truth. The .md mirror + pooled
    # sample rollup are best-effort and only when QIMCHI_NOTES_MD_EXPORT is on.
    if data.note_scope != "sample":
        now = datetime.now(timezone.utc)
        try:
            prev = await asyncio.to_thread(_db_get_note, dataset_uuid)
            previous_measurement_body = prev[0].rstrip() if prev else None
            await asyncio.to_thread(_db_upsert_note, dataset_uuid, data.notes or "", now)
        except Exception as e:
            logger.error(f"save_notes | DB error: {str(e)}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Error saving notes: {str(e)}")

        frontmatter = _make_frontmatter(dataset_uuid, now)
        sample_rollup = None
        if _MD_EXPORT_ENABLED:
            try:
                notes_dir.mkdir(parents=True, exist_ok=True)
                with open(notes_path, "w", encoding="utf-8") as f:
                    f.write(frontmatter + (data.notes or ""))
                sample_rollup = append_sample_rollup(
                    resolved_path,
                    data.notes or "",
                    now,
                    sample_path=data.sample_path,
                    sample_name=data.sample_name,
                    cryostat_name=data.cryostat_name,
                    previous_measurement_notes_body=previous_measurement_body,
                )
            except Exception:
                logger.warning(
                    "save_notes | .md mirror/rollup failed (DB save succeeded)",
                    exc_info=True,
                )

        logger.debug(f"save_notes | Saved notes to DB for {dataset_uuid}")
        return {
            "message": "Notes saved successfully.",
            "path": str(notes_path),
            "last_saved": now.isoformat(),
            "filename": dataset_uuid,
            "note_scope": "measurement",
            "frontmatter": frontmatter,
            "sample_rollup": sample_rollup,
        }

    try:
        # Create the directory if it doesn't exist
        notes_dir.mkdir(parents=True, exist_ok=True)

        previous_measurement_body = None
        if (
            data.note_scope == "measurement"
            and notes_path.exists()
            and notes_path.is_file()
        ):
            with open(notes_path, "r", encoding="utf-8") as f:
                previous_text = f.read()
            previous_measurement_body, _, _ = _parse_frontmatter(previous_text)
            previous_measurement_body = (previous_measurement_body or "").rstrip()

        # Build frontmatter and write the notes
        now = datetime.now(timezone.utc)
        frontmatter = _make_frontmatter(frontmatter_filename, now)
        to_write = frontmatter + (data.notes or "")

        # Debug logging disabled
        # logger.debug(f"save_notes | Writing frontmatter: {frontmatter!r}")
        # logger.debug(f"save_notes | Writing notes length: {len(data.notes or '')}")

        with open(notes_path, "w", encoding="utf-8") as f:
            f.write(to_write)

        sample_rollup = None
        if data.note_scope == "measurement":
            sample_rollup = append_sample_rollup(
                resolved_path,
                data.notes or "",
                now,
                sample_path=data.sample_path,
                sample_name=data.sample_name,
                cryostat_name=data.cryostat_name,
                previous_measurement_notes_body=previous_measurement_body,
            )

        logger.debug(f"save_notes | Successfully saved notes to {notes_path}")
        return {
            "message": "Notes saved successfully.",
            "path": str(notes_path),
            "last_saved": now.isoformat(),
            "filename": frontmatter_filename,
            "note_scope": data.note_scope,
            "frontmatter": frontmatter,
            "sample_rollup": sample_rollup,
        }

    except Exception as e:
        logger.error(f"save_notes | Error saving notes: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error saving notes: {str(e)}")
