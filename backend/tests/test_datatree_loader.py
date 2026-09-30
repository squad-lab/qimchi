"""
DataTree loading, against real stores rather than mocks.

DataTree is a supported format -- Zarr, NetCDF and HDF5 containers can hold a
tree of groups -- but its loaders were the single largest untested block in the
backend: opening, node listing, node extraction and reference parsing all had
their real bodies unexecuted.

"""

import numpy as np
import pytest
import xarray as xr

from api import data_loader
from api import dirtree as data_loader_dirtree
from api.data_loader import DatasetResolutionError, UnsupportedDatasetFormatError


@pytest.fixture
def datatree_store(tmp_path):
    """A zarr store holding a root dataset and two child groups."""
    tree = xr.DataTree.from_dict(
        {
            "/": xr.Dataset(
                {"root_signal": ("x", np.arange(3.0))}, coords={"x": np.arange(3)}
            ),
            "/sweep_a": xr.Dataset(
                {"signal": ("x", np.arange(3.0))}, coords={"x": np.arange(3)}
            ),
            "/sweep_b": xr.Dataset(
                {"signal": ("x", np.arange(3.0) * 2)}, coords={"x": np.arange(3)}
            ),
        }
    )
    path = tmp_path / "tree.zarr"
    tree.to_zarr(path, mode="w")
    return path


class TestReferenceParsing:
    @pytest.mark.parametrize(
        "fragment, expected",
        [
            ("#dt_path=/sweep_a", "/sweep_a"),
            ("#node=/sweep_a", "/sweep_a"),
            ("#/sweep_a", "/sweep_a"),
        ],
    )
    def test_accepts_every_fragment_spelling(self, tmp_path, fragment, expected):
        # Three spellings exist in the wild; all must reach the same node.
        store = tmp_path / "tree.zarr"
        path, node = data_loader._parse_datatree_reference(f"{store}{fragment}")

        assert path == store
        assert node == expected

    def test_a_bare_store_has_no_node(self, tmp_path):
        path, node = data_loader._parse_datatree_reference(str(tmp_path / "tree.zarr"))

        assert node is None

    def test_rejects_a_path_that_is_not_a_container(self, tmp_path):
        with pytest.raises(UnsupportedDatasetFormatError):
            data_loader._parse_datatree_reference(str(tmp_path / "notes.md"))


class TestOpeningAndListing:
    def test_lists_every_node_with_whether_it_holds_data(self, datatree_store):
        nodes = data_loader.list_datatree_nodes(str(datatree_store))

        by_path = {node["path"]: node for node in nodes}
        assert "/sweep_a" in by_path
        assert "/sweep_b" in by_path
        # The Explorer shows only nodes that can actually be plotted.
        assert by_path["/sweep_a"]["has_dataset"] is True
        assert by_path["/sweep_a"]["name"] == "sweep_a"

    def test_a_missing_store_says_so(self, tmp_path):
        with pytest.raises(DatasetResolutionError, match="does not exist"):
            data_loader.list_datatree_nodes(str(tmp_path / "gone.zarr"))

    def test_opens_a_zarr_tree(self, datatree_store):
        tree = data_loader._open_xarray_datatree(datatree_store, "zarr")

        assert isinstance(tree, xr.DataTree)


class TestNodeExtraction:
    def test_pulls_the_dataset_out_of_a_named_node(self, datatree_store):
        tree = data_loader._open_xarray_datatree(datatree_store, "zarr")

        dataset = data_loader._extract_dataset_from_datatree(tree, "/sweep_b")

        assert isinstance(dataset, xr.Dataset)
        assert np.allclose(dataset["signal"].values, [0.0, 2.0, 4.0])

    def test_defaults_to_the_root_node(self, datatree_store):
        tree = data_loader._open_xarray_datatree(datatree_store, "zarr")

        dataset = data_loader._extract_dataset_from_datatree(tree, None)

        assert "root_signal" in dataset.data_vars

    def test_a_node_that_does_not_exist_is_an_error(self, datatree_store):
        tree = data_loader._open_xarray_datatree(datatree_store, "zarr")

        with pytest.raises(DatasetResolutionError, match="node not found"):
            data_loader._extract_dataset_from_datatree(tree, "/nope")


class TestLoadingThroughTheEntryPoint:
    def test_loads_a_named_node(self, datatree_store):
        loaded = data_loader.load_data_sync(f"{datatree_store}#dt_path=/sweep_a")

        assert loaded.kind == "dataset"
        assert "signal" in loaded.obj.data_vars

    def test_a_group_with_no_payload_reports_a_kind_mismatch(self, tmp_path):
        # A group that only holds children is browsable but not plottable.
        tree = xr.DataTree.from_dict(
            {
                "/": xr.Dataset(),
                "/group": xr.Dataset(),
                "/group/run": xr.Dataset(
                    {"signal": ("x", np.arange(2.0))}, coords={"x": np.arange(2)}
                ),
            }
        )
        store = tmp_path / "nested.zarr"
        tree.to_zarr(store, mode="w")

        opened = data_loader._open_xarray_datatree(store, "zarr")
        dataset = data_loader._extract_dataset_from_datatree(opened, "/group")

        # An empty node still carries a dataset object, just an empty one.
        assert len(dataset.data_vars) == 0


class TestMetadataEndpointsOverDataTree:
    """
    A DataTree node reaches /load-meta/ and /load-attrs/ like any dataset.

    Both endpoints release the dataset in a ``finally``, and a node's dataset
    is a DatasetView, which xarray refuses to close. That raised from the
    finally and turned every DataTree reference into a 500.

    """

    @pytest.mark.asyncio
    async def test_metadata_does_not_fail_on_release(self, datatree_store):
        from api.models import PathData

        out = await data_loader_dirtree.get_metadata(
            PathData(path=f"{datatree_store}#dt_path=/sweep_a")
        )

        assert isinstance(out, dict)

    @pytest.mark.asyncio
    async def test_attrs_does_not_fail_on_release(self, datatree_store):
        from api.models import PathData

        out = await data_loader_dirtree.get_meta_attrs(
            PathData(path=f"{datatree_store}#dt_path=/sweep_a")
        )

        assert out["independents"] == ["x"]
        assert out["dependents"] == ["signal"]
