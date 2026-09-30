"""Tests for application health, export workers, and lifespan handling."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from starlette.responses import FileResponse

import main
from api.shared import db, paths


def test_kaleido_sync_server_start_stop_and_disabled(monkeypatch):
    calls = []
    fake = SimpleNamespace(
        start_sync_server=lambda **kwargs: calls.append(("start", kwargs)),
        stop_sync_server=lambda: calls.append("stop"),
    )
    monkeypatch.setitem(__import__("sys").modules, "kaleido", fake)
    monkeypatch.setattr(main, "_enable_kaleido_sync_server", True)
    monkeypatch.setattr(main.export, "export_page_generator", lambda: "font-page")

    assert main._start_kaleido_sync_server("test") is True
    main._stop_kaleido_sync_server("test")
    assert calls == [("start", {"page_generator": "font-page"}), "stop"]

    monkeypatch.setattr(main, "_enable_kaleido_sync_server", False)
    assert main._start_kaleido_sync_server("test") is False
    main._stop_kaleido_sync_server("test")
    assert calls == [("start", {"page_generator": "font-page"}), "stop"]


def test_kaleido_sync_server_failures_are_nonfatal(monkeypatch):
    fake = SimpleNamespace(
        start_sync_server=lambda **_kwargs: (_ for _ in ()).throw(
            RuntimeError("start")
        ),
        stop_sync_server=lambda: (_ for _ in ()).throw(RuntimeError("stop")),
    )
    monkeypatch.setitem(__import__("sys").modules, "kaleido", fake)
    monkeypatch.setattr(main, "_enable_kaleido_sync_server", True)
    monkeypatch.setattr(main.export, "export_page_generator", lambda: "font-page")

    assert main._start_kaleido_sync_server("test") is False
    main._stop_kaleido_sync_server("test")


def test_warm_export_pool_counts_success_and_ignores_task_failures():
    class Future:
        def __init__(self, value=None, error=None):
            self.value = value
            self.error = error

        def result(self, timeout):
            assert timeout == 120
            if self.error:
                raise self.error
            return self.value

    pool = SimpleNamespace(
        submit=lambda _fn: [
            Future(0.5),
            Future(error=RuntimeError("chrome missing")),
        ].pop(0)
    )
    futures = iter([Future(0.5), Future(error=RuntimeError("chrome missing"))])
    pool.submit = lambda _fn: next(futures)

    main._warm_export_pool(pool, 2)

    broken_pool = SimpleNamespace(
        submit=lambda _fn: (_ for _ in ()).throw(RuntimeError("closed"))
    )
    main._warm_export_pool(broken_pool, 1)


def test_init_export_worker_registers_shutdown_only_after_start(monkeypatch):
    registrations = []
    monkeypatch.setattr(main, "_start_kaleido_sync_server", lambda _context: True)
    monkeypatch.setattr(
        main.atexit,
        "register",
        lambda function, context: registrations.append((function, context)),
    )

    main._init_export_worker()

    assert registrations == [(main._stop_kaleido_sync_server, "export-worker")]


@pytest.mark.asyncio
async def test_health_reports_database_status(monkeypatch):
    monkeypatch.setattr(main, "db_status", lambda: (False, "migration failed"))
    assert await main.export_health() == {
        "ok": True,
        "id": "qimchi",
        "dbReady": False,
        "dbError": "migration failed",
    }


@pytest.mark.asyncio
async def test_lifespan_initializes_and_shuts_down_services(monkeypatch):
    events = []

    class Pool:
        def __init__(self, **kwargs):
            events.append(("pool", kwargs))

        def shutdown(self, wait):
            events.append(("shutdown", wait))

    class Thread:
        def __init__(self, **kwargs):
            events.append(("thread", kwargs["name"], kwargs["daemon"]))

        def start(self):
            events.append("thread-start")

    monkeypatch.setattr(main, "run_migrations", lambda: events.append("migrate"))
    monkeypatch.setattr(main, "seed_local_user", lambda: events.append("seed"))
    monkeypatch.setattr(
        main, "set_db_status", lambda ready, error: events.append(("db", ready, error))
    )
    monkeypatch.setattr(main, "_start_kaleido_sync_server", lambda _context: True)
    monkeypatch.setattr(
        main,
        "_stop_kaleido_sync_server",
        lambda context: events.append(("stop", context)),
    )
    monkeypatch.setattr(main, "ProcessPoolExecutor", Pool)
    monkeypatch.setattr(main, "threading", SimpleNamespace(Thread=Thread))
    monkeypatch.setattr(main, "_enable_kaleido_warmup", True)
    monkeypatch.setattr(main, "_export_max_workers_env", "2")
    app = FastAPI()

    async with main.lifespan(app):
        assert app.state.kaleido_sync_started is True
        assert hasattr(app.state, "export_pool")

    assert "migrate" in events and "seed" in events
    assert ("db", True, None) in events
    assert ("shutdown", True) in events
    assert ("stop", "api-process") in events


@pytest.mark.asyncio
async def test_lifespan_degrades_on_database_and_pool_failures(monkeypatch):
    statuses = []
    monkeypatch.setattr(
        main, "run_migrations", lambda: (_ for _ in ()).throw(RuntimeError("bad db"))
    )
    monkeypatch.setattr(
        main, "set_db_status", lambda ready, error: statuses.append((ready, error))
    )
    monkeypatch.setattr(main, "_start_kaleido_sync_server", lambda _context: False)
    monkeypatch.setattr(
        main,
        "ProcessPoolExecutor",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("no processes")),
    )
    app = FastAPI()

    async with main.lifespan(app):
        pass

    assert statuses == [(False, "RuntimeError: bad db")]


def test_database_guard_and_path_overrides(tmp_path, monkeypatch):
    db.set_db_status(False, "broken")
    with pytest.raises(HTTPException) as exc:
        db.require_db()
    assert exc.value.status_code == 503
    assert "broken" in exc.value.detail

    db.set_db_status(True, None)
    assert db.require_db() is None

    home = tmp_path / "home"
    monkeypatch.setenv("QIMCHI_HOME", str(home))
    monkeypatch.delenv("QIMCHI_DB_PATH", raising=False)
    assert paths.qimchi_home() == home
    assert paths.db_path() == home / "qimchi.db"

    exact = tmp_path / "database" / "custom.sqlite"
    monkeypatch.setenv("QIMCHI_DB_PATH", str(exact))
    assert paths.db_path() == exact
    assert exact.parent.is_dir()


def test_root_and_root_asset_handlers(monkeypatch, tmp_path):
    root_endpoint = next(
        route.endpoint
        for route in main.app.routes
        if getattr(route, "path", None) == "/"
    )
    logo_endpoint = next(
        route.endpoint
        for route in main.app.routes
        if getattr(route, "path", None) == "/qimchi-logo.png"
    )
    index = tmp_path / "index.html"
    logo = tmp_path / "qimchi-logo.png"
    index.write_text("<html></html>", encoding="utf-8")
    logo.write_bytes(b"png")
    monkeypatch.setattr(main, "frontend_dist_path", str(tmp_path))

    index_response = __import__("asyncio").run(root_endpoint())
    logo_response = __import__("asyncio").run(logo_endpoint())
    assert isinstance(index_response, FileResponse)
    assert index_response.headers["cache-control"].startswith("no-store")
    assert isinstance(logo_response, FileResponse)

    logo.unlink()
    with pytest.raises(HTTPException) as exc:
        __import__("asyncio").run(logo_endpoint())
    assert exc.value.status_code == 404

    index.unlink()
    assert "error" in __import__("asyncio").run(root_endpoint())
