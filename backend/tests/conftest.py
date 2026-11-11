from concurrent.futures import wait

import pytest
from qimchi_connect import registry as live_registry

from api import data_loader


@pytest.fixture(autouse=True)
def _isolated_live_registry(tmp_path_factory):
    """Keep tests out of the developer's live-measurement registry."""
    live_registry.configure_database(
        tmp_path_factory.mktemp("live-registry") / "live_measurements.db"
    )
    yield
    live_registry.configure_database(None)


def wait_for_live_maintenance() -> None:
    """Wait for the live-registry maintenance pass now running, if any."""
    if data_loader._maintenance is not None:
        wait([data_loader._maintenance], timeout=30)


@pytest.fixture(autouse=True)
def _fresh_live_state():
    """Reset process-wide live caches between tests."""
    data_loader._last_maintenance = 0.0
    data_loader._maintenance = None
    data_loader._live_polls.clear()
    data_loader._live_poll_results.clear()
    yield
    # Let a pass started by the test finish before the registry is swapped
    # back, so it cannot touch the developer's own.
    wait_for_live_maintenance()
    data_loader._last_maintenance = 0.0
    data_loader._maintenance = None
    data_loader._live_polls.clear()
    data_loader._live_poll_results.clear()
