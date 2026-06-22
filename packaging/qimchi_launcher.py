"""
Qimchi desktop launcher (PyInstaller + pywebview).

Responsibilities:
1. Starts the FastAPI/uvicorn server on a background thread.
2. Waits until the server actually answers GET /health before opening the window.
3. Surfaces server startup crashes in the window instead of a blank page.
4. Guards multiprocessing so export workers (ProcessPoolExecutor) don't re-launch the whole app on Windows.
5. Best-effort ensure a Chrome/Chromium is available for Kaleido image export on first run.

This file is the source of truth. `build_local.ps1` copies it into the bundle.

"""

import multiprocessing
import os
import sys


# Paths / logging
def _bundle_dir() -> str:
    if getattr(sys, "frozen", False):
        # PyInstaller onefile (temp extraction dir) or onedir (_internal/ subdir)
        return sys._MEIPASS  # type: ignore[attr-defined]
    return os.path.dirname(os.path.abspath(__file__))


def _qimchi_home() -> str:
    """
    The desktop app's home dir (~/.qimchi): persistent WebView2 storage,
    logs, and the downloaded Chrome all live here.
    
    """
    home = os.path.join(os.path.expanduser("~"), ".qimchi")
    try:
        os.makedirs(home, exist_ok=True)
    except OSError:
        pass
    return home


def _log_path() -> str:
    # Debug log lives in ~/.qimchi (falls back to the temp dir if not writable).
    try:
        candidate = os.path.join(_qimchi_home(), "qimchi_debug.log")
        open(candidate, "a").close()
        return candidate
    except OSError:
        import tempfile

        return os.path.join(tempfile.gettempdir(), "qimchi_debug.log")


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
            log("[chrome] no Chrome found; downloading Chrome for Testing (one-time)...")
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

        result = webview.windows[0].create_file_dialog(webview.FOLDER_DIALOG)
        if not result:
            return ""
        return result[0] if isinstance(result, (list, tuple)) else str(result)

    def apply_update(self, asset_url: str) -> None:
        """
        Download the installer to a temp file, launch it silently, then close
        the app.  Called from JS when the user clicks "Update now".

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
                fd, tmp = tempfile.mkstemp(suffix="-qimchi-setup.exe")
                with os.fdopen(fd, "wb") as f:
                    for chunk in resp.iter_content(65536):
                        f.write(chunk)
            except Exception as exc:
                self._log(f"[updater] download failed: {exc!r}")
                return

            self._log(f"[updater] launching installer: {tmp}")
            try:
                # DETACHED_PROCESS + CREATE_NEW_PROCESS_GROUP so the installer
                # keeps running after this process exits.
                flags = 0
                if os.name == "nt":
                    flags = (
                        subprocess.DETACHED_PROCESS
                        | subprocess.CREATE_NEW_PROCESS_GROUP
                    )
                subprocess.Popen(
                    [tmp, "/VERYSILENT", "/SUPPRESSMSGBOXES"],
                    creationflags=flags,
                    close_fds=True,
                )
            except Exception as exc:
                self._log(f"[updater] failed to launch installer: {exc!r}")
                return

            # Close the window so the process exits cleanly and the installer
            # can replace qimchi.exe once it's no longer in use.
            self._log("[updater] closing app for update…")
            import webview

            if webview.windows:
                webview.windows[0].destroy()

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
                        subprocess.Popen(
                            [term, "--", "bash", "-c", f"tail -f '{log}'"]
                        )
                    elif term == "konsole":
                        subprocess.Popen([term, "-e", "bash", "-c", f"tail -f '{log}'"])
                    else:
                        subprocess.Popen([term, "-e", f"tail -f '{log}'"])
                    return True
            return False
        except Exception:
            return False


def _update_dialog_js(tag: str, current: str, notes: str, asset_url: str) -> str:
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
    btnUpdate.textContent = 'Update now';
    btnUpdate.style.cssText = [
        'padding:7px 18px;border-radius:6px;border:none',
        'background:#0a84ff;color:#fff;cursor:pointer',
        'font-size:.875rem;font-weight:500'
    ].join(';');

    btnSkip.onclick   = function() {{ overlay.remove(); }};
    btnUpdate.onclick = function() {{
        btnUpdate.disabled    = true;
        btnUpdate.textContent = 'Downloading…';
        btnUpdate.style.opacity = '.6';
        if (window.pywebview && window.pywebview.api) {{
            window.pywebview.api.apply_update(assetUrl);
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
        )
        window.evaluate_js(js)
    except Exception as exc:
        log(f"[updater] unexpected error: {exc!r}")


def main() -> None:
    # Re-entry guard (against fork bombs). If a dependency or a
    # stray call ever re-launches the frozen exe, the child inherits this env
    # var and exits immediately instead of starting a second server + window.
    # Note: multiprocessing export workers never reach here -- freeze_support()
    # intercepts them earlier -- so this does not affect the export pool.
    if os.environ.get("QIMCHI_LAUNCHER_ACTIVE") == "1":
        return
    os.environ["QIMCHI_LAUNCHER_ACTIVE"] = "1"

    import socket
    import threading
    import time
    import traceback
    import urllib.request

    import uvicorn
    import webview

    log_file = open(_log_path(), "w", buffering=1, encoding="utf-8")

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

    _ensure_chrome_for_kaleido(log)

    server_error: dict[str, str] = {}

    def start_server() -> None:
        try:
            log("Importing FastAPI app...")
            from main import app

            log(f"Running uvicorn on 127.0.0.1:{port}...")
            uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
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

    # The _Api instance is shared between the folder-picker and the updater so
    # both have access to the log function.
    api = _Api(log)

    if ready:
        window = webview.create_window(
            "Qimchi",
            health_url.replace("/health", "/"),
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

    # Run the update check in the background after the window is ready.
    # Only run when the app started successfully and we're in a frozen build.
    if window is not None and getattr(sys, "frozen", False):
        def _on_loaded() -> None:
            _run_update_check(window, log)

        webview.start(
            func=_on_loaded,
            private_mode=False,
            storage_path=storage_path,
        )
    else:
        webview.start(private_mode=False, storage_path=storage_path)


if __name__ == "__main__":
    # MUST be first: on Windows, ProcessPoolExecutor export workers re-execute
    # this frozen exe. freeze_support() makes those children run the worker and
    # exit instead of re-launching uvicorn + a new window.
    multiprocessing.freeze_support()
    main()
