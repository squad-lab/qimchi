"""Tests for executable discovery and runtime configuration."""

from __future__ import annotations

import importlib
import os
import sys

import pytest

from api import config


@pytest.fixture(autouse=True)
def _restore_config(monkeypatch):
    yield
    monkeypatch.delenv("QIMCHI_MAX_DEPTH", raising=False)
    monkeypatch.delattr(sys, "frozen", raising=False)
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)
    importlib.reload(config)


def test_bundled_fd_wins_in_frozen_build(tmp_path, monkeypatch):
    executable = tmp_path / ("fd.exe" if os.name == "nt" else "fd")
    executable.write_bytes(b"fd")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    monkeypatch.setattr(config.shutil, "which", lambda _name: None)

    reloaded = importlib.reload(config)

    assert reloaded.FD_EXEC == str(executable)


def test_path_search_tries_both_fd_names(monkeypatch):
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    monkeypatch.setattr(
        config.shutil, "which", lambda name: "/bin/fdfind" if name == "fdfind" else None
    )

    reloaded = importlib.reload(config)

    assert reloaded.FD_EXEC == "fdfind"


def test_max_depth_comes_from_environment(monkeypatch):
    monkeypatch.setenv("QIMCHI_MAX_DEPTH", "12")

    reloaded = importlib.reload(config)

    assert reloaded.MAX_DEPTH == 12
