from datetime import datetime

from api import dirtree


def test_live_tree_includes_websocket_only_generic_dataset():
    node = dirtree._memory_dataset_node(
        "qcodes-run-42",
        {
            "disk_path": "",
            "ws_url": "ws://localhost:9876",
            "started_at": datetime.now().isoformat(),
            "ended_at": None,
        },
    )

    assert node is not None
    assert node["name"] == "qcodes-run-42"
    assert node["path"] == "memory://qcodes-run-42"
    assert node["tags"] == ["live"]
    assert "diskPath" not in node
