"""
Filesystem paths for the desktop/server app home and the Qimchi database.

The desktop launcher (``packaging/qimchi_launcher.py::_qimchi_home``) owns
``~/.qimchi`` for WebView storage, the debug log and the export Chrome. The
backend has historically had no equivalent helper; this module provides one so
the database (and any future app-owned state) resolves consistently in both
desktop and server/Docker deployments.

Overrides (highest priority first):
    QIMCHI_DB_PATH  -> exact path to the SQLite file (server/Docker volume)
    QIMCHI_HOME     -> the app home dir (``qimchi.db`` is placed inside it)
    default         -> ``~/.qimchi`` (matches the desktop launcher)

The DB is deliberately kept OUT of the cache subdirs (``webview/``, ``chrome/``)
and is preserved on uninstall -- see the Windows ``packaging/setup.iss`` cleanup.

"""

import os
from pathlib import Path

# Name of the SQLite database file within the app home.
DB_FILENAME = "qimchi.db"


def qimchi_home() -> Path:
    """
    Return the Qimchi app home directory, creating it if necessary.

    Honours the ``QIMCHI_HOME`` env override; otherwise ``~/.qimchi`` (the same
    directory the desktop launcher uses).

    """
    override = os.getenv("QIMCHI_HOME")
    home = Path(override).expanduser() if override else Path.home() / ".qimchi"
    home.mkdir(parents=True, exist_ok=True)
    return home


def db_path() -> Path:
    """
    Return the absolute path to the Qimchi SQLite database file.

    Honours ``QIMCHI_DB_PATH`` (exact file path, e.g. a mounted Docker volume);
    otherwise ``<qimchi_home>/qimchi.db``. The parent directory is created.

    """
    override = os.getenv("QIMCHI_DB_PATH")
    if override:
        path = Path(override).expanduser()
        path.parent.mkdir(parents=True, exist_ok=True)
        return path
    return qimchi_home() / DB_FILENAME
