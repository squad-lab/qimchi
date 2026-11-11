"""Slow work behind an endpoint must not stall the event loop."""

import asyncio
import threading
import time
from types import SimpleNamespace

import pytest
import xarray as xr
from fastapi import BackgroundTasks

from api import (
    background,
    diagnostics,
    dirtree,
    download,
    export,
    live,
    live_measurements,
    notes,
)
from api.models import NotesData, PathData, PinnedParametersRequest

BLOCKING_SECONDS = 0.4


def _slow(result):
    def run(*_args, **_kwargs):
        time.sleep(BLOCKING_SECONDS)
        return result

    return run


async def _dataset(_path):
    return xr.Dataset()


class _Request:
    app = SimpleNamespace(state=SimpleNamespace())

    async def json(self):
        return {"plot_json": {"data": [{}]}, "fpath": "/data/run.zarr"}


CASES = {
    "load notes": (
        [(notes, "_load_notes", _slow({}))],
        lambda: notes.load_notes(PathData(path="run.zarr")),
    ),
    "save notes": (
        [(notes, "_save_notes", _slow({}))],
        lambda: notes.save_notes(NotesData(path="run.zarr", notes="text")),
    ),
    "open a folder": (
        [(dirtree, "_load_directory", _slow({}))],
        lambda: dirtree.load_directory(PathData(path="data")),
    ),
    "list live measurements in the Explorer": (
        [(live_measurements, "get_live_measurements", _slow([]))],
        dirtree.load_live_measurements,
    ),
    "list live measurements": (
        [(live_measurements, "get_live_measurements", _slow([]))],
        live_measurements.api_get_live_measurements,
    ),
    "list live measurements for /live": (
        [(live_measurements, "get_live_measurements", _slow([]))],
        live.list_live_measurements,
    ),
    "describe a live measurement": (
        [(live_measurements, "get_measurement_info", _slow(None))],
        lambda: live_measurements.api_get_measurement("run"),
    ),
    "metadata": (
        [
            (dirtree, "_load_dataset_for_metadata", _dataset),
            (dirtree, "_metadata_sections", _slow({})),
        ],
        lambda: dirtree.get_metadata(PathData(path="run.zarr")),
    ),
    "pinned parameters": (
        [
            (dirtree, "_load_dataset_for_metadata", _dataset),
            (dirtree, "_pinned_parameters", _slow({})),
        ],
        lambda: dirtree.get_pinned_parameters(
            PinnedParametersRequest(path="run.zarr", names=["vg"])
        ),
    ),
    "download": (
        [(download, "_download_dataset", _slow(None))],
        lambda: download.download_dataset(PathData(path="run.zarr")),
    ),
    "send to notes": (
        [(export, "_send_to_notes", _slow({}))],
        lambda: export.export_and_send_to_notes(_Request()),
    ),
    "log bundle": (
        [
            (export, "_desktop_export_dir", lambda _folder=None: None),
            (diagnostics, "build_bundle", _slow({})),
        ],
        lambda: diagnostics.bundle_logs(diagnostics.BundleRequest(), BackgroundTasks()),
    ),
}


@pytest.mark.asyncio
@pytest.mark.parametrize("case", CASES)
async def test_slow_work_leaves_the_event_loop_free(case, monkeypatch):
    patches, call = CASES[case]
    for module, name, value in patches:
        monkeypatch.setattr(module, name, value)
    lags: list[float] = []

    async def heartbeat() -> None:
        while True:
            before = time.perf_counter()
            await asyncio.sleep(0.02)
            lags.append(time.perf_counter() - before - 0.02)

    beating = asyncio.create_task(heartbeat())
    await asyncio.sleep(0.05)
    started = time.perf_counter()
    try:
        await call()
    except Exception:
        pass  # Only the event loop matters here, not what the stub returns.
    elapsed = time.perf_counter() - started
    await asyncio.sleep(0.05)
    beating.cancel()

    assert elapsed >= BLOCKING_SECONDS, "the slow stub was not reached"
    assert lags and max(lags) < 0.15, f"the event loop stalled for {max(lags):.2f}s"


def test_background_jobs_are_counted_until_they_finish():
    release = threading.Event()
    seen_inside: list[int] = []

    def job():
        seen_inside.append(background.pending_jobs())
        release.wait(5)

    before = background.pending_jobs()
    future = background.submit(job)
    try:
        assert background.pending_jobs() == before + 1
    finally:
        release.set()
    future.result(timeout=5)

    assert background.pending_jobs() == before
    # A job reading the count (the resource sample) leaves itself out.
    assert seen_inside == [before]


@pytest.mark.asyncio
async def test_the_background_pool_stops_with_the_app(monkeypatch, tmp_path):
    import main

    monkeypatch.setenv("QIMCHI_HOME", str(tmp_path))
    monkeypatch.setenv("QIMCHI_RESOURCE_LOG_INTERVAL", "0")
    # Only the pool is under test: skip the database, Kaleido and export workers.
    monkeypatch.setattr(main, "run_migrations", lambda: None)
    monkeypatch.setattr(main, "seed_local_user", lambda: None)
    monkeypatch.setattr(main.diagnostics, "install_exception_hooks", lambda: None)
    monkeypatch.setattr(
        main.export_render, "start_kaleido_sync_server", lambda _name: False
    )
    monkeypatch.setattr(
        main,
        "ProcessPoolExecutor",
        lambda **_kwargs: SimpleNamespace(shutdown=lambda wait: None),
    )
    monkeypatch.setattr(main, "_enable_kaleido_warmup", False)

    release = threading.Event()
    started = threading.Semaphore(0)

    def job():
        started.release()
        release.wait(5)

    before = background.pending_jobs()
    try:
        async with main.lifespan(main.app):
            running = [background.submit(job) for _ in range(background.MAX_WORKERS)]
            for _ in running:
                assert started.acquire(timeout=5)
            queued = [background.submit(job) for _ in range(2)]
            workers = [
                thread
                for thread in threading.enumerate()
                if thread.name.startswith(background._THREAD_PREFIX)
            ]
    finally:
        release.set()

    assert background.is_shut_down()
    assert all(future.cancelled() for future in queued)
    for future in running:
        future.result(timeout=5)
    for thread in workers:
        thread.join(timeout=5)
    assert not any(thread.is_alive() for thread in workers)
    assert background.pending_jobs() == before
