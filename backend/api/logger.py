import atexit
import logging
import logging.handlers
import os
import queue
import sys
import time
from pathlib import Path

from concurrent_log_handler import ConcurrentRotatingFileHandler as RotatingFileHandler

try:
    from rich.logging import RichHandler
except Exception:
    RichHandler = None

BASE_DIR = Path(__file__).resolve().parents[1]


def _resolve_log_path() -> Path:
    """Use the app data directory for desktop logs and the backend for dev logs."""
    override = os.getenv("QIMCHI_LOG_PATH")
    if override:
        path = Path(override).expanduser()
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    if getattr(sys, "frozen", False) or os.getenv("QIMCHI_DESKTOP") == "1":
        home_override = os.getenv("QIMCHI_HOME")
        home = (
            Path(home_override).expanduser()
            if home_override
            else Path.home() / ".qimchi"
        )
        try:
            # Keep backend and launcher logs in the update-safe app home.
            logs_dir = home / "logs"
            logs_dir.mkdir(parents=True, exist_ok=True)
            _migrate_legacy_log(home / "qimchi.log", logs_dir / "qimchi.log")
            return logs_dir / "qimchi.log"
        except OSError:
            pass  # fall through to the in-tree default

    return BASE_DIR / "qimchi.log"


def _migrate_legacy_log(old: Path, new: Path) -> None:
    """Move a pre-consolidation log into logs/ so history isn't orphaned."""
    try:
        if old.is_file() and not new.exists():
            old.replace(new)
    except OSError:
        pass  # best-effort; a locked old log just stays where it is


LOG_PATH = _resolve_log_path()

# Millisecond timestamps, matching the desktop launcher's debug log.
FILE_FORMAT = "%(asctime)s.%(msecs)03d [%(levelname)s] %(name)s: %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"
# The desktop launcher timestamps every line it writes to its debug log.
CONSOLE_FORMAT = "[%(levelname)s] %(name)s: %(message)s"


def _desktop() -> bool:
    return bool(getattr(sys, "frozen", False)) or os.getenv("QIMCHI_DESKTOP") == "1"


LOG_PATH.parent.mkdir(parents=True, exist_ok=True)


def _configured_level() -> int:
    """Return QIMCHI_LOG_LEVEL, defaulting to INFO."""
    name = os.getenv("QIMCHI_LOG_LEVEL", "INFO").upper()
    level = logging.getLevelNamesMapping().get(name)
    return level if isinstance(level, int) else logging.INFO


class _QueueHandler(logging.handlers.QueueHandler):
    """Queue log records while preserving synchronous ``flush()`` semantics."""

    def __init__(self, record_queue: queue.Queue, listener) -> None:
        super().__init__(record_queue)
        self.listener = listener

    def flush(self) -> None:
        deadline = time.monotonic() + 2.0
        while not self.queue.empty() and time.monotonic() < deadline:
            time.sleep(0.005)
        for handler in self.listener.handlers:
            handler.flush()

    def close(self) -> None:
        # uvicorn closes handlers during startup; keep the listener alive.
        self.flush()
        super().close()

    def stop_writing(self) -> None:
        """Stop writing and let go of the log file and its lock sidecar."""
        self.listener.stop()
        for handler in self.listener.handlers:
            handler.close()
        super().close()


def _attach_through_queue(
    target: logging.Logger, *handlers: logging.Handler
) -> logging.Handler:
    """Move file and console writes off request threads."""
    record_queue: queue.Queue = queue.Queue(-1)
    listener = logging.handlers.QueueListener(
        record_queue, *handlers, respect_handler_level=True
    )
    listener.start()
    atexit.register(listener.stop)
    handler = _QueueHandler(record_queue, listener)
    target.addHandler(handler)
    return handler


def get_logger(name: str = "qimchi") -> logging.Logger:
    """Return the configured console and rotating-file logger."""
    logger = logging.getLogger(name)
    if getattr(logger, "__configured", False):
        return logger

    logger.setLevel(_configured_level())

    # Rotating file handler
    fh = RotatingFileHandler(
        filename=str(LOG_PATH),
        maxBytes=20 * 1024 * 1024,  # 20 MB
        backupCount=5,  # 5 backups
        encoding="utf-8",
    )
    fh.setLevel(logging.DEBUG)
    fh_formatter = logging.Formatter(
        fmt=FILE_FORMAT,
        datefmt=DATE_FORMAT,
    )
    fh.setFormatter(fh_formatter)

    # Console handler. In the desktop app the console is the debug log, where
    # Rich's column layout wraps long lines and breaks searching.
    if RichHandler is not None and not _desktop():
        ch = RichHandler(rich_tracebacks=True)
        # RichHandler uses its own formatting; set level only
        ch.setLevel(logging.INFO)
    else:
        ch = logging.StreamHandler()
        ch.setLevel(logging.INFO)
        ch.setFormatter(
            logging.Formatter(CONSOLE_FORMAT)
            if _desktop()
            else logging.Formatter(FILE_FORMAT, DATE_FORMAT)
        )

    _attach_through_queue(logger, fh, ch)

    # Avoid duplicate logs when uvicorn/root config also configures logging
    logger.propagate = False
    logger.__configured = True
    return logger


def consolidate_root_logging() -> None:
    """
    Send every other logger's file output to the same ``qimchi.log``.


    """
    root = logging.getLogger()

    for handler in list(root.handlers):
        if getattr(handler, "_qimchi_root_handler", False):
            root.removeHandler(handler)
            try:
                handler.stop_writing()
            except Exception:
                pass

    fh = RotatingFileHandler(
        filename=str(LOG_PATH),
        maxBytes=20 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    fh.setLevel(logging.INFO)
    fh.setFormatter(
        logging.Formatter(
            fmt=FILE_FORMAT,
            datefmt=DATE_FORMAT,
        )
    )
    _attach_through_queue(root, fh)
    root.handlers[-1]._qimchi_root_handler = True
    if root.level == logging.NOTSET or root.level > logging.INFO:
        root.setLevel(logging.INFO)


# Export module-level default logger for convenience
logger = get_logger("qimchi")
consolidate_root_logging()
