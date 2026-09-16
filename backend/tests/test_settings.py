"""Tests for the per-user settings document and the backend sections it drives."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import settings


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    monkeypatch.setenv("QIMCHI_HOME", str(tmp_path / "home"))
    monkeypatch.delenv("QIMCHI_DB_PATH", raising=False)
    from api.shared import db as db_mod

    if db_mod._engine is not None:
        db_mod._engine.dispose()
    db_mod._engine = None
    db_mod.run_migrations()
    db_mod.seed_local_user()
    monkeypatch.setattr(db_mod, "_db_ready", True)
    yield
    if db_mod._engine is not None:
        db_mod._engine.dispose()
    db_mod._engine = None


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(settings.router)
    return TestClient(app)


def test_a_new_user_has_no_stored_settings(client):
    response = client.get("/settings")

    assert response.status_code == 200
    assert response.json() == {"settings": {}, "updatedAt": None}


def test_patches_merge_and_null_restores_the_default(client):
    client.patch(
        "/settings",
        json={"settings": {"general": {"theme": "dark", "zoom": 1.2}}},
    )
    client.patch("/settings", json={"settings": {"general": {"plotWidth": 66}}})
    merged = client.get("/settings").json()["settings"]
    assert merged == {"general": {"theme": "dark", "zoom": 1.2, "plotWidth": 66}}

    client.patch("/settings", json={"settings": {"general": {"zoom": None}}})
    client.patch(
        "/settings", json={"settings": {"general": {"theme": None, "plotWidth": None}}}
    )

    assert client.get("/settings").json()["settings"] == {}


def test_put_replaces_the_whole_document(client):
    client.patch("/settings", json={"settings": {"general": {"zoom": 1.5}}})

    replaced = client.put(
        "/settings", json={"settings": {"explorer": {"sortBy": "name"}}}
    ).json()

    assert replaced["settings"] == {"explorer": {"sortBy": "name"}}
    assert client.get("/settings").json()["settings"] == {
        "explorer": {"sortBy": "name"}
    }


def test_delete_clears_every_setting(client):
    client.patch("/settings", json={"settings": {"explorer": {"sortBy": "name"}}})

    assert client.delete("/settings").json()["settings"] == {}
    assert client.get("/settings").json()["settings"] == {}


def test_invalid_backend_sections_are_refused_and_nothing_is_saved(client):
    client.patch("/settings", json={"settings": {"export": {"formats": ["svg"]}}})

    refused = client.patch(
        "/settings", json={"settings": {"export": {"formats": ["tiff"]}}}
    )

    assert refused.status_code == 422
    assert client.get("/settings").json()["settings"] == {
        "export": {"formats": ["svg"]}
    }


def test_an_empty_format_list_is_refused(client):
    response = client.patch("/settings", json={"settings": {"export": {"formats": []}}})

    assert response.status_code == 422


def test_backend_sections_fall_back_to_defaults(client):
    assert settings.export_settings() == settings.ExportSettings()
    assert settings.desktop_settings().checkForUpdates is True

    client.patch(
        "/settings",
        json={
            "settings": {
                "export": {"formats": ["png"], "variants": ["dark"], "scale": 2},
                "desktop": {"previewReleases": True},
            }
        },
    )

    export = settings.export_settings()
    assert (export.formats, export.variants, export.scale) == (["png"], ["dark"], 2)
    assert settings.desktop_settings().previewReleases is True


def test_backend_sections_use_defaults_when_the_database_fails(monkeypatch):
    def broken(_user_id):
        raise RuntimeError("database is gone")

    monkeypatch.setattr(settings, "load_settings", broken)

    assert settings.export_settings() == settings.ExportSettings()


def test_the_router_reports_an_unavailable_database(client, monkeypatch):
    from api.shared import db as db_mod

    monkeypatch.setattr(db_mod, "_db_ready", False)
    monkeypatch.setattr(db_mod, "_db_error", "disk full")

    response = client.get("/settings")

    assert response.status_code == 503
    assert "disk full" in response.json()["detail"]
