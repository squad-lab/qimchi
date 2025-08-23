import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

try:
    from rich.logging import RichHandler
except Exception:
    RichHandler = None

# Ensure backend directory exists and log file path
BASE_DIR = Path(__file__).resolve().parents[1]
LOG_PATH = BASE_DIR / "qimchi.log"  # TODO: # CHANGEME:
LOG_PATH.parent.mkdir(parents=True, exist_ok=True)


def get_logger(name: str = "qimchi") -> logging.Logger:
    """
    Return a configured logger with RotatingFileHandler and RichHandler + console.

    The file is written to ``backend/qimchi.log``. Rotation: 5 MB, 5 backups.

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


# Export module-level default logger for convenience
logger = get_logger("qimchi")
