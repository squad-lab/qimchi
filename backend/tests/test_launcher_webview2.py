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
