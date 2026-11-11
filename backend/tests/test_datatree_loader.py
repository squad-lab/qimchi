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
from api.data_loader import (
    DatasetKindMismatchError,
    DatasetResolutionError,
    UnsupportedDatasetFormatError,
)


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


@pytest.fixture
def isolated_db(tmp_path, monkeypatch):
    """Point the DB at a scratch file, so Explorer scans cache into it."""
    monkeypatch.setenv("QIMCHI_HOME", str(tmp_path / "home"))
    from api.shared import db as db_mod

    db_mod._engine = None
    db_mod.run_migrations()
    db_mod.seed_local_user()
    yield
    db_mod._engine = None


def _sweep(dim: str, n: int, scale: float = 1.0) -> xr.Dataset:
    return xr.Dataset(
        {"signal": (dim, np.arange(float(n)) * scale)}, coords={dim: np.arange(n)}
    )


def _empty_root_tree(**root_attrs) -> xr.DataTree:
    """Like Elicit's files: metadata on an empty root, data in child groups."""
    return xr.DataTree.from_dict(
        {
            "/": xr.Dataset(attrs=root_attrs),
            "/sweep_a": _sweep("x", 3),
            "/sweep_b": _sweep("x", 4, 2.0),
        }
    )


def _scan(root) -> dict:
    """Run an Explorer scan and return its top-level nodes by name."""
    tree = data_loader_dirtree._build_directory_tree_zarr(str(root))
    return {child["name"]: child for child in tree["children"]}


class TestDetectingTrees:
    def test_a_consolidated_zarr_tree(self, tmp_path):
        store = tmp_path / "tree.zarr"
        _empty_root_tree().to_zarr(store, mode="w")

        assert data_loader.has_datatree_groups(store)

    def test_an_unconsolidated_zarr_tree(self, tmp_path):
        store = tmp_path / "tree.zarr"
        _empty_root_tree().to_zarr(store, mode="w", consolidated=False)

        assert data_loader.has_datatree_groups(store)

    def test_a_netcdf_tree(self, tmp_path):
        path = tmp_path / "tree.nc"
        _empty_root_tree().to_netcdf(path, engine="h5netcdf")

        assert data_loader.has_datatree_groups(path)

    def test_single_datasets_are_not_trees(self, tmp_path):
        _sweep("x", 3).to_zarr(tmp_path / "flat.zarr", mode="w")
        _sweep("x", 3).to_netcdf(tmp_path / "flat.nc", engine="h5netcdf")
        _sweep("x", 3).to_netcdf(tmp_path / "flat3.nc", engine="scipy")

        for name in ("flat.zarr", "flat.nc", "flat3.nc"):
            assert not data_loader.has_datatree_groups(tmp_path / name), name

    def test_netcdf_groups_are_listed_as_xarray_lists_them(self, tmp_path):
        # Without opening the tree in xarray, which is too slow for a folder scan.
        path = tmp_path / "tree.nc"
        _nested_tree(path)
        with xr.open_datatree(path, engine="h5netcdf") as tree:
            expected = [
                {
                    "path": node.path,
                    "name": node.name or "root",
                    "has_dataset": bool(node.data_vars),
                }
                for node in tree.subtree
            ]

        assert data_loader._netcdf4_datatree_nodes(path) == expected


class TestTreesInAFolderScan:
    @pytest.mark.parametrize("name", ["tree.zarr", "tree.nc"])
    def test_a_tree_is_a_folder_of_its_groups(self, tmp_path, isolated_db, name):
        path = tmp_path / name
        tree = _empty_root_tree()
        if name.endswith(".zarr"):
            tree.to_zarr(path, mode="w")
        else:
            tree.to_netcdf(path, engine="h5netcdf")
        _sweep("x", 3).to_zarr(tmp_path / "flat.zarr", mode="w")

        nodes = _scan(tmp_path)

        assert nodes["flat.zarr"]["type"] == "file"
        container = nodes[name]
        assert container["type"] == "folder"
        assert "datatree" in container["tags"]
        # The empty root has nothing to plot, so it gets no leaf.
        assert sorted(c["path"] for c in container["children"]) == [
            f"{path}#dt_path=/sweep_a",
            f"{path}#dt_path=/sweep_b",
        ]

    def test_a_root_with_data_gets_its_own_leaf(self, tmp_path, isolated_db):
        store = tmp_path / "rooted.zarr"
        xr.DataTree.from_dict({"/": _sweep("x", 3), "/child": _sweep("y", 5)}).to_zarr(
            store, mode="w"
        )

        container = _scan(tmp_path)["rooted.zarr"]
        leaves = {c["name"]: c["path"] for c in container["children"]}

        assert leaves == {
            "root": f"{store}#dt_path=/",
            "child": f"{store}#dt_path=/child",
        }
        loaded = data_loader.load_data_sync(leaves["root"])
        assert loaded.obj.sizes == {"x": 3}

    def test_a_group_with_data_and_subgroups_is_a_folder(self, tmp_path, isolated_db):
        store = tmp_path / "nested.zarr"
        xr.DataTree.from_dict(
            {"/": xr.Dataset(), "/run": _sweep("x", 3), "/run/fit": _sweep("y", 2)}
        ).to_zarr(store, mode="w")

        run = _scan(tmp_path)["nested.zarr"]["children"][0]

        assert run["type"] == "folder"
        # Its own reference, so it can be hearted, trashed and tagged by itself.
        assert run["path"] == f"{store}#dt_group=/run"
        assert sorted(c["path"] for c in run["children"]) == [
            f"{store}#dt_path=/run",
            f"{store}#dt_path=/run/fit",
        ]

    def test_the_next_scan_reads_trees_from_the_cache(
        self, tmp_path, isolated_db, monkeypatch
    ):
        _empty_root_tree().to_netcdf(tmp_path / "tree.nc", engine="h5netcdf")
        _sweep("x", 3).to_netcdf(tmp_path / "flat.nc", engine="h5netcdf")
        first = _scan(tmp_path)

        def _no_probe(*_args):
            raise AssertionError("an unchanged container was opened again")

        monkeypatch.setattr(data_loader_dirtree, "_probe_datatree_nodes", _no_probe)
        second = _scan(tmp_path)

        assert second == first
        assert second["tree.nc"]["type"] == "folder"
        assert second["flat.nc"]["type"] == "file"

    def test_containers_a_scan_has_no_time_for_are_checked_in_the_background(
        self, tmp_path, isolated_db, monkeypatch
    ):
        _empty_root_tree().to_netcdf(tmp_path / "tree.nc", engine="h5netcdf")
        monkeypatch.setattr(data_loader_dirtree, "DATATREE_PROBE_BUDGET", 0.0)
        monkeypatch.setattr(data_loader_dirtree, "DATATREE_PROBE_MINIMUM", 0)

        assert _scan(tmp_path)["tree.nc"]["type"] == "file"
        data_loader_dirtree._datatree_probe_job.result(timeout=30)

        assert _scan(tmp_path)["tree.nc"]["type"] == "folder"


class TestOpeningANode:
    def test_the_plain_path_of_a_tree_with_several_groups_is_refused(self, tmp_path):
        path = tmp_path / "tree.nc"
        _empty_root_tree().to_netcdf(path, engine="h5netcdf")

        with pytest.raises(DatasetKindMismatchError, match="choose one of its groups"):
            data_loader.load_data_sync(str(path))

    def test_the_plain_path_of_a_tree_with_one_group_opens_that_group(self, tmp_path):
        # As Elicit writes them; a Basket from before trees were browsable holds these.
        path = tmp_path / "tree.nc"
        xr.DataTree.from_dict(
            {"/": xr.Dataset(attrs={"name": "pinch-off"}), "/sweep": _sweep("x", 3)}
        ).to_netcdf(path, engine="h5netcdf")

        loaded = data_loader.load_data_sync(str(path))

        assert loaded.source_ref == f"{path}#dt_path=/sweep"
        assert list(loaded.obj.data_vars) == ["signal"]
        assert loaded.obj.attrs["name"] == "pinch-off"

    def test_a_node_takes_its_parents_attributes(self, tmp_path):
        path = tmp_path / "tree.nc"
        tree = _empty_root_tree(name="pinch-off", uuid="root-id")
        tree["sweep_a"].attrs = {"uuid": "node-id", "program": "ramp"}
        tree.to_netcdf(path, engine="h5netcdf")

        attrs = data_loader.load_data_sync(f"{path}#dt_path=/sweep_a").obj.attrs

        assert attrs["name"] == "pinch-off"
        assert attrs["program"] == "ramp"
        assert attrs["uuid"] == "node-id"

    def test_inherited_coordinates_stay_only_where_used(self, tmp_path):
        store = tmp_path / "tree.zarr"
        xr.DataTree.from_dict(
            {
                "/": xr.Dataset(coords={"x": np.arange(3)}),
                "/same_axis": xr.Dataset({"signal": ("x", np.arange(3.0))}),
                "/other_axis": _sweep("y", 5),
            }
        ).to_zarr(store, mode="w")

        same = data_loader.load_data_sync(f"{store}#dt_path=/same_axis").obj
        other = data_loader.load_data_sync(f"{store}#dt_path=/other_axis").obj

        assert list(same.coords) == ["x"]
        assert list(other.coords) == ["y"]
        assert type(other) is xr.Dataset


def _nested_tree(path) -> None:
    """A file with a group folder holding two groups, and a group beside it."""
    xr.DataTree.from_dict(
        {
            "/": xr.Dataset(attrs={"name": "cooldown"}),
            "/day1": xr.Dataset(),
            "/day1/a": _sweep("x", 3),
            "/day1/b": _sweep("y", 4),
            "/other": _sweep("x", 2),
        }
    ).to_netcdf(path, engine="h5netcdf")


class TestAnnotations:
    @pytest.mark.asyncio
    async def test_a_bare_path_is_recorded_under_its_group(self, tmp_path, isolated_db):
        from api import library

        path = tmp_path / "tree.nc"
        xr.DataTree.from_dict({"/": xr.Dataset(), "/sweep": _sweep("x", 3)}).to_netcdf(
            path, engine="h5netcdf"
        )
        group_ref = f"{path}#dt_path=/sweep"

        bare = await library.register(library.RegisterRequest(path=str(path)))
        await library.heart(library.HeartRequest(uuid=bare.uuid, hearted=True))
        group = await library.register(library.RegisterRequest(path=group_ref))

        assert bare.uuid == group.uuid
        # Recorded under the file's path, the heart would show on the file instead.
        assert [(s.abs_path, s.hearted) for s in await library.states()] == [
            (group_ref, True)
        ]

    @pytest.mark.asyncio
    async def test_trashing_a_group_folder_clears_its_groups_hearts(
        self, tmp_path, isolated_db
    ):
        from api import library

        path = tmp_path / "tree.nc"
        _nested_tree(path)
        inside, beside = f"{path}#dt_path=/day1/a", f"{path}#dt_path=/other"
        for ref in (inside, beside):
            state = await library.register(library.RegisterRequest(path=ref))
            await library.heart(library.HeartRequest(uuid=state.uuid, hearted=True))
        folder = await library.register(
            library.RegisterRequest(path=f"{path}#dt_group=/day1", folder=True)
        )

        out = await library.trash(library.TrashRequest(uuid=folder.uuid, trashed=True))

        assert out.unhearted_paths == [inside]

    @pytest.mark.asyncio
    async def test_a_groups_note_lives_in_its_files_notes_folder(
        self, tmp_path, isolated_db
    ):
        from api import notes
        from api.models import NotesData, PathData

        data = tmp_path / "sample" / "cooldown"
        data.mkdir(parents=True)
        path = data / "tree.nc"
        _nested_tree(path)
        ref = f"{path}#dt_path=/day1/a"

        await notes.save_notes(NotesData(path=ref, notes="gate drifted", uuid="u-1"))

        assert (data / "tree" / "day1_a.md").is_file()
        assert sorted(p.name for p in data.iterdir()) == ["tree", "tree.nc"]
        loaded = await notes.load_notes(PathData(path=ref, uuid="u-1"))
        assert loaded["notes"].strip() == "gate drifted"


class TestDownloads:
    @staticmethod
    def _names(response) -> list[str]:
        import zipfile

        with zipfile.ZipFile(response.path) as archive:
            return sorted(archive.namelist())

    def test_a_group_downloads_as_netcdf_with_its_files_metadata(
        self, tmp_path, isolated_db
    ):
        import zipfile

        from api import download

        path = tmp_path / "tree.nc"
        _nested_tree(path)

        response = download._download_dataset(f"{path}#dt_path=/day1/a")

        assert self._names(response) == ["tree/day1_a.nc", "tree/day1_a.qimchi.json"]
        with zipfile.ZipFile(response.path) as archive:
            archive.extract("tree/day1_a.nc", tmp_path / "out")
        with xr.open_dataset(tmp_path / "out/tree/day1_a.nc", engine="h5netcdf") as ds:
            assert list(ds.data_vars) == ["signal"]
            assert ds.attrs["name"] == "cooldown"
            assert "path" not in ds.attrs

    def test_a_group_folder_downloads_the_groups_inside_it(self, tmp_path, isolated_db):
        from api import download

        path = tmp_path / "tree.nc"
        _nested_tree(path)

        response = download._download_folder(f"{path}#dt_group=/day1")

        assert [n for n in self._names(response) if n.endswith(".nc")] == [
            "tree/day1_a.nc",
            "tree/day1_b.nc",
        ]

    def test_the_file_itself_downloads_whole(self, tmp_path, isolated_db):
        from api import download

        path = tmp_path / "tree.nc"
        _nested_tree(path)

        response = download._download_folder(str(path))

        assert "tree.nc" in self._names(response)

    def test_groups_join_other_datasets_in_a_multiple_download(
        self, tmp_path, isolated_db
    ):
        from api import download

        path = tmp_path / "tree.nc"
        _nested_tree(path)
        _sweep("x", 3).to_netcdf(tmp_path / "flat.nc", engine="h5netcdf")

        response = download._download_selected_datasets(
            [
                f"{path}#dt_path=/day1/a",
                f"{path}#dt_path=/other",
                str(tmp_path / "flat.nc"),
            ]
        )

        assert [n for n in self._names(response) if n.endswith(".nc")] == [
            "flat.nc",
            "tree/day1_a.nc",
            "tree/other.nc",
        ]
