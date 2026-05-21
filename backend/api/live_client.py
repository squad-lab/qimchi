"""
WebSocket client for reading live measurement data from qcutils measurement processes.

This module connects to the WebSocket server running in measurement scripts
and retrieves data from in-memory Zarr stores.

"""

import asyncio
import json
from typing import List, Optional
import xarray as xr

import websockets

# Local imports
from .logger import logger

# Default WebSocket server address
DEFAULT_WS_URL = "ws://localhost:8765"

# Singleton connection
_ws_connection: Optional[object] = None
_ws_lock = asyncio.Lock()


async def _ensure_connection(ws_url: str = DEFAULT_WS_URL):
    """Ensure WebSocket connection is established."""
    global _ws_connection

    async with _ws_lock:
        # Check if connection is valid
        needs_reconnect = _ws_connection is None
        if _ws_connection is not None:
            try:
                # Try to check state - different versions have different attributes
                if hasattr(_ws_connection, "closed"):
                    needs_reconnect = _ws_connection.closed
                elif hasattr(_ws_connection, "close_code"):
                    needs_reconnect = _ws_connection.close_code is not None
                else:
                    # Assume it's closed if we can't check
                    needs_reconnect = True
            except Exception:
                needs_reconnect = True

        if needs_reconnect:
            try:
                # Use a 100 MB limit to match the server side (default is 1 MB).
                _ws_connection = await asyncio.wait_for(
                    websockets.connect(ws_url, max_size=100 * 1024 * 1024), timeout=2.0
                )
                logger.info(f"Connected to live data server at {ws_url}")
            except (asyncio.TimeoutError, ConnectionRefusedError, OSError) as e:
                logger.debug(f"Could not connect to live data server: {e}")
                raise

        return _ws_connection


async def _send_request(request: dict, ws_url: str = DEFAULT_WS_URL) -> dict:
    """
    Send a request to the WebSocket server and get response.

    Args:
        request (dict): dict with request parameters
        ws_url (str): WebSocket server URL

    Returns:
        dict with response data

    """
    global _ws_connection

    try:
        ws = await _ensure_connection(ws_url)

        await ws.send(json.dumps(request))
        response_str = await asyncio.wait_for(ws.recv(), timeout=5.0)
        response = json.loads(response_str)

        return response

    except Exception as e:
        logger.debug(f"WebSocket request failed: {e}")
        # Close connection on error
        if _ws_connection:
            try:
                await _ws_connection.close()
            except Exception:
                pass
        _ws_connection = None
        raise


async def list_live_measurements(ws_url: str = DEFAULT_WS_URL) -> List[str]:
    """
    List all available live measurements.

    Args:
        ws_url (str): WebSocket server URL

    Returns:
        List of measurement IDs currently available in memory

    """
    request = {"action": "list"}
    response = await _send_request(request, ws_url)

    if not response.get("success"):
        raise RuntimeError(f"Failed to list measurements: {response.get('error')}")

    return response.get("measurements", [])


async def get_measurement_info(
    measurement_id: str, ws_url: str = DEFAULT_WS_URL
) -> dict:
    """
    Get metadata and structure info for a measurement.

    Args:
        measurement_id (str): The measurement ID (e.g., "120-98488e30-...")
        ws_url (str): WebSocket server URL

    Returns:
        dict with coords, data_vars, and attrs

    """
    request = {"action": "get_data", "measurement_id": measurement_id}
    response = await _send_request(request, ws_url)

    if not response.get("success"):
        raise RuntimeError(f"Failed to get measurement info: {response.get('error')}")

    return {
        "coords": response.get("coords", []),
        "data_vars": response.get("data_vars", []),
        "attrs": response.get("attrs", {}),
    }


async def get_measurement_data(
    measurement_id: str, variables: List[str], ws_url: str = DEFAULT_WS_URL
) -> dict:
    """
    Get data for specific variables from a measurement.

    Args:
        measurement_id (str): The measurement ID
        variables (List[str]): List of variable names to retrieve
        ws_url (str): WebSocket server URL

    Returns:
        dict mapping variable names to their data arrays

    """
    request = {
        "action": "get_data",
        "measurement_id": measurement_id,
        "variables": variables,
    }
    response = await _send_request(request, ws_url)

    if not response.get("success"):
        raise RuntimeError(f"Failed to get measurement data: {response.get('error')}")

    return response.get("data", {})


async def get_live_snapshot(
    measurement_id: str, ws_url: str = DEFAULT_WS_URL
) -> dict:
    """
    Fetch variable names and all data for a measurement in a single round-trip.

    Args:
        measurement_id (str): The measurement ID.
        ws_url (str): WebSocket server URL.

    Returns:
        dict with keys: coords, data_vars, var_dims, data, attrs.

    """
    request = {"action": "get_snapshot", "measurement_id": measurement_id}
    response = await _send_request(request, ws_url)
    if not response.get("success"):
        raise RuntimeError(
            f"Failed to get snapshot for {measurement_id}: {response.get('error')}"
        )
    return response


async def open_live_dataset(
    measurement_id: str, ws_url: str = DEFAULT_WS_URL
) -> xr.Dataset:
    """
    Open a live measurement as an xarray Dataset via a single WebSocket round-trip.

    Uses the get_snapshot action so variable names and data are fetched atomically,
    eliminating the race between the old two-call approach (get_data for metadata,
    then get_data for arrays).

    Args:
        measurement_id (str): The measurement ID.
        ws_url (str): WebSocket server URL.

    Returns:
        xarray.Dataset with current data from memory.

    """
    import numpy as np

    snapshot = await get_live_snapshot(measurement_id, ws_url)
    coord_names: List[str] = snapshot.get("coords", [])
    data_var_names: List[str] = snapshot.get("data_vars", [])
    var_dims: dict = snapshot.get("var_dims", {})
    data_dict: dict = snapshot.get("data", {})
    attrs: dict = snapshot.get("attrs", {})

    coords = {}
    for name in coord_names:
        if name in data_dict:
            coords[name] = np.array(data_dict[name])

    data_vars = {}
    for name in data_var_names:
        if name in data_dict:
            dims = var_dims.get(name, coord_names)  # fall back to all coords
            data_vars[name] = (dims, np.array(data_dict[name]))

    ds = xr.Dataset(data_vars=data_vars, coords=coords, attrs=attrs)
    logger.debug(
        f"[live_client] snapshot built: {len(ds.data_vars)} vars, "
        f"{len(ds.coords)} coords for {measurement_id}"
    )
    return ds


async def close_connection():
    """
    Close the WebSocket connection.

    """
    global _ws_connection

    if _ws_connection:
        try:
            await _ws_connection.close()
        except Exception:
            pass
        _ws_connection = None
        logger.info("Closed connection to live data server")


def is_live_server_available(ws_url: str = DEFAULT_WS_URL) -> bool:
    """
    Check if the live data server is available.

    Args:
        ws_url (str): WebSocket server URL

    Returns:
        bool: True if server is reachable, False otherwise

    """

    async def check():
        try:
            await _ensure_connection(ws_url)
            return True
        except Exception:
            return False

    try:
        return asyncio.run(check())
    except Exception:
        return False


# Synchronous wrappers for use in synchronous contexts
def open_live_dataset_sync(
    measurement_id: str, ws_url: str = DEFAULT_WS_URL
) -> xr.Dataset:
    """
    Synchronous wrapper for open_live_dataset.

    Args:
        measurement_id (str): The measurement ID
        ws_url (str): WebSocket server URL

    Returns:
        xarray.Dataset with current data from memory

    """
    import concurrent.futures

    # Run async function in thread pool to avoid nested event loop issues
    with concurrent.futures.ThreadPoolExecutor() as executor:
        future = executor.submit(asyncio.run, open_live_dataset(measurement_id, ws_url))
        return future.result(timeout=10)
