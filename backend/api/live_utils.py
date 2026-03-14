"""Shared helpers for working with live measurement datasets via SQLite DB."""

from __future__ import annotations

from typing import Dict, Any

from qcutils import live_db

# Local imports
from .logger import logger


def get_live_dataset_entries() -> Dict[str, Dict[str, Any]]:
    """
    Return mapping of measurement ids to live dataset info from SQLite DB.

    Returns:
        Dict mapping measurement_id to dict with keys:
        - fpath: disk path where data is/will be saved
        - ws_url: WebSocket URL for live access
        - ws_port: WebSocket port
        - started_at: ISO timestamp when measurement started
        - ended_at: ISO timestamp when measurement ended (None if still active)

    """
    if not live_db:
        logger.debug("Live database not available")
        return {}

    try:
        live_db.init_database()
        measurements = live_db.get_live_measurements()

        entries: Dict[str, Dict[str, Any]] = {}
        for m in measurements:
            entries[m.measurement_id] = {
                "disk_path": m.fpath,
                "ws_url": m.ws_url,
                "ws_port": m.ws_port,
                "started_at": m.started_at,
                "ended_at": m.ended_at,
            }

        logger.debug(f"Retrieved {len(entries)} live measurements from database")
        return entries
    except Exception as e:
        logger.error(f"Failed to get live measurements from database: {e}")
        return {}


def resolve_live_dataset(measurement_id: str) -> Dict[str, Any]:
    """
    Return live dataset info for a specific measurement id from SQLite DB.

    Args:
        measurement_id (str): Measurement ID to look up

    Returns:
        Dict with keys: disk_path, ws_url, ws_port, live_status, started_at, ended_at
        Returns dict with None values if not found.

    """
    if not live_db:
        logger.debug("Live database not available")
        return {
            "disk_path": None,
            "ws_url": None,
            "ws_port": None,
            "live_status": None,
            "started_at": None,
            "ended_at": None,
        }

    try:
        live_db.init_database()
        measurement = live_db.get_measurement(measurement_id)

        if measurement is None:
            logger.debug(f"Measurement {measurement_id} not found in database")
            return {
                "disk_path": None,
                "ws_url": None,
                "ws_port": None,
                "live_status": None,
                "started_at": None,
                "ended_at": None,
            }

        return {
            "disk_path": measurement.fpath,
            "ws_url": measurement.ws_url,
            "ws_port": measurement.ws_port,
            "live_status": bool(measurement.live_status),
            "started_at": measurement.started_at,
            "ended_at": measurement.ended_at,
        }
    except Exception as e:
        logger.error(f"Failed to get measurement {measurement_id} from database: {e}")
        return {
            "disk_path": None,
            "ws_url": None,
            "ws_port": None,
            "live_status": None,
            "started_at": None,
            "ended_at": None,
        }
