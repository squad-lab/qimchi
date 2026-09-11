import pytest

from api import dirtree
from api.models import PathData


@pytest.mark.asyncio
async def test_get_directory_tree_zarr_monkeypatched(tmp_path, monkeypatch):
    # TODOLATER: This doesn't test all of the logic yet.

    # Create a sample directory structure
    root = tmp_path / "root"
    a = root / "a"
    b_zarr = a / "b.zarr"
    c_zarr = root / "c.zarr"

    b_zarr.mkdir(parents=True)
    a.mkdir(parents=True, exist_ok=True)
    c_zarr.mkdir(parents=True, exist_ok=True)

    # Ensure module reports executable present
    monkeypatch.setattr(dirtree, "FD_EXEC", "fdfind")

    # Prepare fd output: absolute paths for directories
    fd_paths = [str(p.resolve()) for p in [b_zarr, c_zarr]]

    class _MockResult:
        def __init__(self, returncode, stdout, stderr):
            self.returncode = returncode
            self.stdout = stdout
            self.stderr = stderr

    def _mock_subprocess_run(
        cmd, input=None, stdout=None, stderr=None, check=False, **kwargs
    ):
        if cmd and cmd[0] == "fdfind":
            out = ("\n".join(fd_paths) + "\n").encode("utf-8")
            return _MockResult(0, out, b"")
        return _MockResult(1, b"", b"unknown command")

    monkeypatch.setattr(dirtree.subprocess, "run", _mock_subprocess_run)

    # Call the async function
    tree = await dirtree.get_directory_tree_zarr(str(root), max_depth=3)

    # Basic shape checks
    assert isinstance(tree, dict)
    assert tree.get("path") == str(root)

    # Find zarr children under the tree
    def collect_zarr_nodes(node):
        found = []
        if node.get("tags") == ["zarr"]:
            found.append(node)
        for ch in node.get("children", []):
            found.extend(collect_zarr_nodes(ch))
        return found

    zarr_nodes = collect_zarr_nodes(tree)
    # We expect two .zarr datasets
    assert len(zarr_nodes) == 2

    sizes = {n["path"]: n.get("size") for n in zarr_nodes}
    assert sizes.get(str(c_zarr.resolve())) is not None
    assert sizes.get(str(b_zarr.resolve())) is not None


@pytest.mark.asyncio
async def test_get_directory_tree_includes_netcdf_and_hdf5(tmp_path, monkeypatch):
    root = tmp_path / "root"
    root.mkdir(parents=True)
    nc_file = root / "trace.nc"
    h5_file = root / "trace.h5"
    nc_file.write_text("nc")
    h5_file.write_text("h5")

    monkeypatch.setattr(dirtree, "FD_EXEC", "fdfind")

    class _MockResult:
        def __init__(self, returncode, stdout, stderr):
            self.returncode = returncode
            self.stdout = stdout
            self.stderr = stderr

    def _mock_subprocess_run(
        cmd, input=None, stdout=None, stderr=None, check=False, **kwargs
    ):
        # zarr directory call
        if "-t" in cmd and "d" in cmd:
            return _MockResult(0, b"", b"")
        # dataset files call
        if "-t" in cmd and "f" in cmd:
            out = f"{nc_file.resolve()}\n{h5_file.resolve()}\n".encode("utf-8")
            return _MockResult(0, out, b"")
        return _MockResult(1, b"", b"unknown command")

    monkeypatch.setattr(dirtree.subprocess, "run", _mock_subprocess_run)

    tree = await dirtree.get_directory_tree_zarr(str(root), max_depth=2)
    assert isinstance(tree, dict)

    children = tree.get("children", [])
    child_paths = {child.get("path"): child for child in children}
    assert str(nc_file.resolve()) in child_paths
    assert str(h5_file.resolve()) in child_paths
    assert child_paths[str(nc_file.resolve())]["tags"] == ["netcdf"]
    assert child_paths[str(h5_file.resolve())]["tags"] == ["hdf5"]


@pytest.mark.asyncio
async def test_get_directory_tree_includes_sqlite(tmp_path, monkeypatch):
    root = tmp_path / "root"
    root.mkdir(parents=True)
    db_file = root / "runs.db"
    sqlite_file = root / "runs.sqlite"
    db_file.write_text("db")
    sqlite_file.write_text("sqlite")

    monkeypatch.setattr(dirtree, "FD_EXEC", "fdfind")

    class _MockResult:
        def __init__(self, returncode, stdout, stderr):
            self.returncode = returncode
            self.stdout = stdout
            self.stderr = stderr

    def _mock_subprocess_run(
        cmd, input=None, stdout=None, stderr=None, check=False, **kwargs
    ):
        # zarr directory call
        if "-t" in cmd and "d" in cmd:
            return _MockResult(0, b"", b"")
        # dataset files call
        if "-t" in cmd and "f" in cmd:
            out = f"{db_file.resolve()}\n{sqlite_file.resolve()}\n".encode("utf-8")
            return _MockResult(0, out, b"")
        return _MockResult(1, b"", b"unknown command")

    monkeypatch.setattr(dirtree.subprocess, "run", _mock_subprocess_run)

    tree = await dirtree.get_directory_tree_zarr(str(root), max_depth=2)
    assert isinstance(tree, dict)

    children = tree.get("children", [])
    child_paths = {child.get("path"): child for child in children}
    assert str(db_file.resolve()) in child_paths
    assert str(sqlite_file.resolve()) in child_paths
    assert child_paths[str(db_file.resolve())]["tags"] == ["sqlite"]
    assert child_paths[str(sqlite_file.resolve())]["tags"] == ["sqlite"]


@pytest.mark.asyncio
async def test_get_directory_tree_includes_flat_tables(tmp_path, monkeypatch):
    root = tmp_path / "root"
    root.mkdir(parents=True)
    csv_file = root / "runs.csv"
    txt_file = root / "runs.txt"
    dat_file = root / "runs.dat"
    csv_file.write_text("x,y\n1,2\n")
    txt_file.write_text("x,y\n1,2\n")
    dat_file.write_text("x,y\n1,2\n")

    monkeypatch.setattr(dirtree, "FD_EXEC", "fdfind")

    class _MockResult:
        def __init__(self, returncode, stdout, stderr):
            self.returncode = returncode
            self.stdout = stdout
            self.stderr = stderr

    def _mock_subprocess_run(
        cmd, input=None, stdout=None, stderr=None, check=False, **kwargs
    ):
        if "-t" in cmd and "d" in cmd:
            return _MockResult(0, b"", b"")
        if "-t" in cmd and "f" in cmd:
            out = (
                f"{csv_file.resolve()}\n{txt_file.resolve()}\n{dat_file.resolve()}\n"
            ).encode("utf-8")
            return _MockResult(0, out, b"")
        return _MockResult(1, b"", b"unknown command")

    monkeypatch.setattr(dirtree.subprocess, "run", _mock_subprocess_run)

    tree = await dirtree.get_directory_tree_zarr(str(root), max_depth=2)
    assert isinstance(tree, dict)

    children = tree.get("children", [])
    child_paths = {child.get("path"): child for child in children}
    assert str(csv_file.resolve()) in child_paths
    assert str(txt_file.resolve()) in child_paths
    assert str(dat_file.resolve()) in child_paths
    assert child_paths[str(csv_file.resolve())]["tags"] == ["csv"]
    assert child_paths[str(txt_file.resolve())]["tags"] == ["csv"]
    assert child_paths[str(dat_file.resolve())]["tags"] == ["csv"]


@pytest.mark.asyncio
async def test_load_directory_sqlite_file_returns_virtual_run_tree(
    tmp_path, monkeypatch
):
    db_file = tmp_path / "runs.sqlite"
    db_file.write_text("placeholder")

    monkeypatch.setattr(
        dirtree,
        "list_qcodes_runs",
        lambda _p: [
            {
                "run_id": 11,
                "name": "r11",
                "result_table_name": "results_11",
                "run_timestamp": 1710000000.0,  # 2024-03-09
            },
            {
                "run_id": 9,
                "name": "r9",
                "result_table_name": "results_9",
                "run_timestamp": 1700000000.0,  # 2023-11-14
            },
        ],
    )

    tree = await dirtree.load_directory(PathData(path=str(db_file)))
    assert tree["type"] == "folder"
    assert tree["path"] == str(db_file)
    date_folders = tree["children"]
    assert len(date_folders) == 2
    assert date_folders[0]["type"] == "folder"
    assert date_folders[1]["type"] == "folder"
    assert date_folders[0]["name"] == "2024-03-09"
    assert date_folders[1]["name"] == "2023-11-14"
    run_children_0 = date_folders[0]["children"]
    run_children_1 = date_folders[1]["children"]
    assert run_children_0[0]["path"] == f"{db_file}#run_id=11"
    assert run_children_1[0]["path"] == f"{db_file}#run_id=9"
    assert run_children_0[0]["name"] == "11 | r11"
    assert "run_id=" not in run_children_0[0]["name"]
    assert run_children_0[0]["tags"] == ["qcodes", "qcodes-run", "sqlite"]


@pytest.mark.asyncio
async def test_load_directory_datatree_file_returns_virtual_tree(tmp_path, monkeypatch):
    nc_file = tmp_path / "tree.nc"
    nc_file.write_text("placeholder")

    monkeypatch.setattr(
        dirtree,
        "list_datatree_nodes",
        lambda _p: [
            {"path": "/", "name": "root", "has_dataset": False},
            {"path": "/group", "name": "group", "has_dataset": False},
            {"path": "/group/run_1", "name": "run_1", "has_dataset": True},
        ],
    )

    tree = await dirtree.load_directory(PathData(path=str(nc_file)))
    assert tree["type"] == "folder"
    assert tree["path"] == str(nc_file)
    assert "datatree" in tree["tags"]

    group = tree["children"][0]
    assert group["name"] == "group"
    assert group["type"] == "folder"
    # Non-leaf nodes are visual structuring nodes, not direct dataset refs.
    assert group["path"] == str(nc_file)

    run_node = group["children"][0]
    assert run_node["type"] == "file"
    assert run_node["path"] == f"{nc_file}#dt_path=/group/run_1"
    assert "datatree-node" in run_node["tags"]
