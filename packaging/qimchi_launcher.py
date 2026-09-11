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
    """Running version from package metadata ('unknown' if unavailable)."""
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

    def apply_update(
        self,
        asset_url: str,
        asset_name: str = "",
        platform: str = "",
        install_mode: str = "",
    ) -> None:
        """
        Download the platform update asset and hand it off to the OS.

        Windows runs the Inno Setup installer silently, then closes the app.
        macOS opens the downloaded DMG. Linux downloads the AppImage, marks it
        executable, and opens the containing folder so the user can replace or
        run it.

        Runs in a daemon thread so the UI stays responsive during download.

        """
        import threading

        def _install() -> None:
            import subprocess
            import tempfile

            self._log(f"[updater] downloading installer from {asset_url}")
            try:
                import requests

                resp = requests.get(asset_url, stream=True, timeout=180)
                resp.raise_for_status()
                suffix = _update_asset_suffix(asset_name, asset_url, platform)
                fd, tmp = tempfile.mkstemp(suffix=suffix)
                with os.fdopen(fd, "wb") as f:
                    for chunk in resp.iter_content(65536):
                        if chunk:
                            f.write(chunk)
            except Exception as exc:
                self._log(f"[updater] download failed: {exc!r}")
                return

            self._log(f"[updater] downloaded update asset: {tmp}")
            try:
                if platform == "windows" or os.name == "nt":
                    # DETACHED_PROCESS + CREATE_NEW_PROCESS_GROUP so the installer
                    # keeps running after this process exits.
                    flags = (
                        subprocess.DETACHED_PROCESS
                        | subprocess.CREATE_NEW_PROCESS_GROUP
                    )
                    self._log(f"[updater] launching installer: {tmp}")
                    subprocess.Popen(
                        [tmp, "/VERYSILENT", "/SUPPRESSMSGBOXES"],
                        creationflags=flags,
                        close_fds=True,
                    )
                    self._log("[updater] closing app for update...")
                    import webview

                    if webview.windows:
                        webview.windows[0].destroy()
                    return
                if platform == "macos" or sys.platform == "darwin":
                    self._log(f"[updater] opening downloaded DMG: {tmp}")
                    subprocess.Popen(["open", tmp], close_fds=True)
                    return
                if platform == "linux" or sys.platform.startswith("linux"):
                    if _try_replace_running_appimage(tmp, self._log):
                        import webview

                        if webview.windows:
                            webview.windows[0].destroy()
                        return
                    target = _linux_update_download_path(asset_name, tmp)
                    self._log(f"[updater] downloaded AppImage to: {target}")
                    _open_containing_folder(target, self._log)
                    return
            except Exception as exc:
                self._log(f"[updater] failed to apply update: {exc!r}")
                return

            _open_containing_folder(tmp, self._log)

        threading.Thread(target=_install, daemon=True).start()

    def open_log_terminal(self) -> bool:
        """
        Open the debug log in a terminal that follows it live (best-effort).

        Spawns a SYSTEM terminal (powershell / tail / Terminal.app), never the
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
                        f"Get-Content -LiteralPath '{log}' -Wait",
                    ],
                    creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0),
                )
                return True
            if sys.platform == "darwin":
                subprocess.Popen(
                    [
                        "osascript",
                        "-e",
                        f'tell application "Terminal" to do script "tail -f \\"{log}\\""',
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
                        subprocess.Popen([term, "--", "bash", "-c", f"tail -f '{log}'"])
                    elif term == "konsole":
                        subprocess.Popen([term, "-e", "bash", "-c", f"tail -f '{log}'"])
                    else:
                        subprocess.Popen([term, "-e", f"tail -f '{log}'"])
                    return True
            return False
        except Exception:
            return False


def _update_asset_suffix(asset_name: str, asset_url: str, platform: str) -> str:
    lower = f"{asset_name} {asset_url}".lower()
    if platform == "windows" or "setup.exe" in lower:
        return "-qimchi-setup.exe"
    if platform == "macos" or ".dmg" in lower:
        return "-qimchi.dmg"
    if platform == "linux" or ".appimage" in lower:
        return "-qimchi.AppImage"
    return "-qimchi-update"


def _linux_update_download_path(asset_name: str, tmp: str) -> str:
    import shutil

    downloads = os.path.join(os.path.expanduser("~"), "Downloads")
    os.makedirs(downloads, exist_ok=True)
    name = asset_name if asset_name.lower().endswith(".appimage") else "qimchi.AppImage"
    safe_name = "".join(c for c in name if c.isalnum() or c in "._- ()").strip()
    target = os.path.join(downloads, safe_name or "qimchi.AppImage")
    shutil.move(tmp, target)
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


def _update_dialog_js(
    tag: str,
    current: str,
    notes: str,
    asset_url: str,
    asset_name: str,
    platform: str,
    install_mode: str,
) -> str:
    """
    Return a self-contained JS snippet that injects an update-available overlay
    into the running SPA.  All dynamic strings are JSON-encoded to prevent XSS /
    injection issues regardless of what the GitLab release notes contain.

    """
    import json

    return f"""(function() {{
    if (document.getElementById('qimchi-updater-overlay')) return;

    var tag       = {json.dumps(tag)};
    var current   = {json.dumps(current)};
    var notes     = {json.dumps(notes)};
    var assetUrl  = {json.dumps(asset_url)};
    var assetName = {json.dumps(asset_name)};
    var platform  = {json.dumps(platform)};
    var installMode = {json.dumps(install_mode)};
    var actionText = platform === 'windows' ? 'Update now' : 'Download update';

    var overlay = document.createElement('div');
    overlay.id  = 'qimchi-updater-overlay';
    overlay.style.cssText = [
        'position:fixed;inset:0;z-index:99999',
        'background:rgba(0,0,0,.65)',
        'display:flex;align-items:center;justify-content:center',
        'font-family:system-ui,sans-serif'
    ].join(';');

    var card = document.createElement('div');
    card.style.cssText = [
        'background:#1c1c1e;color:#e5e5e7',
        'border:1px solid #3a3a3c;border-radius:10px',
        'padding:24px 28px;max-width:520px;width:90%',
        'box-shadow:0 24px 64px rgba(0,0,0,.6)',
        'display:flex;flex-direction:column;gap:14px'
    ].join(';');

    var title = document.createElement('div');
    title.style.cssText = 'font-size:1.05rem;font-weight:600;color:#f5f5f7';
    title.textContent = 'Qimchi ' + tag + ' is available';

    var sub = document.createElement('div');
    sub.style.cssText = 'font-size:.8rem;color:#8e8e93';
    sub.textContent = 'You are running ' + current + '.';

    var notesBox = document.createElement('pre');
    notesBox.style.cssText = [
        'margin:0;padding:12px 14px',
        'background:#111113;border:1px solid #2c2c2e;border-radius:6px',
        'font-size:.78rem;line-height:1.5;color:#c7c7cc',
        'max-height:220px;overflow-y:auto',
        'white-space:pre-wrap;word-break:break-word'
    ].join(';');
    notesBox.textContent = notes || '(No release notes.)';

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:4px';

    var btnSkip = document.createElement('button');
    btnSkip.textContent = 'Skip';
    btnSkip.style.cssText = [
        'padding:7px 18px;border-radius:6px;border:1px solid #3a3a3c',
        'background:transparent;color:#aeaeb2;cursor:pointer;font-size:.875rem'
    ].join(';');

    var btnUpdate = document.createElement('button');
    btnUpdate.id = 'qimchi-updater-btn';
    btnUpdate.textContent = actionText;
    btnUpdate.style.cssText = [
        'padding:7px 18px;border-radius:6px;border:none',
        'background:#0a84ff;color:#fff;cursor:pointer',
        'font-size:.875rem;font-weight:500'
    ].join(';');

    btnSkip.onclick   = function() {{ overlay.remove(); }};
    btnUpdate.onclick = function() {{
        btnUpdate.disabled    = true;
        btnUpdate.textContent = 'Downloading...';
        btnUpdate.style.opacity = '.6';
        if (window.pywebview && window.pywebview.api) {{
            window.pywebview.api.apply_update(assetUrl, assetName, platform, installMode);
        }}
    }};

    btnRow.appendChild(btnSkip);
    btnRow.appendChild(btnUpdate);
    card.appendChild(title);
    card.appendChild(sub);
    card.appendChild(notesBox);
    card.appendChild(btnRow);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
}})();"""


def _run_update_check(window, log) -> None:
    """
    Background thread: fetch the latest GitLab release and show an update
    dialog if a newer version is available.  Never raises.

    """
    import time

    # Give the SPA a moment to render before injecting the overlay.
    time.sleep(3)
    try:
        from api.updater import check_for_update, current_version

        result = check_for_update()
        if result is None:
            log("[updater] no update available")
            return
        js = _update_dialog_js(
            tag=result["tag"],
            current=current_version(),
            notes=result["notes"],
            asset_url=result["asset_url"],
            asset_name=result.get("asset_name", ""),
            platform=result.get("platform", ""),
            install_mode=result.get("install_mode", ""),
        )
        window.evaluate_js(js)
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
                _run_update_check(window, log)

        webview.start(
            func=_on_loaded,
            private_mode=False,
            storage_path=storage_path,
        )
    else:
        webview.start(private_mode=False, storage_path=storage_path)

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
    return 0


if __name__ == "__main__":
    # MUST be first: on Windows, ProcessPoolExecutor export workers re-execute
    # this frozen exe. freeze_support() makes those children run the worker and
    # exit instead of re-launching uvicorn + a new window.
    multiprocessing.freeze_support()
    raise SystemExit(main())
