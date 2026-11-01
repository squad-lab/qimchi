"""Test sweep-aware conversion with runs recorded through QCoDeS."""

import numpy as np
import pytest
from qcodes.dataset import (
    Measurement,
    initialise_or_create_database_at,
    load_or_create_experiment,
)

from api import data_loader
from api.dirtree import build_attrs_payload


@pytest.fixture
def record(tmp_path):
    """Create a database and return a helper that records and loads runs."""
    db_path = tmp_path / "runs.db"
    initialise_or_create_database_at(str(db_path))
    experiment = load_or_create_experiment("layout", sample_name="sample")

    def _record(register, rows, shapes=None):
        measurement = Measurement(exp=experiment, name="run")
        for name, kwargs in register:
            measurement.register_custom_parameter(name, **kwargs)
        if shapes:
            measurement.set_shapes(shapes)
        with measurement.run() as saver:
            for row in rows:
                saver.add_result(*row.items())
        return data_loader._load_qcodes_xarray_dataset(db_path, saver.dataset.run_id)

    return _record


def _dims(dataset, name):
    return tuple(str(dim) for dim in dataset[name].dims)


def test_a_clean_grid_keeps_its_sweeps(record):
    dataset = record(
        [("vg", {}), ("vb", {}), ("i", {"setpoints": ("vg", "vb")})],
        [{"vg": g, "vb": b, "i": g * b} for g in range(4) for b in range(3)],
    )

    assert list(dataset.coords) == ["vg", "vb"]
    assert _dims(dataset, "i") == ("vg", "vb")


def test_a_repeated_sweep_gets_a_repetition_axis(record):
    dataset = record(
        [("vg", {}), ("i", {"setpoints": ("vg",)})],
        [{"vg": g, "i": g + 10 * r} for r in range(3) for g in range(5)],
    )

    assert build_attrs_payload(dataset)["independents"] == ["vg", "repetition"]
    assert dataset.sizes == {"repetition": 3, "vg": 5}
    np.testing.assert_array_equal(dataset["i"].sel(repetition=2), np.arange(5) + 20)


def test_a_repeated_2d_grid_keeps_its_map_and_repeats_it(record):
    dataset = record(
        [("vg", {}), ("vb", {}), ("i", {"setpoints": ("vg", "vb")})],
        [
            {"vg": g, "vb": b, "i": g * b + r}
            for r in range(2)
            for g in range(3)
            for b in range(2)
        ],
    )

    assert list(dataset.coords) == ["vg", "vb", "repetition"]
    assert set(dataset["i"].dims) == {"repetition", "vg", "vb"}


def test_a_sweep_with_one_point_recorded_twice_stays_one_line(record):
    voltages = [*np.linspace(0, 1, 20), 1.0]
    dataset = record(
        [("vg", {}), ("i", {"setpoints": ("vg",)})],
        [{"vg": v, "i": 2 * v} for v in voltages],
    )

    payload = build_attrs_payload(dataset)
    assert payload["independents"] == ["vg"]
    assert payload["variable_independents"]["i"] == ["vg"]
    # Some SQLite builds round stored floats to 15 significant digits.
    np.testing.assert_allclose(dataset["vg"], voltages, rtol=1e-12)


def test_a_raster_of_noisy_readbacks_is_gridded_by_its_rows(record):
    rng = np.random.default_rng(0)
    points = [
        {
            "vg": g + rng.normal(0, 1e-4),
            "vb": b + rng.normal(0, 1e-4),
            "i": g * 10 + b,
        }
        for g in range(4)
        for b in range(3)
    ][:-1]  # interrupted during the last row

    dataset = record(
        [("vg", {}), ("vb", {}), ("i", {"setpoints": ("vg", "vb")})], points
    )

    assert dataset.sizes == {"vg": 4, "vb": 3}
    np.testing.assert_allclose(dataset["vg"], range(4), atol=1e-3)
    np.testing.assert_allclose(dataset["vb"], range(3), atol=1e-3)
    assert dataset["i"].values[1, 2] == 12
    assert np.isnan(dataset["i"].values[3, 2])
    assert _dims(dataset, "vg_readback") == ("vg", "vb")


def test_a_temperature_ramp_recorded_against_time_becomes_an_axis(record):
    # Declare all parameters against elapsed time.
    names = ["target_temperature", "temperature", "heater", "resistance"]
    targets = 3 + 0.05 * np.arange(40)
    rng = np.random.default_rng(1)
    dataset = record(
        [("time", {}), *((name, {"setpoints": ("time",)}) for name in names)],
        [
            {
                "time": 20.0 * k + rng.random(),
                "target_temperature": target,
                "temperature": target + rng.normal(0, 0.01),
                "heater": 0.0,
                "resistance": 1e4 + rng.normal(0, 5),
            }
            for k, target in enumerate(targets)
        ],
    )

    payload = build_attrs_payload(dataset)
    assert payload["independents"] == ["target_temperature", "time"]
    assert payload["variable_independents"]["resistance"] == [
        "target_temperature",
        "time",
    ]
    assert payload["independent_dimensions"] == {
        "target_temperature": ["time"],
        "time": ["time"],
    }
    # Noisy temperature stays measured; constant heater sorts last.
    assert payload["dependents"] == ["temperature", "resistance", "heater"]


def test_repeated_readings_at_one_time_lie_along_a_repetition(record):
    dataset = record(
        [("time", {}), ("current", {"setpoints": ("time",)})],
        [{"time": 0.2, "current": 3.5e-7 + k * 1e-12} for k in range(10)],
    )

    payload = build_attrs_payload(dataset)
    assert payload["independents"] == ["repetition"]
    assert payload["variable_independents"]["current"] == ["repetition"]
    assert float(dataset["time"]) == 0.2


def test_a_ramp_recorded_without_setpoints_becomes_an_axis(record):
    dataset = record(
        [("vg", {}), ("i", {})],
        [{"vg": v, "i": v**2} for v in np.linspace(-1, 1, 11)],
    )

    assert build_attrs_payload(dataset)["independents"] == ["vg", "index"]
    assert list(dataset.data_vars) == ["i"]


def test_a_readback_inferred_from_a_setpoint_is_an_axis(record):
    dataset = record(
        [
            ("vg_set", {}),
            ("vg_meas", {"basis": ("vg_set",)}),
            ("i", {"setpoints": ("vg_set",)}),
        ],
        [{"vg_set": v, "vg_meas": v + 1e-3, "i": v} for v in range(4)],
    )

    assert list(dataset.coords) == ["vg_set", "vg_meas"]
    assert list(dataset.data_vars) == ["i"]


def test_added_axes_never_take_a_parameter_name(record):
    dataset = record(
        [("repetition", {}), ("vg", {}), ("i", {"setpoints": ("vg",)})],
        [{"vg": g, "i": g} for _ in range(3) for g in range(4)],
    )

    assert "repetition_" in dataset.dims


def test_units_labels_and_run_attrs_match_qcodes_own_export(tmp_path):
    from qcodes.dataset import initialised_database_at, load_by_id

    db_path = tmp_path / "runs.db"
    initialise_or_create_database_at(str(db_path))
    experiment = load_or_create_experiment("layout", sample_name="sample")
    measurement = Measurement(exp=experiment, name="run")
    measurement.register_custom_parameter("vg", label="Gate", unit="V")
    measurement.register_custom_parameter("i", unit="A", setpoints=("vg",))
    with measurement.run() as saver:
        for g in range(3):
            saver.add_result(("vg", g), ("i", g))
    saver.dataset.add_metadata("operator", "someone")
    run_id = saver.dataset.run_id

    dataset = data_loader._load_qcodes_xarray_dataset(db_path, run_id)

    assert dataset["vg"].attrs["units"] == "V"
    assert dataset["vg"].attrs["long_name"] == "Gate"
    assert dataset["i"].attrs["unit"] == "A"
    assert dataset.attrs["qimchi_qcodes_records"] == 3
    with initialised_database_at(str(db_path)):
        expected = load_by_id(run_id).to_xarray_dataset().attrs
    for key, value in expected.items():
        if key != "snapshot":
            assert dataset.attrs[key] == value, key
    assert dataset.attrs["operator"] == "someone"


def test_a_run_it_cannot_lay_out_falls_back_to_qcodes_export(record, monkeypatch):
    def fail(_run):
        raise RuntimeError("unexpected run layout")

    monkeypatch.setattr(data_loader, "qcodes_run_to_xarray", fail)

    dataset = record(
        [("vg", {}), ("i", {"setpoints": ("vg",)})],
        [{"vg": g, "i": g} for _ in range(2) for g in range(3)],
    )

    # Compare QCoDeS' conversion of repeated setpoints.
    assert list(dataset.dims) == ["index"]
    assert "vg" in dataset.data_vars
