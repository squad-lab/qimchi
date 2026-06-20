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
        # PyInstaller onefile extraction dir
        return sys._MEIPASS  # type: ignore[attr-defined]
    return os.path.dirname(os.path.abspath(__file__))


def _log_path() -> str:
    # Write the debug log next to the executable (predictable location),
    # falling back to the temp dir if that's not writable.
    if getattr(sys, "frozen", False):
        base = os.path.dirname(sys.executable)
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    try:
        candidate = os.path.join(base, "qimchi_debug.log")
        open(candidate, "a").close()
        return candidate
    except OSError:
        import tempfile

        return os.path.join(tempfile.gettempdir(), "qimchi_debug.log")


def _persistent_chrome_dir() -> str:
    """
    Persistent, writable dir for a downloaded Chrome (survives across runs).

    """
    return os.path.join(os.path.expanduser("~"), ".qimchi", "chrome")


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

    if ready:
        webview.create_window("Qimchi", health_url.replace("/health", "/"))
    else:
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

    webview.start()


if __name__ == "__main__":
    # MUST be first: on Windows, ProcessPoolExecutor export workers re-execute
    # this frozen exe. freeze_support() makes those children run the worker and
    # exit instead of re-launching uvicorn + a new window.
    multiprocessing.freeze_support()
    main()
