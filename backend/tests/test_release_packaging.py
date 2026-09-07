"""Regression checks for files used only by release artefacts."""

from __future__ import annotations

import re
from pathlib import Path

_REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def test_docker_image_uses_the_lock_and_bundles_database_migrations():
    dockerfile = (_REPOSITORY_ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert "FROM node:22.12.0-slim AS frontend-builder" in dockerfile
    assert "RUN npm ci" in dockerfile
    assert "COPY backend/pyproject.toml backend/uv.lock /app/" in dockerfile
    assert "uv sync --locked --no-dev --extra datasets" in dockerfile
    assert "COPY backend/migrations/ /app/migrations/" in dockerfile


def test_container_starts_the_prebuilt_environment_without_resolving_again():
    supervisor = (_REPOSITORY_ROOT / "supervisord.conf").read_text(encoding="utf-8")

    assert "command=/app/.venv/bin/uvicorn " in supervisor
    assert "command=uv run " not in supervisor


def test_nginx_proxies_every_frontend_api_route_family():
    nginx = (_REPOSITORY_ROOT / "nginx.conf").read_text(encoding="utf-8")
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
