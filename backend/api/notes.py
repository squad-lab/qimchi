"""
FastAPI endpoints for loading and saving notes associated with .zarr datasets.

"""

import re
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict
from fastapi import APIRouter, HTTPException

# Local imports
from .models import PathData, NotesData
from .logger import logger

router = APIRouter()


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


@router.post("/load-notes/")
async def load_notes(path: PathData) -> Dict:
    """
    Load notes for a .zarr file at the given path.

    Args:
        path (PathData): Path to the .zarr dataset directory.

    Returns:
        Dict: Notes for the zarr dataset

    """
    # NOTE: The notes are stored in the folder with the same name without the .zarr extension
    # NOTE: The filepath is expected to be like: /path/to/{dataset_uuid}.zarr/../{dataset_uuid}/{dataset_uuid}.md
    path = Path(path.path)

    # Get the dataset UUID without ext from the .zarr folder name
    dataset_uuid = path.stem

    # Navigate to parent directory, then to the UUID folder, then to the .md file
    notes_path = path.parent / dataset_uuid / f"{dataset_uuid}.md"

    logger.debug(f"load_notes | POST path={path}, notes_path={notes_path}")

    try:
        if notes_path.exists() and notes_path.is_file():
            with open(notes_path, "r", encoding="utf-8") as f:
                file_text = f.read()

            body, last_saved, filename = _parse_frontmatter(file_text)

            logger.debug(f"load_notes | Successfully loaded notes from {notes_path}")
            return {"notes": body, "last_saved": last_saved, "filename": filename}

        else:
            # Create a new directory + notes file if it doesn't exist
            logger.debug(
                f"load_notes | No notes file found at {notes_path}, creating new one"
            )
            notes_dir = notes_path.parent
            notes_dir.mkdir(parents=True, exist_ok=True)
            logger.debug(f"load_notes | Created directory: {notes_dir}")

            # Create an empty notes file with frontmatter
            fm = _make_frontmatter(dataset_uuid, datetime.now(timezone.utc))
            with open(notes_path, "w", encoding="utf-8") as f:
                f.write(fm + "")
            logger.debug(f"load_notes | Created empty notes file: {notes_path}")

            return {"notes": "", "last_saved": None, "filename": dataset_uuid}

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
    # NOTE: The notes are stored in the folder with the same name without the .zarr extension
    # NOTE: The filepath is expected to be like: /path/to/{dataset_uuid}.zarr/../{dataset_uuid}/{dataset_uuid}.md
    path = Path(data.path)

    # Get the dataset UUID without ext from the .zarr folder name
    dataset_uuid = path.stem

    # Navigate to parent directory, then to the UUID folder, then to the .md file
    notes_dir = path.parent / dataset_uuid
    notes_path = notes_dir / f"{dataset_uuid}.md"

    logger.debug(f"save_notes | POST path={path}, notes_path={notes_path}")

    try:
        # Create the directory if it doesn't exist
        notes_dir.mkdir(parents=True, exist_ok=True)

        # Build frontmatter and write the notes
        now = datetime.now(timezone.utc)
        frontmatter = _make_frontmatter(dataset_uuid, now)
        to_write = frontmatter + (data.notes or "")

        # Debug logging disabled
        # logger.debug(f"save_notes | Writing frontmatter: {frontmatter!r}")
        # logger.debug(f"save_notes | Writing notes length: {len(data.notes or '')}")

        with open(notes_path, "w", encoding="utf-8") as f:
            f.write(to_write)

        logger.debug(f"save_notes | Successfully saved notes to {notes_path}")
        return {
            "message": "Notes saved successfully.",
            "path": str(notes_path),
            "last_saved": now.isoformat(),
            "filename": dataset_uuid,
            "frontmatter": frontmatter,
        }

    except Exception as e:
        logger.error(f"save_notes | Error saving notes: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error saving notes: {str(e)}")
