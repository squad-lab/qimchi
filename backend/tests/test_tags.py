"""
Tests for managing the custom tags themselves.

Tagging a measurement was always possible; the tags were not editable once
made, and nothing in the app ever called the delete route. These pin the
rename that keeps existing assignments, the clash a rename must refuse
rather than silently merge, and the usage count the delete confirmation
shows.

"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from api import library


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    """Point the DB at a scratch file and migrate it, per test."""
    monkeypatch.setenv("QIMCHI_HOME", str(tmp_path / "home"))
    from api.shared import db as db_mod

    db_mod._engine = None  # force a new engine at the new path
    db_mod.run_migrations()
    db_mod.seed_local_user()
    yield
    db_mod._engine = None


def _tagged_measurement(path: str, tag_id: int) -> str:
    """Register a measurement and put the tag on it."""
    uuid = library._register(path, {"Measurement ID": path}, path, "qanary").uuid
    library._set_measurement_tag(uuid, tag_id, True)
    return uuid


class TestRename:
    def test_a_tag_keeps_its_measurements_through_a_rename(self):
        tag = library._create_tag("cooldown")
        uuid = _tagged_measurement("/data/a.nc", tag.id)

        renamed = library._rename_tag(tag.id, "cooldown 2")

        assert renamed.name == "cooldown 2"
        assert renamed.id == tag.id, "the same tag, not a replacement"
        assert renamed.count == 1, "the measurement still carries it"
        assert library._set_measurement_tag(uuid, tag.id, True) == [tag.id]

    def test_surrounding_whitespace_is_dropped(self):
        tag = library._create_tag("noisy")

        assert library._rename_tag(tag.id, "  quiet  ").name == "quiet"

    def test_an_empty_name_is_refused(self):
        tag = library._create_tag("keepme")

        with pytest.raises(HTTPException) as exc:
            library._rename_tag(tag.id, "   ")

        assert exc.value.status_code == 400
        assert library._list_tags()[0].name == "keepme"

    def test_renaming_onto_another_tag_is_refused_rather_than_merged(self):
        """Merging two tags loses which measurements came from which."""
        first = library._create_tag("alpha")
        library._create_tag("beta")

        with pytest.raises(HTTPException) as exc:
            library._rename_tag(first.id, "beta")

        assert exc.value.status_code == 409
        assert {t.name for t in library._list_tags()} == {"alpha", "beta"}

    def test_renaming_an_unknown_tag_reports_that(self):
        with pytest.raises(HTTPException) as exc:
            library._rename_tag(4321, "ghost")

        assert exc.value.status_code == 404


class TestUsageCount:
    def test_a_fresh_tag_is_on_nothing(self):
        library._create_tag("unused")

        assert library._list_tags()[0].count == 0

    def test_the_count_is_the_measurements_carrying_it(self):
        tag = library._create_tag("interesting")
        _tagged_measurement("/data/a.nc", tag.id)
        _tagged_measurement("/data/b.nc", tag.id)

        assert library._list_tags()[0].count == 2

    def test_untagging_a_measurement_lowers_the_count(self):
        tag = library._create_tag("interesting")
        uuid = _tagged_measurement("/data/a.nc", tag.id)
        _tagged_measurement("/data/b.nc", tag.id)

        library._set_measurement_tag(uuid, tag.id, False)

        assert library._list_tags()[0].count == 1

    def test_counts_do_not_leak_between_tags(self):
        first = library._create_tag("aaa")
        second = library._create_tag("bbb")
        _tagged_measurement("/data/a.nc", first.id)

        counts = {t.name: t.count for t in library._list_tags()}

        assert counts == {"aaa": 1, "bbb": 0}
        assert second.id != first.id
