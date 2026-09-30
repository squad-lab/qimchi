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


@pytest.fixture(autouse=True)
def _fresh_live_state():
    """Reset process-wide live caches between tests."""
    data_loader._last_maintenance = 0.0
    data_loader._live_polls.clear()
    data_loader._live_poll_results.clear()
    yield
    data_loader._last_maintenance = 0.0
    data_loader._live_polls.clear()
    data_loader._live_poll_results.clear()
