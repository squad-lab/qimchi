"""Tests for export-worker image rendering."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from api import export_render as render


def test_export_page_bundles_and_waits_for_fira_sans(tmp_path, monkeypatch):
    fonts = {}
    for weight in render._FIRA_SANS_WEIGHTS:
        path = tmp_path / f"fira-sans-latin-{weight}-normal.woff2"
        path.write_bytes(b"font")
        fonts[weight] = path
    monkeypatch.setattr(render, "_find_fira_sans_fonts", lambda: fonts)

    page = render.export_page_generator().generate_index()

    assert page.count("font-family:'Fira Sans'") == len(fonts)
    assert page.count("data:font/woff2;base64,Zm9udA==") == len(fonts)
    assert "Fira Sans did not load" in page
    assert "document.fonts.ready" in page
    assert render._MATHJAX_FIRA_SVG_URL in page
    assert "window.MathJax?.startup?.promise" in page
    assert "Plotly.toImage = (...args) => qimchiExportReady" in page


def test_svg_export_embeds_fira_sans_for_portable_rendering(tmp_path, monkeypatch):
    fonts = {}
    for weight in render._FIRA_SANS_WEIGHTS:
        path = tmp_path / f"fira-sans-latin-{weight}-normal.woff2"
        path.write_bytes(b"font")
        fonts[weight] = path
    monkeypatch.setattr(render, "_find_fira_sans_fonts", lambda: fonts)
    svg_path = tmp_path / "plot.svg"
    svg_path.write_text('<svg xmlns="http://www.w3.org/2000/svg"></svg>')

    render._embed_fira_sans_in_svg(svg_path)
    render._embed_fira_sans_in_svg(svg_path)

    svg = svg_path.read_text(encoding="utf-8")
    assert svg.count('id="qimchi-export-fonts"') == 1
    assert svg.count("data:font/woff2;base64,Zm9udA==") == len(fonts)


@pytest.mark.parametrize("server_running", [True, False])
def test_image_writer_only_supplies_page_options_without_server(
    tmp_path, monkeypatch, server_running
):
    import kaleido

    calls = []
    page = object()

    monkeypatch.setattr(kaleido._global_server, "is_running", lambda: server_running)
    monkeypatch.setattr(render, "export_page_generator", lambda: page)

    def fake_calc(figure, **kwargs):
        calls.append((figure, kwargs))
        return b"image"

    monkeypatch.setattr(kaleido, "calc_fig_sync", fake_calc)
    monkeypatch.setattr(
        render,
        "_calc_fig_on_sync_server",
        lambda _server, figure, **kwargs: fake_calc(figure, **kwargs),
    )
    output = tmp_path / "plot.png"
    figure = render.go.Figure(layout={"width": 321, "height": 123})

    render.write_plotly_image(figure, output, scale=2)

    assert output.read_bytes() == b"image"
    assert calls[0][1]["opts"] == {
        "format": "png",
        "width": 321,
        "height": 123,
        "scale": 2,
    }
    if server_running:
        assert "kopts" not in calls[0][1]
    else:
        assert calls[0][1]["kopts"] == {"page_generator": page}


def _fake_sync_server(thread_alive: bool, results: list):
    import queue

    closed = []
    server = SimpleNamespace(
        _task_queue=queue.Queue(),
        _return_queue=queue.Queue(),
        _thread=SimpleNamespace(is_alive=lambda: thread_alive),
        close=lambda **_kwargs: closed.append(True),
    )
    for result in results:
        server._return_queue.put(result)
    return server, closed


def test_sync_server_render_returns_the_result():
    server, closed = _fake_sync_server(True, [b"image"])

    assert render._calc_fig_on_sync_server(server, "fig", opts={}) == b"image"
    task = server._task_queue.get_nowait()
    assert (task.fn, task.args, task.kwargs) == ("calc_fig", ("fig",), {"opts": {}})
    assert closed == []


def test_sync_server_render_fails_instead_of_hanging_when_chrome_died():
    server, closed = _fake_sync_server(False, [])

    with pytest.raises(RuntimeError, match="Chrome closed while starting"):
        render._calc_fig_on_sync_server(server, "fig", opts={})
    assert closed == [True]


def test_find_fira_sans_fonts_prefers_the_built_assets(tmp_path, monkeypatch):
    assets = tmp_path / "frontend" / "dist" / "assets"
    assets.mkdir(parents=True)
    for weight in render._FIRA_SANS_WEIGHTS:
        (assets / f"fira-sans-latin-{weight}-normal-hash.woff2").write_bytes(b"font")

    monkeypatch.setattr(
        render, "__file__", str(tmp_path / "backend" / "api" / "export_render.py")
    )
    found = render._find_fira_sans_fonts()

    assert set(found) == set(render._FIRA_SANS_WEIGHTS)


def test_find_fira_sans_fonts_rejects_an_incomplete_set(tmp_path, monkeypatch):
    assets = tmp_path / "frontend" / "dist" / "assets"
    assets.mkdir(parents=True)
    # Font weights must come from one directory.
    for weight in render._FIRA_SANS_WEIGHTS[:-1]:
        (assets / f"fira-sans-latin-{weight}-normal-hash.woff2").write_bytes(b"font")

    monkeypatch.setattr(
        render, "__file__", str(tmp_path / "backend" / "api" / "export_render.py")
    )
    found = render._find_fira_sans_fonts()

    assert found == {} or set(found) != set(render._FIRA_SANS_WEIGHTS)


def test_kaleido_sync_server_start_stop_and_disabled(monkeypatch):
    calls = []
    fake = SimpleNamespace(
        start_sync_server=lambda **kwargs: calls.append(("start", kwargs)),
        stop_sync_server=lambda: calls.append("stop"),
    )
    monkeypatch.setitem(__import__("sys").modules, "kaleido", fake)
    monkeypatch.setenv("ENABLE_KALEIDO_SYNC_SERVER", "1")
    monkeypatch.setattr(render, "export_page_generator", lambda: "font-page")

    assert render.start_kaleido_sync_server("test") is True
    render.stop_kaleido_sync_server("test")
    assert calls == [("start", {"page_generator": "font-page"}), "stop"]

    monkeypatch.setenv("ENABLE_KALEIDO_SYNC_SERVER", "0")
    assert render.start_kaleido_sync_server("test") is False
    render.stop_kaleido_sync_server("test")
    assert calls == [("start", {"page_generator": "font-page"}), "stop"]


def test_kaleido_sync_server_failures_are_nonfatal(monkeypatch):
    fake = SimpleNamespace(
        start_sync_server=lambda **_kwargs: (_ for _ in ()).throw(
            RuntimeError("start")
        ),
        stop_sync_server=lambda: (_ for _ in ()).throw(RuntimeError("stop")),
    )
    monkeypatch.setitem(__import__("sys").modules, "kaleido", fake)
    monkeypatch.setenv("ENABLE_KALEIDO_SYNC_SERVER", "1")
    monkeypatch.setattr(render, "export_page_generator", lambda: "font-page")

    assert render.start_kaleido_sync_server("test") is False
    render.stop_kaleido_sync_server("test")


def test_init_export_worker_registers_shutdown_only_after_start(monkeypatch):
    registrations = []
    monkeypatch.setattr(render, "start_kaleido_sync_server", lambda _context: True)
    monkeypatch.setattr(
        render.atexit,
        "register",
        lambda function, context: registrations.append((function, context)),
    )

    render.init_export_worker()

    assert registrations == [(render.stop_kaleido_sync_server, "export-worker")]


def test_export_workers_do_not_load_the_data_stack():
    heavy = ["xarray", "pandas", "scipy", "sqlalchemy", "fastapi"]
    script = (
        "import sys, api.export_render; "
        f"print([m for m in {heavy!r} if m in sys.modules])"
    )
    loaded = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        check=True,
        cwd=str(Path(render.__file__).parents[1]),
    ).stdout.strip()
    assert loaded == "[]"
