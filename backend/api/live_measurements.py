"""
API endpoints for querying live measurement database.

"""

import logging
from typing import List, Optional
from fastapi import APIRouter
from pydantic import BaseModel

# Local imports
from .shared import live_db

logger = logging.getLogger(__name__)

router = APIRouter()

logger.info("Live database support available")


class LiveMeasurementInfo(BaseModel):
    """
    Information about a live measurement.

    """

    measurement_id: str
    fpath: str
    ws_url: str
    ws_port: int
    live_status: bool
    started_at: str
    ended_at: Optional[str] = None


def get_live_measurements() -> List[LiveMeasurementInfo]:
    """
    Get all currently live measurements from database.

    Returns:
        List of LiveMeasurementInfo for active measurements

    """
    if not live_db:
        logger.debug("Live database not available")
        return []

    try:
        # Ensure database is initialized
        live_db.init_database()

        measurements = live_db.get_live_measurements()
        logger.info(f"Found {len(measurements)} live measurements in database")

        return [
            LiveMeasurementInfo(
                measurement_id=m.measurement_id,
                fpath=m.fpath,
                ws_url=m.ws_url,
                ws_port=m.ws_port,
                live_status=m.live_status,
                started_at=m.started_at,
                ended_at=m.ended_at,
            )
            for m in measurements
        ]
    except Exception as e:
        logger.error(f"Error querying live measurements: {e}", exc_info=True)
        return []


def get_measurement_info(measurement_id: str) -> Optional[LiveMeasurementInfo]:
    """
    Get information about a specific measurement.

    Args:
        measurement_id: Measurement ID to look up

    Returns:
        LiveMeasurementInfo if found, None otherwise

    """
    if not live_db:
        logger.debug("Live database not available")
        return None

    try:
        # Ensure database is initialized
        live_db.init_database()

        m = live_db.get_measurement(measurement_id)
        if m is None:
            logger.debug(f"Measurement {measurement_id} not found in database")
            return None

        logger.info(
            f"Found measurement {measurement_id} in database: live_status={m.live_status}, fpath={m.fpath}"
        )

        return LiveMeasurementInfo(
            measurement_id=m.measurement_id,
            fpath=m.fpath,
            ws_url=m.ws_url,
            ws_port=m.ws_port,
            live_status=m.live_status,
            started_at=m.started_at,
            ended_at=m.ended_at,
        )
    except Exception as e:
        logger.error(f"Error querying measurement {measurement_id}: {e}", exc_info=True)
        return None


# API endpoints
@router.get("/live-measurements/")
async def api_get_live_measurements():
    """
    Get all currently live measurements.

    """
    measurements = get_live_measurements()
    return {
        "success": True,
        "measurements": measurements,
        "count": len(measurements),
    }


@router.get("/live-measurements/{measurement_id}")
async def api_get_measurement(measurement_id: str):
    """
    Get information about a specific measurement.

    """
    info = get_measurement_info(measurement_id)
    if info is None:
        return {
            "success": False,
            "error": f"Measurement {measurement_id} not found",
        }

    return {
        "success": True,
        "measurement": info,
    }
