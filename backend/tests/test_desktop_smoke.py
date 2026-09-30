"""Tests for the packaged-desktop smoke-test contract."""

from __future__ import annotations

import importlib.util
import zipfile
from pathlib import Path

import pytest


@pytest.fixture
def launcher():
    launcher_path = (
        Path(__file__).resolve().parents[2] / "packaging" / "qimchi_launcher.py"
    )
    spec = importlib.util.spec_from_file_location(
        "qimchi_launcher_smoke", launcher_path
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_smoke_fixture_is_isolated_under_qimchi_home(launcher, tmp_path, monkeypatch):
    home = tmp_path / "home"
    monkeypatch.setenv("QIMCHI_HOME", str(home))
    monkeypatch.delenv("QIMCHI_DOWNLOAD_DIR", raising=False)
    monkeypatch.delenv("QIMCHI_SMOKE_DATASET", raising=False)

    dataset_path, download_dir = launcher._prepare_smoke_fixture()

    assert Path(dataset_path).read_bytes() == b"qimchi packaged desktop smoke fixture"
    assert Path(download_dir) == home / "desktop-smoke" / "downloads"
    assert Path(download_dir).is_dir()


def test_smoke_archive_validation_accepts_fixture_and_rejects_wrong_archive(
    launcher, tmp_path
):
    dataset = tmp_path / "smoke-measurement.nc"
    dataset.write_bytes(b"fixture")
    valid = tmp_path / "valid.zip"
    invalid = tmp_path / "invalid.zip"
    with zipfile.ZipFile(valid, "w") as archive:
        archive.write(dataset, dataset.name)
    with zipfile.ZipFile(invalid, "w") as archive:
        archive.writestr("other.nc", b"other")

    launcher._validate_smoke_archive(str(valid), str(dataset))
    with pytest.raises(RuntimeError, match="does not contain"):
        launcher._validate_smoke_archive(str(invalid), str(dataset))


def test_release_builds_run_supported_packaged_smokes():
    repository = Path(__file__).resolve().parents[2]
    ci = (repository / ".gitlab-ci.yml").read_text(encoding="utf-8")

    assert "qimchi.exe --mode headless" in ci
    # The AppImage filename carries the version, so the job discovers it into
    # $APPIMAGE rather than naming it.
    assert "APPIMAGE=$(ls packaging/build/qimchi-${ARCH}-*.AppImage" in ci
    assert '"$APPIMAGE" --mode headless' in ci
    assert '"$APPIMAGE" --mode native' in ci
    assert "xvfb-run" in ci
