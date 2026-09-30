"""
Tests for the Explorer's per-dataset scan cache (``dataset_scan_cache``).

Deriving a zarr store's size and modification time means touching the store's
contents, which dominated directory scans. The cache reuses both while the
store's stat fingerprint holds, so three things must be true: a cached scan
returns the same values as an uncached one, writing to a store invalidates the
entry, and a broken database only makes the scan slower rather than failing it.
"""

import numpy as np
import pytest
import xarray as xr
from sqlmodel import select

from api import dirtree
from api.db_models import DatasetScanCache
from api.shared.db import session_scope


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


def _write_store(root, name: str, values: int = 16):
    """Write a small zarr store under ``root`` and return its path."""
    ds = xr.Dataset(
        {"y": ("x", np.linspace(0, 1, values))},
        coords={"x": np.arange(values)},
    )
    path = root / name
    ds.to_zarr(path, mode="w")
    return path


def _leaves(node) -> dict:
    """Flatten a tree into {path: node} for the dataset leaves."""
    out = {}
    if node.get("type") == "file":
        out[node["path"]] = node
    for child in node.get("children") or []:
        out.update(_leaves(child))
    return out


def test_cached_scan_matches_an_uncached_scan(tmp_path):
    root = tmp_path / "data"
    root.mkdir()
    store = _write_store(root, "run-1.zarr")

    first = _leaves(dirtree._build_directory_tree_zarr(str(root)))
    second = _leaves(dirtree._build_directory_tree_zarr(str(root)))

    assert set(first) == set(second)
    node_a, node_b = first[str(store)], second[str(store)]
    assert node_a["size"] == node_b["size"]
    assert node_a["lastModified"] == node_b["lastModified"]

    with session_scope() as session:
        cached_paths = [
            row.abs_path for row in session.exec(select(DatasetScanCache)).all()
        ]
    assert cached_paths == [str(store)]


def test_rewriting_a_store_invalidates_its_entry(tmp_path):
    root = tmp_path / "data"
    root.mkdir()
    store = _write_store(root, "run-1.zarr", values=16)

    dirtree._build_directory_tree_zarr(str(root))
    with session_scope() as session:
        before = session.get(DatasetScanCache, str(store)).fingerprint
        assert before

    # Rewriting the store changes the directory's stat signature.
    _write_store(root, "run-1.zarr", values=64)

    dirtree._build_directory_tree_zarr(str(root))
    with session_scope() as session:
        after = session.get(DatasetScanCache, str(store)).fingerprint

    assert before != after


def test_scan_survives_an_unusable_database(tmp_path, monkeypatch):
    root = tmp_path / "data"
    root.mkdir()
    store = _write_store(root, "run-1.zarr")

    def _boom(*_args, **_kwargs):
        raise RuntimeError("database is gone")

    monkeypatch.setattr(dirtree, "_read_scan_cache", _boom)

    # The cache only saves work, so losing it must not lose the Explorer.
    with pytest.raises(RuntimeError):
        dirtree._read_scan_cache([str(store)])

    monkeypatch.undo()
    monkeypatch.setattr("api.shared.db.session_scope", _boom)

    leaves = _leaves(dirtree._build_directory_tree_zarr(str(root)))
    assert str(store) in leaves
    assert leaves[str(store)]["size"] >= 0
