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
