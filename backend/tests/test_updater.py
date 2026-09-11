from types import SimpleNamespace

from api import updater

# Captured before any test patches it, for the stamp test below.
_REAL_CURRENT_VERSION = updater.current_version


class _Response:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def _release_with_links(*links):
    return [
        {
            "tag_name": "v0.6.2",
            "description": "notes",
            "assets": {"links": list(links)},
        }
    ]


def _install_fake_requests(monkeypatch, payload):
    fake_requests = SimpleNamespace(get=lambda *args, **kwargs: _Response(payload))
    monkeypatch.setitem(__import__("sys").modules, "requests", fake_requests)
    monkeypatch.setattr(updater, "current_version", lambda: "0.6.1")


def test_check_for_update_selects_windows_installer(monkeypatch):
    monkeypatch.setattr(updater.sys, "platform", "win32")
    _install_fake_requests(
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
    _install_fake_requests(
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
    _install_fake_requests(
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
    _install_fake_requests(
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


_WIN_ASSET = {
    "name": "qimchi-setup.exe (Windows)",
    "direct_asset_url": "https://example.invalid/qimchi-setup.exe",
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
    _install_fake_requests(monkeypatch, payload)
    monkeypatch.setattr(updater.sys, "platform", "win32")

    result = updater.check_for_update()
    assert result is not None
    assert result["tag"] == "v0.6.4"


def test_only_prereleases_means_no_update(monkeypatch):
    payload = [_release("v0.7.0-rc.1", _WIN_ASSET), _release("v0.7.0-rc.2", _WIN_ASSET)]
    _install_fake_requests(monkeypatch, payload)
    monkeypatch.setattr(updater.sys, "platform", "win32")
    assert updater.check_for_update() is None


def test_running_a_preview_is_not_offered_an_older_stable(monkeypatch):
    """A -rc user must not be 'updated' backwards onto the previous stable."""
    payload = [_release("v0.6.3", _WIN_ASSET)]
    _install_fake_requests(monkeypatch, payload)
    monkeypatch.setattr(updater, "current_version", lambda: "0.6.4-rc.1")
    monkeypatch.setattr(updater.sys, "platform", "win32")
    assert updater.check_for_update() is None


def test_running_a_preview_is_offered_the_matching_stable(monkeypatch):
    """...but the stable of the same version IS an upgrade from its rc."""
    payload = [_release("v0.6.4", _WIN_ASSET)]
    _install_fake_requests(monkeypatch, payload)
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

    class _Failing:
        @staticmethod
        def get(*_args, **_kwargs):
            raise OSError("no route to host")

    monkeypatch.setitem(__import__("sys").modules, "requests", _Failing)

    assert updater.check_for_update() is None


def test_an_empty_release_list_is_not_an_update(monkeypatch):
    _install_fake_requests(monkeypatch, [])

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
    _install_fake_requests(monkeypatch, payload)
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
    _install_fake_requests(monkeypatch, payload)
    monkeypatch.setattr(updater, "current_version", lambda: "v0.7.0-rc.5")
    monkeypatch.setattr(updater.sys, "platform", "win32")

    result = updater.check_for_update()

    assert result is not None and result["tag"] == "v0.7.0"


def test_a_stable_install_is_still_never_offered_a_preview(monkeypatch):
    payload = [_release("v0.8.0-rc.1", _WIN_ASSET), _release("v0.7.0", _WIN_ASSET)]
    _install_fake_requests(monkeypatch, payload)
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


def test_a_stamped_preview_build_is_offered_the_stable_release(monkeypatch):
    """The end-to-end path: an rc install reaches stable without a manual step."""
    import importlib.metadata as metadata

    monkeypatch.setattr(metadata, "version", lambda _name: "0.7.0")
    _stamp_build_version(monkeypatch, "v0.7.0-rc.5")
    _install_fake_requests(monkeypatch, [_release("v0.7.0", _WIN_ASSET)])
    # The helper pins current_version; here the stamp is the thing under test.
    monkeypatch.setattr(updater, "current_version", _REAL_CURRENT_VERSION)
    monkeypatch.setattr(updater.sys, "platform", "win32")

    result = updater.check_for_update()

    assert result is not None and result["tag"] == "v0.7.0"


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
