import logging
import os
import sys
from concurrent_log_handler import ConcurrentRotatingFileHandler as RotatingFileHandler
from pathlib import Path

try:
    from rich.logging import RichHandler
except Exception:
    RichHandler = None

BASE_DIR = Path(__file__).resolve().parents[1]


def _resolve_log_path() -> Path:
    """
    Decide where ``qimchi.log`` lives.

    In a frozen build ``BASE_DIR`` is inside the *installation* directory
    (``_internal/backend`` under %LOCALAPPDATA%\\Programs or Program Files).
    Logging there is actively harmful:

    * ``ConcurrentRotatingFileHandler`` keeps ``qimchi.log`` and a
      ``.__qimchi.lock`` sidecar open, so the auto-update installer cannot
      replace files in that directory -- with ``/VERYSILENT /SUPPRESSMSGBOXES``
      the in-use prompt is suppressed and the upgrade can silently skip files.
    * A machine-wide install puts it under Program Files, which is read-only
      for a normal user, so opening the log fails outright.

    So a frozen/desktop run logs to the app home (``~/.qimchi``), alongside the
    launcher's ``qimchi_debug.log``. Dev runs keep ``backend/qimchi.log``.

    """
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
            # All logs live together in <home>/logs: this file, its rotation
            # backups, and the launcher's qimchi_debug.log. ~/.qimchi survives
            # updates (they replace program files only), so history is kept.
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
LOG_PATH.parent.mkdir(parents=True, exist_ok=True)


def get_logger(name: str = "qimchi") -> logging.Logger:
    """
    Return a configured logger with RotatingFileHandler and RichHandler + console.

    The file is written to ``LOG_PATH`` (see ``_resolve_log_path``):
    ``~/.qimchi/qimchi.log`` when frozen, ``backend/qimchi.log`` in dev.
    Rotation: 20 MB, 5 backups.

    """
    logger = logging.getLogger(name)
    if getattr(logger, "__configured", False):
        return logger

    logger.setLevel(logging.DEBUG)

    # Rotating file handler
    fh = RotatingFileHandler(
        filename=str(LOG_PATH),
        maxBytes=20 * 1024 * 1024,  # 20 MB
        backupCount=5,  # 5 backups
        encoding="utf-8",
    )
    fh.setLevel(logging.DEBUG)
    fh_formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    fh.setFormatter(fh_formatter)
    logger.addHandler(fh)

    # Console handler: use RichHandler if available, fallback to StreamHandler
    if RichHandler is not None:
        ch = RichHandler(rich_tracebacks=True)
        # RichHandler uses its own formatting; set level only
        ch.setLevel(logging.INFO)
    else:
        ch = logging.StreamHandler()
        ch.setLevel(logging.INFO)
        ch.setFormatter(
            logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
        )

    logger.addHandler(ch)

    # Avoid duplicate logs when uvicorn/root config also configures logging
    logger.propagate = False
    logger.__configured = True
    return logger


def consolidate_root_logging() -> None:
    """
    Send every other logger's file output to the same ``qimchi.log``.

    Several modules use ``logging.getLogger(__name__)`` (``api.updater``,
    ``api.live_measurements``), and uvicorn has its own loggers. Without this
    they only reach stderr -- which in the desktop app means the launcher's
    debug log, i.e. not the rotating, preserved file. Attaching one shared
    handler to the root logger consolidates them.

    The ``qimchi`` logger sets ``propagate = False`` and keeps its own handler,
    so nothing is written twice.

    """
    root = logging.getLogger()

    # Drop a handler we attached earlier rather than bailing out. The root
    # logger survives a module reload, so a "already done" flag would leave an
    # old handler pointing at the previous log path after LOG_PATH changes.
    for handler in list(root.handlers):
        if getattr(handler, "_qimchi_root_handler", False):
            root.removeHandler(handler)
            try:
                handler.close()
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
            fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )
    fh._qimchi_root_handler = True
    root.addHandler(fh)
    if root.level == logging.NOTSET or root.level > logging.INFO:
        root.setLevel(logging.INFO)


# Export module-level default logger for convenience
logger = get_logger("qimchi")
consolidate_root_logging()
