"""
Measurement identity: resolve a stable UUID for any supported dataset.

The library DB keys everything on a UUID that must survive a rename, a move to
another folder, and reopening on another machine -- ``abs_path`` is node-local
and is never a key.

Resolution ladder, most authoritative first:

1. ``attrs["Measurement ID"]`` -- the qanary UUID (``measure.py`` mints it and
   names the file after it). Origin ``qanary``.
2. ``attrs["guid"]`` -- QCoDeS mints a per-run GUID and ``to_xarray_dataset()``
   exports it, so ``.db``/``.sqlite`` runs carry a native identity too.
   Origin ``qcodes``.
3. A **content signature** -- a uuid5 derived from the dataset's own structure
   and identity-bearing attrs. Origin ``content``.

Tier 3 deliberately writes nothing: no sidecar marker files, no attrs written
back into the user's measurement files, and it works on read-only shares. The
trade-off is that re-saving a dataset changes its signature (annotations are
orphaned) and two byte-identical datasets resolve to the same UUID. Structure
alone collides far too easily -- two sweeps of the same instrument have
identical dims and variables -- so the signature also samples the coordinate
*values*, which is what actually distinguishes one sweep from another.

"""

from __future__ import annotations

import hashlib
import uuid

import numpy as np
import xarray as xr

from ..logger import logger

# Fixed namespace for Qimchi-derived UUIDs.
# NOTE: Never change this: doing so re-keys every content-addressed measurement and orphans its annotations.
QIMCHI_NAMESPACE = uuid.UUID("b7f3c1d2-5e4a-5b6c-8d9e-0f1a2b3c4d5e")

# Attrs that identify a measurement and do not change on reopen. Deliberately
# excludes anything path- or machine-derived so a moved dataset keeps its UUID.
_IDENTITY_ATTRS = (
    "Timestamp",
    "Cryostat",
    "Wafer ID",
    "Device Type",
    "Sample Name",
    "Experiment Name",
    "run_timestamp",
    "exp_name",
    "sample_name",
)

# How many values to sample from each end of a coordinate axis.
_EDGE = 8


def _fmt(value) -> str:
    """Format a scalar deterministically (stable across runs and machines)."""
    if isinstance(value, (np.floating, float)):
        # 12 significant digits: enough to separate distinct sweep setpoints,
        # loose enough to absorb float noise from a round-trip through a file.
        return f"{float(value):.12g}"
    if isinstance(value, (np.integer, int, bool, np.bool_)):
        return str(value)
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return str(value)


def _coord_sample(da: xr.DataArray) -> str:
    """
    Sample the edges of a coordinate without materialising the whole axis.

    Uses ``isel`` on 1-D coords so a multi-million-point axis costs two small
    reads rather than a full load.

    """
    size = int(da.size)
    if size == 0:
        return ""
    if da.ndim == 1 and size > 2 * _EDGE:
        dim = da.dims[0]
        head = np.asarray(da.isel({dim: slice(0, _EDGE)}).values).ravel()
        tail = np.asarray(da.isel({dim: slice(-_EDGE, None)}).values).ravel()
        values = np.concatenate([head, tail])
    elif size > 2 * _EDGE:
        # Multi-dimensional and large: structure only, don't load it.
        return "..."
    else:
        values = np.asarray(da.values).ravel()
    return ",".join(_fmt(v) for v in values)


def dataset_signature(ds: xr.Dataset) -> str:
    """
    Build the canonical identity string for a dataset.

    Combines shape/dtype structure, identity-bearing attrs, and a bounded
    sample of coordinate values. Everything is sorted so the string does not
    depend on dict or file ordering.

    """
    parts: list[str] = []

    parts.append(
        "dims:" + ",".join(f"{k}={int(v)}" for k, v in sorted(ds.sizes.items()))
    )

    for label, names in (("vars", ds.data_vars), ("coords", ds.coords)):
        entries = []
        for name in sorted(map(str, names)):
            da = ds[name]
            shape = "x".join(str(int(s)) for s in da.shape)
            entries.append(f"{name}:{da.dtype}:{shape}")
        parts.append(f"{label}:" + ",".join(entries))

    attrs = []
    for key in sorted(_IDENTITY_ATTRS):
        value = ds.attrs.get(key)
        if value is not None and str(value).strip() not in ("", "N/A"):
            attrs.append(f"{key}={_fmt(value)}")
    parts.append("attrs:" + ",".join(attrs))

    samples = []
    for name in sorted(map(str, ds.coords)):
        try:
            samples.append(f"{name}[{int(ds[name].size)}]:{_coord_sample(ds[name])}")
        except Exception:  # a coord we can't read must not break identity
            logger.debug("identity: could not sample coord %s", name, exc_info=True)
            samples.append(f"{name}[?]")
    parts.append("coordvals:" + ";".join(samples))

    return "|".join(parts)


def content_uuid(ds: xr.Dataset) -> str:
    """Derive a deterministic uuid5 from the dataset's content signature."""
    digest = hashlib.sha256(dataset_signature(ds).encode("utf-8")).hexdigest()
    return str(uuid.uuid5(QIMCHI_NAMESPACE, digest))


def _clean(value) -> str | None:
    """Normalise the ``"N/A"`` sentinel and blanks to None."""
    if value is None:
        return None
    text = str(value).strip()
    return None if text in ("", "N/A") else text


def resolve_from_attrs(attrs: dict | None) -> tuple[str | None, str | None]:
    """
    Try the two native-identity tiers, which need only attrs (no dataset load).

    Returns ``(uuid, origin)``, or ``(None, None)`` if neither applies and a
    content signature is required.

    """
    if not attrs:
        return None, None
    native = _clean(attrs.get("Measurement ID"))
    if native:
        return native, "qanary"
    guid = _clean(attrs.get("guid"))
    if guid:
        return guid, "qcodes"
    return None, None


def resolve_identity(
    attrs: dict | None, dataset: xr.Dataset | None
) -> tuple[str | None, str | None]:
    """
    Resolve a measurement's UUID and its origin.

    Falls through the ladder: qanary id -> QCoDeS guid -> content signature.
    ``dataset`` may be None when only attrs are available; in that case the
    content tier is skipped and ``(None, None)`` is returned.

    """
    resolved, origin = resolve_from_attrs(attrs)
    if resolved:
        return resolved, origin

    if dataset is None:
        return None, None

    # The dataset's own attrs may carry an id the caller's lean attrs dict lost.
    resolved, origin = resolve_from_attrs(dict(dataset.attrs))
    if resolved:
        return resolved, origin

    try:
        return content_uuid(dataset), "content"
    except Exception:
        logger.exception("identity: failed to derive a content UUID")
        return None, None
