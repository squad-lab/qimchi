"""Resource sampling, exception hooks, page errors, and log bundles."""

from __future__ import annotations

import asyncio
import ctypes
import json
import logging
import os
import platform
import sys
import tempfile
import threading
import time
import zipfile
from collections import deque
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Literal

from fastapi import APIRouter, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .logger import LOG_PATH, logger

router = APIRouter(prefix="/diagnostics")

_MB = 1024 * 1024
_GAUGES: dict[str, Callable[[], int]] = {}


def register_gauge(name: str, read: Callable[[], int]) -> None:
    """Report ``read()`` (a count of cached or pending items) in every sample."""
    _GAUGES[name] = read


def _gauge_values() -> dict[str, int]:
    values = {}
    for name, read in list(_GAUGES.items()):
        try:
            values[name] = int(read())
        except Exception:
            continue
    return values


# --------------------------------------------------------------------------- #
# Process sampling
# --------------------------------------------------------------------------- #
_CHROME_NAMES = (
    "chrome",
    "google chrome",
    "google chrome for testing",
    "chromium",
    "chromium-browser",
    "headless_shell",
)
_LINUX_WEBVIEW_PREFIXES = (
    "webkitwebprocess",
    "webkitnetworkprocess",
    "webkitgpuprocess",
)
_CHROMIUM_WRAPPER = "_unix_pipe_chromium_wrapper.py"


def _process_name(proc) -> str:
    name = (proc.info.get("name") if hasattr(proc, "info") else None) or proc.name()
    name = name.lower()
    return name[:-4] if name.endswith(".exe") else name


def _group_of(proc) -> str:
    """Which part of Qimchi a descendant process belongs to."""
    name = _process_name(proc)
    if name.startswith("msedgewebview2") or name.startswith(_LINUX_WEBVIEW_PREFIXES):
        return "webview"
    if name in _CHROME_NAMES:
        return "chrome"
    try:
        cmdline = " ".join(proc.cmdline())
    except Exception:
        cmdline = ""
    # Frozen macOS/Linux builds start Chrome through the launcher itself.
    if _CHROMIUM_WRAPPER in cmdline:
        return "chrome"
    if "multiprocessing" in cmdline or name.startswith(("python", "qimchi")):
        return "workers"
    return "other"


_responsible_pid_fn: Any = None
_responsible_pid_state = "untried"


def _responsible_pid(pid: int) -> int | None:
    """
    Return the process macOS holds responsible for ``pid``.

    WKWebView uses launchd XPC services, so ordinary parentage is insufficient.
    """
    global _responsible_pid_fn, _responsible_pid_state
    if _responsible_pid_state == "untried":
        _responsible_pid_state = "unavailable"
        try:
            lib = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
            fn = lib.responsibility_get_pid_responsible_for_pid
            fn.argtypes = [ctypes.c_int]
            fn.restype = ctypes.c_int
            _responsible_pid_fn = fn
            _responsible_pid_state = "ok"
        except Exception:
            logger.info("[resources] macOS responsible-pid lookup unavailable")
    if _responsible_pid_state != "ok":
        return None
    try:
        result = int(_responsible_pid_fn(pid))
    except Exception:
        return None
    return result if result > 0 else None


def _macos_webview_processes(psutil, own_pid: int) -> list | None:
    """WebKit processes macOS attributes to Qimchi, or None when it cannot say."""
    _responsible_pid(own_pid)
    if _responsible_pid_state != "ok":
        return None
    found = []
    for proc in psutil.process_iter(["pid", "name"]):
        try:
            if (proc.info.get("name") or "").startswith("com.apple.WebKit"):
                if _responsible_pid(proc.pid) == own_pid:
                    found.append(proc)
        except Exception:
            continue
    return found


def _memory(proc) -> tuple[int, int]:
    """Resident and private bytes. Private falls back to resident."""
    info = proc.memory_info()
    rss = int(info.rss)
    private = getattr(info, "private", None)  # Windows
    if private is None:
        try:
            private = proc.memory_full_info().uss
        except Exception:
            private = rss
    return rss, int(private)


def sample() -> dict[str, Any]:
    """One measurement of Qimchi's processes, the system and the gauges."""
    import psutil

    me = psutil.Process()
    groups: dict[str, list] = {
        "qimchi": [me],
        "workers": [],
        "chrome": [],
        "webview": [],
    }
    try:
        descendants = me.children(recursive=True)
    except Exception:
        descendants = []
    for proc in descendants:
        try:
            group = _group_of(proc)
        except Exception:
            continue
        if group in groups:
            groups[group].append(proc)

    webview_available = True
    if sys.platform == "darwin":
        try:
            extra = _macos_webview_processes(psutil, me.pid)
        except Exception:
            extra = None
        if extra is None:
            webview_available = bool(groups["webview"])
        else:
            groups["webview"].extend(extra)

    result: dict[str, Any] = {"time": datetime.now().isoformat(timespec="seconds")}
    for group, procs in groups.items():
        rss = private = count = 0
        for proc in procs:
            try:
                r, p = _memory(proc)
            except Exception:
                continue
            rss += r
            private += p
            count += 1
        result[group] = {"count": count, "rss": rss, "private": private}
    if not webview_available:
        result["webview"] = None

    try:
        result["threads"] = me.num_threads()
        handles = me.num_handles() if hasattr(me, "num_handles") else me.num_fds()
        result["handles"] = handles
        result["cpu_percent"] = me.cpu_percent(interval=None)
    except Exception:
        pass
    try:
        memory = psutil.virtual_memory()
        result["system"] = {
            "available": int(memory.available),
            "percent": memory.percent,
        }
    except Exception:
        pass
    result["gauges"] = _gauge_values()
    if _page_heap:
        result["page_heap"] = dict(_page_heap)
    return result


def _mb(value: int) -> str:
    megabytes = value / _MB
    return f"{megabytes / 1024:.1f} GB" if megabytes >= 1024 else f"{megabytes:.0f} MB"


def _total(sample_: dict[str, Any]) -> int:
    return sum(
        (sample_.get(group) or {}).get("private", 0)
        for group in ("qimchi", "workers", "chrome", "webview")
    )


def format_sample(current: dict[str, Any], baseline: dict[str, Any] | None) -> str:
    """One readable line: private memory per group, growth, counts and gauges."""
    parts = []
    for group in ("qimchi", "workers", "chrome", "webview"):
        data = current.get(group)
        if data is None:
            parts.append(f"{group} unavailable")
            continue
        count = f"{data['count']}x " if group != "qimchi" else ""
        parts.append(f"{group} {count}{_mb(data['private'])}")
    total = _total(current)
    line = " | ".join(parts) + f" | total {_mb(total)}"
    if baseline is not None:
        delta = (total - _total(baseline)) / _MB
        line += f" ({delta:+.0f} MB since start)"
    if "threads" in current:
        line += f" | threads {current['threads']} handles {current.get('handles', '?')}"
    system = current.get("system")
    if system:
        line += (
            f" | system free {_mb(system['available'])} ({system['percent']:.0f}% used)"
        )
    heap = current.get("page_heap")
    if heap and heap.get("used"):
        line += f" | page heap {_mb(int(heap['used']))}"
    gauges = current.get("gauges") or {}
    if gauges:
        line += " | " + ", ".join(
            f"{name}={value}" for name, value in sorted(gauges.items())
        )
    return "[resources] " + line


class _Sampler:
    """Periodic and on-demand resource lines, measured off the event loop."""

    def __init__(self) -> None:
        self.baseline: dict[str, Any] | None = None
        self.latest: dict[str, Any] | None = None
        self._lock = threading.Lock()

    def snapshot(self, reason: str | None = None) -> dict[str, Any] | None:
        """Measure and log now. Safe to call from any thread; never raises."""
        try:
            current = sample()
        except Exception:
            logger.debug("[resources] sampling failed", exc_info=True)
            return None
        with self._lock:
            if self.baseline is None:
                self.baseline = current
            self.latest = current
            baseline = self.baseline
        line = format_sample(current, baseline)
        logger.info(f"{line} ({reason})" if reason else line)
        return current

    async def run(self, interval: float) -> None:
        while True:
            await asyncio.to_thread(self.snapshot)
            await asyncio.sleep(interval)


sampler = _Sampler()


def resource_log_interval() -> float:
    try:
        return max(0.0, float(os.environ.get("QIMCHI_RESOURCE_LOG_INTERVAL", "60")))
    except ValueError:
        return 60.0


async def watch_event_loop(threshold: float = 0.5, period: float = 0.5) -> None:
    """Log when the event loop was blocked, which is what a frozen UI looks like."""
    loop = asyncio.get_running_loop()
    last_report = 0.0
    while True:
        start = loop.time()
        await asyncio.sleep(period)
        lag = loop.time() - start - period
        if lag > threshold and loop.time() - last_report > 10:
            last_report = loop.time()
            logger.warning("[diagnostics] event loop was blocked for %.2f s", lag)


# --------------------------------------------------------------------------- #
# Exception hooks
# --------------------------------------------------------------------------- #
_hooks_installed = False


def install_exception_hooks() -> None:
    """Log uncaught exceptions from any thread with a timestamp and its name."""
    global _hooks_installed
    if _hooks_installed:
        return
    _hooks_installed = True
    previous_sys = sys.excepthook
    previous_thread = threading.excepthook

    def on_uncaught(exc_type, exc, tb) -> None:
        if not issubclass(exc_type, KeyboardInterrupt):
            logger.error(
                "[diagnostics] uncaught exception", exc_info=(exc_type, exc, tb)
            )
        previous_sys(exc_type, exc, tb)

    def on_thread(args) -> None:
        if args.exc_type is not SystemExit:
            name = args.thread.name if args.thread else "unknown"
            logger.error(
                "[diagnostics] uncaught exception in thread %s",
                name,
                exc_info=(args.exc_type, args.exc_value, args.exc_traceback),
            )
        previous_thread(args)

    sys.excepthook = on_uncaught
    threading.excepthook = on_thread


def asyncio_exception_handler(loop: asyncio.AbstractEventLoop, context: dict) -> None:
    exc = context.get("exception")
    logger.error(
        "[diagnostics] %s",
        context.get("message", "unhandled error in a background task"),
        exc_info=(type(exc), exc, exc.__traceback__) if exc else None,
    )


# --------------------------------------------------------------------------- #
# Polling noise
# --------------------------------------------------------------------------- #
# Suppress successful access logs for the SPA's polling endpoints.
_QUIET_PATHS = (
    "/health",
    "/load-live/",
    "/transform-plot",
    "/telemetry/",
    "/diagnostics/",
)


class QuietPollingFilter(logging.Filter):
    """Drop successful access-log lines for endpoints the SPA polls."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args if isinstance(record.args, tuple) else ()
        # uvicorn.access: (client, method, path, http_version, status)
        if len(args) >= 5:
            path, status = str(args[2]), args[4]
            if (
                isinstance(status, int)
                and status < 400
                and path.startswith(_QUIET_PATHS)
            ):
                return logger.isEnabledFor(logging.DEBUG)
        return True


def quiet_polling_access_log() -> None:
    access = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, QuietPollingFilter) for f in access.filters):
        access.addFilter(QuietPollingFilter())


# --------------------------------------------------------------------------- #
# Page errors
# --------------------------------------------------------------------------- #
frontend_logger = logging.getLogger("qimchi.frontend")
_page_heap: dict[str, float] = {}
_CLIENT_LOG_LIMIT = 60  # per minute
_client_log_times: deque[float] = deque()
_client_log_dropped = 0


class ClientLog(BaseModel):
    level: Literal["error", "warning", "info"] = "error"
    message: str = Field(default="", max_length=20_000)
    stack: str | None = Field(default=None, max_length=50_000)
    source: str | None = Field(default=None, max_length=200)
    heap_used: float | None = None
    heap_total: float | None = None


def _allow_client_log(now: float) -> bool:
    global _client_log_dropped
    while _client_log_times and now - _client_log_times[0] > 60:
        _client_log_times.popleft()
    if len(_client_log_times) >= _CLIENT_LOG_LIMIT:
        _client_log_dropped += 1
        return False
    _client_log_times.append(now)
    return True


@router.post("/client-log")
async def client_log(entry: ClientLog) -> dict:
    """Record an error from the page, or its JS heap size (a heartbeat)."""
    global _client_log_dropped
    if entry.heap_used is not None:
        _page_heap["used"] = entry.heap_used
        if entry.heap_total is not None:
            _page_heap["total"] = entry.heap_total
    if not entry.message:
        return {"logged": False}
    if not _allow_client_log(time.monotonic()):
        return {"logged": False}
    if _client_log_dropped:
        frontend_logger.warning(
            "%d page messages were dropped (too many)", _client_log_dropped
        )
        _client_log_dropped = 0
    text = entry.message[:4000]
    if entry.source:
        text = f"{text} [{entry.source}]"
    if entry.stack:
        text += "\n" + entry.stack[:4000]
    frontend_logger.log(getattr(logging, entry.level.upper()), text)
    return {"logged": True}


# --------------------------------------------------------------------------- #
# Bug-report bundle
# --------------------------------------------------------------------------- #
_CRASH_REPORT_MAX_AGE = timedelta(days=14)
_CRASH_REPORT_MAX_BYTES = 100 * _MB


class BundleRequest(BaseModel):
    include_crash_reports: bool = False


def _home() -> Path:
    override = os.environ.get("QIMCHI_HOME")
    return Path(override).expanduser() if override else Path.home() / ".qimchi"


def _log_files() -> list[Path]:
    folder = LOG_PATH.parent
    names = ("qimchi.log*", "qimchi_debug.log*")
    found = {
        path for pattern in names for path in folder.glob(pattern) if path.is_file()
    }
    return sorted(found)


def _crash_reports() -> list[Path]:
    """WebView crash dumps from the last two weeks, newest first."""
    candidates: list[Path] = []
    candidates += (_home() / "webview").glob("**/Crashpad/reports/*")
    if sys.platform == "darwin":
        reports = Path.home() / "Library" / "Logs" / "DiagnosticReports"
        for pattern in ("com.apple.WebKit*", "qimchi*", "Qimchi*"):
            candidates += reports.glob(pattern)
    cutoff = (datetime.now() - _CRASH_REPORT_MAX_AGE).timestamp()
    recent = []
    for path in candidates:
        try:
            if path.is_file() and path.stat().st_mtime >= cutoff:
                recent.append(path)
        except OSError:
            continue
    return sorted(recent, key=lambda p: p.stat().st_mtime, reverse=True)


def system_info() -> dict[str, Any]:
    info: dict[str, Any] = {
        "created": datetime.now().astimezone().isoformat(timespec="seconds"),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "python": sys.version.split()[0],
        "frozen": bool(getattr(sys, "frozen", False)),
        "qimchi_home": str(_home()),
        "log_folder": str(LOG_PATH.parent),
        "browser_path": os.environ.get("BROWSER_PATH"),
    }
    try:
        from .updater import current_version

        info["version"] = current_version()
    except Exception:
        pass
    try:
        import psutil

        info["memory_total"] = int(psutil.virtual_memory().total)
        info["cpu_count"] = psutil.cpu_count()
    except Exception:
        pass
    info["latest_resources"] = sampler.latest
    return info


def build_bundle(destination: Path, include_crash_reports: bool) -> dict[str, Any]:
    """Zip the logs, system details and optionally crash reports."""
    manifest: dict[str, Any] = {"logs": [], "crash_reports": [], "skipped": []}
    sampler.snapshot("bug report")
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as bundle:
        for path in _log_files():
            try:
                bundle.write(path, f"logs/{path.name}")
                manifest["logs"].append(path.name)
            except OSError as exc:
                manifest["skipped"].append(f"{path.name}: {exc}")
        if include_crash_reports:
            budget = _CRASH_REPORT_MAX_BYTES
            for path in _crash_reports():
                try:
                    size = path.stat().st_size
                    if size > budget:
                        manifest["skipped"].append(f"{path.name}: over the size limit")
                        continue
                    bundle.write(path, f"crash-reports/{path.name}")
                    budget -= size
                    manifest["crash_reports"].append(path.name)
                except OSError as exc:
                    manifest["skipped"].append(f"{path.name}: {exc}")
        info = system_info()
        info["bundle"] = manifest
        bundle.writestr("system-info.json", json.dumps(info, indent=2, default=str))
    return manifest


@router.post("/bundle", response_model=None)
async def bundle_logs(
    request: BundleRequest, background: BackgroundTasks
) -> FileResponse | dict:
    """Create a log bundle, saving it directly in desktop mode."""
    from .export import _desktop_export_dir
    from .settings import export_settings

    name = f"qimchi-logs-{datetime.now():%Y%m%d-%H%M%S}.zip"
    folder = await asyncio.to_thread(
        lambda: _desktop_export_dir(export_settings().folder)
    )
    if folder is not None:
        target = folder / name
        manifest = await asyncio.to_thread(
            build_bundle, target, request.include_crash_reports
        )
        logger.info("[diagnostics] saved a log bundle to %s", target)
        return {"path": str(target), **manifest}

    handle, temp = tempfile.mkstemp(suffix=".zip")
    os.close(handle)
    await asyncio.to_thread(build_bundle, Path(temp), request.include_crash_reports)
    background.add_task(lambda: Path(temp).unlink(missing_ok=True))
    return FileResponse(temp, media_type="application/zip", filename=name)
