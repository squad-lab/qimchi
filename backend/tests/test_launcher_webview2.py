"""Tests for the desktop launcher's WebView2 flags and crash recovery."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def launcher():
    launcher_path = (
        Path(__file__).resolve().parents[2] / "packaging" / "qimchi_launcher.py"
    )
    spec = importlib.util.spec_from_file_location(
        "qimchi_launcher_webview2", launcher_path
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_browser_flag_is_appended_once(launcher):
    flag = "--disable-background-timer-throttling"

    assert launcher._with_webview2_argument(None, flag) == flag
    assert launcher._with_webview2_argument("--foo", flag) == f"--foo {flag}"
    assert launcher._with_webview2_argument(f"--foo {flag}", flag) == f"--foo {flag}"


def test_reload_budget_refills_after_its_window(launcher):
    now = [0.0]
    budget = launcher._ReloadBudget(limit=2, window_seconds=60, clock=lambda: now[0])

    assert budget.take() and budget.take()
    assert not budget.take()
    now[0] = 61.0
    assert budget.take()


class _Sender:
    def __init__(self):
        self.reloads = 0

    def Reload(self):  # noqa: N802 - mirrors the .NET method name
        self.reloads += 1


def _failure(kind: str):
    return SimpleNamespace(
        ProcessFailedKind=kind, Reason="Crashed", ExitCode=-1, ProcessDescription=""
    )


def test_renderer_crash_reloads_until_the_budget_runs_out(launcher):
    sender, messages = _Sender(), []
    budget = launcher._ReloadBudget(limit=1)

    for _ in range(2):
        launcher._handle_webview2_process_failed(
            sender, _failure("RenderProcessExited"), budget, messages.append
        )

    assert sender.reloads == 1
    assert "kind=RenderProcessExited" in messages[0]
    assert "not reloading again" in messages[-1]


@pytest.mark.parametrize(
    "kind", ["GpuProcessExited", "BrowserProcessExited", "RenderProcessUnresponsive"]
)
def test_other_process_failures_are_only_logged(launcher, kind):
    sender, messages = _Sender(), []

    launcher._handle_webview2_process_failed(
        sender, _failure(kind), launcher._ReloadBudget(), messages.append
    )

    assert sender.reloads == 0
    assert messages == [
        f"[webview2] process failed: kind={kind}, Reason=Crashed, ExitCode=-1, "
        "ProcessDescription="
    ]


def test_windows_log_terminal_shows_only_the_end_and_follows(launcher):
    command = launcher._windows_log_follow_command(r"C:\Users\o'neil\.qimchi\debug.log")

    assert command == (
        r"Get-Content -LiteralPath 'C:\Users\o''neil\.qimchi\debug.log' -Tail 200 -Wait"
    )


def test_unix_log_terminal_uses_less_and_falls_back_to_tail(launcher):
    command = launcher._unix_log_follow_command("/home/a b/.qimchi/debug.log")

    assert "less +F '/home/a b/.qimchi/debug.log'" in command
    assert "tail -n 200 -f '/home/a b/.qimchi/debug.log'" in command


def test_update_check_follows_the_desktop_settings(launcher, monkeypatch):
    import time

    from api import settings, updater

    monkeypatch.setattr(time, "sleep", lambda _seconds: None)
    calls, messages = [], []
    monkeypatch.setattr(
        updater, "check_for_update", lambda **kwargs: calls.append(kwargs)
    )

    monkeypatch.setattr(
        settings,
        "desktop_settings",
        lambda: settings.DesktopSettings(checkForUpdates=False),
    )
    launcher._run_update_check(window=None, log=messages.append)
    assert calls == []
    assert "turned off in Settings" in messages[-1]

    monkeypatch.setattr(
        settings,
        "desktop_settings",
        lambda: settings.DesktopSettings(previewReleases=True),
    )
    launcher._run_update_check(window=None, log=messages.append)
    assert calls == [{"include_previews": True}]


def test_save_text_file_writes_where_the_user_chose(launcher, tmp_path, monkeypatch):
    import sys
    from types import SimpleNamespace

    target = tmp_path / "exported.json"
    calls = []

    def create_file_dialog(dialog_type, **kwargs):
        calls.append((dialog_type, kwargs))
        return (str(target),)

    fake_webview = SimpleNamespace(
        FileDialog=SimpleNamespace(SAVE="save"),
        windows=[SimpleNamespace(create_file_dialog=create_file_dialog)],
    )
    monkeypatch.setitem(sys.modules, "webview", fake_webview)
    api = launcher._Api(lambda _message: None)

    assert api.save_text_file("settings.json", '{"a": 1}') == str(target)
    assert target.read_text(encoding="utf-8") == '{"a": 1}'
    assert calls == [("save", {"save_filename": "settings.json"})]

    fake_webview.windows[0].create_file_dialog = lambda *_args, **_kwargs: None
    assert api.save_text_file("settings.json", "{}") == ""
