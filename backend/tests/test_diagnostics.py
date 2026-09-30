"""Resource sampling, page-error logging, polling filter and the log bundle."""

from __future__ import annotations

import json
import logging
import threading
import time
import zipfile
from pathlib import Path

import pytest

from api import diagnostics


def _group(count: int, private_mb: int) -> dict:
    return {"count": count, "rss": private_mb << 20, "private": private_mb << 20}


def _fake_sample(**overrides) -> dict:
    base = {
        "qimchi": _group(1, 400),
        "workers": _group(4, 800),
        "chrome": _group(9, 1200),
        "webview": _group(6, 600),
        "threads": 40,
        "handles": 900,
        "system": {"available": 8 << 30, "percent": 50.0},
        "gauges": {"plot contexts": 3},
    }
    base.update(overrides)
    return base


def test_a_resource_line_names_each_group_and_the_growth():
    baseline = _fake_sample()
    later = _fake_sample(qimchi=_group(1, 500))

    line = diagnostics.format_sample(later, baseline)

    assert line.startswith("[resources] qimchi 500 MB | workers 4x 800 MB")
    assert "chrome 9x 1.2 GB" in line
    assert "(+100 MB since start)" in line
    assert "threads 40 handles 900" in line
    assert "plot contexts=3" in line


def test_an_unknown_webview_is_reported_as_unavailable_not_zero():
    line = diagnostics.format_sample(_fake_sample(webview=None), None)
    assert "webview unavailable" in line


def test_sampling_this_process_works_and_counts_gauges():
    diagnostics.register_gauge("test items", lambda: 7)
    diagnostics.register_gauge("broken", lambda: 1 / 0)
    try:
        current = diagnostics.sample()
    finally:
        diagnostics._GAUGES.pop("test items", None)
        diagnostics._GAUGES.pop("broken", None)

    assert current["qimchi"]["count"] == 1
    assert current["qimchi"]["private"] > 0
    assert current["gauges"]["test items"] == 7
    assert "broken" not in current["gauges"]


def test_a_missing_macos_lookup_falls_back_without_breaking(monkeypatch):
    monkeypatch.setattr(diagnostics.sys, "platform", "darwin")
    monkeypatch.setattr(diagnostics, "_responsible_pid_state", "unavailable")

    current = diagnostics.sample()

    # No WebView descendants here, so it cannot be measured on macOS.
    assert current["webview"] is None
    assert current["qimchi"]["count"] == 1


def test_a_failing_sample_logs_nothing_and_raises_nothing(monkeypatch):
    def broken():
        raise RuntimeError("psutil is gone")

    monkeypatch.setattr(diagnostics, "sample", broken)
    assert diagnostics._Sampler().snapshot("test") is None


def _access_record(path: str, status: int) -> logging.LogRecord:
    return logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        1,
        '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1:1", "GET", path, "1.1", status),
        None,
    )


def test_polling_is_left_out_of_the_access_log_unless_it_fails():
    quiet = diagnostics.QuietPollingFilter()

    assert not quiet.filter(_access_record("/health", 200))
    assert not quiet.filter(_access_record("/transform-plot", 200))
    assert quiet.filter(_access_record("/health", 500))
    assert quiet.filter(_access_record("/load/", 200))


@pytest.mark.asyncio
async def test_page_errors_are_logged_and_rate_limited(monkeypatch, caplog):
    monkeypatch.setattr(diagnostics, "_client_log_times", diagnostics.deque())
    monkeypatch.setattr(diagnostics, "_CLIENT_LOG_LIMIT", 2)
    diagnostics.frontend_logger.addHandler(caplog.handler)
    try:
        for i in range(3):
            await diagnostics.client_log(
                diagnostics.ClientLog(
                    message=f"boom {i}", stack="at x", source="app.js:1"
                )
            )
    finally:
        diagnostics.frontend_logger.removeHandler(caplog.handler)

    logged = [r.getMessage() for r in caplog.records if r.name == "qimchi.frontend"]
    assert logged == ["boom 0 [app.js:1]\nat x", "boom 1 [app.js:1]\nat x"]


@pytest.mark.asyncio
async def test_a_heap_heartbeat_is_kept_for_the_next_resource_line(monkeypatch):
    monkeypatch.setattr(diagnostics, "_page_heap", {})
    result = await diagnostics.client_log(
        diagnostics.ClientLog(level="info", heap_used=50 << 20, heap_total=80 << 20)
    )
    assert result == {"logged": False}
    assert "page heap 50 MB" in diagnostics.format_sample(
        _fake_sample(page_heap=diagnostics._page_heap), None
    )


@pytest.fixture
def home(tmp_path, monkeypatch):
    home = tmp_path / "home"
    logs = home / "logs"
    logs.mkdir(parents=True)
    for name in ("qimchi.log", "qimchi.log.1", "qimchi_debug.log", "unrelated.txt"):
        (logs / name).write_text(name, encoding="utf-8")
    monkeypatch.setenv("QIMCHI_HOME", str(home))
    monkeypatch.setattr(diagnostics, "LOG_PATH", logs / "qimchi.log")
    return home


def test_the_bundle_holds_the_logs_and_the_system_details(home, tmp_path):
    target = tmp_path / "bundle.zip"

    manifest = diagnostics.build_bundle(target, include_crash_reports=False)

    with zipfile.ZipFile(target) as bundle:
        names = set(bundle.namelist())
        info = json.loads(bundle.read("system-info.json"))
    assert {"logs/qimchi.log", "logs/qimchi.log.1", "logs/qimchi_debug.log"} <= names
    assert "logs/unrelated.txt" not in names
    assert info["bundle"]["logs"] == manifest["logs"]
    assert "platform" in info


def test_crash_reports_are_added_only_when_asked_and_only_recent_ones(home, tmp_path):
    reports = home / "webview" / "EBWebView" / "Crashpad" / "reports"
    reports.mkdir(parents=True)
    (reports / "new.dmp").write_bytes(b"x")
    old = reports / "old.dmp"
    old.write_bytes(b"x")
    two_months_ago = time.time() - 60 * 24 * 3600
    import os

    os.utime(old, (two_months_ago, two_months_ago))

    without = tmp_path / "without.zip"
    diagnostics.build_bundle(without, include_crash_reports=False)
    with zipfile.ZipFile(without) as bundle:
        assert not any(n.startswith("crash-reports/") for n in bundle.namelist())

    with_reports = tmp_path / "with.zip"
    manifest = diagnostics.build_bundle(with_reports, include_crash_reports=True)
    assert manifest["crash_reports"] == ["new.dmp"]


@pytest.mark.asyncio
async def test_the_desktop_app_saves_the_bundle_and_says_where(
    home, tmp_path, monkeypatch
):
    folder = tmp_path / "exports"
    monkeypatch.setenv("QIMCHI_DESKTOP", "1")
    monkeypatch.setenv("QIMCHI_EXPORT_DIR", str(folder))
    from api import settings

    monkeypatch.setattr(settings, "export_settings", lambda: settings.ExportSettings())

    result = await diagnostics.bundle_logs(
        diagnostics.BundleRequest(), diagnostics.BackgroundTasks()
    )

    path = Path(result["path"])
    assert path.parent == folder and path.name.startswith("qimchi-logs-")
    assert zipfile.is_zipfile(path)


def test_uncaught_thread_errors_are_logged(caplog, monkeypatch):
    monkeypatch.setattr(diagnostics, "_hooks_installed", False)
    monkeypatch.setattr(threading, "excepthook", lambda args: None)
    monkeypatch.setattr(diagnostics.sys, "excepthook", lambda *args: None)
    diagnostics.install_exception_hooks()
    diagnostics.logger.propagate = True
    caplog.set_level(logging.ERROR)
    try:
        worker = threading.Thread(target=lambda: 1 / 0, name="doomed")
        worker.start()
        worker.join()
    finally:
        diagnostics.logger.propagate = False

    assert any("thread doomed" in r.getMessage() for r in caplog.records)


def test_the_log_keeps_writing_after_uvicorn_configures_logging(tmp_path, monkeypatch):
    import importlib

    import uvicorn

    monkeypatch.setenv("QIMCHI_LOG_PATH", str(tmp_path / "qimchi.log"))
    from api import logger as logger_module

    fresh = importlib.reload(logger_module)
    try:
        test_logger = fresh.get_logger("qimchi-survival-test")
        # uvicorn applies a dictConfig at startup, which closes every handler.
        uvicorn.Config(lambda: None, log_level="info")
        test_logger.info("written after uvicorn started")
        for handler in test_logger.handlers:
            handler.flush()
        text = (tmp_path / "qimchi.log").read_text(encoding="utf-8")
    finally:
        for handler in list(test_logger.handlers):
            handler.stop_writing()
            test_logger.removeHandler(handler)
        monkeypatch.delenv("QIMCHI_LOG_PATH")
        importlib.reload(logger_module)

    assert "written after uvicorn started" in text
