"""Tests for export rendering helpers and asynchronous task endpoints."""

from __future__ import annotations

import json
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image
from starlette.responses import FileResponse

from api import export


class FakeRequest:
    def __init__(self, payload, export_pool=None):
        self._payload = payload
        self.app = SimpleNamespace(state=SimpleNamespace())
        if export_pool is not None:
            self.app.state.export_pool = export_pool

    async def json(self):
        return self._payload


def _json(response):
    return json.loads(response.body)


@pytest.fixture(autouse=True)
def _clear_tasks():
    export._export_tasks.clear()
    yield
    export._export_tasks.clear()


def test_cleanup_old_tasks_removes_file_and_keeps_recent(tmp_path):
    old_zip = tmp_path / "old.zip"
    old_zip.write_bytes(b"zip")
    export._export_tasks.update(
        {
            "old": {
                "created_at": datetime.now() - timedelta(minutes=6),
                "zip_path": str(old_zip),
            },
            "new": {"created_at": datetime.now(), "zip_path": None},
        }
    )

    export._cleanup_old_tasks()

    assert set(export._export_tasks) == {"new"}
    assert not old_zip.exists()


def test_desktop_export_dir_modes_and_failure(tmp_path, monkeypatch):
    monkeypatch.delenv("QIMCHI_DESKTOP", raising=False)
    assert export._desktop_export_dir() is None

    target = tmp_path / "exports"
    monkeypatch.setenv("QIMCHI_DESKTOP", "yes")
    monkeypatch.setenv("QIMCHI_EXPORT_DIR", str(target))
    assert export._desktop_export_dir() == target
    assert target.is_dir()

    monkeypatch.setattr(Path, "mkdir", lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError()))
    assert export._desktop_export_dir() is None


def test_resolve_fpath_wraps_loader_errors(monkeypatch):
    monkeypatch.setattr(export, "resolve_to_disk_path", lambda path: f"disk:{path}")
    assert export._resolve_fpath_to_disk("memory://one") == "disk:memory://one"

    monkeypatch.setattr(
        export,
        "resolve_to_disk_path",
        lambda _path: (_ for _ in ()).throw(RuntimeError("not finished")),
    )
    with pytest.raises(ValueError, match="not finished"):
        export._resolve_fpath_to_disk("memory://one")


def test_embed_png_metadata_round_trip(tmp_path):
    path = tmp_path / "plot.png"
    Image.new("RGB", (2, 2), "white").save(path)
    meta = {"dataset_uuid": "run", "tags": ["good", "cold"]}

    export._embed_png_metadata(str(path), meta)

    with Image.open(path) as image:
        assert image.text["Software"] == "Qimchi"
        assert "good, cold" in image.text["ImageDescription"]
        assert json.loads(image.text["Qimchi"]) == meta


def test_export_footer_includes_basket_info_and_ordered_filters_without_size():
    figure = export.go.Figure(
        {"data": [{"x": [0, 1], "y": [1, 2]}], "layout": {"margin": {"b": 60}}}
    )
    original_plot_bottom = export._PLOTLY_DEFAULT_HEIGHT - 60

    export._add_export_info_footer(
        figure,
        [
            {"name": "savgol", "options": {"window": 5}},
            {"name": "normalize", "options": {"axis": "y"}},
        ],
        {
            "Timestamp": "2025-04-09T19:25:34.311282",
            "Cryostat": "017",
            "Wafer ID": "IHPCVD6",
            "Device Type": "Quantum Dot",
            "Sample Name": "00602_A3",
            "Experiment Name": "Single gate sweep",
            "Measurement ID": "1-40d7d11d-cbd9-48f4-9921-1ae6ac3a67fa",
            "Size": "12 MB",
        },
    )

    annotation = figure.layout.annotations[-1]
    assert annotation.name == "qimchi-export-info"
    assert "<b>Timestamp:</b> 2025-04-09T19:25:34.311282" in annotation.text
    assert "<b>Measurement ID:</b> 1-40d7d11d-cbd9-48f4-9921-1ae6ac3a67fa" in (
        annotation.text
    )
    assert "<b>Applied Filters:</b> Savitzky-Golay -> Normalize" in annotation.text
    assert "Size" not in annotation.text
    assert annotation.font.size == 15
    assert annotation.font.family == export._EXPORT_INFO_FONT_FAMILY
    assert figure.layout.width == export._PLOTLY_DEFAULT_WIDTH
    assert figure.layout.margin.b > 60
    assert figure.layout.height > export._PLOTLY_DEFAULT_HEIGHT
    assert figure.layout.height - figure.layout.margin.b == original_plot_bottom


def test_export_footer_preserves_explicit_plot_dimensions():
    figure = export.go.Figure(
        {
            "data": [{"x": [0, 1], "y": [1, 2]}],
            "layout": {"width": 960, "height": 540, "margin": {"b": 45}},
        }
    )

    export._add_export_info_footer(
        figure,
        [],
        {"Measurement ID": "full-id"},
    )

    assert figure.layout.width == 960
    assert figure.layout.height - figure.layout.margin.b == 540 - 45


def test_export_plot_images_sync_writes_variants_and_archive(tmp_path, monkeypatch):
    dataset = tmp_path / "run.zarr"
    dataset.mkdir()

    def fake_write(_figure, path, **_kwargs):
        target = Path(path)
        if target.suffix == ".png":
            Image.new("RGB", (2, 2), "white").save(target)
        else:
            target.write_text("<svg/>", encoding="utf-8")

    monkeypatch.setattr(export.pio, "write_image", fake_write)
    monkeypatch.setattr(
        export,
        "_library_metadata",
        lambda path, uuid: {"dataset_uuid": uuid, "dataset_path": str(path)},
    )
    plot = {
        "data": [{"type": "scatter", "x": [0, 1], "y": [2, 3]}],
        "layout": {"xaxis": {}, "yaxis": {}},
    }

    result = export._export_plot_images_sync(
        plot,
        str(dataset),
        relayout_data={"xaxis.range[0]": 0, "xaxis.range[1]": 1},
    )

    assert set(result["saved_paths"]) == {
        "png_light",
        "png_dark",
        "svg_light",
        "svg_dark",
    }
    with zipfile.ZipFile(result["zip_path"]) as archive:
        assert {"metadata.json", "timings.json"} <= set(archive.namelist())
        assert json.loads(archive.read("metadata.json"))["dataset_uuid"] == "run"
    Path(result["zip_path"]).unlink()


def test_save_light_dark_pngs_supports_one_or_both_variants(tmp_path, monkeypatch):
    dataset = tmp_path / "run.zarr"

    def fake_write(_figure, path, **_kwargs):
        Path(path).write_bytes(b"png")

    monkeypatch.setattr(export, "_resolve_fpath_to_disk", lambda _path: str(dataset))
    monkeypatch.setattr(export.pio, "write_image", fake_write)
    plot = {"data": [{"x": [0, 1], "y": [1, 2]}], "layout": {}}

    light = export._save_light_dark_pngs(plot, "memory://run", ts="one", only_light=True)
    both = export._save_light_dark_pngs(
        plot,
        "memory://run",
        ts="two",
        relayout_data={"xaxis.range[0]": 0, "xaxis.range[1]": 1},
    )

    assert set(light) == {"png_light"}
    assert set(both) == {"png_light", "png_dark"}
    assert all(Path(path).exists() for path in [*light.values(), *both.values()])


@pytest.mark.asyncio
async def test_run_export_task_completes_and_copies_for_desktop(tmp_path, monkeypatch):
    archive = tmp_path / "result.zip"
    archive.write_bytes(b"zip")
    destination = tmp_path / "downloads"
    destination.mkdir()
    export._export_tasks["task"] = {"status": "pending"}
    monkeypatch.setattr(
        export,
        "_export_plot_images_sync",
        lambda *_args: {
            "zip_path": str(archive),
            "zip_filename": "plot.zip",
            "saved_paths": {},
            "timings": {},
        },
    )
    monkeypatch.setattr(export, "_desktop_export_dir", lambda: destination)

    await export._run_export_task("task", {}, "/data/run.zarr")

    task = export._export_tasks["task"]
    assert task["status"] == "completed"
    assert Path(task["saved_to"]).read_bytes() == b"zip"


@pytest.mark.asyncio
async def test_run_export_task_records_failure(monkeypatch):
    export._export_tasks["task"] = {"status": "pending"}
    monkeypatch.setattr(
        export,
        "_export_plot_images_sync",
        lambda *_args: (_ for _ in ()).throw(RuntimeError("render failed")),
    )

    await export._run_export_task("task", {}, "/data/run.zarr")

    assert export._export_tasks["task"]["status"] == "failed"
    assert export._export_tasks["task"]["error"] == "render failed"


@pytest.mark.asyncio
async def test_start_export_validates_and_creates_task(monkeypatch):
    missing = await export.export_plot_images(FakeRequest({}))
    assert missing.status_code == 400

    monkeypatch.setattr(export, "_resolve_fpath_to_disk", lambda path: path)

    def discard(coroutine):
        coroutine.close()
        return SimpleNamespace()

    monkeypatch.setattr(export.asyncio, "create_task", discard)
    started = await export.export_plot_images(
        FakeRequest({"plot_json": {"data": [{}]}, "fpath": "/data/run.zarr"})
    )
    payload = _json(started)
    assert started.status_code == 202
    assert export._export_tasks[payload["task_id"]]["status"] == "pending"

    monkeypatch.setattr(
        export,
        "_resolve_fpath_to_disk",
        lambda _path: (_ for _ in ()).throw(ValueError("unknown live run")),
    )
    rejected = await export.export_plot_images(
        FakeRequest({"plot_json": {"data": [{}]}, "fpath": "memory://missing"})
    )
    assert rejected.status_code == 400


@pytest.mark.asyncio
async def test_status_and_download_endpoints_cover_all_states(tmp_path):
    assert (await export.get_export_status("missing")).status_code == 404
    assert (await export.download_export("missing")).status_code == 404

    export._export_tasks["pending"] = {"status": "pending"}
    assert _json(await export.get_export_status("pending"))["status"] == "pending"
    assert (await export.download_export("pending")).status_code == 400

    export._export_tasks["failed"] = {"status": "failed", "error": "bad"}
    assert _json(await export.get_export_status("failed"))["error"] == "bad"

    export._export_tasks["gone"] = {
        "status": "completed",
        "zip_path": str(tmp_path / "missing.zip"),
    }
    assert (await export.download_export("gone")).status_code == 404

    archive = tmp_path / "ready.zip"
    archive.write_bytes(b"zip")
    export._export_tasks["ready"] = {
        "status": "completed",
        "zip_path": str(archive),
        "zip_filename": "named.zip",
        "result": {"zip_filename": "named.zip"},
        "saved_to": "/downloads/named.zip",
    }
    status = _json(await export.get_export_status("ready"))
    response = await export.download_export("ready")
    assert status["saved_to"] == "/downloads/named.zip"
    assert isinstance(response, FileResponse)
    assert response.filename == "named.zip"


@pytest.mark.asyncio
async def test_send_to_notes_appends_image_and_lists_exports(tmp_path, monkeypatch):
    dataset = tmp_path / "sample" / "experiment" / "run.zarr"
    dataset.mkdir(parents=True)
    extras = dataset.parent / "run"
    light = extras / "run__stamp__plot_light.png"
    dark = extras / "run__stamp__plot_dark.png"

    def fake_save(*_args, **_kwargs):
        extras.mkdir(exist_ok=True)
        light.write_bytes(b"light")
        dark.write_bytes(b"dark")
        return {"png_light": str(light), "png_dark": str(dark)}

    monkeypatch.setattr(export, "_save_light_dark_pngs", fake_save)
    monkeypatch.setattr(export, "_resolve_fpath_to_disk", lambda _path: str(dataset))
    monkeypatch.setattr(
        export, "append_sample_rollup", lambda *_args, **_kwargs: {"sample_notes_path": "pool.md"}
    )

    response = await export.export_and_send_to_notes(
        FakeRequest({"plot_json": {"data": [{}]}, "fpath": "memory://run"})
    )
    listed = await export.export_send_to_notes_get("memory://run")

    assert response.status_code == 200
    assert "![plot](run/run__stamp__plot_light.png)" in (
        extras / "run.md"
    ).read_text(encoding="utf-8")
    assert set(_json(listed)["paths"]) == {"png_light", "png_dark"}


@pytest.mark.asyncio
async def test_send_to_notes_and_listing_error_responses(tmp_path, monkeypatch):
    assert (await export.export_and_send_to_notes(FakeRequest({}))).status_code == 400

    monkeypatch.setattr(
        export,
        "_save_light_dark_pngs",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("render failed")),
    )
    failed = await export.export_and_send_to_notes(
        FakeRequest({"plot_json": {"data": [{}]}, "fpath": "/data/run.zarr"})
    )
    assert failed.status_code == 500

    monkeypatch.setattr(export, "_resolve_fpath_to_disk", lambda _path: str(tmp_path / "run.zarr"))
    empty = await export.export_send_to_notes_get("/data/run.zarr")
    assert _json(empty)["paths"] == {}

    monkeypatch.setattr(
        export,
        "_resolve_fpath_to_disk",
        lambda _path: (_ for _ in ()).throw(RuntimeError("bad path")),
    )
    assert (await export.export_send_to_notes_get("bad")).status_code == 500
