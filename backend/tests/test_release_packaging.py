"""Regression checks for files used only by release artefacts."""

from __future__ import annotations

import re
from pathlib import Path

_REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


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
    # The Dockerfile sits in docker/ but builds from the repository root,
    # so its own siblings must be addressed through that prefix.
    assert "COPY docker/nginx.conf " in dockerfile
    assert "COPY docker/supervisord.conf " in dockerfile
    assert "-f docker/Dockerfile" in gitlab_ci


def test_pywebview_builds_embed_the_release_version_in_the_frontend():
    windows = (_REPOSITORY_ROOT / "build_local.ps1").read_text(encoding="utf-8")
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
