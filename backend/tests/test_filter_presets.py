"""Saved filter presets: create, list, overwrite, rename and delete."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from api import library
from api.library import (
    CreateFilterPresetRequest,
    PresetFilter,
    UpdateFilterPresetRequest,
)


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


def _filters(*names: str) -> list[PresetFilter]:
    return [
        PresetFilter(name=name, options={"step": i}) for i, name in enumerate(names)
    ]


def test_a_preset_keeps_its_filters_in_order():
    created = library._create_filter_preset(
        CreateFilterPresetRequest(
            name=" Smooth then diff ", filters=_filters("savgol", "diff_x")
        )
    )

    listed = library._list_filter_presets()

    assert [p.name for p in listed] == ["Smooth then diff"]
    assert [f.name for f in listed[0].filters] == ["savgol", "diff_x"]
    assert listed[0].filters[1].options == {"step": 1}
    assert listed[0].id == created.id


def test_a_preset_name_must_be_new_and_not_empty():
    library._create_filter_preset(
        CreateFilterPresetRequest(name="A", filters=_filters("flip"))
    )

    with pytest.raises(HTTPException) as taken:
        library._create_filter_preset(
            CreateFilterPresetRequest(name="A", filters=_filters("flip"))
        )
    assert taken.value.status_code == 409
    with pytest.raises(HTTPException) as empty:
        library._create_filter_preset(
            CreateFilterPresetRequest(name="  ", filters=_filters("flip"))
        )
    assert empty.value.status_code == 400
    with pytest.raises(HTTPException) as no_filters:
        library._create_filter_preset(CreateFilterPresetRequest(name="B", filters=[]))
    assert no_filters.value.status_code == 400


def test_a_preset_can_be_overwritten_renamed_and_deleted():
    a = library._create_filter_preset(
        CreateFilterPresetRequest(name="A", filters=_filters("flip"))
    )
    library._create_filter_preset(
        CreateFilterPresetRequest(name="B", filters=_filters("flip"))
    )

    overwritten = library._update_filter_preset(
        a.id, UpdateFilterPresetRequest(filters=_filters("normalize", "flip"))
    )
    assert [f.name for f in overwritten.filters] == ["normalize", "flip"]
    assert overwritten.name == "A"

    with pytest.raises(HTTPException) as clash:
        library._update_filter_preset(a.id, UpdateFilterPresetRequest(name="B"))
    assert clash.value.status_code == 409
    renamed = library._update_filter_preset(a.id, UpdateFilterPresetRequest(name="C"))
    assert renamed.name == "C"

    library._delete_filter_preset(a.id)
    assert [p.name for p in library._list_filter_presets()] == ["B"]
    with pytest.raises(HTTPException) as gone:
        library._delete_filter_preset(a.id)
    assert gone.value.status_code == 404
