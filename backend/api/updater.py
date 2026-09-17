"""
Auto-updater: checks GitLab Releases for a newer version of Qimchi.

Designed to run only when frozen (PyInstaller desktop build).  The actual
download + install is triggered from the launcher so it has access to the
pywebview window reference.

Public API:
    check_for_update(include_previews=False, log=None) -> dict | None
        Returns update metadata if a newer release has an asset for this
        platform, else None.

    current_version() -> str
        The running version string (the build tag when stamped, else
        importlib.metadata).

    version_source() -> str
        Where current_version() came from, for the update log.

    last_check_error() -> str | None
        Diagnostic from the latest failed release fetch.

"""

from __future__ import annotations

import json
import logging
import re
import sys
from collections.abc import Callable
from urllib.request import Request, urlopen

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

_last_check_error: str | None = None


def last_check_error() -> str | None:
    """Reason the most recent release fetch failed, if it failed."""
    return _last_check_error


def _platform_asset_match(name: str, url: str) -> tuple[str, str] | None:
    """
    Return (platform, install_mode) when a release asset fits this OS.

    """
    haystack = f"{name} {url}".lower()
    if sys.platform == "win32":
        # The installer is named qimchi-setup-<tag>.exe, so the version sits
        # between the two halves of the name -- do not match "setup.exe".
        if "qimchi-setup" in haystack and ".exe" in haystack:
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


def version_source() -> str:
    """Where :func:`current_version` finds the version: the build stamp or metadata."""
    try:
        from ._build_version import BUILD_VERSION

        if BUILD_VERSION:
            return "build stamp"
    except Exception:
        pass
    try:
        from importlib.metadata import version

        version("qimchi-api")
        return "package metadata, so any -rc suffix is unknown"
    except Exception:
        return "neither a build stamp nor package metadata"


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


def check_for_update(
    include_previews: bool = False,
    log: Callable[[str], None] | None = None,
) -> dict | None:
    """
    Fetch the latest GitLab release and compare against the running version.

    Returns a dict with keys "tag", "notes", "asset_url", "asset_name",
    "platform", and "install_mode" when a newer release has an asset for this
    platform; returns None otherwise (no update, network error, or no asset).

    ``include_previews`` puts a stable install on the preview channel as well.
    ``log`` receives every step of the decision, so the desktop log shows why an
    update was or was not offered.

    Never raises - all errors are logged at INFO level and treated as "no update".

    """
    global _last_check_error
    _last_check_error = None

    def trace(message: str) -> None:
        _log.info("[updater] %s", message)
        if log is not None:
            log(f"[updater] {message}")

    running = current_version()
    on_preview = include_previews or is_prerelease(running)
    trace(
        f"running {running!r} (from {version_source()}) on {sys.platform}; "
        f"channel: {'preview and stable' if on_preview else 'stable only'} "
        f"(running a preview: {is_prerelease(running)}, "
        f"preview releases setting: {include_previews})"
    )
    trace(f"fetching {_RELEASES_URL}")
    try:
        # Use the standard library: requests is not a declared Qimchi runtime
        # dependency and is therefore absent from the frozen desktop bundle.
        # Importing it here made every packaged update check silently return
        # None before it ever contacted GitLab.
        request = Request(
            _RELEASES_URL,
            headers={"Accept": "application/json", "User-Agent": "Qimchi-Updater"},
        )
        with urlopen(request, timeout=10) as response:  # noqa: S310 - fixed HTTPS URL
            status = getattr(response, "status", None)
            releases = json.load(response)
        if not isinstance(releases, list):
            raise ValueError("GitLab releases response was not a list")
    except Exception as exc:
        _last_check_error = f"{type(exc).__name__}: {exc}"
        trace(f"release check failed (non-fatal): {_last_check_error}")
        return None

    tags = [str(rel.get("tag_name")) for rel in releases if isinstance(rel, dict)]
    trace(f"HTTP {status}: {len(releases)} release(s): {', '.join(tags) or 'none'}")
    if not releases:
        trace("no update available: no releases are published")
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
    candidates = [
        rel
        for rel in releases
        if isinstance(rel, dict)
        and rel.get("tag_name")
        and (on_preview or not is_prerelease(rel["tag_name"]))
    ]
    if not candidates:
        trace(f"no update available: none of the {len(releases)} release(s) is stable")
        return None

    latest = max(candidates, key=lambda rel: _parse_ver(rel["tag_name"]))
    tag = latest["tag_name"]
    trace(
        f"newest on this channel: {tag} {_parse_ver(tag)}; "
        f"running {running} {_parse_ver(running)}"
    )
    if _parse_ver(tag) <= _parse_ver(running):
        trace(f"no update available: {tag} is not newer than {running}")
        return None

    notes: str = latest.get("description", "")

    asset_url = ""
    asset_name = ""
    platform = ""
    install_mode = ""
    links = latest.get("assets", {}).get("links", [])
    for link in links:
        name = (link.get("name") or "").lower()
        url = link.get("direct_asset_url") or link.get("url") or ""
        match = _platform_asset_match(name, url)
        verdict = f"for {match[0]}" if match else f"not for {sys.platform}"
        trace(f"asset {link.get('name')!r} -> {url}: {verdict}")
        if match:
            asset_url = url
            asset_name = link.get("name") or ""
            platform, install_mode = match
            break

    if not asset_url:
        trace(
            f"no update offered: {tag} is newer, but none of its {len(links)} "
            f"asset(s) is for {sys.platform}"
        )
        return None

    trace(f"update available: {running} -> {tag} ({asset_name}; {install_mode})")
    return {
        "tag": tag,
        "notes": notes,
        "asset_url": asset_url,
        "asset_name": asset_name,
        "platform": platform,
        "install_mode": install_mode,
    }
