"""Regression checks for files used only by release artefacts."""

from __future__ import annotations

import re
import runpy
import struct
from pathlib import Path

import pytest

_REPOSITORY_ROOT = Path(__file__).resolve().parents[2]

# The release job embeds JSON inside a double-quoted shell string, so every
# quote in it is backslash-escaped in the YAML.
ESCAPED_QUOTE = '\\"'


def test_macos_dmg_artwork_fits_the_native_finder_layout(tmp_path):
    app = tmp_path / "Qimchi.app"
    app.mkdir()
    icon = tmp_path / "qimchi-logo.icns"
    icon.write_bytes(b"icns")
    assets = _REPOSITORY_ROOT / "packaging" / "assets"
    settings_file = _REPOSITORY_ROOT / "packaging" / "dmg-settings.py"
    settings = runpy.run_path(
        str(settings_file),
        init_globals={"defines": {"app": str(app), "assets": str(assets)}},
    )
    assert settings["files"] == [str(app)]
    assert settings["volume_name"] == "Qimchi"
    assert settings["icon"] == str(icon)
    assert settings["symlinks"]["Applications"] == "/Applications"
    width, height = settings["window_rect"][1]
    radius = settings["icon_size"] / 2
    for name in (app.name, "Applications"):
        x, y = settings["icon_locations"][name]
        assert radius < x < width - radius
        assert radius < y < height - radius - settings["text_size"]
    for scale, suffix in ((1, ""), (2, "@2x")):
        image = (assets / f"dmg-background{suffix}.png").read_bytes()
        assert image.startswith(b"\x89PNG\r\n\x1a\n")
        assert struct.unpack(">II", image[16:24]) == (width * scale, height * scale)

    # A missing volume icon must not silently produce the default disk icon.
    icon.unlink()
    with pytest.raises(FileNotFoundError, match="Required Qimchi volume icon"):
        runpy.run_path(
            str(settings_file),
            init_globals={"defines": {"app": str(app), "assets": str(assets)}},
        )

    image = (assets / "qimchi-macos-icon.png").read_bytes()
    assert image.startswith(b"\x89PNG\r\n\x1a\n")
    assert struct.unpack(">II", image[16:24]) == (1024, 1024)
    assert image[25] == 6, "macOS icon must have RGBA transparency"

    # Reject a legacy lower-case bundle before it can ship in a new DMG.
    legacy_app = tmp_path / "qimchi.app"
    app.rename(tmp_path / "old-app")
    legacy_app.mkdir()
    with pytest.raises(ValueError, match="Expected the built Qimchi.app"):
        runpy.run_path(
            str(settings_file),
            init_globals={"defines": {"app": str(legacy_app), "assets": str(assets)}},
        )


def test_docker_image_uses_the_lock_and_bundles_database_migrations():
    dockerfile = (_REPOSITORY_ROOT / "docker" / "Dockerfile").read_text(
        encoding="utf-8"
    )
    gitlab_ci = (_REPOSITORY_ROOT / ".gitlab-ci.yml").read_text(encoding="utf-8")

    assert "FROM node:22.12.0-slim AS frontend-builder" in dockerfile
    assert "RUN npm ci" in dockerfile
    assert "ARG QIMCHI_VERSION" in dockerfile
    assert "ENV QIMCHI_VERSION=$QIMCHI_VERSION" in dockerfile
    assert '--build-arg QIMCHI_VERSION="$CI_COMMIT_TAG"' in gitlab_ci
    assert "COPY backend/pyproject.toml backend/uv.lock /app/" in dockerfile
    assert "uv sync --locked --no-dev --extra datasets" in dockerfile
    assert "COPY backend/migrations/ /app/migrations/" in dockerfile
    # frontend/src/utils/changelog.ts imports these from outside frontend/.
    assert "COPY CHANGELOG.md /CHANGELOG.md" in dockerfile
    assert "COPY md/release-notes/ /md/release-notes/" in dockerfile
    # The Dockerfile sits in docker/ but builds from the repository root,
    # so its own siblings must be addressed through that prefix.
    assert "COPY docker/nginx.conf " in dockerfile
    assert "COPY docker/supervisord.conf " in dockerfile
    assert "-f docker/Dockerfile" in gitlab_ci


def test_pywebview_builds_embed_the_release_version_in_the_frontend():
    windows = (_REPOSITORY_ROOT / "scripts" / "build_windows.ps1").read_text(
        encoding="utf-8"
    )
    linux = (_REPOSITORY_ROOT / "scripts" / "build_linux.sh").read_text(
        encoding="utf-8"
    )
    macos = (_REPOSITORY_ROOT / "scripts" / "build_macos.sh").read_text(
        encoding="utf-8"
    )
    spec = (_REPOSITORY_ROOT / "packaging" / "qimchi.spec").read_text(encoding="utf-8")

    assert "$env:CI_COMMIT_TAG" in windows
    assert 'git tag --points-at HEAD --list "v*"' in windows
    assert "$env:QIMCHI_VERSION = $frontendVersion" in windows
    for script in (linux, macos):
        assert "${QIMCHI_VERSION:-${CI_COMMIT_TAG:-}}" in script
        assert "git tag --points-at HEAD --list 'v*'" in script
        assert 'QIMCHI_VERSION="$FRONTEND_VERSION" npm run build' in script
    assert '(_frontend_dist, "frontend/dist")' in spec
    assert 'hiddenimports += ["api._build_version"]' in spec
    assert "pathex=[_backend_stage," in spec


def test_container_starts_the_prebuilt_environment_without_resolving_again():
    supervisor = (_REPOSITORY_ROOT / "docker" / "supervisord.conf").read_text(
        encoding="utf-8"
    )

    assert "command=/app/.venv/bin/uvicorn " in supervisor
    assert "command=uv run " not in supervisor


def test_nginx_proxies_every_frontend_api_route_family():
    nginx = (_REPOSITORY_ROOT / "docker" / "nginx.conf").read_text(encoding="utf-8")
    match = re.search(r"location ~ (\^/\([^\n]+\)) \{", nginx)
    assert match is not None, "nginx API proxy location was not found"
    api_pattern = re.compile(match.group(1))

    routes = (
        "/health",
        "/plot/",
        "/transform-plot",
        "/library/register",
        "/library/states",
        "/live-measurements/",
        "/load-live/",
        "/load-attrs/",
        "/load-notes/",
        "/save-notes/",
        "/export-plot-images",
        "/download-folder/",
        "/dataset-status/",
    )
    missed = [route for route in routes if api_pattern.match(route) is None]
    assert not missed, f"nginx would serve API routes as SPA content: {missed}"


def test_release_asset_names_carry_the_tag_and_stay_matchable(monkeypatch):
    """
    The release lists each asset by name, so the name states the version.

    It must still contain the filename the updater matches on: api/updater.py
    picks the asset for this OS by looking for "setup.exe", ".dmg" or
    ".appimage" in it. Renaming the asset to "qimchi-setup-v0.7.0.exe" would
    read fine on the releases page and quietly stop every Windows install from
    being offered an update.
    """
    from api import updater

    gitlab_ci = (_REPOSITORY_ROOT / ".gitlab-ci.yml").read_text(encoding="utf-8")

    # The links are shell-escaped JSON inside the YAML, so read them by marker
    # rather than parsing: BACKSLASH"name\":\"<name>\",\"url
    opening = ESCAPED_QUOTE + "name" + ESCAPED_QUOTE + ":" + ESCAPED_QUOTE
    closing = ESCAPED_QUOTE + "," + ESCAPED_QUOTE + "url"
    names = [
        chunk.split(closing)[0]
        for chunk in gitlab_ci.split(opening)[1:]
        if closing in chunk
    ]

    assert len(names) == 3, names
    for tag in ("v0.7.0-rc.5", "v0.7.0"):
        expanded = [name.replace("${CI_COMMIT_TAG}", tag) for name in names]
        assert all(tag in name for name in expanded), expanded

        for platform, expected in (
            ("win32", "windows"),
            ("darwin", "macos"),
            ("linux", "linux"),
        ):
            monkeypatch.setattr(updater.sys, "platform", platform)
            hits = [
                name for name in expanded if updater._platform_asset_match(name, "")
            ]
            assert len(hits) == 1, (platform, hits)
            assert updater._platform_asset_match(hits[0], "")[0] == expected


def test_installer_configuration_launch_bypasses_update_marker():
    setup = (_REPOSITORY_ROOT / "packaging" / "setup.iss").read_text(encoding="utf-8")
    run = setup.split("[Run]", 1)[1].split("[UninstallRun]", 1)[0]
    entries = re.split(r"(?m)^Filename:", run)[1:]
    assert len(entries) == 2
    interactive = next(entry for entry in entries if "skipifsilent" in entry)
    assert 'Parameters: "--after-update"' in interactive
    assert "runasoriginaluser" in interactive
    assert "skipifsilent" in interactive
    assert "Check: ShouldLaunchQimchi" in interactive
    silent = next(entry for entry in entries if "skipifnotsilent" in entry)
    assert 'Parameters: "--after-update"' in silent
    assert "Check: IsInAppUpdate" in silent
