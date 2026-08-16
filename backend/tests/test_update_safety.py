"""
Regression tests for the auto-update path.

Two hazards, both of which leave a *working* app broken after an update:

1. The backend logs into its own installation directory when frozen. The
   rotating handler holds ``qimchi.log`` + a ``.__qimchi.lock`` sidecar open, so
   the silent installer cannot replace files there (and a machine-wide install
   is read-only anyway).
2. index.html gets cached. Vite content-hashes the assets, so a stale shell
   points at filenames the new build no longer ships.

"""

import importlib
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


# --------------------------------------------------------------------------- #
# 1. Log location
# --------------------------------------------------------------------------- #
def _reload_logger():
    import api.logger

    return importlib.reload(api.logger)


def test_dev_run_logs_into_the_backend_tree(monkeypatch):
    monkeypatch.delenv("QIMCHI_LOG_PATH", raising=False)
    monkeypatch.delenv("QIMCHI_DESKTOP", raising=False)
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    mod = _reload_logger()
    assert mod.LOG_PATH.parent.name == "backend"


def test_desktop_run_logs_into_the_app_home_not_the_install_dir(monkeypatch, tmp_path):
    """The fix: a frozen/desktop run must not write into its own program files."""
    monkeypatch.delenv("QIMCHI_LOG_PATH", raising=False)
    monkeypatch.setenv("QIMCHI_DESKTOP", "1")
    monkeypatch.setenv("QIMCHI_HOME", str(tmp_path / "home"))
    mod = _reload_logger()
    assert mod.LOG_PATH == tmp_path / "home" / "logs" / "qimchi.log"
    assert "backend" not in str(mod.LOG_PATH.parent)


def test_log_path_env_override_wins(monkeypatch, tmp_path):
    monkeypatch.setenv("QIMCHI_LOG_PATH", str(tmp_path / "custom" / "q.log"))
    monkeypatch.setenv("QIMCHI_DESKTOP", "1")
    mod = _reload_logger()
    assert mod.LOG_PATH == tmp_path / "custom" / "q.log"
    assert mod.LOG_PATH.parent.is_dir()


@pytest.fixture(autouse=True)
def _restore_logger():
    yield
    for var in ("QIMCHI_LOG_PATH", "QIMCHI_DESKTOP", "QIMCHI_HOME"):
        os.environ.pop(var, None)
    _reload_logger()


# --------------------------------------------------------------------------- #
# 2. index.html must not be cached
# --------------------------------------------------------------------------- #
def test_index_html_is_served_uncacheable():
    """
    A cached shell survives an update and references deleted hashed assets.
    """
    import main

    with TestClient(main.app) as client:
        resp = client.get("/")
        if resp.status_code != 200 or "text/html" not in resp.headers.get(
            "content-type", ""
        ):
            pytest.skip("frontend/dist not built; static serving disabled")
        cache_control = resp.headers.get("cache-control", "")
        assert "no-store" in cache_control, cache_control


def test_launcher_and_backend_agree_on_the_app_home(monkeypatch, tmp_path):
    """
    The launcher owns ~/.qimchi (WebView profile, debug log, update marker) and
    the backend owns the DB and app log. If only one honours QIMCHI_HOME they
    split across two directories.
    """
    import importlib.util

    launcher_path = (
        Path(__file__).resolve().parents[2] / "packaging" / "qimchi_launcher.py"
    )
    if not launcher_path.exists():
        pytest.skip("launcher not present")

    spec = importlib.util.spec_from_file_location("qimchi_launcher", launcher_path)
    launcher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(launcher)

    from api.shared import paths

    home = tmp_path / "shared_home"
    monkeypatch.setenv("QIMCHI_HOME", str(home))
    monkeypatch.delenv("QIMCHI_DB_PATH", raising=False)

    assert Path(launcher._qimchi_home()) == paths.qimchi_home()
    assert paths.db_path().parent == Path(launcher._qimchi_home())


def test_hashed_assets_referenced_by_index_actually_exist():
    """
    Guards the failure mode directly: every /assets/ URL the shell references
    must be present in dist. If a stale index.html is ever served, this is
    exactly what breaks.
    """
    import re

    dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    index = dist / "index.html"
    if not index.exists():
        pytest.skip("frontend/dist not built")
    html = index.read_text(encoding="utf-8")
    refs = re.findall(r'(?:src|href)="(/assets/[^"]+)"', html)
    assert refs, "index.html references no hashed assets -- unexpected"
    missing = [r for r in refs if not (dist / r.lstrip("/")).exists()]
    assert not missing, f"index.html points at missing assets: {missing}"


# --------------------------------------------------------------------------- #
# 3. Log consolidation + preservation
# --------------------------------------------------------------------------- #
def test_logs_are_consolidated_under_the_app_home(monkeypatch, tmp_path):
    """App log and the launcher's debug log must share one logs/ directory."""
    monkeypatch.delenv("QIMCHI_LOG_PATH", raising=False)
    monkeypatch.setenv("QIMCHI_DESKTOP", "1")
    monkeypatch.setenv("QIMCHI_HOME", str(tmp_path / "home"))

    mod = _reload_logger()
    assert mod.LOG_PATH == tmp_path / "home" / "logs" / "qimchi.log"

    import importlib.util

    launcher_path = (
        Path(__file__).resolve().parents[2] / "packaging" / "qimchi_launcher.py"
    )
    spec = importlib.util.spec_from_file_location("qimchi_launcher", launcher_path)
    launcher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(launcher)

    debug_log = Path(launcher._log_path())
    assert debug_log.parent == mod.LOG_PATH.parent, "logs are not consolidated"


def test_debug_log_is_appended_not_truncated(monkeypatch, tmp_path):
    """
    The regression that mattered: the log was opened with mode "w", so the
    session that just crashed was wiped by the restart used to investigate it.
    """
    monkeypatch.setenv("QIMCHI_HOME", str(tmp_path / "home"))
    import importlib.util

    launcher_path = (
        Path(__file__).resolve().parents[2] / "packaging" / "qimchi_launcher.py"
    )
    spec = importlib.util.spec_from_file_location("qimchi_launcher", launcher_path)
    launcher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(launcher)

    path = launcher._log_path()

    handle = launcher._open_log_file(path)
    handle.write("first session marker\n")
    handle.close()

    handle = launcher._open_log_file(path)  # simulates the next launch
    handle.write("second session marker\n")
    handle.close()

    text = Path(path).read_text(encoding="utf-8", errors="replace")
    assert "first session marker" in text, "previous session was wiped"
    assert "second session marker" in text
    assert text.count("Qimchi session started") == 2


def test_legacy_logs_are_migrated_into_logs_dir(monkeypatch, tmp_path):
    """A log written before consolidation must not be orphaned."""
    home = tmp_path / "home"
    home.mkdir(parents=True)
    (home / "qimchi_debug.log").write_text("old history\n", encoding="utf-8")
    monkeypatch.setenv("QIMCHI_HOME", str(home))

    import importlib.util

    launcher_path = (
        Path(__file__).resolve().parents[2] / "packaging" / "qimchi_launcher.py"
    )
    spec = importlib.util.spec_from_file_location("qimchi_launcher", launcher_path)
    launcher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(launcher)

    moved = Path(launcher._log_path())
    assert moved == home / "logs" / "qimchi_debug.log"
    assert "old history" in moved.read_text(encoding="utf-8")
    assert not (home / "qimchi_debug.log").exists()


def test_module_loggers_reach_the_consolidated_file(monkeypatch, tmp_path):
    """api.updater / api.live_measurements use logging.getLogger(__name__)."""
    import logging

    monkeypatch.delenv("QIMCHI_LOG_PATH", raising=False)
    monkeypatch.setenv("QIMCHI_DESKTOP", "1")
    monkeypatch.setenv("QIMCHI_HOME", str(tmp_path / "home"))

    mod = _reload_logger()
    logging.getLogger("api.updater").info("updater probe message")
    for handler in logging.getLogger().handlers:
        handler.flush()

    assert "updater probe message" in mod.LOG_PATH.read_text(
        encoding="utf-8", errors="replace"
    )
