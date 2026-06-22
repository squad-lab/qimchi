"""
Qimchi Backend Configuration with executable checks etc.

"""

import os
import shutil
import sys

# Candidate names for the fd executable on different platforms
_FD_CANDIDATES = ["fd", "fdfind"]

FD_EXEC: str | None = None

# When frozen (PyInstaller onefile or onedir) fd is bundled inside the package.
# sys._MEIPASS is the extraction dir (onefile) or _internal/ subdir (onedir).
if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
    _fd_name = "fd.exe" if os.name == "nt" else "fd"
    _bundled_fd = os.path.join(sys._MEIPASS, _fd_name)  # type: ignore[attr-defined]
    if os.path.isfile(_bundled_fd):
        FD_EXEC = _bundled_fd

if FD_EXEC is None:
    for _c in _FD_CANDIDATES:
        if shutil.which(_c):
            FD_EXEC = _c
            break

# Detect du executable
# DU_EXEC = None
# if shutil.which("du"):
#     DU_EXEC = "du"

# # Detect xargs
# XARGS_EXEC = None
# if shutil.which("xargs"):
#     XARGS_EXEC = "xargs"

# Max depth for directory traversal (default: 6)
MAX_DEPTH = int(os.getenv("QIMCHI_MAX_DEPTH", 6))
