"""Endpoints that expose information about live measurements via SQLite DB."""

from __future__ import annotations

from typing import Dict, List

from fastapi import APIRouter, HTTPException

# Local imports
from . import live_measurements

router = APIRouter(prefix="/live", tags=["live"])


@router.get("/measurements")
async def list_live_measurements() -> Dict[str, object]:
    """Return all active live measurements from SQLite DB."""
    measurements = live_measurements.get_live_measurements()

    results: List[Dict[str, object]] = []
    for m in measurements:
        entry: Dict[str, object] = {
            "id": m.measurement_id,
            "path": f"memory://{m.measurement_id}",
            "diskPath": m.fpath,
            "ws_url": m.ws_url,
            "ws_port": m.ws_port,
            "started_at": m.started_at,
            "ended_at": m.ended_at,
            "live_status": m.live_status,
        }
        results.append(entry)

    return {"count": len(results), "measurements": results}


@router.get("/measurements/{measurement_id}")
async def get_live_measurement(measurement_id: str) -> Dict[str, object]:
    """Return detailed information about a specific live measurement from SQLite DB."""
    measurement = live_measurements.get_measurement_info(measurement_id)

    if not measurement:
        raise HTTPException(
            status_code=404,
            detail=f"Live dataset {measurement_id} not found in database",
        )

    return {
        "id": measurement.measurement_id,
        "path": f"memory://{measurement.measurement_id}",
        "diskPath": measurement.fpath,
        "ws_url": measurement.ws_url,
        "ws_port": measurement.ws_port,
        "started_at": measurement.started_at,
        "ended_at": measurement.ended_at,
        "live_status": measurement.live_status,
    }
