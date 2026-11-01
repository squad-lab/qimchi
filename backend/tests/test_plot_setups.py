"""Test plot setup creation, listing, updates, and deletion."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from api import library
from api.library import CreatePlotSetupRequest, UpdatePlotSetupRequest


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    monkeypatch.setenv("QIMCHI_HOME", str(tmp_path / "home"))
    monkeypatch.delenv("QIMCHI_DB_PATH", raising=False)
    from api.shared import db

    if db._engine is not None:
        db._engine.dispose()
    db._engine = None
    db.run_migrations()
    db.seed_local_user()
    yield
    if db._engine is not None:
        db._engine.dispose()
    db._engine = None


def _setup(*deps: str) -> dict:
    return {
        "qimchi": "plot-setup",
        "formatVersion": 1,
        "plots": [
            {"plotType": "LinePlot", "indeps": ["gate"], "deps": [dep]} for dep in deps
        ],
    }


def test_a_plot_setup_is_kept_as_it_was_saved():
    created = library._create_plot_setup(
        CreatePlotSetupRequest(name=" Gate sweeps ", setup=_setup("current", "phase"))
    )

    [listed] = library._list_plot_setups()

    assert listed.name == "Gate sweeps"
    assert listed.id == created.id
    assert listed.setup == _setup("current", "phase")


def test_a_plot_setup_needs_a_new_name_and_some_plots():
    library._create_plot_setup(CreatePlotSetupRequest(name="A", setup=_setup("i")))

    with pytest.raises(HTTPException) as taken:
        library._create_plot_setup(CreatePlotSetupRequest(name="A", setup=_setup("i")))
    assert taken.value.status_code == 409
    assert "plot setup named 'A'" in taken.value.detail
    with pytest.raises(HTTPException) as empty:
        library._create_plot_setup(CreatePlotSetupRequest(name=" ", setup=_setup("i")))
    assert empty.value.status_code == 400
    with pytest.raises(HTTPException) as no_plots:
        library._create_plot_setup(CreatePlotSetupRequest(name="B", setup=_setup()))
    assert no_plots.value.status_code == 400
    with pytest.raises(HTTPException) as other:
        library._create_plot_setup(
            CreatePlotSetupRequest(name="C", setup={"qimchi": "settings"})
        )
    assert other.value.status_code == 400


def test_a_plot_setup_can_be_replaced_renamed_and_deleted():
    a = library._create_plot_setup(CreatePlotSetupRequest(name="A", setup=_setup("i")))
    library._create_plot_setup(CreatePlotSetupRequest(name="B", setup=_setup("i")))

    replaced = library._update_plot_setup(
        a.id, UpdatePlotSetupRequest(setup=_setup("v", "i"))
    )
    assert replaced.setup == _setup("v", "i")
    assert replaced.name == "A"

    with pytest.raises(HTTPException) as clash:
        library._update_plot_setup(a.id, UpdatePlotSetupRequest(name="B"))
    assert clash.value.status_code == 409
    assert (
        library._update_plot_setup(a.id, UpdatePlotSetupRequest(name="C")).name == "C"
    )

    library._delete_plot_setup(a.id)
    assert [row.name for row in library._list_plot_setups()] == ["B"]
    with pytest.raises(HTTPException) as gone:
        library._delete_plot_setup(a.id)
    assert gone.value.status_code == 404
