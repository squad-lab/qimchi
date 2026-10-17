import json
from types import SimpleNamespace

from api import updater

# Captured before any test patches it, for the stamp test below.
_REAL_CURRENT_VERSION = updater.current_version


class _Response:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode("utf-8")

    def read(self, size=-1):
        if size is None or size < 0:
            size = len(self._body)
        chunk, self._body = self._body[:size], self._body[size:]
        return chunk

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


def _release_with_links(*links):
    return [
        {
            "tag_name": "v0.6.2",
            "description": "notes",
            "assets": {"links": list(links)},
        }
    ]


def _install_fake_release_fetch(monkeypatch, payload):
    monkeypatch.setattr(
        updater, "urlopen", lambda *_args, **_kwargs: _Response(payload)
    )
    monkeypatch.setattr(updater, "current_version", lambda: "0.6.1")


def test_check_for_update_selects_windows_installer(monkeypatch):
    monkeypatch.setattr(updater.sys, "platform", "win32")
    _install_fake_release_fetch(
        monkeypatch,
        _release_with_links(
            {
                "name": "qimchi-setup.exe (Windows installer)",
                "url": "https://example.invalid/qimchi-setup.exe",
            }
        ),
    )

    result = updater.check_for_update()

    assert result is not None
    assert result["platform"] == "windows"
    assert result["install_mode"] == "run-installer"
    assert result["asset_url"].endswith("qimchi-setup.exe")


def test_check_for_update_selects_linux_appimage(monkeypatch):
    monkeypatch.setattr(updater.sys, "platform", "linux")
    _install_fake_release_fetch(
        monkeypatch,
        _release_with_links(
            {
                "name": "qimchi-x86_64.AppImage (Linux)",
                "url": "https://example.invalid/qimchi-x86_64.AppImage",
            }
        ),
    )

    result = updater.check_for_update()

    assert result is not None
    assert result["platform"] == "linux"
    assert result["install_mode"] == "open-download"
    assert result["asset_url"].endswith("qimchi-x86_64.AppImage")


def test_check_for_update_selects_macos_dmg(monkeypatch):
    monkeypatch.setattr(updater.sys, "platform", "darwin")
    _install_fake_release_fetch(
        monkeypatch,
        _release_with_links(
            {
                "name": "qimchi.dmg (macOS)",
                "url": "https://example.invalid/qimchi.dmg",
            }
        ),
    )

    result = updater.check_for_update()

    assert result is not None
    assert result["platform"] == "macos"
    assert result["install_mode"] == "open-download"
    assert result["asset_url"].endswith("qimchi.dmg")


def test_check_for_update_returns_none_without_platform_asset(monkeypatch):
    monkeypatch.setattr(updater.sys, "platform", "darwin")
    _install_fake_release_fetch(
        monkeypatch,
        _release_with_links(
            {
                "name": "qimchi-setup.exe (Windows installer)",
                "url": "https://example.invalid/qimchi-setup.exe",
            }
        ),
    )

    assert updater.check_for_update() is None


# --------------------------------------------------------------------------- #
# Preview (-rc) channel: previews are download-only and must never be offered.
# --------------------------------------------------------------------------- #
def _release(tag, *links):
    return {
        "tag_name": tag,
        "description": f"notes for {tag}",
        "assets": {"links": list(links)},
    }


# Named as the release job names it: the tag sits inside the filename.
_WIN_ASSET = {
    "name": "qimchi-setup-v0.7.0.exe (Windows installer)",
    "direct_asset_url": "https://example.invalid/qimchi-setup-v0.7.0.exe",
}


def test_prerelease_detection():
    assert updater.is_prerelease("v0.6.4-rc.1")
    assert updater.is_prerelease("v0.6.4-alpha.2")
    assert updater.is_prerelease("v0.6.4-beta.10")
    assert not updater.is_prerelease("v0.6.4")
    assert not updater.is_prerelease("0.6.4")


def test_prerelease_at_the_top_does_not_hide_the_newest_stable(monkeypatch):
    """
    The regression this guards: check_for_update used to read releases[0] only.
    Publishing one preview then silently stopped every stable user from being
    offered updates.
    """
    payload = [
        _release("v0.7.0-rc.1", _WIN_ASSET),  # newest overall, must be skipped
        _release("v0.6.4", _WIN_ASSET),  # newest STABLE -> expected
        _release("v0.6.3", _WIN_ASSET),
    ]
    _install_fake_release_fetch(monkeypatch, payload)
    monkeypatch.setattr(updater.sys, "platform", "win32")

    result = updater.check_for_update()
    assert result is not None
    assert result["tag"] == "v0.6.4"


def test_only_prereleases_means_no_update(monkeypatch):
    payload = [_release("v0.7.0-rc.1", _WIN_ASSET), _release("v0.7.0-rc.2", _WIN_ASSET)]
    _install_fake_release_fetch(monkeypatch, payload)
    monkeypatch.setattr(updater.sys, "platform", "win32")
    assert updater.check_for_update() is None


def test_a_stable_install_can_opt_into_previews(monkeypatch):
    payload = [_release("v0.7.0-rc.1", _WIN_ASSET), _release("v0.6.4", _WIN_ASSET)]
    _install_fake_release_fetch(monkeypatch, payload)
    monkeypatch.setattr(updater.sys, "platform", "win32")

    assert updater.check_for_update()["tag"] == "v0.6.4"
    assert updater.check_for_update(include_previews=True)["tag"] == "v0.7.0-rc.1"


def test_running_a_preview_is_not_offered_an_older_stable(monkeypatch):
    """A -rc user must not be 'updated' backwards onto the previous stable."""
    payload = [_release("v0.6.3", _WIN_ASSET)]
    _install_fake_release_fetch(monkeypatch, payload)
    monkeypatch.setattr(updater, "current_version", lambda: "0.6.4-rc.1")
    monkeypatch.setattr(updater.sys, "platform", "win32")
    assert updater.check_for_update() is None


def test_running_a_preview_is_offered_the_matching_stable(monkeypatch):
    """...but the stable of the same version IS an upgrade from its rc."""
    payload = [_release("v0.6.4", _WIN_ASSET)]
    _install_fake_release_fetch(monkeypatch, payload)
    monkeypatch.setattr(updater, "current_version", lambda: "0.6.4-rc.1")
    monkeypatch.setattr(updater.sys, "platform", "win32")
    result = updater.check_for_update()
    assert result is not None and result["tag"] == "v0.6.4"


def test_release_list_is_fetched_deep_enough_to_see_past_previews():
    """per_page=1 would defeat the stable scan entirely."""
    import re as _re

    match = _re.search(r"per_page=(\d+)", updater._RELEASES_URL)
    assert match and int(match.group(1)) > 1, updater._RELEASES_URL


def test_current_version_falls_back_when_metadata_is_missing(monkeypatch):
    """
    A frozen build without package metadata must not crash the check.

    Returning "0.0.0" makes every release look newer, which is the safe
    direction: offering an update beats silently never offering one.

    """
    import importlib.metadata as metadata

    def _boom(_name):
        raise metadata.PackageNotFoundError("qimchi-api")

    monkeypatch.setattr(metadata, "version", _boom)

    assert updater.current_version() == "0.0.0"


def test_current_version_reads_package_metadata(monkeypatch):
    import importlib.metadata as metadata

    monkeypatch.setattr(metadata, "version", lambda _name: "1.2.3")

    assert updater.current_version() == "1.2.3"


def test_a_network_failure_is_not_an_update(monkeypatch):
    """The check runs at startup; a flaky network must never surface an error."""

    def fail(*_args, **_kwargs):
        raise OSError("no route to host")

    monkeypatch.setattr(updater, "urlopen", fail)

    assert updater.check_for_update() is None
    assert updater.last_check_error() == "OSError: no route to host"


def test_an_empty_release_list_is_not_an_update(monkeypatch):
    _install_fake_release_fetch(monkeypatch, [])

    assert updater.check_for_update() is None


def test_an_unparseable_tag_sorts_lowest_rather_than_raising(monkeypatch):
    # A hand-made tag must not break ordering for everyone else.
    assert updater._parse_ver("not-a-version") == (0,)
    assert updater._parse_ver("v0.6.3") > updater._parse_ver("nonsense")


def test_an_asset_for_another_platform_is_ignored(monkeypatch):
    monkeypatch.setattr(updater.sys, "platform", "win32")

    assert updater._platform_asset_match("qimchi.dmg", "https://x/qimchi.dmg") is None
    assert updater._platform_asset_match("qimchi-setup.exe", "https://x/s.exe") == (
        "windows",
        "run-installer",
    )


def test_an_unknown_platform_matches_nothing(monkeypatch):
    monkeypatch.setattr(updater.sys, "platform", "sunos5")

    assert updater._platform_asset_match("qimchi-setup.exe", "https://x/s.exe") is None


def test_a_preview_install_is_offered_the_next_preview(monkeypatch):
    """Preview users stay on the preview channel instead of stalling on an rc."""
    payload = [_release("v0.7.0-rc.2", _WIN_ASSET), _release("v0.7.0-rc.1", _WIN_ASSET)]
    _install_fake_release_fetch(monkeypatch, payload)
    monkeypatch.setattr(updater, "current_version", lambda: "v0.7.0-rc.1")
    monkeypatch.setattr(updater.sys, "platform", "win32")

    result = updater.check_for_update()

    assert result is not None and result["tag"] == "v0.7.0-rc.2"


def test_a_preview_install_prefers_the_stable_over_a_newer_preview(monkeypatch):
    """
    Once the stable of this version ships, that is where an rc user belongs.

    A later rc of the SAME version is a candidate for a release that already
    exists, so it must not outrank it.
    """
    payload = [
        _release("v0.7.0-rc.6", _WIN_ASSET),
        _release("v0.7.0", _WIN_ASSET),
        _release("v0.7.0-rc.5", _WIN_ASSET),
    ]
    _install_fake_release_fetch(monkeypatch, payload)
    monkeypatch.setattr(updater, "current_version", lambda: "v0.7.0-rc.5")
    monkeypatch.setattr(updater.sys, "platform", "win32")

    result = updater.check_for_update()

    assert result is not None and result["tag"] == "v0.7.0"


def test_preview_and_stable_update_routes(monkeypatch):
    monkeypatch.setattr(updater.sys, "platform", "win32")
    routes = (
        ("v0.7.0-rc.10", False, ["v0.7.0-rc.11", "v0.6.2"], "v0.7.0-rc.11"),
        ("v0.7.0-rc.11", False, ["v0.7.0", "v0.7.0-rc.12"], "v0.7.0"),
        ("v0.7.0", False, ["v0.8.0-rc.1", "v0.7.1"], "v0.7.1"),
        ("v0.7.0", False, ["v0.8.0-rc.1"], None),
        ("v0.7.0", True, ["v0.8.0-rc.1"], "v0.8.0-rc.1"),
    )

    for running, include_previews, tags, expected in routes:
        releases = [_release(tag, _WIN_ASSET) for tag in tags]
        monkeypatch.setattr(
            updater,
            "urlopen",
            lambda *_args, _releases=releases, **_kwargs: _Response(_releases),
        )
        monkeypatch.setattr(
            updater, "current_version", lambda _running=running: _running
        )

        result = updater.check_for_update(include_previews=include_previews)

        assert (result["tag"] if result else None) == expected


def test_a_stable_install_is_still_never_offered_a_preview(monkeypatch):
    payload = [_release("v0.8.0-rc.1", _WIN_ASSET), _release("v0.7.0", _WIN_ASSET)]
    _install_fake_release_fetch(monkeypatch, payload)
    monkeypatch.setattr(updater, "current_version", lambda: "0.7.0")
    monkeypatch.setattr(updater.sys, "platform", "win32")

    assert updater.check_for_update() is None


def _stamp_build_version(monkeypatch, value):
    monkeypatch.setitem(
        __import__("sys").modules,
        "api._build_version",
        SimpleNamespace(BUILD_VERSION=value),
    )


def test_the_build_stamp_outranks_package_metadata(monkeypatch):
    """
    pyproject.toml carries the base version, so an rc build reports the stable
    one and would never see the stable release as newer. The build scripts
    stamp the real tag; it must win.
    """
    import importlib.metadata as metadata

    monkeypatch.setattr(metadata, "version", lambda _name: "0.7.0")
    _stamp_build_version(monkeypatch, "v0.7.0-rc.5")

    assert updater.current_version() == "v0.7.0-rc.5"
    assert updater.is_prerelease(updater.current_version())


def test_an_empty_stamp_falls_back_to_package_metadata(monkeypatch):
    import importlib.metadata as metadata

    monkeypatch.setattr(metadata, "version", lambda _name: "0.7.0")
    _stamp_build_version(monkeypatch, "")

    assert updater.current_version() == "0.7.0"


def test_a_frozen_build_reads_the_bundled_stamp(monkeypatch, tmp_path):
    import importlib.metadata as metadata

    stamp = tmp_path / "backend" / "api" / "_build_version.py"
    stamp.parent.mkdir(parents=True)
    stamp.write_text('BUILD_VERSION = "v0.7.0-rc.10"\n', encoding="utf-8")
    monkeypatch.delitem(__import__("sys").modules, "api._build_version", raising=False)
    monkeypatch.setattr(updater.sys, "frozen", True, raising=False)
    monkeypatch.setattr(updater.sys, "_MEIPASS", str(tmp_path), raising=False)
    monkeypatch.setattr(metadata, "version", lambda _name: "0.7.0")

    assert updater.current_version() == "v0.7.0-rc.10"
    assert updater.version_source() == "build stamp"

    stamp.write_text('BUILD_VERSION = "v0.7.0"\n', encoding="utf-8")
    assert updater.current_version() == "v0.7.0"
    assert not updater.is_prerelease(updater.current_version())


def test_a_stamped_preview_build_is_offered_the_stable_release(monkeypatch):
    """The end-to-end path: an rc install reaches stable without a manual step."""
    import importlib.metadata as metadata

    monkeypatch.setattr(metadata, "version", lambda _name: "0.7.0")
    _stamp_build_version(monkeypatch, "v0.7.0-rc.5")
    _install_fake_release_fetch(monkeypatch, [_release("v0.7.0", _WIN_ASSET)])
    # The helper pins current_version; here the stamp is the thing under test.
    monkeypatch.setattr(updater, "current_version", _REAL_CURRENT_VERSION)
    monkeypatch.setattr(updater.sys, "platform", "win32")

    result = updater.check_for_update()

    assert result is not None and result["tag"] == "v0.7.0"


def test_stamped_rc_reaches_the_desktop_stable_update_dialog(monkeypatch, tmp_path):
    """Mock the unreleased v0.7.0 stable and exercise the desktop handoff."""
    import importlib.metadata as metadata
    import importlib.util
    from pathlib import Path

    # Import before metadata.version is patched: pydantic checks the
    # email-validator version through it on first import.
    from api import settings

    stable_asset = {
        "name": "qimchi-setup-v0.7.0.exe (Windows installer)",
        "direct_asset_url": "https://example.invalid/qimchi-setup-v0.7.0.exe",
    }
    releases = [
        _release("v0.7.0", stable_asset),
        _release("v0.7.0-rc.7", _WIN_ASSET),
    ]
    monkeypatch.setattr(metadata, "version", lambda _name: "0.7.0")
    _stamp_build_version(monkeypatch, "v0.7.0-rc.7")
    monkeypatch.setattr(updater, "current_version", _REAL_CURRENT_VERSION)
    monkeypatch.setattr(
        updater, "urlopen", lambda *_args, **_kwargs: _Response(releases)
    )
    monkeypatch.setattr(updater.sys, "platform", "win32")
    monkeypatch.setattr(__import__("time"), "sleep", lambda _seconds: None)
    monkeypatch.setattr(settings, "desktop_settings", settings.DesktopSettings)

    launcher_path = (
        Path(__file__).resolve().parents[2] / "packaging" / "qimchi_launcher.py"
    )
    spec = importlib.util.spec_from_file_location("qimchi_launcher", launcher_path)
    launcher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(launcher)
    scripts = []
    logs = []
    updates = launcher._Updates(logs.append, home=str(tmp_path))
    updates.attach(SimpleNamespace(evaluate_js=scripts.append))

    launcher._run_update_check(updates, logs.append)

    assert not [line for line in logs if "error" in line or "failed" in line]
    assert any("update available: v0.7.0-rc.7 -> v0.7.0 " in line for line in logs)
    state = updates.status()
    assert state["status"] == "available"
    assert state["tag"] == "v0.7.0"
    assert state["prompt"] == "available"
    assert state["current"] == "v0.7.0-rc.7"
    assert '"tag": "v0.7.0"' in scripts[-1]
    assert "qimchi-update" in scripts[-1]


def test_every_build_script_stamps_the_version(monkeypatch):
    """
    The stamp is invisible in a dev checkout, so nothing else would catch a
    build script that stopped writing it -- the app would silently go back to
    reporting the base version.
    """
    from pathlib import Path

    repo_root = Path(__file__).resolve().parents[2]
    scripts = [
        repo_root / "scripts" / "build_windows.ps1",
        repo_root / "scripts" / "build_linux.sh",
        repo_root / "scripts" / "build_macos.sh",
    ]

    for script in scripts:
        assert script.exists(), script
        assert "_build_version.py" in script.read_text(encoding="utf-8"), script


def test_a_versioned_installer_name_still_selects_the_windows_asset(monkeypatch):
    """
    The artefacts carry the release tag, so the name is not "qimchi-setup.exe".

    Matching on that literal would find no asset for a newer release, and
    check_for_update would return None -- every Windows install silently
    stops being offered updates, with only an INFO line to show for it.
    """
    monkeypatch.setattr(updater.sys, "platform", "win32")

    versioned = "qimchi-setup-v0.7.0-rc.5.exe (Windows installer)"
    assert updater._platform_asset_match(versioned, "") == ("windows", "run-installer")
    # The plain name a hand-built installer still has must keep working too.
    assert updater._platform_asset_match("qimchi-setup.exe", "") == (
        "windows",
        "run-installer",
    )
    assert updater._platform_asset_match("qimchi-x86_64-v0.7.0.AppImage", "") is None


def test_changelog_selects_exact_stable_and_rc_sections():
    markdown = """## Changelog
### v0.7.1 - 2026-10-03
- Stable changes
#### Details
Still part of this release.
### v0.7.1-rc.2 - 2026-10-03
- Second candidate
### v0.7.1-rc.1 - 2026-10-02
- First candidate
"""
    assert updater.changelog_section(markdown, "0.7.1") == (
        "- Stable changes\n#### Details\nStill part of this release."
    )
    assert updater.changelog_section(markdown, "v0.7.1-rc.2") == "- Second candidate"
    assert updater.changelog_section(markdown, "v0.7.1-rc.3") == ""


def test_update_notes_come_from_tagged_changelog_not_release_description(monkeypatch):
    monkeypatch.setattr(updater.sys, "platform", "win32")
    monkeypatch.setattr(updater, "current_version", lambda: "0.6.1")
    requests = []

    def fetch(request, **_kwargs):
        requests.append(request.full_url)
        if request.full_url == updater._RELEASES_URL:
            return _Response(
                _release_with_links(
                    {
                        "name": "qimchi-setup.exe",
                        "url": "https://example.invalid/setup.exe",
                    }
                )
            )
        response = _Response(None)
        response._body = b"### v0.6.2 - 2026-10-03\n- Fixed launch\n### v0.6.1\n- Older"
        return response

    monkeypatch.setattr(updater, "urlopen", fetch)
    result = updater.check_for_update()
    assert result["notes"] == "- Fixed launch"
    assert (
        requests[-1] == "https://gitlab.com/squad-lab/qimchi/-/raw/v0.6.2/CHANGELOG.md"
    )


def test_legacy_preview_heading_and_missing_exact_rc(monkeypatch):
    from urllib.error import HTTPError

    body = b"### v0.7.1 (Preview)\n- Legacy candidate\n### v0.7.0\n- Old"

    def fetch(request, **_kwargs):
        if "/md/release-notes/" in request.full_url:
            raise HTTPError(request.full_url, 404, "Not Found", {}, None)
        response = _Response(None)
        response._body = body
        return response

    monkeypatch.setattr(updater, "urlopen", fetch)
    assert updater.release_changelog("v0.7.1-rc.1") == "- Legacy candidate"
    body = b"### v0.7.1 - 2026-10-03\n- Stable only"
    assert updater.release_changelog("v0.7.1-rc.2") == ""


def test_preview_notes_use_separate_file_at_offered_tag(monkeypatch):
    requests = []

    def fetch(request, **_kwargs):
        requests.append(request.full_url)
        response = _Response(None)
        response._body = b"### v0.7.1-rc.1 - 2026-10-02\n- Candidate changes"
        return response

    monkeypatch.setattr(updater, "urlopen", fetch)
    assert updater.release_changelog("v0.7.1-rc.1") == "- Candidate changes"
    assert requests == [
        "https://gitlab.com/squad-lab/qimchi/-/raw/v0.7.1-rc.1/md/release-notes/v0.7.1-rc.1.md"
    ]


def test_published_preview_notes_in_legacy_changelog_still_work(monkeypatch):
    from urllib.error import HTTPError

    def fetch(request, **_kwargs):
        if "/md/release-notes/" in request.full_url:
            raise HTTPError(request.full_url, 404, "Not Found", {}, None)
        response = _Response(None)
        response._body = b"### v0.7.1\n- Stable\n### v0.7.1-rc.1\n- Original candidate"
        return response

    monkeypatch.setattr(updater, "urlopen", fetch)
    assert updater.release_changelog("v0.7.1-rc.1") == "- Original candidate"


def test_changelog_network_failure_does_not_offer_install_instructions(monkeypatch):
    def fail(*_args, **_kwargs):
        raise OSError("offline")

    monkeypatch.setattr(updater, "urlopen", fail)
    assert updater.release_changelog("v0.7.1") == ""
    assert updater.release_changelog("../../main") == ""
