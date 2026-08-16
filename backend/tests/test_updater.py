from types import SimpleNamespace

from api import updater


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
