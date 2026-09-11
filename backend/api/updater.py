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
        The running version string (the build tag when stamped, else
        importlib.metadata).

"""

from __future__ import annotations

import logging
import re
import sys

_log = logging.getLogger(__name__)

# Preview/prerelease tags: v0.6.4-rc.1, -alpha.2, -beta.3.
_PRERELEASE_RE = re.compile(r"^v?\d+(?:\.\d+)*-(?:rc|alpha|beta)\.\d+$")

# Public GitLab Releases API endpoint for the project.
#
# per_page must be > 1: preview (-rc) tags publish Releases too, and they are
# newest-first, so fetching a single release would usually return a prerelease
# and hide the newest stable one behind it. 20 is plenty to find a stable
# release beneath any run of previews.
_RELEASES_URL = (
    "https://gitlab.com/api/v4/projects/squad-lab%2Fqimchi/releases?per_page=20"
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
    Return the running version, preferring the tag this build was cut from.

    Package metadata carries the BASE version only -- the -rc.N suffix is
    minted by CI and never written into pyproject.toml -- so a preview install
    reports the same "0.7.0" as the stable release it is a candidate for, and
    the comparison below finds nothing newer. The build scripts stamp the real
    tag into ``api/_build_version.py``; it is absent in a dev checkout.

    """
    try:
        from ._build_version import BUILD_VERSION

        if BUILD_VERSION:
            return BUILD_VERSION
    except Exception:
        pass

    try:
        from importlib.metadata import version

        return version("qimchi-api")
    except Exception:
        return "0.0.0"


def is_prerelease(tag: str) -> bool:
    """
    True for a preview tag such as ``v0.6.4-rc.1``.

    The tag shape decides the channel: a stable install is never offered a
    preview, while a preview install is offered both channels.

    """
    return bool(_PRERELEASE_RE.match(tag or ""))


def _parse_ver(tag: str) -> tuple[int, ...]:
    """
    Version tuple for ordering. ``'v0.5.3'`` -> ``(0, 5, 3, 1, 0)``.

    The last two elements are stability then preview number. Stability is 1 for
    a release and 0 for a prerelease, so ``v0.6.4-rc.1`` (0,6,4,0,1) sorts
    *below* ``v0.6.4`` (0,6,4,1,0) but still above ``v0.6.3``. Without that, a
    user running an rc would be offered the previous stable build as an
    "update" -- a silent downgrade.

    The preview number orders one rc against another; without it rc.1 and rc.2
    compare equal and a preview install is never offered the next preview.

    """
    cleaned = (tag or "").lstrip("v")
    match = _PRERELEASE_RE.match(tag or "")
    prerelease = 0 if match else 1
    preview_number = int(cleaned.rsplit(".", 1)[-1]) if match else 0
    base = cleaned.split("-", 1)[0]
    try:
        return tuple(int(x) for x in base.split(".")) + (prerelease, preview_number)
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

    # Pick the newest release on this install's channel, scanning the whole
    # list rather than taking releases[0]: GitLab orders by creation date, so a
    # back-dated or re-cut release could otherwise mask a newer one.
    #
    # A stable install is offered stable releases only -- publishing a preview
    # must not push everyone onto it. A preview install follows the preview
    # channel, so it is offered both the next preview and the stable release it
    # was a candidate for; _parse_ver ranks v0.7.0 above v0.7.0-rc.5, so an rc
    # user lands on stable as soon as it ships instead of being stranded.
    running = current_version()
    on_preview = is_prerelease(running)
    candidates = [
        rel
        for rel in releases
        if rel.get("tag_name") and (on_preview or not is_prerelease(rel["tag_name"]))
    ]
    if not candidates:
        _log.info(
            "[updater] no release on this channel (%d entries, preview=%s)",
            len(releases),
            on_preview,
        )
        return None

    latest = max(candidates, key=lambda rel: _parse_ver(rel["tag_name"]))
    tag = latest["tag_name"]
    if _parse_ver(tag) <= _parse_ver(running):
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
