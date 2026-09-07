"""
Tests for measurement identity resolution (``api/shared/identity.py``).

The load-bearing property is that a UUID survives a rename and a move to
another folder -- annotations are keyed on it, so if it drifts the user's
hearts, tags and notes silently detach from their measurement.
"""

import shutil
import uuid as uuid_mod

import numpy as np
import pytest
import xarray as xr

from api.shared.identity import (
    QIMCHI_NAMESPACE,
    content_uuid,
    dataset_signature,
    resolve_from_attrs,
    resolve_identity,
)


def _sweep(start: float = 0.0, stop: float = 1.0, n: int = 64, **attrs) -> xr.Dataset:
    """A small measurement-shaped dataset."""
    x = np.linspace(start, stop, n)
    return xr.Dataset(
        data_vars={"current": (("voltage",), np.sin(x))},
        coords={"voltage": x},
        attrs=attrs,
    )


# --------------------------------------------------------------------------- #
# Tier 1 / 2: native ids
# --------------------------------------------------------------------------- #
def test_qanary_measurement_id_wins():
    attrs = {"Measurement ID": "12-abcdef", "guid": "should-be-ignored"}
    assert resolve_from_attrs(attrs) == ("12-abcdef", "qanary")


def test_qcodes_guid_used_when_no_measurement_id():
    attrs = {"Measurement ID": "N/A", "guid": "aaaaaaaa-0000-4000-8000-000000000001"}
    assert resolve_from_attrs(attrs) == (
        "aaaaaaaa-0000-4000-8000-000000000001",
        "qcodes",
    )


@pytest.mark.parametrize("sentinel", [None, "", "  ", "N/A"])
def test_blank_sentinels_are_not_identities(sentinel):
    assert resolve_from_attrs({"Measurement ID": sentinel, "guid": sentinel}) == (
        None,
        None,
    )


def test_native_id_short_circuits_without_a_dataset():
    """A native id must resolve even when the dataset can't be opened."""
    assert resolve_identity({"Measurement ID": "7-xyz"}, None) == ("7-xyz", "qanary")


def test_no_dataset_and_no_native_id_is_unresolved():
    assert resolve_identity({"Sample Name": "S1"}, None) == (None, None)


def test_dataset_attrs_consulted_when_caller_attrs_lack_the_id():
    ds = _sweep(**{"Measurement ID": "42-from-the-dataset"})
    assert resolve_identity({}, ds) == ("42-from-the-dataset", "qanary")


# --------------------------------------------------------------------------- #
# Tier 3: content signature
# --------------------------------------------------------------------------- #
def test_content_uuid_is_a_valid_uuid5_in_our_namespace():
    value = content_uuid(_sweep())
    parsed = uuid_mod.UUID(value)
    assert parsed.version == 5
    assert parsed != QIMCHI_NAMESPACE


def test_content_uuid_is_deterministic():
    assert content_uuid(_sweep()) == content_uuid(_sweep())


def test_content_uuid_survives_rename_and_move(tmp_path):
    """The whole point: relocating a file must not change its identity."""
    ds = _sweep(**{"Sample Name": "S1"})
    original = tmp_path / "run_001.nc"
    ds.to_netcdf(original)

    with xr.open_dataset(original) as opened:
        before = content_uuid(opened)

    moved_dir = tmp_path / "archive" / "2026"
    moved_dir.mkdir(parents=True)
    moved = moved_dir / "totally_different_name.nc"
    shutil.move(original, moved)

    with xr.open_dataset(moved) as opened:
        after = content_uuid(opened)

    assert before == after


def test_content_uuid_survives_a_netcdf_round_trip(tmp_path):
    """In-memory and on-disk views of the same data must agree."""
    ds = _sweep(**{"Sample Name": "S1", "Cryostat": "Triton"})
    in_memory = content_uuid(ds)
    path = tmp_path / "run.nc"
    ds.to_netcdf(path)
    with xr.open_dataset(path) as opened:
        assert content_uuid(opened) == in_memory


def test_content_uuid_survives_a_zarr_round_trip(tmp_path):
    ds = _sweep(**{"Sample Name": "S1"})
    in_memory = content_uuid(ds)
    path = tmp_path / "run.zarr"
    ds.to_zarr(path)
    with xr.open_zarr(path) as opened:
        assert content_uuid(opened) == in_memory


def test_different_sweep_ranges_differ():
    """Same shape, same variables -- only the setpoints differ. Must not collide."""
    assert content_uuid(_sweep(0.0, 1.0)) != content_uuid(_sweep(0.0, 2.0))


def test_different_lengths_differ():
    assert content_uuid(_sweep(n=64)) != content_uuid(_sweep(n=128))


def test_different_samples_differ():
    a = _sweep(**{"Sample Name": "S1"})
    b = _sweep(**{"Sample Name": "S2"})
    assert content_uuid(a) != content_uuid(b)


def test_different_variable_names_differ():
    a = xr.Dataset({"current": (("v",), [1.0, 2.0])}, coords={"v": [0.0, 1.0]})
    b = xr.Dataset({"voltage": (("v",), [1.0, 2.0])}, coords={"v": [0.0, 1.0]})
    assert content_uuid(a) != content_uuid(b)


def test_path_and_machine_attrs_do_not_affect_identity():
    """Node-local attrs must be excluded, or moving a file would re-key it."""
    a = _sweep(**{"Sample Name": "S1"})
    b = _sweep(**{"Sample Name": "S1", "path": "E:/elsewhere/x.nc", "host": "lab-pc"})
    assert content_uuid(a) == content_uuid(b)


def test_resolve_identity_falls_through_to_content():
    ds = _sweep(**{"Sample Name": "S1"})
    resolved, origin = resolve_identity({"Measurement ID": "N/A"}, ds)
    assert origin == "content"
    assert resolved == content_uuid(ds)


def test_signature_is_order_independent():
    """Attr insertion order must not change the signature."""
    a = _sweep(**{"Sample Name": "S1", "Cryostat": "Triton"})
    b = _sweep(**{"Cryostat": "Triton", "Sample Name": "S1"})
    assert dataset_signature(a) == dataset_signature(b)


def test_large_coord_is_sampled_not_loaded():
    """A long axis must still produce a signature (edges only, no full load)."""
    big = _sweep(n=2_000_000)
    signature = dataset_signature(big)
    assert "voltage[2000000]" in signature
    assert content_uuid(big) != content_uuid(_sweep(n=2_000_001))


def test_unreadable_dataset_does_not_raise():
    """Identity failures must degrade to 'unpersisted', never break register."""

    class Exploding:
        @property
        def attrs(self):
            return {}

        @property
        def sizes(self):
            raise OSError("disk gone")

    assert resolve_identity({}, Exploding()) == (None, None)
