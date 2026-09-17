"""
Qimchi desktop launcher (PyInstaller + pywebview).

Responsibilities:
1. Starts the FastAPI/uvicorn server on a background thread.
2. Waits until the server actually answers GET /health before opening the window.
3. Surfaces server startup crashes in the window instead of a blank page.
4. Guards multiprocessing so export workers (ProcessPoolExecutor) don't re-launch the whole app on Windows.
5. Best-effort ensure a Chrome/Chromium is available for Kaleido image export on first run.

This file is the source of truth. `build_windows.ps1` copies it into the bundle.

"""

import multiprocessing
import os
import sys
from urllib.request import Request, urlopen


# Paths / logging
def _bundle_dir() -> str:
    if getattr(sys, "frozen", False):
        # PyInstaller onefile (temp extraction dir) or onedir (_internal/ subdir)
        return sys._MEIPASS  # type: ignore[attr-defined]
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repository_root = os.path.dirname(script_dir)
    # The canonical launcher can also be exercised directly during development;
    # the staged copy is frozen and continues to resolve through sys._MEIPASS.
    if os.path.isdir(os.path.join(repository_root, "backend")):
        return repository_root
    return script_dir


def _qimchi_home() -> str:
    """
    The desktop app's home dir: persistent WebView storage, logs, the version
    marker and the downloaded Chrome all live here.

    Honours QIMCHI_HOME so this stays in step with the backend's resolver
    (backend/api/shared/paths.py::qimchi_home). They must agree.

    """
    override = os.environ.get("QIMCHI_HOME")
    home = (
        os.path.expanduser(override)
        if override
        else os.path.join(os.path.expanduser("~"), ".qimchi")
    )
    try:
        os.makedirs(home, exist_ok=True)
    except OSError:
        pass
    return home


def _log_path() -> str:
    """
    Path of the launcher's raw stdout/stderr log.

    Lives in <home>/logs alongside the backend's qimchi.log so all logs are in
    one place. ~/.qimchi survives updates (they replace program files only), so
    this history is preserved -- see _open_log_file for why it is appended to
    rather than truncated.

    """
    try:
        logs_dir = os.path.join(_qimchi_home(), "logs")
        os.makedirs(logs_dir, exist_ok=True)
        candidate = os.path.join(logs_dir, "qimchi_debug.log")

        # Move a pre-consolidation log into logs/ so history isn't orphaned.
        legacy = os.path.join(_qimchi_home(), "qimchi_debug.log")
        if os.path.isfile(legacy) and not os.path.exists(candidate):
            try:
                os.replace(legacy, candidate)
            except OSError:
                pass

        open(candidate, "a").close()
        return candidate
    except OSError:
        import tempfile

        return os.path.join(tempfile.gettempdir(), "qimchi_debug.log")


# Roll the debug log at this size so appending forever can't fill the disk.
_DEBUG_LOG_MAX_BYTES = 10 * 1024 * 1024


def _open_log_file(path: str):
    """
    Open the debug log for APPEND, rolling it once when it gets large.

    """
    try:
        if os.path.isfile(path) and os.path.getsize(path) > _DEBUG_LOG_MAX_BYTES:
            os.replace(path, path + ".1")  # keep exactly one previous roll
    except OSError:
        pass

    handle = open(path, "a", buffering=1, encoding="utf-8")
    try:
        import datetime

        stamp = datetime.datetime.now().isoformat(timespec="seconds")
        handle.write(f"\n===== Qimchi session started {stamp} =====\n")
    except Exception:
        pass
    return handle


def _app_version() -> str:
    """Running version: the build's tag, else package metadata ('unknown' if neither)."""
    try:
        from api._build_version import BUILD_VERSION

        if BUILD_VERSION:
            return BUILD_VERSION
    except Exception:
        pass
    try:
        from importlib.metadata import version

        return version("qimchi-api")
    except Exception:
        return "unknown"


def _purge_webview_cache_on_upgrade(storage_path: str, log) -> None:
    """
    Drop the WebView's HTTP cache when the app version has changed.

    """
    import shutil

    marker = os.path.join(_qimchi_home(), ".last_version")
    current = _app_version()
    previous = None
    try:
        if os.path.exists(marker):
            with open(marker, "r", encoding="utf-8") as fh:
                previous = fh.read().strip()
    except OSError:
        pass

    if previous == current:
        return

    # WebView2 (Windows) layout; other platforms simply have no such dirs.
    default_profile = os.path.join(storage_path, "EBWebView", "Default")
    for name in ("Cache", "Code Cache"):
        target = os.path.join(default_profile, name)
        if os.path.isdir(target):
            shutil.rmtree(target, ignore_errors=True)
            log(f"[cache] purged WebView '{name}' (version {previous} -> {current})")

    try:
        with open(marker, "w", encoding="utf-8") as fh:
            fh.write(current)
    except OSError:
        log("[cache] could not record app version marker (will retry next launch)")


WEBVIEW2_ARGUMENTS_ENV = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"


def _with_webview2_argument(existing: str | None, argument: str) -> str:
    """Add a browser flag to a WebView2 arguments string, once."""
    parts = (existing or "").split()
    if argument not in parts:
        parts.append(argument)
    return " ".join(parts)


class _ReloadBudget:
    """
    Allow a few automatic reloads in a time window.

    A page that crashes again as soon as it loads would otherwise reload
    forever; past the budget, the crash page stays so the user can see it.

    """

    def __init__(self, limit: int = 3, window_seconds: float = 300.0, clock=None):
        import time

        self.limit = limit
        self.window_seconds = window_seconds
        self.clock = clock or time.monotonic
        self.reloads: list[float] = []

    def take(self) -> bool:
        now = self.clock()
        self.reloads = [t for t in self.reloads if now - t < self.window_seconds]
        if len(self.reloads) >= self.limit:
            return False
        self.reloads.append(now)
        return True


def _handle_webview2_process_failed(sender, args, budget: _ReloadBudget, log) -> None:
    """Log a WebView2 process failure and reload the page if its renderer died."""
    kind = str(args.ProcessFailedKind)
    details = ", ".join(
        f"{name}={getattr(args, name, None)}"
        for name in ("Reason", "ExitCode", "ProcessDescription")
    )
    log(f"[webview2] process failed: kind={kind}, {details}")
    # A dead main-frame renderer leaves only the crash page. The browser process
    # dying takes the whole control with it, and GPU crashes recover by themselves.
    if kind != "RenderProcessExited":
        return
    if budget.take():
        log("[webview2] reloading the page after a renderer crash")
        sender.Reload()
    else:
        log("[webview2] renderer keeps crashing; not reloading again")


def _watch_webview2_crashes(window, log) -> None:
    """Hook WebView2's ProcessFailed event once the window has loaded (Windows only)."""
    if sys.platform != "win32":
        return

    import traceback

    budget = _ReloadBudget()
    state = {"hooked": False}

    def on_loaded() -> None:
        if state["hooked"]:
            return
        try:
            from System import Action

            form = window.native

            def on_failed(sender, args) -> None:
                try:
                    _handle_webview2_process_failed(sender, args, budget, log)
                except Exception:
                    log("[webview2] crash handler failed:\n" + traceback.format_exc())

            def attach() -> None:
                form.browser.webview.CoreWebView2.ProcessFailed += on_failed

            # WebView2 objects may only be touched on the UI thread.
            form.Invoke(Action(attach))
            state["hooked"] = True
            log("[webview2] watching for renderer crashes")
        except Exception:
            state["hooked"] = True
            log("[webview2] could not hook ProcessFailed:\n" + traceback.format_exc())

    window.events.loaded += on_loaded


def _persistent_chrome_dir() -> str:
    """
    Persistent, writable dir for a downloaded Chrome (survives across runs).

    """
    return os.path.join(_qimchi_home(), "chrome")


def _find_installed_chrome() -> str | None:
    """
    Locate a real Chrome/Chromium (NOT Edge -- Edge is unreliable with
    choreographer). Checks PATH and common Windows install locations, plus a
    Chrome we may have downloaded on a previous run.

    """
    import glob
    import shutil

    for name in ("chrome", "google-chrome", "chromium", "chromium-browser"):
        p = shutil.which(name)
        if p:
            return p

    if os.name == "nt":
        bases = [
            os.environ.get("ProgramFiles", r"C:\Program Files"),
            os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
            os.environ.get("LOCALAPPDATA", ""),
        ]
        for base in bases:
            if not base:
                continue
            cand = os.path.join(base, "Google", "Chrome", "Application", "chrome.exe")
            if os.path.exists(cand):
                return cand

    # A Chrome-for-Testing we downloaded previously.
    for pat in ("chrome-*/chrome.exe", "chrome-*/chrome"):
        hits = glob.glob(os.path.join(_persistent_chrome_dir(), pat))
        if hits:
            return hits[0]
    return None


def _ensure_chrome_for_kaleido(log) -> None:
    """
    Make sure Kaleido v1 has a working Chrome for PNG/SVG export.

    Kaleido >=1.0 no longer bundles Chrome; it finds one at runtime. We point it
    at a real Chrome via the BROWSER_PATH env var that choreographer honours,
    and if none exists we download 'Chrome for Testing' once.

    """
    import threading

    found = _find_installed_chrome()
    if found:
        os.environ["BROWSER_PATH"] = found
        log(f"[chrome] using Chrome for Kaleido export: {found}")
        return

    def _download() -> None:
        try:
            log(
                "[chrome] no Chrome found; downloading Chrome for Testing (one-time)..."
            )
            import kaleido

            exe = kaleido.get_chrome_sync(path=_persistent_chrome_dir())
            os.environ["BROWSER_PATH"] = str(exe)
            log(f"[chrome] downloaded Chrome to: {exe}")
        except Exception as exc:  # never fatal -- app still runs, export just fails
            log(f"[chrome] download failed (image export may not work): {exc!r}")

    threading.Thread(target=_download, daemon=True).start()
    log("[chrome] fetching Chrome in background; app will open now.")


class _Api:
    """
    Native APIs exposed to the SPA as window.pywebview.api (desktop only).

    """

    def __init__(self, log_fn) -> None:
        self._log = log_fn
        # Underscored so pywebview does not expose the object itself to the page.
        self._updates = _Updates(log_fn)

    def open_folder_dialog(self) -> str:
        """
        Open the OS folder picker; return the chosen absolute path (or "").

        """
        import webview

        # pywebview 5 replaced the FOLDER_DIALOG constant with the FileDialog
        # enum and deprecated the old name; accept whichever this build has.
        file_dialog = getattr(webview, "FileDialog", None)
        dialog_type = (
            file_dialog.FOLDER if file_dialog is not None else webview.FOLDER_DIALOG
        )
        result = webview.windows[0].create_file_dialog(dialog_type)
        if not result:
            return ""
        return result[0] if isinstance(result, (list, tuple)) else str(result)

    def save_text_file(self, filename: str, content: str) -> str:
        """
        Ask where to save ``content`` and write it there; return the path, or ""
        if the user cancelled.

        WebView2 silently drops downloads the page starts itself, so a file the
        SPA generates (an exported settings file) is saved through this instead.

        """
        import webview

        file_dialog = getattr(webview, "FileDialog", None)
        dialog_type = (
            file_dialog.SAVE if file_dialog is not None else webview.SAVE_DIALOG
        )
        result = webview.windows[0].create_file_dialog(
            dialog_type, save_filename=filename
        )
        if not result:
            return ""
        path = result[0] if isinstance(result, (list, tuple)) else str(result)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content)
        self._log(f"[settings] exported to {path}")
        return path

    def update_status(self) -> dict:
        """The update state the SPA shows: see _Updates.status."""
        return self._updates.status()

    def check_for_updates(self) -> dict:
        """Look for a newer release now, whatever the startup-check setting says."""
        return self._updates.check()

    def download_update(self) -> dict:
        """Start downloading the offered update in the background."""
        return self._updates.download()

    def install_update(self) -> dict:
        """Install the downloaded update; the app closes to let it."""
        return self._updates.install()

    def remind_update_at_next_launch(self) -> dict:
        """Keep the downloaded update and ask again when Qimchi next starts."""
        return self._updates.remind_at_next_launch()

    def dismiss_update_prompt(self) -> dict:
        """Close the update dialog for this session."""
        return self._updates.dismiss()

    def open_log_terminal(self) -> bool:
        """
        Open the debug log in a terminal that follows it live (best-effort).

        Spawns a SYSTEM terminal (powershell / less / Terminal.app), never the
        frozen exe, so there is no re-launch/fork-bomb risk. Returns False if no
        terminal could be launched.

        """
        import shutil
        import subprocess

        log = _log_path()
        try:
            if os.name == "nt":
                subprocess.Popen(
                    [
                        "powershell",
                        "-NoExit",
                        "-Command",
                        _windows_log_follow_command(log),
                    ],
                    creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0),
                )
                return True
            follow = _unix_log_follow_command(log)
            if sys.platform == "darwin":
                script = follow.replace("\\", "\\\\").replace('"', '\\"')
                subprocess.Popen(
                    [
                        "osascript",
                        "-e",
                        f'tell application "Terminal" to do script "{script}"',
                        "-e",
                        'tell application "Terminal" to activate',
                    ]
                )
                return True
            # Linux: try common terminal emulators in order.
            for term in (
                "x-terminal-emulator",
                "gnome-terminal",
                "konsole",
                "xfce4-terminal",
                "xterm",
            ):
                if shutil.which(term):
                    if term in ("gnome-terminal", "xfce4-terminal"):
                        subprocess.Popen([term, "--", "sh", "-c", follow])
                    else:
                        subprocess.Popen([term, "-e", "sh", "-c", follow])
                    return True
            return False
        except Exception:
            return False


# Enough recent history for context without dumping a log that can run to
# many megabytes.
LOG_FOLLOW_TAIL_LINES = 200


def _windows_log_follow_command(log: str) -> str:
    """PowerShell that shows the end of the log and keeps printing new lines."""
    quoted = "'" + log.replace("'", "''") + "'"
    return f"Get-Content -LiteralPath {quoted} -Tail {LOG_FOLLOW_TAIL_LINES} -Wait"


def _unix_log_follow_command(log: str) -> str:
    """
    Shell that follows the log in less, falling back to tail.

    less +F opens at the end and follows new lines like tail -f; Ctrl+C stops
    following so the whole log can be scrolled and searched, F resumes, q quits.

    """
    import shlex

    quoted = shlex.quote(log)
    return (
        f"if command -v less >/dev/null 2>&1; then less +F {quoted}; "
        f"else tail -n {LOG_FOLLOW_TAIL_LINES} -f {quoted}; fi"
    )


def _close_windows(log) -> None:
    import webview

    if not webview.windows:
        log("[updater] no open window to close")
        return
    for window in list(webview.windows):
        window.destroy()


def _download_update_asset(asset_url: str, destination: str, log, progress=None) -> str:
    """
    Download an update to ``destination``, using only modules the frozen bundle has.

    The file appears under its final name only once complete, so a download cut
    short is never mistaken for an installer.
    """
    partial = destination + ".part"
    request = Request(asset_url, headers={"User-Agent": "Qimchi-Updater"})
    try:
        with urlopen(request, timeout=180) as response, open(partial, "wb") as target:
            headers = getattr(response, "headers", None) or {}
            total = int(headers.get("Content-Length") or 0)
            final_url = getattr(response, "url", None) or asset_url
            log(
                f"[updater] HTTP {getattr(response, 'status', '?')} from {final_url}; "
                f"{total or 'unknown'} bytes"
            )
            received, next_report = 0, 0.25
            while chunk := response.read(65536):
                target.write(chunk)
                received += len(chunk)
                if total:
                    if progress is not None:
                        progress(received / total)
                    if received / total >= next_report:
                        log(f"[updater] downloaded {received * 100 // total}%")
                        next_report += 0.25
        os.replace(partial, destination)
    except Exception:
        try:
            os.unlink(partial)
        except OSError:
            pass
        raise
    return destination


def _linux_update_download_path(asset_name: str, tmp: str) -> str:
    import shutil

    downloads = os.path.join(os.path.expanduser("~"), "Downloads")
    os.makedirs(downloads, exist_ok=True)
    name = asset_name if asset_name.lower().endswith(".appimage") else "qimchi.AppImage"
    safe_name = "".join(c for c in name if c.isalnum() or c in "._- ()").strip()
    target = os.path.join(downloads, safe_name or "qimchi.AppImage")
    shutil.copy2(tmp, target)
    os.chmod(target, 0o755)
    return target


def _try_replace_running_appimage(tmp: str, log) -> bool:
    if not sys.platform.startswith("linux"):
        return False
    current = os.environ.get("APPIMAGE", "")
    if not current or not os.path.isfile(current):
        return False
    folder = os.path.dirname(current)
    if not os.access(current, os.W_OK) or not os.access(folder, os.W_OK):
        log("[updater] running AppImage is not writable; downloading update instead")
        return False

    import shutil
    import subprocess

    staged = f"{current}.new"
    try:
        shutil.move(tmp, staged)
        os.chmod(staged, 0o755)
        os.replace(staged, current)
        log(f"[updater] replaced running AppImage: {current}")
        try:
            subprocess.Popen([current], close_fds=True)
        except Exception as exc:
            log(f"[updater] replaced AppImage but failed to relaunch: {exc!r}")
        return True
    except Exception as exc:
        log(f"[updater] in-place AppImage update failed: {exc!r}")
        try:
            if os.path.exists(staged):
                shutil.move(staged, tmp)
        except Exception:
            pass
        return False


def _open_containing_folder(path: str, log) -> None:
    import subprocess

    folder = os.path.dirname(path)
    try:
        if os.name == "nt":
            subprocess.Popen(["explorer", "/select,", path], close_fds=True)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R", path], close_fds=True)
        else:
            opener = "xdg-open"
            subprocess.Popen([opener, folder], close_fds=True)
    except Exception as exc:
        log(f"[updater] failed to open update location: {exc!r}")


def _asset_file_name(asset_url: str, platform: str) -> str:
    """A safe local file name for a release asset, keeping its extension."""
    from urllib.parse import unquote, urlparse

    name = os.path.basename(unquote(urlparse(asset_url).path))
    name = "".join(c for c in name if c.isalnum() or c in "._-")
    if name:
        return name
    return {
        "windows": "qimchi-setup.exe",
        "macos": "qimchi.dmg",
        "linux": "qimchi.AppImage",
    }.get(platform, "qimchi-update")


def _windows_install_after_exit_command(installer: str) -> list[str]:
    """
    A detached helper that installs once this Qimchi is really gone.

    Setup cannot replace qimchi.exe while it runs, and it cannot reliably close
    it either: Restart Manager refuses on some machines ("Permission Denied +
    Session Mismatch"), and the export workers are windowless processes it
    cannot ask to quit. Setup then answers its own "file in use" error with
    Abort, which leaves the installation part-done. So the helper waits for
    this process and its workers to exit, ends any straggler, and only then
    runs Setup -- which starts Qimchi again (/QIMCHIUPDATE=1).
    """
    quoted = installer.replace("'", "''")
    script = (
        "$ErrorActionPreference='SilentlyContinue';"
        f"Wait-Process -Id {os.getpid()} -Timeout 120;"
        "Get-Process qimchi | Wait-Process -Timeout 60;"
        "Get-Process qimchi | Stop-Process -Force;"
        "Start-Sleep -Seconds 1;"
        f"Start-Process -FilePath '{quoted}' -Wait -ArgumentList "
        "'/SILENT','/SUPPRESSMSGBOXES','/CLOSEAPPLICATIONS',"
        "'/FORCECLOSEAPPLICATIONS','/NORESTART','/QIMCHIUPDATE=1'"
    )
    return [
        "powershell",
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        script,
    ]


def _install_marker_path(home: str | None = None) -> str:
    return os.path.join(home or _qimchi_home(), "updates", "installing.json")


def _mark_install_started(pid: int, tag: str, home: str | None = None) -> None:
    """Record the running installer, so a launch during the install can wait."""
    import json
    import time

    path = _install_marker_path(home)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"pid": pid, "tag": tag, "started": time.time()}, fh)


def _process_is_running(pid: int) -> bool:
    if os.name == "nt":
        import ctypes

        process_query_limited_information = 0x1000
        still_active = 259
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(process_query_limited_information, False, pid)
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            return bool(
                kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
                and code.value == still_active
            )
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _update_being_installed(home: str | None = None, is_running=None) -> str | None:
    """
    The tag an installer is putting in place right now, if any.

    Opening Qimchi while its installer replaces files locks some of them, and
    the installer then aborts part-way, leaving a mix of two versions that no
    longer starts. A stale marker (installer gone, or over 30 minutes old) is
    removed.
    """
    import json
    import time

    path = _install_marker_path(home)
    try:
        with open(path, encoding="utf-8") as fh:
            marker = json.load(fh)
    except (OSError, ValueError):
        return None
    running = (is_running or _process_is_running)(int(marker.get("pid", 0)))
    if running and time.time() - float(marker.get("started", 0)) < 30 * 60:
        return str(marker.get("tag") or "a new version")
    try:
        os.unlink(path)
    except OSError:
        pass
    return None


def _tell_user_update_in_progress(tag: str) -> None:
    message = (
        f"Qimchi is being updated to {tag}.\n\n"
        "It will open by itself when the update has finished."
    )
    if os.name == "nt":
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, message, "Qimchi", 0x40)


def _evaluate_js_detached(window, script: str, log) -> None:
    """
    Run page script without waiting on it from the calling thread.

    pywebview's evaluate_js blocks until the page answers, with no timeout. If
    the window is closing, that answer never comes, and a non-daemon thread
    stuck there -- the thread webview.start(func=...) runs in, or one serving a
    js_api call -- keeps the whole process alive after the window is gone.
    """
    import threading

    def run() -> None:
        try:
            window.evaluate_js(script)
        except Exception as exc:
            log(f"[webview] page script failed: {exc!r}")

    threading.Thread(target=run, name="qimchi-evaluate-js", daemon=True).start()


def _exit_soon_after_close(window, log, grace_seconds: float = 10.0) -> None:
    """
    End the process shortly after the window closes, even if shutdown hangs.

    main() normally exits right after webview.start returns; this covers the
    cases where it never returns, or the backend and export workers hang while
    stopping. A lingering process blocks an installer from replacing the app,
    and on macOS makes the next launch only re-activate the windowless process.
    """
    import threading

    def on_closed() -> None:
        log(f"Window closed; the process will end within {grace_seconds:.0f}s.")
        timer = threading.Timer(grace_seconds, _shut_down, args=(0,))
        timer.daemon = True
        timer.start()

    window.events.closed += on_closed


class _Updates:
    """
    The desktop update flow, shared by the startup check and the SPA.

    Checking, downloading and installing are separate steps, so the app stays
    usable while an update downloads. A downloaded update is remembered in
    <home>/updates/pending.json, so "remind me at next launch" survives a
    restart without downloading again.

    Every change is pushed to the page as a ``qimchi-update`` event; the page
    can also ask for :meth:`status` at any time.
    """

    def __init__(self, log, home: str | None = None) -> None:
        import threading

        self._log = log
        self._home = home
        self._lock = threading.Lock()
        self._window = None
        self._offer: dict | None = None
        self._state: dict = {
            "status": "idle",  # idle | checking | none | available | downloading | downloaded | installing | error
            "current": None,
            "tag": None,
            "notes": "",
            "platform": None,
            "progress": 0.0,
            "error": None,
            "prompt": None,  # "available" | "ready" | None: what the dialog should show
            "checkedAt": None,
        }
        self._last_emitted_progress = -1.0

    # -- plumbing ---------------------------------------------------------------
    def attach(self, window) -> None:
        self._window = window

    def _updates_dir(self) -> str:
        folder = os.path.join(self._home or _qimchi_home(), "updates")
        os.makedirs(folder, exist_ok=True)
        return folder

    def _pending_path(self) -> str:
        return os.path.join(self._updates_dir(), "pending.json")

    def _current_version(self) -> str:
        try:
            from api.updater import current_version

            return current_version()
        except Exception:
            return _app_version()

    def status(self) -> dict:
        with self._lock:
            state = dict(self._state)
        state["current"] = state["current"] or self._current_version()
        return state

    def _set(self, **changes) -> dict:
        with self._lock:
            self._state.update(changes)
            state = dict(self._state)
        state["current"] = state["current"] or self._current_version()
        self._emit(state)
        return state

    def _emit(self, state: dict) -> None:
        if self._window is None:
            return
        import json

        _evaluate_js_detached(
            self._window,
            "window.dispatchEvent(new CustomEvent('qimchi-update', "
            f"{{ detail: {json.dumps(state)} }}))",
            self._log,
        )

    # -- steps ------------------------------------------------------------------
    def restore_pending(self) -> None:
        """Offer an update downloaded in an earlier session, or clear a stale one."""
        import json

        path = self._pending_path()
        if not os.path.exists(path):
            return
        try:
            with open(path, encoding="utf-8") as fh:
                pending = json.load(fh)
        except Exception as exc:
            self._log(f"[updater] ignoring unreadable {path}: {exc!r}")
            self._clear_pending()
            return

        from api.updater import _parse_ver

        running = self._current_version()
        installer = pending.get("path") or ""
        if _parse_ver(pending.get("tag", "")) <= _parse_ver(running):
            self._log(
                f"[updater] {pending.get('tag')} is installed (running {running}); "
                "removing the downloaded installer"
            )
            self._clear_pending()
            return
        if not os.path.isfile(installer):
            self._log(
                f"[updater] downloaded update is gone ({installer}); forgetting it"
            )
            self._clear_pending()
            return
        self._log(f"[updater] {pending['tag']} was downloaded earlier: {installer}")
        self._offer = pending
        self._set(
            status="downloaded",
            tag=pending["tag"],
            notes=pending.get("notes", ""),
            platform=pending.get("platform"),
            progress=1.0,
            error=None,
            prompt="ready",
        )

    def _clear_pending(self) -> None:
        import json

        path = self._pending_path()
        try:
            with open(path, encoding="utf-8") as fh:
                installer = json.load(fh).get("path") or ""
            if installer and os.path.dirname(installer) == self._updates_dir():
                os.unlink(installer)
        except Exception:
            pass
        try:
            os.unlink(path)
        except OSError:
            pass

    def check(
        self, startup: bool = False, include_previews: bool | None = None
    ) -> dict:
        import datetime

        state = self.status()
        if state["status"] in ("checking", "downloading", "installing"):
            self._log(f"[updater] check skipped: already {state['status']}")
            return state
        if include_previews is None:
            try:
                from api.settings import desktop_settings

                include_previews = desktop_settings().previewReleases
            except Exception as exc:
                self._log(f"[updater] could not read the update settings: {exc!r}")
                include_previews = False

        self._log(
            f"[updater] checking for updates ({'startup' if startup else 'manual'})"
        )
        self._set(status="checking", error=None)
        try:
            from api.updater import check_for_update, last_check_error

            result = check_for_update(include_previews=include_previews, log=self._log)
        except Exception as exc:
            result, error = None, f"{type(exc).__name__}: {exc}"
        else:
            error = last_check_error()
        checked_at = datetime.datetime.now().isoformat(timespec="seconds")

        pending = self._offer if state["status"] == "downloaded" else None
        if result is None:
            if pending is not None:
                return self._set(status="downloaded", checkedAt=checked_at)
            if error:
                self._log(f"[updater] update check failed: {error}")
                return self._set(status="error", error=error, checkedAt=checked_at)
            self._log("[updater] no update available")
            return self._set(status="none", tag=None, prompt=None, checkedAt=checked_at)

        if pending is not None and pending.get("tag") == result["tag"]:
            self._log(f"[updater] {result['tag']} is already downloaded")
            return self._set(status="downloaded", checkedAt=checked_at)

        self._offer = result
        self._log(f"[updater] offering {result['tag']}")
        return self._set(
            status="available",
            tag=result["tag"],
            notes=result.get("notes", ""),
            platform=result.get("platform"),
            progress=0.0,
            error=None,
            prompt="available" if startup else None,
            checkedAt=checked_at,
        )

    def download(self) -> dict:
        import threading

        state = self.status()
        offer = self._offer
        if state["status"] != "available" or not offer:
            self._log(f"[updater] nothing to download (status {state['status']})")
            return state

        destination = os.path.join(
            self._updates_dir(), _asset_file_name(offer["asset_url"], offer["platform"])
        )
        self._log(
            f"[updater] downloading {offer['tag']} in the background: "
            f"{offer['asset_url']} -> {destination}"
        )

        def report(fraction: float) -> None:
            if fraction - self._last_emitted_progress >= 0.02 or fraction >= 1:
                self._last_emitted_progress = fraction
                self._set(progress=round(fraction, 3))

        def run() -> None:
            import json

            self._last_emitted_progress = -1.0
            try:
                _download_update_asset(
                    offer["asset_url"], destination, self._log, report
                )
            except Exception as exc:
                self._log(f"[updater] download failed: {exc!r}")
                self._set(status="error", error=f"Download failed: {exc}", prompt=None)
                return
            pending = {
                "tag": offer["tag"],
                "notes": offer.get("notes", ""),
                "platform": offer["platform"],
                "install_mode": offer.get("install_mode", ""),
                "asset_name": offer.get("asset_name", ""),
                "path": destination,
            }
            try:
                with open(self._pending_path(), "w", encoding="utf-8") as fh:
                    json.dump(pending, fh)
            except OSError as exc:
                self._log(f"[updater] could not remember the download: {exc!r}")
            self._offer = pending
            self._log(
                f"[updater] {offer['tag']} downloaded ({os.path.getsize(destination)} "
                "bytes); asking to install"
            )
            self._set(status="downloaded", progress=1.0, prompt="ready")

        self._set(status="downloading", progress=0.0, error=None, prompt=None)
        threading.Thread(target=run, name="qimchi-update-download", daemon=True).start()
        return self.status()

    def remind_at_next_launch(self) -> dict:
        self._log(
            f"[updater] install of {self._state.get('tag')} postponed to next launch"
        )
        return self._set(prompt=None)

    def dismiss(self) -> dict:
        self._log(f"[updater] update dialog dismissed ({self._state.get('status')})")
        return self._set(prompt=None)

    def install(self) -> dict:
        import subprocess

        state = self.status()
        pending = self._offer
        if state["status"] != "downloaded" or not pending or not pending.get("path"):
            self._log(f"[updater] nothing to install (status {state['status']})")
            return state
        installer = pending["path"]
        platform = pending.get("platform") or ""
        self._log(
            f"[updater] installing {pending['tag']} from {installer} "
            f"(platform {platform!r}, running on {sys.platform})"
        )
        self._set(status="installing", prompt=None)
        try:
            if platform == "windows" or os.name == "nt":
                # DETACHED_PROCESS + CREATE_NEW_PROCESS_GROUP so the installer
                # keeps running after this process exits.
                flags = (
                    subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
                )
                process = subprocess.Popen(
                    _windows_install_after_exit_command(installer),
                    creationflags=flags,
                    close_fds=True,
                )
                _mark_install_started(process.pid, pending["tag"], self._home)
                self._log(
                    f"[updater] installer will start once this app has closed "
                    f"(helper pid {process.pid})"
                )
                _close_windows(self._log)
            elif platform == "macos" or sys.platform == "darwin":
                subprocess.Popen(["open", installer], close_fds=True)
                # A running app cannot be replaced from the DMG, so quit.
                self._log(
                    "[updater] opened the disk image; closing app so it can be replaced"
                )
                _close_windows(self._log)
            elif _try_replace_running_appimage(installer, self._log):
                _close_windows(self._log)
            else:
                target = _linux_update_download_path(
                    pending.get("asset_name", ""), installer
                )
                self._log(f"[updater] AppImage saved to {target}; showing it")
                _open_containing_folder(target, self._log)
                self._clear_pending()
                return self._set(status="none", prompt=None)
        except Exception as exc:
            self._log(f"[updater] failed to install: {exc!r}")
            return self._set(status="downloaded", error=f"Install failed: {exc}")
        return self.status()


def _run_update_check(updates: _Updates, log) -> None:
    """
    Startup: offer an update downloaded earlier, then look for a newer one.
    Never raises.
    """
    import time

    # Give the SPA a moment to start listening before announcing anything.
    time.sleep(3)
    try:
        updates.restore_pending()
        from api.settings import desktop_settings

        preferences = desktop_settings()
        log(
            f"[updater] settings: check for updates {preferences.checkForUpdates}, "
            f"preview releases {preferences.previewReleases}"
        )
        if not preferences.checkForUpdates:
            log("[updater] update checks at startup are turned off in Settings")
            return
        updates.check(startup=True, include_previews=preferences.previewReleases)
    except Exception as exc:
        log(f"[updater] unexpected error: {exc!r}")


def _prepare_smoke_fixture() -> tuple[str, str]:
    """Create the isolated dataset and download directory used by CI smoke tests."""
    smoke_root = os.path.join(_qimchi_home(), "desktop-smoke")
    download_dir = os.environ.get(
        "QIMCHI_DOWNLOAD_DIR", os.path.join(smoke_root, "downloads")
    )
    dataset_path = os.environ.get(
        "QIMCHI_SMOKE_DATASET", os.path.join(smoke_root, "smoke-measurement.nc")
    )
    os.makedirs(download_dir, exist_ok=True)
    os.makedirs(os.path.dirname(dataset_path), exist_ok=True)
    with open(dataset_path, "wb") as dataset:
        dataset.write(b"qimchi packaged desktop smoke fixture")
    os.environ["QIMCHI_DOWNLOAD_DIR"] = download_dir
    return dataset_path, download_dir


def _validate_smoke_archive(archive_path: str, dataset_path: str) -> None:
    """Assert that the desktop download is a readable ZIP containing the fixture."""
    import zipfile

    if not os.path.isfile(archive_path):
        raise RuntimeError(f"Desktop download was not created: {archive_path}")
    with zipfile.ZipFile(archive_path) as archive:
        if os.path.basename(dataset_path) not in archive.namelist():
            raise RuntimeError(
                f"Desktop archive does not contain {os.path.basename(dataset_path)}"
            )


def _run_headless_smoke(base_url: str, log) -> bool:
    """Exercise the packaged backend, bundled SPA, and desktop download path."""
    import io
    import json
    import traceback
    import urllib.parse
    import urllib.request
    import zipfile

    try:
        dataset_path, download_dir = _prepare_smoke_fixture()

        with urllib.request.urlopen(f"{base_url}/", timeout=15) as response:
            index_html = response.read().decode("utf-8")
            if response.status != 200 or 'id="root"' not in index_html:
                raise RuntimeError("Bundled frontend index did not load")

        with urllib.request.urlopen(f"{base_url}/health", timeout=15) as response:
            health = json.loads(response.read())
            if response.status != 200 or health.get("ok") is not True:
                raise RuntimeError(f"Backend health check failed: {health}")

        request = urllib.request.Request(
            f"{base_url}/download/",
            data=json.dumps({"path": dataset_path}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            archive_bytes = response.read()
            saved_header = response.headers.get("X-Qimchi-Saved-To")
            if response.status != 200 or not saved_header:
                raise RuntimeError(
                    "Desktop download response did not report a saved path"
                )

        saved_path = urllib.parse.unquote(saved_header)
        if os.path.commonpath(
            (os.path.abspath(saved_path), os.path.abspath(download_dir))
        ) != os.path.abspath(download_dir):
            raise RuntimeError(
                f"Desktop download escaped its test directory: {saved_path}"
            )
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            if os.path.basename(dataset_path) not in archive.namelist():
                raise RuntimeError("HTTP download response is not the expected archive")
        _validate_smoke_archive(saved_path, dataset_path)
        log(f"[smoke] PASS headless packaged-app smoke; archive={saved_path}")
        return True
    except Exception:
        log("[smoke] FAIL headless packaged-app smoke:\n" + traceback.format_exc())
        return False


def _run_native_smoke(window, dataset_path: str, download_dir: str, log) -> bool:
    """Drive one real pywebview workflow and close the native window."""
    import glob
    import time
    import traceback

    try:
        deadline = time.time() + 60
        ready = False
        while time.time() < deadline:
            try:
                state = window.evaluate_js(
                    """
                    (() => ({
                      root: Boolean(document.querySelector('#root')),
                      bridge: Boolean(window.pywebview && window.pywebview.api),
                      download: Boolean(document.querySelector(
                        'button[aria-label="Download smoke-measurement.nc"]'
                      )),
                    }))()
                    """
                )
                if (
                    state
                    and state.get("root")
                    and state.get("bridge")
                    and state.get("download")
                ):
                    ready = True
                    break
            except Exception:
                pass
            time.sleep(0.25)

        if not ready:
            raise RuntimeError("SPA or pywebview bridge did not become ready")

        clicked = window.evaluate_js(
            """
            (() => {
              const button = document.querySelector(
                'button[aria-label="Download smoke-measurement.nc"]'
              );
              if (!button) return false;
              button.click();
              return true;
            })()
            """
        )
        if not clicked:
            raise RuntimeError("Could not click the desktop download action")

        archive_path = None
        deadline = time.time() + 30
        while time.time() < deadline:
            # The basket posts to /download-multiple/, which names its archive
            # after the item count ("items_1_files.zip"), not after the
            # dataset. The download directory is a fresh temp dir per run, so
            # any archive in it is this run's; _validate_smoke_archive checks
            # that it really holds the fixture.
            matches = glob.glob(os.path.join(download_dir, "*.zip"))
            if matches:
                archive_path = matches[0]
                break
            time.sleep(0.25)
        if archive_path is None:
            raise RuntimeError("Native frontend did not create a desktop download")

        _validate_smoke_archive(archive_path, dataset_path)
        log(f"[smoke] PASS native pywebview smoke; archive={archive_path}")
        return True
    except Exception:
        log("[smoke] FAIL native pywebview smoke:\n" + traceback.format_exc())
        return False
    finally:
        try:
            window.destroy()
        except Exception:
            pass


def main() -> int:
    # Re-entry guard (against fork bombs). If a dependency or a
    # stray call ever re-launches the frozen exe, the child inherits this env
    # var and exits immediately instead of starting a second server + window.
    # Note: multiprocessing export workers never reach here -- freeze_support()
    # intercepts them earlier -- so this does not affect the export pool.
    if os.environ.get("QIMCHI_LAUNCHER_ACTIVE") == "1":
        return 0
    os.environ["QIMCHI_LAUNCHER_ACTIVE"] = "1"

    headless_smoke = os.environ.get("QIMCHI_HEADLESS_SMOKE") == "1"
    native_smoke = os.environ.get("QIMCHI_NATIVE_SMOKE") == "1"
    if headless_smoke or native_smoke:
        os.environ["ENABLE_KALEIDO_WARMUP"] = "0"

    import socket
    import threading
    import time
    import traceback
    import urllib.request

    import uvicorn

    if not headless_smoke:
        import webview

    log_file = _open_log_file(_log_path())

    def log(msg: str) -> None:
        print(msg, file=log_file)

    sys.stdout = log_file
    sys.stderr = log_file
    log("Starting Qimchi launcher...")

    # The installer starts Qimchi with --after-update just before it exits.
    after_update = "--after-update" in sys.argv
    if after_update:
        try:
            os.unlink(_install_marker_path())
        except OSError:
            pass
    installing = None if after_update else _update_being_installed()
    if installing:
        log(f"An installer is updating Qimchi to {installing}; not starting now.")
        log_file.flush()
        _tell_user_update_in_progress(installing)
        return 0

    bundle_dir = _bundle_dir()
    sys.path.insert(0, os.path.join(bundle_dir, "backend"))
    os.environ["SERVE_STATIC_FILES"] = "true"
    # Tell the backend it's the desktop build: export zips are written straight
    # to disk (~/Downloads) because WebView2 can't save browser downloads.
    os.environ.setdefault("QIMCHI_DESKTOP", "1")

    # Pick a port: honor QIMCHI_PORT, else 8001, else any free port.
    def _port_is_free(p: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            return s.connect_ex(("127.0.0.1", p)) != 0

    port = int(os.environ.get("QIMCHI_PORT", "8001"))
    if not _port_is_free(port):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        log(f"Default port busy; using free port {port}")

    if not (headless_smoke or native_smoke):
        _ensure_chrome_for_kaleido(log)

    server_error: dict[str, str] = {}
    server_ref: dict[str, uvicorn.Server] = {}

    def start_server() -> None:
        try:
            log("Importing FastAPI app...")
            from main import app

            log(f"Running uvicorn on 127.0.0.1:{port}...")
            config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="info")
            server = uvicorn.Server(config)
            server_ref["server"] = server
            server.run()
        except BaseException:  # noqa: BLE001 - we want EVERYTHING logged
            tb = traceback.format_exc()
            server_error["tb"] = tb
            log("!!! Server thread crashed during startup:\n" + tb)

    t = threading.Thread(target=start_server, daemon=True)
    t.start()

    # Poll /health until the server answers, or the thread dies, or we time out.
    health_url = f"http://127.0.0.1:{port}/health"
    deadline = time.time() + 60.0
    ready = False
    log("Waiting for server /health ...")
    while time.time() < deadline:
        if server_error:
            break
        try:
            with urllib.request.urlopen(health_url, timeout=1.0) as resp:
                if resp.status == 200:
                    ready = True
                    log("Server is ready.")
                    break
        except Exception:
            time.sleep(0.25)

    base_url = health_url.removesuffix("/health")
    if headless_smoke:
        passed = ready and _run_headless_smoke(base_url, log)
        server = server_ref.get("server")
        if server is not None:
            server.should_exit = True
        t.join(timeout=30)
        if t.is_alive():
            log("[smoke] FAIL backend did not stop cleanly")
            passed = False
        log_file.flush()
        return 0 if passed else 1

    if native_smoke and not ready:
        log_file.flush()
        return 1

    # The _Api instance is shared between the folder-picker and the updater so
    # both have access to the log function.
    api = _Api(log)

    smoke_fixture = _prepare_smoke_fixture() if native_smoke else None
    if ready:
        window_url = base_url + "/"
        if smoke_fixture is not None:
            import urllib.parse

            window_url += "?dataset=" + urllib.parse.quote(smoke_fixture[0])
        window = webview.create_window(
            "Qimchi",
            window_url,
            js_api=api,
            maximized=True,
        )
    else:
        window = None
        detail = server_error.get("tb", "Server did not respond within 60s.")
        log("Server never became ready. Showing error window.")
        html = (
            "<html><body style='font-family:sans-serif;padding:2rem'>"
            "<h2>Qimchi failed to start</h2>"
            "<p>The backend server did not come up. Details have been written to "
            f"<code>{_log_path()}</code>.</p><pre style='white-space:pre-wrap;"
            "background:#f4f4f4;padding:1rem;border-radius:6px'>"
            f"{detail}</pre></body></html>"
        )
        webview.create_window("Qimchi - startup error", html=html)

    if window is not None:
        api._updates.attach(window)
        _watch_webview2_crashes(window, log)
        if not native_smoke:
            _exit_soon_after_close(window, log)
    # Live plots poll on a timer, which Chromium throttles while the window is
    # minimized or hidden. The variable is appended to pywebview's own flags.
    os.environ[WEBVIEW2_ARGUMENTS_ENV] = _with_webview2_argument(
        os.environ.get(WEBVIEW2_ARGUMENTS_ENV), "--disable-background-timer-throttling"
    )

    # private_mode=False + a persistent storage_path so the SPA's localStorage
    # (zustand-persisted basket/plot/sidebar state) survives across launches.
    # pywebview defaults to private_mode=True, which wipes it every time.
    storage_path = os.path.join(_qimchi_home(), "webview")
    os.makedirs(storage_path, exist_ok=True)
    _purge_webview_cache_on_upgrade(storage_path, log)

    # Run the update check in the background after the window is ready.
    # Only run when the app started successfully and we're in a frozen build.
    native_smoke_result = {"passed": False}
    if window is not None and (getattr(sys, "frozen", False) or native_smoke):

        def _on_loaded() -> None:
            if native_smoke and smoke_fixture is not None:
                native_smoke_result["passed"] = _run_native_smoke(
                    window, smoke_fixture[0], smoke_fixture[1], log
                )
            else:
                # webview.start runs this in a non-daemon thread; keep it short
                # so it can never hold the process open after the window closes.
                threading.Thread(
                    target=_run_update_check,
                    args=(api._updates, log),
                    name="qimchi-update-check",
                    daemon=True,
                ).start()

        webview.start(
            func=_on_loaded,
            private_mode=False,
            storage_path=storage_path,
        )
    else:
        webview.start(private_mode=False, storage_path=storage_path)
    log("Window closed.")

    if native_smoke:
        server = server_ref.get("server")
        if server is not None:
            server.should_exit = True
        t.join(timeout=30)
        if t.is_alive():
            log("[smoke] FAIL backend did not stop cleanly")
            native_smoke_result["passed"] = False
        log_file.flush()
        return 0 if native_smoke_result["passed"] else 1

    server = server_ref.get("server")
    if server is not None:
        server.should_exit = True
        t.join(timeout=5)
        if t.is_alive():
            log("Backend did not stop within 5s; exiting anyway.")
    log("Qimchi closed.")
    log_file.flush()
    return 0


def _shut_down(code: int) -> None:
    """
    End the process once the window has closed.

    A normal interpreter exit waits for the export pool's workers and their
    Chrome, and one that hangs leaves a windowless process behind. On macOS
    that process keeps the app "running", so the next launch only re-activates
    it: a window flashes and nothing opens, and an update cannot replace it.
    """
    for handle in (sys.stdout, sys.stderr):
        try:
            print(f"Qimchi process exiting (code {code}).", file=handle)
            handle.flush()
        except Exception:
            pass
    try:
        for child in multiprocessing.active_children():
            child.kill()
    except Exception:
        pass
    os._exit(code)


if __name__ == "__main__":
    # MUST be first: on Windows, ProcessPoolExecutor export workers re-execute
    # this frozen exe. freeze_support() makes those children run the worker and
    # exit instead of re-launching uvicorn + a new window.
    multiprocessing.freeze_support()
    exit_code = main()
    if getattr(sys, "frozen", False):
        _shut_down(exit_code)
    raise SystemExit(exit_code)
