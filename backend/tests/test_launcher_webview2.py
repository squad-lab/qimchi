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


def test_update_check_follows_the_desktop_settings(launcher, monkeypatch, tmp_path):
    import time

    from api import settings

    monkeypatch.setattr(time, "sleep", lambda _seconds: None)
    calls, messages = [], []
    updates = launcher._Updates(messages.append, home=str(tmp_path))
    monkeypatch.setattr(updates, "check", lambda **kwargs: calls.append(kwargs))

    monkeypatch.setattr(
        settings,
        "desktop_settings",
        lambda: settings.DesktopSettings(checkForUpdates=False),
    )
    launcher._run_update_check(updates, messages.append)
    assert calls == []
    assert "turned off in Settings" in messages[-1]

    monkeypatch.setattr(
        settings,
        "desktop_settings",
        lambda: settings.DesktopSettings(previewReleases=True),
    )
    launcher._run_update_check(updates, messages.append)
    assert calls == [{"startup": True, "include_previews": True}]


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


def test_closing_the_window_ends_the_process_even_if_workers_hang(
    launcher, monkeypatch
):
    import multiprocessing
    import os

    killed, exits = [], []
    worker = SimpleNamespace(kill=lambda: killed.append(True))
    monkeypatch.setattr(multiprocessing, "active_children", lambda: [worker])
    monkeypatch.setattr(os, "_exit", exits.append)

    launcher._shut_down(0)

    assert killed == [True]
    assert exits == [0]


_OFFER = {
    "tag": "v0.7.0-rc.9",
    "notes": "notes",
    "asset_url": "https://example.invalid/qimchi-setup-v0.7.0-rc.9.exe?job=x",
    "asset_name": "qimchi-setup-v0.7.0-rc.9.exe (Windows installer)",
    "platform": "windows",
    "install_mode": "run-installer",
}


def _updates_with_offer(
    launcher, monkeypatch, tmp_path, messages, running="v0.7.0-rc.8"
):
    import threading

    from api import updater

    monkeypatch.setattr(updater, "current_version", lambda: running)
    monkeypatch.setattr(updater, "check_for_update", lambda **_kwargs: dict(_OFFER))

    class _InlineThread:
        def __init__(self, target, name=None, daemon=None):
            self.target = target

        def start(self):
            self.target()

    monkeypatch.setattr(threading, "Thread", _InlineThread)

    def fake_download(url, destination, log, progress=None):
        with open(destination, "wb") as fh:
            fh.write(b"installer")
        if progress:
            progress(0.5)
            progress(1.0)
        return destination

    monkeypatch.setattr(launcher, "_download_update_asset", fake_download)
    events = []
    updates = launcher._Updates(messages.append, home=str(tmp_path))
    updates.attach(SimpleNamespace(evaluate_js=events.append))
    return updates, events


def test_an_update_downloads_in_the_background_then_asks_to_install(
    launcher, monkeypatch, tmp_path
):
    messages = []
    updates, events = _updates_with_offer(launcher, monkeypatch, tmp_path, messages)

    assert updates.check(startup=True, include_previews=False)["prompt"] == "available"
    state = updates.download()

    assert state["status"] == "downloaded"
    assert state["prompt"] == "ready"
    assert (tmp_path / "updates" / "qimchi-setup-v0.7.0-rc.9.exe").read_bytes() == (
        b"installer"
    )
    assert any('"status": "downloading"' in event for event in events)
    assert any('"progress": 0.5' in event for event in events)


def test_remind_at_next_launch_offers_the_download_again_without_fetching(
    launcher, monkeypatch, tmp_path
):
    messages = []
    updates, _ = _updates_with_offer(launcher, monkeypatch, tmp_path, messages)
    updates.check(include_previews=False)
    updates.download()
    assert updates.remind_at_next_launch()["prompt"] is None

    next_launch, _ = _updates_with_offer(launcher, monkeypatch, tmp_path, messages)
    next_launch.restore_pending()
    state = next_launch.status()
    assert (state["status"], state["tag"], state["prompt"]) == (
        "downloaded",
        "v0.7.0-rc.9",
        "ready",
    )

    # The same release found again is not downloaded twice.
    assert next_launch.check(include_previews=False)["status"] == "downloaded"


def test_a_downloaded_update_is_forgotten_once_installed(
    launcher, monkeypatch, tmp_path
):
    messages = []
    updates, _ = _updates_with_offer(launcher, monkeypatch, tmp_path, messages)
    updates.check(include_previews=False)
    updates.download()

    after_install, _ = _updates_with_offer(
        launcher, monkeypatch, tmp_path, messages, running="v0.7.0-rc.9"
    )
    after_install.restore_pending()

    assert after_install.status()["status"] == "idle"
    assert list((tmp_path / "updates").iterdir()) == []


def test_installing_on_windows_runs_the_installer_and_closes(
    launcher, monkeypatch, tmp_path
):
    import os
    import subprocess

    messages, started, closed = [], [], []
    updates, _ = _updates_with_offer(launcher, monkeypatch, tmp_path, messages)
    updates.check(include_previews=False)
    updates.download()
    monkeypatch.setattr(launcher.os, "name", "nt")
    monkeypatch.setattr(subprocess, "CREATE_NO_WINDOW", 0x08000000, raising=False)
    monkeypatch.setattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 512, raising=False)
    flags = []
    monkeypatch.setattr(
        subprocess,
        "Popen",
        lambda args, **kwargs: (
            (started.append(args) or flags.append(kwargs["creationflags"]))
            or SimpleNamespace(pid=1)
        ),
    )
    monkeypatch.setattr(launcher, "_close_windows", lambda log: closed.append(True))

    assert updates.install()["status"] == "installing"
    # Setup cannot replace a running Qimchi, so a helper waits for it to exit.
    assert started[0][0] == "powershell"
    # DETACHED_PROCESS would exit before running the script.
    assert flags == [0x08000000 | 512]
    script = started[0][-1]
    assert f"Wait-Process -Id {os.getpid()}" in script
    assert "Get-Process qimchi | Stop-Process -Force" in script
    assert "qimchi-setup-v0.7.0-rc.9.exe" in script
    # Keep the standard Setup wizard interactive.
    assert "/SILENT" not in script and "/VERYSILENT" not in script
    assert "'/NORESTART'" in script
    # -Wait would include the relaunched Qimchi process.
    assert "-Wait " not in script and "$setup.WaitForExit()" in script
    assert "setup.log" in script
    assert closed == [True]
    assert launcher._update_being_installed(str(tmp_path), lambda pid: pid == 1) == (
        "v0.7.0-rc.9"
    )
    assert closed == [True]


def test_macos_update_replaces_the_app_once_it_has_quit(
    launcher, monkeypatch, tmp_path
):
    import subprocess
    import sys

    messages, opened, closed = [], [], []
    updates, _ = _updates_with_offer(launcher, monkeypatch, tmp_path, messages)
    updates.check(include_previews=False)
    updates.download()
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(launcher.os, "name", "posix")
    monkeypatch.setattr(
        sys, "executable", "/Applications/qimchi.app/Contents/MacOS/qimchi"
    )
    updates._offer["platform"] = "macos"
    monkeypatch.setattr(
        subprocess, "Popen", lambda args, **_kwargs: opened.append(args)
    )
    monkeypatch.setattr(launcher, "_close_windows", lambda log: closed.append(True))

    updates.install()

    helper = opened[0]
    assert helper[:2] == ["/bin/sh", "-c"]
    assert helper[5:7] == [updates._offer["path"], "/Applications/qimchi.app"]
    assert "ditto" in helper[2] and 'open "$dmg"' in helper[2]
    assert closed == [True]


def test_macos_update_opens_the_dmg_outside_an_app_bundle(
    launcher, monkeypatch, tmp_path
):
    import subprocess
    import sys

    messages, opened = [], []
    updates, _ = _updates_with_offer(launcher, monkeypatch, tmp_path, messages)
    updates.check(include_previews=False)
    updates.download()
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(launcher.os, "name", "posix")
    monkeypatch.setattr(sys, "executable", "/usr/local/bin/python3")
    updates._offer["platform"] = "macos"
    monkeypatch.setattr(
        subprocess, "Popen", lambda args, **_kwargs: opened.append(args)
    )
    monkeypatch.setattr(launcher, "_close_windows", lambda log: None)

    updates.install()

    assert opened[0][0] == "open"


def test_update_events_never_wait_on_the_page(launcher, monkeypatch, tmp_path):
    """A closing window never answers evaluate_js; the caller must not block."""
    import threading

    release = threading.Event()
    started = threading.Event()

    def evaluate_js(_script):
        started.set()
        release.wait(5)

    updates = launcher._Updates(lambda _message: None, home=str(tmp_path))
    updates.attach(SimpleNamespace(evaluate_js=evaluate_js))

    updates.dismiss()  # returns although the page has not answered

    assert started.wait(2)
    release.set()


def test_the_process_ends_soon_after_the_window_closes(launcher, monkeypatch):
    import threading

    handlers, timers = [], []

    class _Events:
        def __iadd__(self, handler):
            handlers.append(handler)
            return self

    class _Timer:
        def __init__(self, interval, function, args=()):
            timers.append((interval, function, args))
            self.daemon = False

        def start(self):
            assert self.daemon

    monkeypatch.setattr(threading, "Timer", _Timer)
    window = SimpleNamespace(events=SimpleNamespace(closed=_Events()))

    launcher._exit_soon_after_close(window, lambda _message: None, grace_seconds=3)
    handlers[0]()

    assert timers == [(3, launcher._shut_down, (0,))]


def test_a_launch_during_an_install_waits_and_a_stale_marker_is_cleared(
    launcher, tmp_path
):
    launcher._mark_install_started(4242, "v0.7.0-rc.9", str(tmp_path))
    marker = tmp_path / "updates" / "installing.json"

    assert launcher._update_being_installed(str(tmp_path), lambda pid: True) == (
        "v0.7.0-rc.9"
    )
    assert marker.exists()

    assert launcher._update_being_installed(str(tmp_path), lambda pid: False) is None
    assert not marker.exists()


def test_the_current_process_counts_as_running(launcher):
    import os

    assert launcher._process_is_running(os.getpid())


def test_chrome_is_found_where_macos_actually_puts_it(launcher, monkeypatch, tmp_path):
    chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

    monkeypatch.setattr(launcher.sys, "platform", "darwin")
    monkeypatch.setattr(launcher, "_persistent_chrome_dir", lambda: str(tmp_path))
    monkeypatch.setattr(launcher.os.path, "exists", lambda path: path == chrome)

    import shutil as _shutil

    monkeypatch.setattr(_shutil, "which", lambda _name: None)

    assert launcher._find_installed_chrome() == chrome


def test_a_downloaded_chrome_wins_over_the_users_own(launcher, monkeypatch, tmp_path):
    downloaded = tmp_path / "chrome-mac-arm64" / "chrome"
    downloaded.parent.mkdir(parents=True)
    downloaded.write_text("#!/bin/sh\n", encoding="utf-8")

    monkeypatch.setattr(launcher, "_persistent_chrome_dir", lambda: str(tmp_path))

    import shutil as _shutil

    monkeypatch.setattr(_shutil, "which", lambda _name: "/usr/bin/google-chrome")

    assert launcher._find_installed_chrome() == str(downloaded)


def test_https_uses_the_bundled_certificates(launcher, monkeypatch, tmp_path):
    monkeypatch.delenv("SSL_CERT_FILE", raising=False)
    monkeypatch.delenv("REQUESTS_CA_BUNDLE", raising=False)

    lines: list[str] = []
    launcher._use_bundled_certificates(lines.append)

    import certifi

    assert launcher.os.environ["SSL_CERT_FILE"] == certifi.where()
    assert launcher.os.environ["REQUESTS_CA_BUNDLE"] == certifi.where()


def test_an_existing_certificate_setting_is_left_alone(launcher, monkeypatch):
    monkeypatch.setenv("SSL_CERT_FILE", "/etc/ssl/chosen.pem")
    launcher._use_bundled_certificates(lambda _msg: None)
    assert launcher.os.environ["SSL_CERT_FILE"] == "/etc/ssl/chosen.pem"


def test_the_frozen_app_recognises_choreographers_chrome_wrapper(launcher):
    wrapper = "/app/_internal/choreographer/browsers/_unix_pipe_chromium_wrapper.py"
    chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

    assert launcher._chromium_wrapper_command(
        ["/app/qimchi", wrapper, chrome, "--headless", "--remote-debugging-pipe"]
    ) == [chrome, "--headless", "--remote-debugging-pipe"]
    assert launcher._chromium_wrapper_command(["/app/qimchi"]) is None
    assert launcher._chromium_wrapper_command(["/app/qimchi", "--after-update"]) is None


def test_a_slow_chrome_is_kept_rather_than_replaced(launcher, monkeypatch):
    import subprocess

    calls = []

    def slow(args, **_kwargs):
        calls.append(args)
        raise subprocess.TimeoutExpired(args, 30)

    monkeypatch.setattr(subprocess, "run", slow)

    assert launcher._chrome_starts("/chrome", lambda _message: None)
    # The keychain flags keep macOS from holding Chrome on a prompt.
    assert "--use-mock-keychain" in calls[0]
    assert "--password-store=basic" in calls[0]


def test_a_broken_downloaded_chrome_is_not_downloaded_again(
    launcher, monkeypatch, tmp_path
):
    downloaded = str(tmp_path / "chrome-mac-arm64" / "chrome")
    downloads = []
    monkeypatch.delenv("BROWSER_PATH", raising=False)
    monkeypatch.setattr(launcher, "_persistent_chrome_dir", lambda: str(tmp_path))
    monkeypatch.setattr(launcher, "_find_installed_chrome", lambda: downloaded)
    monkeypatch.setattr(launcher, "_chrome_starts", lambda _exe, _log: False)

    import threading

    class Immediate:
        def __init__(self, target, daemon):
            self._target = target

        def start(self):
            self._target()

    monkeypatch.setattr(threading, "Thread", Immediate)
    import kaleido

    monkeypatch.setattr(kaleido, "get_chrome_sync", lambda **_kw: downloads.append(1))

    launcher._ensure_chrome_for_kaleido(lambda _message: None)

    assert downloads == []


def test_the_splash_shows_one_v_before_the_version(launcher, monkeypatch):
    for version in ("v0.7.0-rc.9", "0.7.0"):
        monkeypatch.setattr(launcher, "_app_version", lambda v=version: v)
        html = launcher._splash_html()
        assert ">v0.7.0" in html
        assert "vv0.7.0" not in html


def test_every_debug_log_line_gets_a_timestamp_even_when_written_in_pieces(launcher):
    import io
    import re
    import threading

    buffer = io.StringIO()
    writer = launcher._TimestampedWriter(buffer)
    writer.write("[updater] checking ")
    writer.write("for updates\nTraceback (most recent call last):\n  File x")
    writer.write("\n")

    def burst(tag: str) -> None:
        for i in range(50):
            writer.write(f"{tag} {i}\n")

    threads = [threading.Thread(target=burst, args=(t,)) for t in "ab"]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    stamp = r"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} "
    lines = buffer.getvalue().splitlines()
    assert len(lines) == 103
    assert all(re.match(stamp, line) for line in lines)
    assert re.fullmatch(stamp + r"\[updater\] checking for updates", lines[0])
    assert re.fullmatch(stamp + "  File x", lines[2])


def test_the_debug_log_keeps_three_rolls(launcher, tmp_path, monkeypatch):
    log = tmp_path / "qimchi_debug.log"
    monkeypatch.setattr(launcher, "_DEBUG_LOG_MAX_BYTES", 10)
    for generation in range(5):
        log.write_text(f"generation {generation} " * 3, encoding="utf-8")
        launcher._open_log_file(str(log)).close()

    rolls = sorted(p.name for p in tmp_path.iterdir())
    assert rolls == [
        "qimchi_debug.log",
        "qimchi_debug.log.1",
        "qimchi_debug.log.2",
        "qimchi_debug.log.3",
    ]
    assert "generation 4" in (tmp_path / "qimchi_debug.log.1").read_text("utf-8")


def test_uvicorn_logs_without_its_own_time_or_colours(launcher):
    config = launcher._uvicorn_log_config()
    for formatter in config["formatters"].values():
        assert "asctime" not in formatter["fmt"]
        assert formatter["use_colors"] is False
