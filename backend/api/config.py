"""
Qimchi Backend Configuration with executable checks etc.

"""

import shutil

# Candidate names for the fd executable on different platforms
_FD_CANDIDATES = ["fd", "fdfind"]

FD_EXEC = None
for _c in _FD_CANDIDATES:
    if shutil.which(_c):
        FD_EXEC = _c
        break

# Detect du executable
DU_EXEC = None
if shutil.which("du"):
    DU_EXEC = "du"

# Detect xargs
XARGS_EXEC = None
if shutil.which("xargs"):
    XARGS_EXEC = "xargs"
