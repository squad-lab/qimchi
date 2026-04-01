"""
SQLite database for tracking live measurements across processes.

This module provides a centralized database for tracking active measurements,
allowing the FastAPI backend to discover live measurements and their WebSocket
endpoints without requiring shared memory.

# NOTE: Keep in sync with `qcutils.shared.live_db`
# TODO: Make this a separate package to avoid code duplication.

"""

import sqlite3
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

# Local imports
# from qcutils.logger import get_logger
from ..logger import get_logger

logger = get_logger(__name__)

# Global database path
_DB_PATH: Optional[Path] = None
_DB_LOCK = threading.Lock()


@dataclass
class LiveMeasurement:
    """Information about a live measurement."""

    measurement_id: str
    fpath: str  # Disk path where data will be saved
    ws_url: str  # WebSocket URL (e.g., ws://localhost:8765)
    ws_port: int  # WebSocket port number
    live_status: bool  # True if measurement is currently running
    started_at: str  # ISO format timestamp
    ended_at: Optional[str] = None  # ISO format timestamp when measurement ended


def _get_db_path() -> Path:
    """Get the path to the live measurements database."""
    global _DB_PATH

    if _DB_PATH is not None:
        return _DB_PATH

    # Use ~/.qcutils/live_measurements.db
    db_dir = Path.home() / ".qcutils"
    db_dir.mkdir(parents=True, exist_ok=True)

    _DB_PATH = db_dir / "live_measurements.db"
    return _DB_PATH


@contextmanager
def _get_connection():
    """Get a database connection with proper locking."""
    with _DB_LOCK:
        db_path = _get_db_path()
        conn = sqlite3.connect(str(db_path), timeout=10.0)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def init_database():
    """Initialize the database schema."""
    with _get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS live_measurements (
                measurement_id TEXT PRIMARY KEY,
                fpath TEXT NOT NULL,
                ws_url TEXT NOT NULL,
                ws_port INTEGER NOT NULL,
                live_status BOOLEAN NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT
            )
        """
        )
        # Create index for quick lookups
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_live_status 
            ON live_measurements(live_status)
        """
        )
        logger.debug(f"Initialized live measurements database at {_get_db_path()}")


def register_measurement(
    measurement_id: str,
    fpath: str,
    ws_url: str,
    ws_port: int,
    started_at: str,
) -> None:
    """
    Register a new live measurement.

    Args:
        measurement_id: Unique measurement ID
        fpath: Disk path where data will be saved
        ws_url: WebSocket URL for accessing live data
        ws_port: WebSocket port number
        started_at: ISO format timestamp when measurement started
    """
    with _get_connection() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO live_measurements 
            (measurement_id, fpath, ws_url, ws_port, live_status, started_at, ended_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
            (measurement_id, fpath, ws_url, ws_port, True, started_at, None),
        )
    logger.debug(f"Registered live measurement {measurement_id} at {ws_url}")


def end_measurement(measurement_id: str, ended_at: str) -> None:
    """
    Mark a measurement as ended.

    Args:
        measurement_id: Measurement ID to mark as ended
        ended_at: ISO format timestamp when measurement ended
    """
    with _get_connection() as conn:
        conn.execute(
            """
            UPDATE live_measurements 
            SET live_status = ?, ended_at = ?
            WHERE measurement_id = ?
        """,
            (False, ended_at, measurement_id),
        )
    logger.debug(f"Marked measurement {measurement_id} as ended")


def update_measurement_path(measurement_id: str, fpath: str) -> None:
    """
    Update the persisted disk path for a measurement.

    Args:
        measurement_id: Measurement ID to update
        fpath: New disk path

    """
    with _get_connection() as conn:
        conn.execute(
            """
            UPDATE live_measurements
            SET fpath = ?
            WHERE measurement_id = ?
        """,
            (fpath, measurement_id),
        )
    logger.debug(f"Updated measurement {measurement_id} path to {fpath}")


def get_live_measurements() -> List[LiveMeasurement]:
    """
    Get all currently live measurements.

    Returns:
        List of LiveMeasurement objects for active measurements
    """
    with _get_connection() as conn:
        cursor = conn.execute(
            """
            SELECT measurement_id, fpath, ws_url, ws_port, live_status, started_at, ended_at
            FROM live_measurements
            WHERE live_status = ?
            ORDER BY started_at DESC
        """,
            (True,),
        )

        measurements = []
        for row in cursor:
            measurements.append(
                LiveMeasurement(
                    measurement_id=row["measurement_id"],
                    fpath=row["fpath"],
                    ws_url=row["ws_url"],
                    ws_port=row["ws_port"],
                    live_status=bool(row["live_status"]),
                    started_at=row["started_at"],
                    ended_at=row["ended_at"],
                )
            )

        return measurements


def get_all_measurements() -> List[LiveMeasurement]:
    """
    Get all measurements (both live and ended).

    Returns:
        List of LiveMeasurement objects
    """
    with _get_connection() as conn:
        cursor = conn.execute(
            """
            SELECT measurement_id, fpath, ws_url, ws_port, live_status, started_at, ended_at
            FROM live_measurements
            ORDER BY started_at DESC
        """
        )

        measurements = []
        for row in cursor:
            measurements.append(
                LiveMeasurement(
                    measurement_id=row["measurement_id"],
                    fpath=row["fpath"],
                    ws_url=row["ws_url"],
                    ws_port=row["ws_port"],
                    live_status=bool(row["live_status"]),
                    started_at=row["started_at"],
                    ended_at=row["ended_at"],
                )
            )

        return measurements


def get_measurement(measurement_id: str) -> Optional[LiveMeasurement]:
    """
    Get information about a specific measurement.

    Args:
        measurement_id: Measurement ID to look up

    Returns:
        LiveMeasurement object if found, None otherwise
    """
    with _get_connection() as conn:
        cursor = conn.execute(
            """
            SELECT measurement_id, fpath, ws_url, ws_port, live_status, started_at, ended_at
            FROM live_measurements
            WHERE measurement_id = ?
        """,
            (measurement_id,),
        )

        row = cursor.fetchone()
        if row is None:
            return None

        return LiveMeasurement(
            measurement_id=row["measurement_id"],
            fpath=row["fpath"],
            ws_url=row["ws_url"],
            ws_port=row["ws_port"],
            live_status=bool(row["live_status"]),
            started_at=row["started_at"],
            ended_at=row["ended_at"],
        )


def cleanup_old_measurements(days: int = 7) -> int:
    """
    Remove old measurement records from database.

    Args:
        days: Remove measurements older than this many days

    Returns:
        Number of records deleted
    """
    with _get_connection() as conn:
        cursor = conn.execute(
            """
            DELETE FROM live_measurements
            WHERE live_status = ? 
            AND datetime(ended_at) < datetime('now', '-' || ? || ' days')
        """,
            (False, days),
        )
        deleted = cursor.rowcount
        if deleted > 0:
            logger.debug(f"Cleaned up {deleted} old measurement records")
        return deleted
