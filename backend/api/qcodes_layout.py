"""
Convert QCoDeS runs to xarray datasets using their declared sweeps.

QCoDeS may use ``index`` or ``multi_index`` when setpoints repeat or do not
form an exact grid. Here, declared setpoints remain coordinates. Repeated
points gain a ``repetition`` axis, noisy rasters use their row structure, and
programmed ramps recorded against time can become coordinates. Singleton axes
are removed and constant parameters are listed last.

"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
import xarray as xr

_TIME_AXIS_RE = re.compile(r"(?:^|_)(?:time|timestamp)$|^t$", re.IGNORECASE)

# Allow floating-point rounding in ramp step sizes.
_RAMP_STEP_TOLERANCE = 1e-6

# Require at least half of a candidate grid to contain points.
_MIN_GRID_FILL = 0.5


@dataclass(frozen=True, slots=True)
class _AxisNames:
    """Generated axis names that do not conflict with run parameters."""

    repetition: str
    index: str
    taken: frozenset[str]

    @classmethod
    def free_of(cls, taken: set[str]) -> _AxisNames:
        return cls(
            repetition=_free_name("repetition", taken),
            index=_free_name("index", taken),
            taken=frozenset(taken),
        )

    def readback(self, axis: str) -> str:
        return _free_name(f"{axis}_readback", set(self.taken))


def _free_name(base: str, taken: set[str]) -> str:
    name = base
    while name in taken:
        name = f"{name}_"

    return name


def _flatten(values: Any) -> np.ndarray:
    """Flatten a QCoDeS column, including array-valued rows."""
    values = np.asarray(values)
    if values.dtype == object:
        try:
            return np.concatenate(values)
        except ValueError:
            pass

    return values.ravel()


def _grid_by_value(
    frame: pd.DataFrame, axes: list[str], repetition: str
) -> xr.Dataset | None:
    """Grid points by setpoint values, adding ``repetition`` for duplicates."""
    repeats = frame.groupby(axes, sort=False, dropna=False).cumcount().to_numpy()
    keys = list(axes)
    if repeats.max(initial=0) > 0:
        # Keep sparse repeats in a 1D sweep on the same line.
        sweep = np.count_nonzero(repeats == 0)
        if len(axes) == 1 and len(frame) - sweep < sweep / 2:
            return None
        frame = frame.assign(**{repetition: repeats})
        keys = [repetition, *axes]

    grid_size = np.prod([frame[key].nunique() for key in keys], dtype=float)
    if len(frame) < _MIN_GRID_FILL * grid_size:
        return None

    return xr.Dataset.from_dataframe(frame.set_index(keys))


def _grid_by_sweep(
    frame: pd.DataFrame, axes: list[str], names: _AxisNames
) -> xr.Dataset | None:
    """Grid a noisy 2D raster at each reset of its fast axis."""
    if len(axes) != 2 or any(frame[col].dtype.kind not in "biufc" for col in frame):
        return None

    size = len(frame)
    for slow, fast in (axes, axes[::-1]):
        steps = np.diff(frame[fast].to_numpy(dtype=float))
        direction = np.sign(np.median(steps)) if steps.size else 0
        if direction == 0:
            continue
        jumps = np.flatnonzero(np.sign(steps) == -direction) + 1
        if jumps.size == 0:
            continue
        row = int(jumps[0])
        if row < 2 or not np.array_equal(jumps, np.arange(row, size, row)):
            continue

        rows = -(-size // row)

        def grid(values: np.ndarray) -> np.ndarray:
            padded = np.full(rows * row, np.nan, np.result_type(values, np.float64))
            padded[:size] = values
            return padded.reshape(rows, row)

        slow_grid = grid(frame[slow].to_numpy())
        fast_grid = grid(frame[fast].to_numpy())
        dims = (slow, fast)
        data_vars = {
            name: (dims, grid(frame[name].to_numpy()))
            for name in frame.columns
            if name not in axes
        }
        data_vars[names.readback(slow)] = (dims, slow_grid)
        data_vars[names.readback(fast)] = (dims, fast_grid)
        coords = {
            slow: np.nanmean(slow_grid, axis=1),
            fast: np.nanmean(fast_grid, axis=0),
        }
        return xr.Dataset(data_vars, coords=coords)

    return None


def _scattered(frame: pd.DataFrame, axes: list[str], index: str) -> xr.Dataset:
    """Preserve point order and expose setpoints as coordinates."""
    dataset = xr.Dataset.from_dataframe(frame.rename_axis(index)).set_coords(axes)

    return dataset.drop_vars(index) if axes else dataset


def _measured_parameter(
    columns: dict[str, np.ndarray], setpoints: list[str], names: _AxisNames
) -> xr.Dataset:
    frame = pd.DataFrame(columns)
    axes = [name for name in setpoints if name in frame]
    if not axes:
        return _scattered(frame, axes, names.index)

    # Drop points missing a required setpoint.
    frame = frame.dropna(subset=axes).reset_index(drop=True)
    gridded = _grid_by_value(frame, axes, names.repetition)
    if gridded is None:
        gridded = _grid_by_sweep(frame, axes, names)
    if gridded is None:
        gridded = _scattered(frame, axes, names.index)

    return gridded


def _merge(parts: list[xr.Dataset]) -> xr.Dataset:
    coords = set().union(*(part.coords for part in parts))
    parts = [
        part.set_coords([n for n in coords if n in part.data_vars]) for part in parts
    ]

    return xr.merge(parts, compat="no_conflicts", join="outer", combine_attrs="drop")


def _drop_length_one_axes(dataset: xr.Dataset) -> xr.Dataset:
    single = [dim for dim, size in dataset.sizes.items() if size == 1]
    if single and len(single) < len(dataset.sizes):
        return dataset.squeeze(single)

    return dataset


def _is_ramp(values: np.ndarray) -> bool:
    """Check for strictly monotonic, evenly spaced values."""
    if values.size < 3 or values.dtype.kind not in "iuf":
        return False
    steps = np.diff(values.astype(float))
    if not (np.all(steps > 0) or np.all(steps < 0)):
        return False

    return np.ptp(steps) <= _RAMP_STEP_TOLERANCE * abs(steps.mean())


def _ramps(dataset: xr.Dataset, specs: dict[str, Any], index: str) -> list[str]:
    """Find programmed ramps in runs indexed only by time or position."""
    if len(dataset.dims) != 1:
        return []
    dim = str(next(iter(dataset.dims)))
    label = str(getattr(specs.get(dim), "label", "") or "")
    against_time = bool(_TIME_AXIS_RE.search(dim)) or "elapsed" in label.lower()
    against_nothing = dim == index and index in dataset.coords
    if not (against_time or against_nothing):
        return []

    return [
        str(name)
        for name, var in dataset.data_vars.items()
        if var.dims == (dim,) and _is_ramp(var.values)
    ]


def _is_constant(values: np.ndarray) -> bool:
    return pd.Series(values.ravel()).nunique(dropna=True) <= 1


def _ordered(
    dataset: xr.Dataset, declared: list[str], ramps: list[str], names: _AxisNames
) -> xr.Dataset:
    """Order axes and measurements for plot selection.

    Put promoted ramps before time, generated axes after declared axes, and
    constant measurements after varying ones.
    """
    rank = {name: position for position, name in enumerate(declared)}
    late = {names.repetition: 1, names.index: 2}
    coords = sorted(
        map(str, dataset.coords),
        key=lambda n: (n not in ramps, late.get(n, 0), rank.get(n, len(rank))),
    )
    constant = {str(n) for n, v in dataset.data_vars.items() if _is_constant(v.values)}
    data_vars = sorted(
        map(str, dataset.data_vars),
        key=lambda n: (n in constant, rank.get(n, len(rank))),
    )

    return dataset[[*coords, *data_vars]]


def _describe_variables(dataset: xr.Dataset, run: Any) -> None:
    """Copy QCoDeS parameter labels and units to xarray variables."""
    specs = run.paramspecs
    for name, variable in dataset.variables.items():
        spec = specs.get(str(name))
        if spec is None:
            continue
        variable.attrs.update(
            name=spec.name,
            paramtype=spec.type,
            label=spec.label,
            unit=spec.unit,
            depends_on=spec.depends_on,
            inferred_from=spec.inferred_from,
            units=spec.unit,
            long_name=spec.label,
        )


def _run_attrs(run: Any) -> dict[str, Any]:
    """Return run attributes matching QCoDeS' xarray export."""
    from qcodes.dataset.descriptions.versioning.serialization import (
        to_json_for_storage,
    )
    from qcodes.dataset.linked_datasets.links import links_to_str

    started = run.run_timestamp_raw
    completed = run.completed_timestamp_raw

    return {
        "ds_name": run.name,
        "sample_name": run.sample_name,
        "exp_name": run.exp_name,
        "snapshot": run.snapshot_raw or "null",
        "guid": run.guid,
        "run_timestamp": run.run_timestamp() or "",
        "completed_timestamp": run.completed_timestamp() or "",
        "captured_run_id": run.captured_run_id,
        "captured_counter": run.captured_counter,
        "run_id": run.run_id,
        "run_description": to_json_for_storage(run.description),
        "parent_dataset_links": links_to_str(run.parent_dataset_links),
        # Match QCoDeS' -1 sentinel for missing timestamps.
        "run_timestamp_raw": started if started is not None else -1,
        "completed_timestamp_raw": completed if completed is not None else -1,
        **run.metadata,
    }


def qcodes_run_to_xarray(run: Any) -> xr.Dataset:
    """Build an xarray dataset from a loaded QCoDeS run.

    Args:
        run: A QCoDeS ``DataSet`` from ``load_by_id``. Keep its database open
            during conversion.

    Returns:
        xr.Dataset: Run data with sweeps as coordinates.
    """
    interdeps = run.description.interdeps
    specs = {spec.name: spec for spec in interdeps.paramspecs}
    setpoints_of = {
        dependent.name: [setpoint.name for setpoint in setpoints]
        for dependent, setpoints in interdeps.dependencies.items()
    }
    names = _AxisNames.free_of(set(specs))

    parts = [
        _measured_parameter(
            {key: _flatten(values) for key, values in columns.items()},
            setpoints_of.get(name, []),
            names,
        )
        for name, columns in run.get_parameter_data().items()
    ]
    dataset = _merge(parts) if parts else xr.Dataset()

    # Use one-dimensional readbacks inferred from setpoints as axes.
    setpoint_names = {name for setpoints in setpoints_of.values() for name in setpoints}
    readbacks = [
        inferred.name
        for inferred, bases in interdeps.inferences.items()
        if setpoint_names.intersection(base.name for base in bases)
    ]
    dataset = dataset.set_coords(
        [n for n in readbacks if n in dataset.data_vars and dataset[n].ndim == 1]
    )

    dataset = _drop_length_one_axes(dataset)
    ramps = _ramps(dataset, specs, names.index)
    dataset = _ordered(dataset.set_coords(ramps), list(specs), ramps, names)

    _describe_variables(dataset, run)
    dataset.attrs.update(_run_attrs(run))

    return dataset
