"""
Compatibility tests for datasets written by Qanary releases.

Recorded fixtures cover completed and interrupted sweeps. When the local test
corpus is available, its datasets are also checked against ``corpus.json``.

"""

import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
import xarray as xr

from api import data_loader, dirtree, plots
from api.filters import _extract_axis_data
from api.models import PathData, PinnedParametersRequest, PlotRequest
from api.shared.identity import resolve_identity

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "qanary_datasets"
WRITERS = ["qanary-0.12.3", "qanary-zarr3", "qanary-0.13.0"]
CORPUS = Path(__file__).resolve().parents[2] / "data" / "test"
CORPUS_MANIFEST = FIXTURES / "corpus.json"


def _fixture(writer: str, kind: str) -> Path:
    (path,) = (FIXTURES / writer / kind).iterdir()
    return path


def _load(path: Path) -> xr.Dataset:
    loaded = data_loader.load_data_sync(str(path))
    assert loaded.kind == "dataset"
    assert loaded.loaded_from == "disk"
    return loaded.obj


@pytest.fixture(params=WRITERS)
def writer(request) -> str:
    return request.param


def _assert_sweep_values(dataset: xr.Dataset) -> np.ndarray:
    """Check every measured point and return where the sweep has measured."""
    x = dataset["x"].values
    y = dataset["y"].values if "y" in dataset.coords else np.zeros(1)
    grid_x, grid_y = np.meshgrid(x, y, indexing="ij")
    signal = dataset["signal"].values.reshape(grid_x.shape)
    current = dataset["current"].values.reshape(grid_x.shape)

    measured = np.isfinite(signal)
    np.testing.assert_array_equal(measured, np.isfinite(current))
    np.testing.assert_allclose(signal[measured], (100 * grid_x + grid_y)[measured])
    np.testing.assert_allclose(current[measured], (grid_x * grid_y - 0.5)[measured])
    return measured


class TestFixturesLoad:
    def test_a_finished_2d_sweep(self, writer):
        path = _fixture(writer, "sweep-2d")
        dataset = _load(path)

        assert dict(dataset.sizes) == {"x": 8, "y": 6}
        assert dataset["signal"].dims == ("x", "y")
        np.testing.assert_allclose(dataset["x"], np.linspace(0, 0.7, 8))
        np.testing.assert_allclose(dataset["y"], np.linspace(0, 0.5, 6))
        assert _assert_sweep_values(dataset).all()
        assert dataset["signal"].attrs["unit"] == "A"
        assert dataset["current"].attrs["label"] == "Current"
        assert dataset.attrs["Measurement ID"] == path.stem
        dataset.close()

    def test_a_finished_1d_sweep(self, writer):
        dataset = _load(_fixture(writer, "sweep-1d"))

        assert dict(dataset.sizes) == {"x": 11}
        np.testing.assert_allclose(dataset["x"], np.linspace(-1, 1, 11))
        assert _assert_sweep_values(dataset).all()
        dataset.close()

    def test_the_checkpoint_of_an_interrupted_sweep(self, writer):
        path = _fixture(writer, "interrupted")
        dataset = _load(path)

        assert dict(dataset.sizes) == {"x": 8, "y": 6}
        measured = _assert_sweep_values(dataset).ravel()
        count = int(measured.sum())
        assert 0 < count < measured.size
        # The sweep fills the grid in order, so what was measured is a prefix.
        assert measured[:count].all()
        assert dataset.attrs["Measurement ID"] == path.stem
        dataset.close()

    @pytest.mark.parametrize("kind", ["sweep-2d", "sweep-1d", "interrupted"])
    def test_every_writer_records_the_same_data(self, kind):
        first, *others = [_load(_fixture(writer, kind)) for writer in WRITERS]
        for other in others:
            xr.testing.assert_identical(
                first.drop_attrs(deep=False), other.drop_attrs(deep=False)
            )
            assert set(first.attrs) == set(other.attrs)
        for dataset in (first, *others):
            dataset.close()


class TestFixturesInTheApp:
    def test_the_explorer_summary_and_identity(self, writer):
        path = _fixture(writer, "sweep-2d")
        dataset = _load(path)

        summary = dirtree.build_attrs_payload(dataset)
        assert summary["Measurement ID"] == path.stem
        assert summary["Experiment Name"] == "fixture-sweep-2d"
        assert summary["Wafer ID"] == "W1"
        assert summary["independents"] == ["x", "y"]
        assert summary["dependents"] == ["signal", "current"]
        assert summary["variable_independents"]["signal"] == ["x", "y"]
        assert resolve_identity(dict(dataset.attrs), dataset) == (path.stem, "qanary")
        dataset.close()

    @pytest.mark.asyncio
    async def test_metadata_and_pinned_parameters(self, writer):
        path = str(_fixture(writer, "interrupted"))

        sections = await dirtree.get_metadata(PathData(path=path))
        assert list(sections) == [
            "Sweeps",
            "Parameters Snapshot",
            "Extra Metadata",
            "Instruments Snapshot",
        ]
        assert "Gate x" in json.loads(sections["Sweeps"])

        pinned = await dirtree.get_pinned_parameters(
            PinnedParametersRequest(path=path, names=["x_gate", "absent"])
        )
        assert pinned["parameters"][0]["label"] == "X gate"
        assert pinned["parameters"][1] == {"name": "absent", "missing": True}

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", ["sweep-2d", "interrupted"])
    async def test_a_heat_map(self, writer, kind):
        response = await plots.create_plots(
            PlotRequest(
                fpaths=[str(_fixture(writer, kind))],
                indeps=["x", "y"],
                deps=["signal"],
                plotType="HeatMap",
            )
        )

        assert response.success, response.message
        trace = response.plots[0]["plotJson"]["data"][0]
        x = _extract_axis_data(trace, "x")
        y = _extract_axis_data(trace, "y")
        z = _extract_axis_data(trace, "z").reshape(y.size, x.size)
        measured = np.isfinite(z)
        assert measured.any()
        # The heat map draws the second independent along x, in float32.
        np.testing.assert_allclose(
            z[measured], (100 * y[:, None] + x[None, :])[measured], rtol=1e-6
        )

    @pytest.mark.asyncio
    async def test_a_line_plot(self, writer):
        response = await plots.create_plots(
            PlotRequest(
                fpaths=[str(_fixture(writer, "sweep-1d"))],
                indeps=["x"],
                deps=["current"],
                plotType="LinePlot",
            )
        )

        assert response.success, response.message
        trace = response.plots[0]["plotJson"]["data"][0]
        np.testing.assert_allclose(
            _extract_axis_data(trace, "y"), np.full(11, -0.5), atol=1e-12
        )


def _plain(value):
    if isinstance(value, np.ndarray):
        return [_plain(item) for item in value.tolist()]
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _plain(item) for key, item in value.items()}
    if isinstance(value, float) and value != value:
        return "NaN"
    return value


def _canonical(value) -> bytes:
    return json.dumps(_plain(value), sort_keys=True, default=repr).encode()


def dataset_digest(dataset: xr.Dataset) -> str:
    """Digest of a dataset's variables, values and attrs, as stored on disk."""
    digest = hashlib.sha256()
    # Added by Qimchi's loader, not stored in the file.
    stored = {
        k: v for k, v in dataset.attrs.items() if k not in ("loaded_from", "path")
    }
    digest.update(_canonical(stored))
    for name in sorted(map(str, dataset.variables)):
        variable = dataset.variables[name]
        digest.update(
            _canonical(
                [name, name in dataset.coords, list(variable.dims), str(variable.dtype)]
            )
        )
        digest.update(_canonical(variable.attrs))
        values = variable.values
        if values.dtype.kind == "O":
            digest.update(_canonical(values))
        else:
            if values.dtype.kind in "fc":
                # NaN payloads may differ between writers.
                values = np.where(np.isnan(values), np.nan, values)
            digest.update(np.ascontiguousarray(values).tobytes())
    return digest.hexdigest()[:32]


def _corpus_datasets() -> list[Path]:
    return sorted(
        path
        for path in CORPUS.rglob("*")
        if (path.suffix == ".zarr" and path.is_dir())
        or (path.suffix == ".nc" and path.is_file())
    )


def _corpus_key(path: Path) -> str:
    # The manifest keeps no folder or sample names.
    relative = path.relative_to(CORPUS).as_posix()
    return hashlib.sha256(relative.encode()).hexdigest()[:16]


def write_corpus_manifest() -> None:
    """Record the digest of every loadable dataset in the local corpus."""
    manifest = {}
    for path in _corpus_datasets():
        try:
            dataset = _load(path)
        except data_loader.DatasetResolutionError:
            continue
        manifest[_corpus_key(path)] = dataset_digest(dataset)
        dataset.close()
    CORPUS_MANIFEST.write_text(
        json.dumps(manifest, indent=1, sort_keys=True) + "\n", encoding="utf-8"
    )


@pytest.mark.skipif(not CORPUS.exists(), reason="local data/test corpus not present")
@pytest.mark.filterwarnings("ignore:Failed to open Zarr store with consolidated")
def test_the_local_corpus_still_loads_to_its_recorded_values():
    manifest = json.loads(CORPUS_MANIFEST.read_text(encoding="utf-8"))
    present = {_corpus_key(path): path for path in _corpus_datasets()}
    checked = [key for key in manifest if key in present]
    assert checked, "none of the recorded corpus datasets are present"

    changed = []
    for key in checked:
        dataset = _load(present[key])
        if dataset_digest(dataset) != manifest[key]:
            changed.append(str(present[key].relative_to(CORPUS)))
        dataset.close()
    assert not changed, f"these datasets now load differently: {changed}"
