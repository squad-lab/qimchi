"""
How the backend drives live-registry maintenance.

Reconciliation opens a real WebSocket to every producer it knows about, so it
costs network time and it runs on the path the SPA polls once a second.

"""

import asyncio
import time
from datetime import datetime, timedelta, timezone

import pytest
from qimchi_connect import registry as live_db

from api import data_loader, live, live_measurements


def _record(measurement_id: str = "m-001"):
    """
    Build a live registry record.

    Args:
        measurement_id (str): Identifier for the record.

    Returns:
        live_db.LiveMeasurement: Record shaped like a live producer's row.

    """
    return live_db.LiveMeasurement(
        measurement_id=measurement_id,
        fpath="/data/m-001.nc",
        ws_url="ws://localhost:8765",
        ws_port=8765,
        live_status=True,
        started_at="2026-09-04T10:00:00+00:00",
        ended_at=None,
    )


@pytest.mark.asyncio
async def test_listing_live_measurements_leaves_the_event_loop_free(monkeypatch):
    """
    Maintenance probes producers over the network, and the app runs a single
    uvicorn worker. Called straight from the handler it stalls every other
    request -- plot refreshes included -- for the length of the probe.

    """

    def slow_maintenance(*_args, **_kwargs):
        time.sleep(0.4)
        return live_db.RegistryMaintenanceResult((), 0)

    monkeypatch.setattr(
        live_measurements.live_db, "maintain_registry", slow_maintenance
    )
    monkeypatch.setattr(live_measurements.live_db, "get_live_measurements", list)

    lags: list[float] = []

    async def heartbeat() -> None:
        while True:
            before = time.perf_counter()
            await asyncio.sleep(0.02)
            lags.append(time.perf_counter() - before - 0.02)

    beating = asyncio.create_task(heartbeat())
    await asyncio.sleep(0.05)
    await live.list_live_measurements()
    # Let the heartbeat run again: a stall is only visible on the tick that
    # follows it, and cancelling straight after the handler hides it.
    await asyncio.sleep(0.05)
    beating.cancel()

    assert lags, "the heartbeat never ran"
    assert max(lags) < 0.15, f"the event loop stalled for {max(lags):.2f}s"


def test_live_dataset_entries_survive_a_pass_that_reports_stale_rows(monkeypatch):
    """
    The maintenance result is read for a log line. Reading a field the result
    does not have throws the whole lookup into its own except clause, and the
    Explorer's live branch silently sees no measurements at all.

    """
    monkeypatch.setattr(
        data_loader.live_db,
        "maintain_registry",
        lambda *_args, **_kwargs: live_db.RegistryMaintenanceResult(("gone",), 1),
    )
    monkeypatch.setattr(data_loader.live_db, "init_database", lambda: None)
    monkeypatch.setattr(
        data_loader.live_db, "get_live_measurements", lambda: [_record()]
    )

    entries = data_loader.get_live_dataset_entries()

    assert set(entries) == {"m-001"}
    assert entries["m-001"]["ws_url"] == "ws://localhost:8765"


def test_the_backend_gives_a_probe_enough_time_to_answer(monkeypatch):
    """
    A refused connection to a closed localhost port takes ~2s to come back on
    Windows (~4s via the dual-stack ``localhost`` name). A budget under that
    cannot tell a dead producer from a busy one -- both come back as timeouts.

    """
    budgets: list[float] = []

    def record(*_args, **kwargs):
        budgets.append(kwargs.get("timeout"))
        return live_db.RegistryMaintenanceResult((), 0)

    monkeypatch.setattr(live_measurements.live_db, "maintain_registry", record)
    monkeypatch.setattr(live_measurements.live_db, "get_live_measurements", list)
    monkeypatch.setattr(data_loader.live_db, "maintain_registry", record)
    monkeypatch.setattr(data_loader.live_db, "init_database", lambda: None)
    monkeypatch.setattr(data_loader.live_db, "get_live_measurements", list)

    live_measurements.get_live_measurements()
    data_loader.get_live_dataset_entries()

    assert budgets, "no maintenance pass ran"
    assert min(budgets) >= 2.0, f"probe budget of {min(budgets)}s is too short"


@pytest.mark.asyncio
async def test_a_producer_that_stopped_beating_does_not_reach_the_explorer(tmp_path):
    """
    End to end over the real registry: liveness is decided by the producer's
    heartbeat, and the backend inherits that by calling the same accessor it
    always did.

    """
    live_db.configure_database(tmp_path / "live.db")
    try:
        live_db.register_measurement("beating", None, "ws://localhost:8765", 8765)
        live_db.register_measurement("stopped", None, "ws://localhost:8766", 8766)
        live_db.heartbeat("beating")
        live_db.heartbeat(
            "stopped",
            when=(datetime.now(timezone.utc) - timedelta(seconds=120)).isoformat(),
        )

        listed = await live.list_live_measurements()

        assert [m["id"] for m in listed["measurements"]] == ["beating"]
        assert live_db.get_measurement("stopped").live_status is False
    finally:
        live_db.configure_database(None)
