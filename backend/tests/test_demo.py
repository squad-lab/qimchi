import time

import numpy as np
import pytest
import xarray as xr
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import data_loader, demo, plots
from api.dirtree import build_attrs_payload
from api.shared.identity import content_uuid


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("QIMCHI_HOME", str(tmp_path))
    return tmp_path


def test_prepare_writes_both_demo_measurements(home):
    result = demo.prepare_demo_files()

    assert result["folder"] == str(home / "demo")
    for key in ("logo", "reveal"):
        loaded = data_loader.load_dataset_sync(result[key])
        assert loaded.attrs["qimchi_demo_version"] == demo.DEMO_VERSION


def test_prepare_leaves_current_files_alone_and_rewrites_old_ones(home, monkeypatch):
    logo = demo.demo_dir() / demo.LOGO_FILE
    demo.prepare_demo_files()
    written = logo.stat().st_mtime_ns

    demo.prepare_demo_files()
    assert logo.stat().st_mtime_ns == written

    monkeypatch.setattr(demo, "DEMO_VERSION", demo.DEMO_VERSION + 1)
    monkeypatch.setitem(demo._DEMO_ATTRS, "qimchi_demo_version", demo.DEMO_VERSION)
    time.sleep(0.01)
    demo.prepare_demo_files()
    assert logo.stat().st_mtime_ns != written


def test_the_endpoint_reports_where_the_files_are(home):
    # The router alone: the full app's startup launches Kaleido and export workers.
    app = FastAPI()
    app.include_router(demo.router)

    with TestClient(app) as client:
        response = client.post("/demo/prepare")

    assert response.status_code == 200
    assert response.json()["logo"].endswith(demo.LOGO_FILE)


def test_regenerated_demo_files_keep_their_identity():
    """Hearts and notes on a demo measurement must survive it being rewritten."""
    assert content_uuid(demo.logo_dataset()) == content_uuid(demo.logo_dataset())
    assert content_uuid(demo.reveal_dataset()) == content_uuid(demo.reveal_dataset())


def test_the_logo_lands_on_the_viridis_colours_of_the_logo():
    signal = demo.logo_dataset()["signal"]
    top = signal.sel(P2=0.03, P1=0.0, method="nearest")
    bottom = signal.sel(P2=-0.03, P1=0.0, method="nearest")
    gap = signal.sel(P2=0.0, P1=0.0, method="nearest")
    span = float(signal.max() - signal.min())

    def position(value):
        return float(value - signal.min()) / span

    assert 0.75 < position(top) < 0.95  # Viridis green
    assert 0.45 < position(bottom) < 0.6  # Viridis teal
    assert position(gap) < 0.1


def test_the_logo_is_plotted_as_a_heatmap_over_both_gates():
    attrs = build_attrs_payload(demo.logo_dataset())

    assert attrs["dependents"] == ["signal"]
    # A heat map draws its second independent along x.
    assert attrs["variable_independents"]["signal"] == ["P2", "P1"]
    reveal = build_attrs_payload(demo.reveal_dataset())
    assert reveal["variable_independents"]["brightness"][:2] == ["y", "x"]


def test_the_reveal_slider_steps_from_silhouette_to_picture():
    dataset = demo.reveal_dataset()

    config = plots.gen_slider_config(dataset, ["x", "y"], ["brightness"])
    assert config == {
        "reveal": {
            "min": 0,
            "max": 1,
            "step": 1,
            "value": 0,
            "labels": demo.REVEAL_LABELS,
        }
    }

    figure = np.flipud(demo._qabbage_parts()) > 0
    silhouette = plots.apply_data_slicing(dataset, ["x", "y"], {"reveal": {"value": 0}})
    revealed = plots.apply_data_slicing(dataset, ["x", "y"], {"reveal": {"value": 1}})
    assert np.all(silhouette["brightness"].transpose("y", "x").values[figure] == 0.0)
    assert len(np.unique(revealed["brightness"].transpose("y", "x").values[figure])) > 3


def test_the_live_logo_points_at_the_logo_file_and_writes_nothing(home, monkeypatch):
    published = []

    class _Registration:
        def __init__(self, measurement_id, snapshot, **options):
            published.append((measurement_id, snapshot, options))

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    from qimchi_connect import producer

    monkeypatch.setattr(producer, "live_measurement", _Registration)
    live = demo._LiveDemo()

    measurement_id = live.start(row_interval=0.0)
    live._thread.join(10)

    assert not live.running()
    (published_id, snapshot, options) = published[0]
    assert published_id == measurement_id
    assert options["disk_path"] == str(demo.demo_dir() / demo.LOGO_FILE)
    xr.testing.assert_allclose(snapshot()["signal"], demo.logo_dataset()["signal"])
    assert sorted(p.name for p in demo.demo_dir().iterdir()) == sorted(
        [demo.LOGO_FILE, demo.REVEAL_FILE]
    )


def test_prepare_removes_files_left_by_older_versions(home):
    stale = demo.demo_dir() / "live" / "qimchi-demo-000000-abcd.nc"
    stale.parent.mkdir(parents=True)
    stale.write_bytes(b"old")
    renamed = demo.demo_dir() / "whos_that_qubit.nc"
    renamed.write_bytes(b"old")

    demo.prepare_demo_files()

    assert not stale.parent.exists()
    assert not renamed.exists()


def test_the_second_demo_does_not_give_its_surprise_away():
    assert "qabbage" not in demo.REVEAL_FILE.lower()
    assert "qabbage" not in demo.reveal_dataset().attrs["Experiment Name"].lower()


def test_a_second_start_reports_the_demo_already_running(home, monkeypatch):
    from qimchi_connect import producer

    class _Registration:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(producer, "live_measurement", _Registration)
    live = demo._LiveDemo()

    first = live.start(row_interval=0.05)
    second = live.start(row_interval=0.05)
    live.stop()

    assert first == second
    assert not live.running()
