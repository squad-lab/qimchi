import pytest

from api import dirtree
from api import config


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

    # Ensure config reports executables present
    monkeypatch.setattr(config, "FD_EXEC", "fdfind")
    monkeypatch.setattr(config, "DU_EXEC", "du")
    monkeypatch.setattr(config, "XARGS_EXEC", "xargs")

    # Prepare fd output: absolute paths for directories
    fd_paths = [str(p.resolve()) for p in [a, b_zarr, c_zarr]]

    # Clear any cache
    dirtree._SIZE_CACHE.clear()

    async def _mock_run(cmd, input_data: bytes = None):
        # Simulate fd listing
        if cmd and cmd[0] == config.FD_EXEC:
            out = "\n".join(fd_paths) + "\n"
            return 0, out, ""
        # Simulate xargs+du output
        if cmd and cmd[0] == config.XARGS_EXEC:
            # Return sizes for c_zarr and b_zarr
            lines = [f"1234 {str(c_zarr.resolve())}", f"2345 {str(b_zarr.resolve())}"]
            out = "\n".join(lines) + "\n"
            return 0, out, ""
        return 1, "", "unknown command"

    monkeypatch.setattr(dirtree, "_run_subprocess", _mock_run)

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

    # Sizes should be attached from the mocked du output
    sizes = {n["path"]: n.get("size") for n in zarr_nodes}
    assert sizes.get(str(c_zarr.resolve())) == 1234
    assert sizes.get(str(b_zarr.resolve())) == 2345
