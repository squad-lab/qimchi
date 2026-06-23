"""
Auto-updater: checks GitLab Releases for a newer version of Qimchi.

Designed to run only when frozen (PyInstaller desktop build).  The actual
download + install is triggered from the launcher so it has access to the
pywebview window reference.

Public API:
    check_for_update() -> dict | None
        Returns update metadata if a newer release has an asset for this
        platform, else None.

    current_version() -> str
        The running version string (from importlib.metadata).

"""

from __future__ import annotations

import logging
import sys

_log = logging.getLogger(__name__)

# Public GitLab Releases API endpoint for the project.
_RELEASES_URL = (
    "https://gitlab.com/api/v4/projects/squad-lab%2Fqimchi/releases?per_page=1"
)


def _platform_asset_match(name: str, url: str) -> tuple[str, str] | None:
    """
    Return (platform, install_mode) when a release asset fits this OS.

    """
    haystack = f"{name} {url}".lower()
    if sys.platform == "win32":
        if "setup.exe" in haystack:
            return ("windows", "run-installer")
        return None
    if sys.platform == "darwin":
        if ".dmg" in haystack:
            return ("macos", "open-download")
        return None
    if sys.platform.startswith("linux"):
        if ".appimage" in haystack:
            return ("linux", "open-download")
        return None
    return None


def current_version() -> str:
    """
    Return the running version from package metadata, or '0.0.0' if unknown.

    """
    try:
        from importlib.metadata import version

        return version("qimchi-api")
    except Exception:
        return "0.0.0"


def _parse_ver(tag: str) -> tuple[int, ...]:
    """'v0.5.3' → (0, 5, 3)."""
    cleaned = tag.lstrip("v")
    try:
        return tuple(int(x) for x in cleaned.split("."))
    except ValueError:
        return (0,)


def check_for_update() -> dict | None:
    """
    Fetch the latest GitLab release and compare against the running version.

    Returns a dict with keys "tag", "notes", "asset_url", "asset_name",
    "platform", and "install_mode" when a newer release has an asset for this
    platform; returns None otherwise (no update, network error, or no asset).

    Never raises - all errors are logged at INFO level and treated as "no update".

    """
    try:
        import requests  # transitive via qcodes; always present in the bundle

        resp = requests.get(_RELEASES_URL, timeout=10)
        resp.raise_for_status()
        releases = resp.json()
    except Exception as exc:
        _log.info("[updater] release check failed (non-fatal): %s", exc)
        return None

    if not releases:
        return None

    latest = releases[0]
    tag = latest.get("tag_name", "")
    if not tag or _parse_ver(tag) <= _parse_ver(current_version()):
        return None

    notes: str = latest.get("description", "")

    asset_url = ""
    asset_name = ""
    platform = ""
    install_mode = ""
    for link in latest.get("assets", {}).get("links", []):
        name = (link.get("name") or "").lower()
        url = link.get("direct_asset_url") or link.get("url") or ""
        match = _platform_asset_match(name, url)
        if match:
            asset_url = url
            asset_name = link.get("name") or ""
            platform, install_mode = match
            break

    if not asset_url:
        _log.info(
            "[updater] %s is newer but no %s asset found; skipping",
            tag,
            sys.platform,
        )
        return None

    _log.info("[updater] update available: %s → %s", current_version(), tag)
    return {
        "tag": tag,
        "notes": notes,
        "asset_url": asset_url,
        "asset_name": asset_name,
        "platform": platform,
        "install_mode": install_mode,
    }
