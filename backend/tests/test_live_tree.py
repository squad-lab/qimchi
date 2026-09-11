"""
The Live Measurements tree.

Live is a first-class Explorer pane, but the two functions that build its tree
were among the least-covered in the backend. They decide what a running
measurement looks like in the Explorer: its name, its tags, and which timestamp
it sorts by.

"""

from datetime import datetime

import pytest
from fastapi import HTTPException

from api import dirtree
from api.data_loader import MEMORY_PROTOCOL


def _entry(**overrides):
    entry = {
        "disk_path": None,
        "ws_url": "ws://127.0.0.1:9999/live",
        "started_at": "2026-09-11T10:00:00",
        "ended_at": None,
    }
    entry.update(overrides)
    return entry


class TestMemoryDatasetNode:
    def test_a_running_measurement_is_tagged_live(self):
        node = dirtree._memory_dataset_node("abc-123", _entry())

        assert node["tags"] == ["live"]
        # Always addressed through memory://, so the loader can choose between
        # the websocket and the file on disk.
        assert node["path"] == f"{MEMORY_PROTOCOL}abc-123"
        assert node["type"] == "file"

    def test_a_finished_measurement_is_tagged_ended(self):
        node = dirtree._memory_dataset_node(
            "abc-123", _entry(ended_at="2026-09-11T11:00:00")
        )

        assert node["tags"] == ["ended"]
        assert node["metadata"]["ended_at"] == "2026-09-11T11:00:00"

    def test_a_zarr_backed_measurement_shows_its_extension(self, tmp_path):
        store = tmp_path / "abc-123.zarr"
        store.mkdir()

        node = dirtree._memory_dataset_node("abc-123", _entry(disk_path=str(store)))

        assert node["name"] == "abc-123.zarr"
        assert node["tags"] == ["zarr", "live"]
        assert node["diskPath"] == str(store)
        assert "size" in node

    def test_falls_back_to_the_start_time_when_the_file_cannot_be_read(self):
        # The disk copy may not exist yet for a measurement just started.
        node = dirtree._memory_dataset_node(
            "abc-123", _entry(disk_path="C:/nowhere/missing.zarr")
        )

        assert (
            node["timestamp"]
            == datetime.fromisoformat("2026-09-11T10:00:00").isoformat()
        )

    def test_falls_back_to_now_when_nothing_else_is_known(self):
        node = dirtree._memory_dataset_node("abc-123", _entry(started_at=None))

        # Sorting needs a timestamp, so one is always produced.
        assert node["timestamp"]
        assert node["lastModified"] > 0

    def test_survives_an_unparseable_start_time(self):
        node = dirtree._memory_dataset_node("abc-123", _entry(started_at="not-a-date"))

        assert node["timestamp"]

    def test_carries_the_websocket_url_for_the_live_client(self):
        node = dirtree._memory_dataset_node("abc-123", _entry())

        assert node["metadata"]["ws_url"] == "ws://127.0.0.1:9999/live"
        assert node["metadata"]["started_at"] == "2026-09-11T10:00:00"


class TestBuildMemoryTree:
    def test_lists_every_live_measurement_under_one_root(self, monkeypatch):
        monkeypatch.setattr(
            dirtree,
            "get_live_dataset_entries",
            lambda: {
                "abc-123": _entry(),
                "def-456": _entry(ended_at="2026-09-11T11:00:00"),
            },
        )

        tree = dirtree._build_memory_tree(MEMORY_PROTOCOL)

        assert tree["name"] == "Live Measurements"
        assert tree["type"] == "folder"
        assert {child["id"] for child in tree["children"]} == {
            "file-memory-abc-123",
            "file-memory-def-456",
        }

    def test_an_empty_registry_still_returns_the_root(self, monkeypatch):
        monkeypatch.setattr(dirtree, "get_live_dataset_entries", dict)

        tree = dirtree._build_memory_tree(MEMORY_PROTOCOL)

        assert tree["children"] == []

    def test_a_single_measurement_reference_returns_just_that_node(self, monkeypatch):
        monkeypatch.setattr(
            dirtree, "get_live_dataset_entries", lambda: {"abc-123": _entry()}
        )

        node = dirtree._build_memory_tree(f"{MEMORY_PROTOCOL}abc-123")

        assert node["id"] == "file-memory-abc-123"
        assert "children" not in node

    def test_a_reference_with_no_measurement_id_is_rejected(self, monkeypatch):
        monkeypatch.setattr(dirtree, "get_live_dataset_entries", dict)

        with pytest.raises(HTTPException) as excinfo:
            dirtree._build_memory_tree(f"{MEMORY_PROTOCOL}/")

        assert excinfo.value.status_code == 400

    def test_an_unknown_measurement_is_looked_up_before_failing(self, monkeypatch):
        # The registry may not have it yet; resolve_live_dataset is the
        # second chance before reporting it gone.
        monkeypatch.setattr(dirtree, "get_live_dataset_entries", dict)
        monkeypatch.setattr(dirtree, "resolve_live_dataset", lambda _id: _entry())

        node = dirtree._build_memory_tree(f"{MEMORY_PROTOCOL}abc-123")

        assert node["id"] == "file-memory-abc-123"
