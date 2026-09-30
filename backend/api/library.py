"""
Library endpoints for measurement state such as hearts, trash, and tags.

Measurements are registered when they are opened, and their library state is
stored in the Qimchi database so the directory tree can filter against it.

Measurements are keyed by the UUID resolved in ``shared/identity.py``. The
resolver prefers the qanary ``Measurement ID``, then a QCoDeS run ``guid``,
and finally a content-signature-based UUID5. ``measurements.uuid_origin``
records which source produced the UUID.

Datasets that cannot be identified because they are unreadable are not stored.
In those cases the API returns ``uuid=None``, and state-changing operations are
treated as no-ops.

Database operations are run outside the event loop with ``asyncio.to_thread``,
following the convention used elsewhere in the repository.

"""

import asyncio
import json
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, update
from sqlmodel import Session, select

from .db_models import (
    LOCAL_USER_ID,
    FilterPreset,
    Measurement,
    MeasurementState,
    MeasurementTag,
    Note,
    Tag,
    _utcnow,
)
from .logger import logger
from .shared.db import require_db, session_scope
from .shared.identity import folder_uuid, resolve_from_attrs, resolve_identity

# Report database startup failures as 503 responses.
router = APIRouter(prefix="/library", dependencies=[Depends(require_db)])

# Attrs cached per measurement (mirrors /load-attrs/, minus the
# independents/dependents lists). Kept lean so metadata_json stays small.
_ATTR_KEYS = [
    "Timestamp",
    "Cryostat",
    "Wafer ID",
    "Device Type",
    "Sample Name",
    "Experiment Name",
    "Measurement ID",
    "guid",  # QCoDeS run GUID -- the identity tier for .db/.sqlite runs
]


# --------------------------------------------------------------------------- #
# Request / response models
# --------------------------------------------------------------------------- #
class RegisterRequest(BaseModel):
    path: str
    # The attrs already fetched by /load-attrs/ (avoids re-loading the dataset).
    attrs: dict | None = None
    # A folder rather than a measurement: keyed by its path.
    folder: bool = False


class StateOut(BaseModel):
    uuid: str | None = None
    hearted: bool = False
    trashed: bool = False
    unhearted_paths: list[str] = Field(default_factory=list)


class HeartRequest(BaseModel):
    uuid: str
    hearted: bool


class TrashRequest(BaseModel):
    uuid: str
    trashed: bool


class MeasurementStateOut(BaseModel):
    uuid: str
    abs_path: str | None = None
    hearted: bool = False
    trashed: bool = False
    tags: list[int] = []


class TagOut(BaseModel):
    id: int
    name: str
    # Measurements currently carrying this tag. The delete confirmation needs
    # it, and it comes free from the query that lists the tags.
    count: int = 0


class CreateTagRequest(BaseModel):
    name: str


class RenameTagRequest(BaseModel):
    name: str


class TagMeasurementRequest(BaseModel):
    uuid: str
    tag_id: int
    add: bool = True


class PresetFilter(BaseModel):
    """A filter key and its options."""

    name: str
    options: Any = None


class FilterPresetOut(BaseModel):
    id: int
    name: str
    filters: list[PresetFilter]
    updatedAt: datetime


class CreateFilterPresetRequest(BaseModel):
    name: str
    filters: list[PresetFilter]


class UpdateFilterPresetRequest(BaseModel):
    """Fields to rename a preset or replace its filters."""

    name: str | None = None
    filters: list[PresetFilter] | None = None


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _na(value) -> str | None:
    """Normalise the ``"N/A"`` sentinel (and blanks) from /load-attrs/ to None."""
    if value is None:
        return None
    s = str(value).strip()
    return None if s in ("", "N/A") else s


def _source_format(path: str) -> str | None:
    disk_path, separator, _fragment = path.partition("#")
    suffix = Path(disk_path).suffix.lower()
    if suffix == ".db":
        return "qcodes"
    if suffix == ".sqlite":
        return "qcodes" if separator else "container"
    return {
        ".zarr": "zarr",
        ".nc": "netcdf",
        ".h5": "hdf5",
        ".hdf5": "hdf5",
        ".csv": "csv",
        ".txt": "csv",
    }.get(suffix)


def _qcodes_database_path(path: str) -> str | None:
    """Return the database part of a QCoDeS run reference."""
    disk_path, separator, fragment = path.partition("#")
    if (
        not separator
        or not fragment.startswith("run_id=")
        or Path(disk_path).suffix.lower() not in {".db", ".sqlite"}
    ):
        return None
    return str(Path(disk_path))


def _migrate_qcodes_run_notes(session: Session, db_path: str, db_uuid: str) -> None:
    """Move notes keyed by per-run GUIDs onto the database UID."""
    run_prefix = f"{db_path}#run_id="
    run_rows = session.exec(
        select(Measurement).where(Measurement.abs_path.startswith(run_prefix))
    ).all()
    for run_row in run_rows:
        try:
            path_run_id = int((run_row.abs_path or "").removeprefix(run_prefix))
        except ValueError:
            continue
        legacy_notes = session.exec(select(Note).where(Note.uuid == run_row.uuid)).all()
        for legacy in legacy_notes:
            run_id = legacy.run_id or path_run_id
            current = session.get(Note, (db_uuid, legacy.user_id, run_id))
            if current is None:
                session.add(
                    Note(
                        uuid=db_uuid,
                        user_id=legacy.user_id,
                        run_id=run_id,
                        body=legacy.body,
                        updated_at=legacy.updated_at,
                    )
                )
            elif legacy.updated_at > current.updated_at:
                current.body = legacy.body
                current.updated_at = legacy.updated_at
            session.delete(legacy)


def _ensure_qcodes_database(path: str, attrs: dict) -> str | None:
    """Return the persistent Qimchi UID shared by every run in one QCoDeS DB."""
    db_path = _qcodes_database_path(path)
    if db_path is None:
        return None
    with session_scope() as session:
        measurement = session.exec(
            select(Measurement).where(
                Measurement.abs_path == db_path,
                Measurement.uuid_origin == "qimchi-qcodes-db",
            )
        ).first()
        if measurement is None:
            measurement = Measurement(
                uuid=str(uuid4()),
                abs_path=db_path,
                source_format="qcodes",
                uuid_origin="qimchi-qcodes-db",
            )
            session.add(measurement)
        measurement.last_opened = _utcnow()
        _migrate_qcodes_run_notes(session, db_path, measurement.uuid)
        return measurement.uuid


def _upsert_measurement(
    session: Session,
    path: str,
    attrs: dict | None,
    uuid: str | None,
    origin: str | None,
) -> str | None:
    if uuid is None:
        return None

    meas = session.get(Measurement, uuid)
    if meas is None:
        meas = Measurement(uuid=uuid, uuid_origin=origin or "content")
        session.add(meas)

    meas.abs_path = path
    meas.source_format = _source_format(path)
    meas.cryostat = _na((attrs or {}).get("Cryostat"))
    meas.sample = _na((attrs or {}).get("Sample Name"))
    meas.wafer_id = _na((attrs or {}).get("Wafer ID"))
    meas.device_type = _na((attrs or {}).get("Device Type"))
    meas.experiment = _na((attrs or {}).get("Experiment Name"))
    try:
        meas.metadata_json = json.dumps(attrs) if attrs else None
    except (TypeError, ValueError):
        meas.metadata_json = None
    # Stamp the fingerprint alongside the payload so /load-attrs/ can decide
    # whether the cache is still valid (see get_cached_attrs).
    meas.source_fingerprint = _fingerprint(path) if _is_cacheable(path) else None
    meas.last_opened = _utcnow()
    return uuid


def _lean_attrs(ds) -> dict:
    """Build the cached ``/load-attrs/`` payload, including QCoDeS identity."""
    from .dirtree import build_attrs_payload

    out = build_attrs_payload(ds)
    guid = dict(ds.attrs).get("guid")
    if guid is not None:
        out["guid"] = guid if isinstance(guid, (str, int, float, bool)) else str(guid)
    return out


async def _resolve(
    path: str, attrs: dict | None
) -> tuple[str | None, str | None, dict | None]:
    """Resolve dataset identity from attrs, loading data only when needed."""
    uuid, origin = resolve_from_attrs(attrs)
    if uuid:
        return uuid, origin, attrs

    # Imported lazily to avoid a module-load cycle with the dirtree router.
    from .dirtree import _load_dataset_for_metadata

    try:
        ds = await _load_dataset_for_metadata(path)
    except Exception:
        logger.debug(
            "library: could not load %s to resolve identity", path, exc_info=True
        )
        return None, None, attrs

    if attrs is None:
        attrs = _lean_attrs(ds)
    uuid, origin = await asyncio.to_thread(resolve_identity, attrs, ds)
    return uuid, origin, attrs


def library_metadata(dataset_path: Path, dataset_uuid: str | None = None) -> dict:
    """Return export metadata, including library state when available."""
    if dataset_uuid is None:
        dataset_uuid = dataset_path.stem

    meta: dict = {
        "dataset_uuid": dataset_uuid,
        "dataset_path": str(dataset_path),
        "exported_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "exported_by": "Qimchi",
    }
    try:
        from sqlmodel import select

        from .db_models import (
            LOCAL_USER_ID,
            Measurement,
            MeasurementState,
            MeasurementTag,
            Tag,
        )
        from .shared.db import session_scope

        with session_scope() as session:
            # Prefer the canonical filename UUID, with path lookup for legacy rows.
            measurement = session.get(Measurement, dataset_uuid)
            if measurement is None:
                measurement = session.exec(
                    select(Measurement).where(Measurement.abs_path == str(dataset_path))
                ).first()
            measurement_uuid = measurement.uuid if measurement else dataset_uuid
            meta["measurement_uuid"] = measurement_uuid
            if measurement is not None:
                meta["uuid_origin"] = measurement.uuid_origin
            state = session.get(MeasurementState, (measurement_uuid, LOCAL_USER_ID))
            meta["hearted"] = bool(state.hearted) if state else False
            meta["trashed"] = bool(state.trashed) if state else False
            meta["tags"] = sorted(
                session.exec(
                    select(Tag.name)
                    .join(MeasurementTag, MeasurementTag.tag_id == Tag.id)
                    .where(MeasurementTag.uuid == measurement_uuid)
                ).all()
            )
    except Exception as exc:
        logger.info("Export metadata unavailable for %s: %s", dataset_uuid, exc)
    return meta


# --------------------------------------------------------------------------- #
# Metadata read-through cache
# --------------------------------------------------------------------------- #
# Cache attrs by indexed abs_path and validate them with a stat fingerprint.
# Live and QCoDeS references are excluded because their backing stores change.


# Increment when loader changes require invalidating cached /load-attrs/ payloads.
_ATTRS_CACHE_VERSION = 2


def _fingerprint(path: str) -> str | None:
    """Cheap change signature for a dataset (None if it can't be stat'd)."""
    try:
        st = Path(path).stat()
    except OSError:
        return None
    return f"{st.st_mtime_ns}:{st.st_size}:v{_ATTRS_CACHE_VERSION}"


def _is_cacheable(path: str) -> bool:
    # ``memory://`` sources are live and can change over time. A ``#run_id=``
    # reference, however, points to a fixed run inside a QCoDeS database. Since
    # the database mtime changes whenever any run is added, using it in the
    # fingerprint would invalidate the cache even when this particular run has
    # not changed.
    return not path.startswith("memory://") and "#run_id=" not in path


def _read_cached_attrs(path: str) -> dict | None:
    fingerprint = _fingerprint(path)
    if fingerprint is None:
        return None
    with session_scope() as session:
        row = session.exec(
            select(Measurement).where(Measurement.abs_path == path)
        ).first()
        if row is None or not row.metadata_json:
            return None
        if row.source_fingerprint != fingerprint:
            return None  # dataset changed on disk -> reload
        try:
            cached = json.loads(row.metadata_json)
        except (TypeError, ValueError):
            return None
        if not isinstance(cached, dict) or "variable_independents" not in cached:
            return None
        return cached


def _update_existing_cached_attrs(path: str, attrs: dict) -> bool:
    """Refresh an existing cache row and return whether one was found."""
    fingerprint = _fingerprint(path)
    if fingerprint is None:
        return False
    with session_scope() as session:
        row = session.exec(
            select(Measurement).where(Measurement.abs_path == path)
        ).first()
        if row is None:
            return False
        try:
            row.metadata_json = json.dumps(attrs)
        except (TypeError, ValueError):
            return True  # row exists; just couldn't serialise. Don't re-create.
        row.source_fingerprint = fingerprint
        return True


def _write_cached_attrs(
    path: str, attrs: dict, uuid: str | None, origin: str | None
) -> None:
    """Upsert the measurement row that stores cached attrs."""
    if uuid is None:
        return  # unidentifiable dataset; nothing to key the cache on
    with session_scope() as session:
        _upsert_measurement(session, path, attrs, uuid, origin)


async def get_cached_attrs(path: str) -> dict | None:
    """Return cached ``/load-attrs/`` payload for ``path``, or None."""
    if not _is_cacheable(path):
        return None
    try:
        return await asyncio.to_thread(_read_cached_attrs, path)
    except Exception:
        logger.debug("library: metadata cache read failed for %s", path, exc_info=True)
        return None


async def store_cached_attrs(path: str, attrs: dict, dataset=None) -> None:
    """Cache attrs and register the measurement without failing metadata loads."""
    if not attrs:
        return
    try:
        database_uuid = await asyncio.to_thread(_ensure_qcodes_database, path, attrs)
        if database_uuid:
            # Returned with /load-attrs/ so Notes can use one stable database
            # identity plus the run integer, rather than each run's own GUID.
            attrs["qimchi_db_uuid"] = database_uuid
        cacheable = _is_cacheable(path)
        # Refresh registered rows without resolving identity again.
        if cacheable and await asyncio.to_thread(
            _update_existing_cached_attrs, path, attrs
        ):
            return
        # Register on first open so caching does not depend on hearting or tagging.
        uuid, origin = await asyncio.to_thread(resolve_identity, attrs, dataset)
        await asyncio.to_thread(_write_cached_attrs, path, attrs, uuid, origin)
    except Exception:
        logger.debug("library: metadata cache write failed for %s", path, exc_info=True)


def _get_state_row(session: Session, uuid: str) -> MeasurementState:
    state = session.get(MeasurementState, (uuid, LOCAL_USER_ID))
    if state is None:
        state = MeasurementState(uuid=uuid, user_id=LOCAL_USER_ID)
        session.add(state)
    return state


def _register(
    path: str, attrs: dict | None, uuid: str | None, origin: str | None
) -> StateOut:
    with session_scope() as session:
        uuid = _upsert_measurement(session, path, attrs, uuid, origin)
        if uuid is None:
            return StateOut()
        state = session.get(MeasurementState, (uuid, LOCAL_USER_ID))
        return StateOut(
            uuid=uuid,
            hearted=bool(state.hearted) if state else False,
            trashed=bool(state.trashed) if state else False,
        )


def _register_folder(path: str) -> StateOut:
    if not Path(path).is_dir():
        raise HTTPException(status_code=404, detail=f"No folder at {path}")
    uuid = folder_uuid(path)
    with session_scope() as session:
        folder = session.get(Measurement, uuid)
        if folder is None:
            folder = Measurement(uuid=uuid, uuid_origin="folder-path")
            session.add(folder)
        folder.abs_path = path
        folder.source_format = "folder"
        folder.last_opened = _utcnow()
        state = session.get(MeasurementState, (uuid, LOCAL_USER_ID))
        return StateOut(
            uuid=uuid,
            hearted=bool(state.hearted) if state else False,
            trashed=bool(state.trashed) if state else False,
        )


def _set_heart(uuid: str, hearted: bool) -> StateOut:
    with session_scope() as session:
        if session.get(Measurement, uuid) is None:
            raise HTTPException(status_code=404, detail=f"Unknown measurement {uuid}")
        state = _get_state_row(session, uuid)
        state.hearted = hearted
        state.updated_at = _utcnow()
        return StateOut(uuid=uuid, hearted=hearted, trashed=bool(state.trashed))


def _unheart_folder_descendants(session: Session, folder_path: str) -> list[str]:
    """Clear descendant hearts in one statement and return their paths."""
    base = folder_path.rstrip("/\\")
    prefixes = (f"{base}/", f"{base}\\")
    descendants = session.exec(
        select(Measurement.uuid, Measurement.abs_path)
        .join(MeasurementState, MeasurementState.uuid == Measurement.uuid)
        .where(
            MeasurementState.user_id == LOCAL_USER_ID,
            MeasurementState.hearted == True,  # noqa: E712
            or_(
                Measurement.abs_path.startswith(prefixes[0], autoescape=True),
                Measurement.abs_path.startswith(prefixes[1], autoescape=True),
            ),
        )
    ).all()
    if not descendants:
        return []

    uuids = [uuid for uuid, _path in descendants]
    session.execute(
        update(MeasurementState)
        .where(
            MeasurementState.user_id == LOCAL_USER_ID,
            MeasurementState.uuid.in_(uuids),
        )
        .values(hearted=False, updated_at=_utcnow())
    )
    return [path for _uuid, path in descendants if path is not None]


def _set_trash(uuid: str, trashed: bool) -> StateOut:
    with session_scope() as session:
        measurement = session.get(Measurement, uuid)
        if measurement is None:
            raise HTTPException(status_code=404, detail=f"Unknown measurement {uuid}")
        state = _get_state_row(session, uuid)
        state.trashed = trashed
        unhearted_paths: list[str] = []
        if trashed:
            state.hearted = False
            if measurement.source_format == "folder" and measurement.abs_path:
                unhearted_paths = _unheart_folder_descendants(
                    session, measurement.abs_path
                )
        state.updated_at = _utcnow()
        return StateOut(
            uuid=uuid,
            hearted=bool(state.hearted),
            trashed=trashed,
            unhearted_paths=unhearted_paths,
        )


def _list_states() -> list[MeasurementStateOut]:
    """All measurements that are hearted/trashed OR tagged, for DirTree filters."""
    with session_scope() as session:
        # uuid -> [tag_id] (this user's tags only)
        tag_rows = session.exec(
            select(MeasurementTag.uuid, MeasurementTag.tag_id)
            .join(Tag, Tag.id == MeasurementTag.tag_id)
            .where(Tag.user_id == LOCAL_USER_ID)
        ).all()
        tags_by_uuid: dict[str, list[int]] = {}
        for uuid, tag_id in tag_rows:
            tags_by_uuid.setdefault(uuid, []).append(tag_id)

        state_rows = session.exec(
            select(MeasurementState).where(
                MeasurementState.user_id == LOCAL_USER_ID,
                (MeasurementState.hearted == True)  # noqa: E712
                | (MeasurementState.trashed == True),  # noqa: E712
            )
        ).all()
        state_by_uuid = {st.uuid: st for st in state_rows}

        relevant = set(tags_by_uuid) | set(state_by_uuid)
        if not relevant:
            return []
        meas_by_uuid = {
            m.uuid: m
            for m in session.exec(
                select(Measurement).where(Measurement.uuid.in_(relevant))
            ).all()
        }

        out: list[MeasurementStateOut] = []
        for uuid in relevant:
            st = state_by_uuid.get(uuid)
            meas = meas_by_uuid.get(uuid)
            out.append(
                MeasurementStateOut(
                    uuid=uuid,
                    abs_path=meas.abs_path if meas else None,
                    hearted=bool(st.hearted) if st else False,
                    trashed=bool(st.trashed) if st else False,
                    tags=sorted(tags_by_uuid.get(uuid, [])),
                )
            )
        return out


def _list_tags() -> list[TagOut]:
    with session_scope() as session:
        rows = session.exec(
            select(Tag).where(Tag.user_id == LOCAL_USER_ID).order_by(Tag.name)
        ).all()
        counts: dict[int, int] = {}
        for tag_id, count in session.exec(
            select(MeasurementTag.tag_id, func.count()).group_by(MeasurementTag.tag_id)
        ).all():
            counts[tag_id] = int(count)
        return [TagOut(id=t.id, name=t.name, count=counts.get(t.id, 0)) for t in rows]


def _rename_tag(tag_id: int, name: str) -> TagOut:
    """Rename a tag without changing its measurement assignments."""
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Tag name cannot be empty")
    with session_scope() as session:
        tag = session.get(Tag, tag_id)
        if tag is None or tag.user_id != LOCAL_USER_ID:
            raise HTTPException(status_code=404, detail="Unknown tag")
        clash = session.exec(
            select(Tag).where(
                Tag.user_id == LOCAL_USER_ID,
                Tag.name == name,
                Tag.id != tag_id,
            )
        ).first()
        if clash is not None:
            raise HTTPException(
                status_code=409, detail=f"A tag named {name!r} already exists"
            )
        tag.name = name
        session.add(tag)
        count = len(
            session.exec(
                select(MeasurementTag).where(MeasurementTag.tag_id == tag_id)
            ).all()
        )
        return TagOut(id=tag.id, name=tag.name, count=count)


def _create_tag(name: str) -> TagOut:
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Tag name cannot be empty")
    with session_scope() as session:
        existing = session.exec(
            select(Tag).where(Tag.user_id == LOCAL_USER_ID, Tag.name == name)
        ).first()
        if existing is not None:
            return TagOut(id=existing.id, name=existing.name)
        tag = Tag(user_id=LOCAL_USER_ID, name=name)
        session.add(tag)
        session.flush()  # populate tag.id before the session closes
        return TagOut(id=tag.id, name=tag.name)


def _delete_tag(tag_id: int) -> None:
    with session_scope() as session:
        tag = session.get(Tag, tag_id)
        if tag is None or tag.user_id != LOCAL_USER_ID:
            raise HTTPException(status_code=404, detail="Unknown tag")
        # Remove associations first (no FK cascade on the plain uuid column).
        for mt in session.exec(
            select(MeasurementTag).where(MeasurementTag.tag_id == tag_id)
        ).all():
            session.delete(mt)
        session.delete(tag)


def _set_measurement_tag(uuid: str, tag_id: int, add: bool) -> list[int]:
    with session_scope() as session:
        tag = session.get(Tag, tag_id)
        if tag is None or tag.user_id != LOCAL_USER_ID:
            raise HTTPException(status_code=404, detail="Unknown tag")
        link = session.get(MeasurementTag, (uuid, tag_id))
        if add and link is None:
            session.add(MeasurementTag(uuid=uuid, tag_id=tag_id))
        elif not add and link is not None:
            session.delete(link)
        # Autoflush makes this query reflect the pending add/delete.
        rows = session.exec(
            select(MeasurementTag.tag_id)
            .join(Tag, Tag.id == MeasurementTag.tag_id)
            .where(MeasurementTag.uuid == uuid, Tag.user_id == LOCAL_USER_ID)
        ).all()
        return sorted(set(rows))


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
def _preset_out(preset: FilterPreset) -> FilterPresetOut:
    return FilterPresetOut(
        id=preset.id,
        name=preset.name,
        filters=json.loads(preset.filters_json or "[]"),
        updatedAt=preset.updated_at,
    )


def _preset_name(name: str, session: Session, exclude_id: int | None = None) -> str:
    """Validate and normalize a unique preset name."""
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Preset name cannot be empty")
    query = select(FilterPreset).where(
        FilterPreset.user_id == LOCAL_USER_ID, FilterPreset.name == name
    )
    if exclude_id is not None:
        query = query.where(FilterPreset.id != exclude_id)
    if session.exec(query).first() is not None:
        raise HTTPException(
            status_code=409, detail=f"A preset named {name!r} already exists"
        )
    return name


def _filters_json(filters: list[PresetFilter]) -> str:
    if not filters:
        raise HTTPException(
            status_code=400, detail="A preset needs at least one filter"
        )
    return json.dumps([f.model_dump() for f in filters])


def _list_filter_presets() -> list[FilterPresetOut]:
    with session_scope() as session:
        rows = session.exec(
            select(FilterPreset)
            .where(FilterPreset.user_id == LOCAL_USER_ID)
            .order_by(FilterPreset.name)
        ).all()
        return [_preset_out(row) for row in rows]


def _create_filter_preset(req: CreateFilterPresetRequest) -> FilterPresetOut:
    with session_scope() as session:
        preset = FilterPreset(
            user_id=LOCAL_USER_ID,
            name=_preset_name(req.name, session),
            filters_json=_filters_json(req.filters),
        )
        session.add(preset)
        session.flush()
        return _preset_out(preset)


def _update_filter_preset(
    preset_id: int, req: UpdateFilterPresetRequest
) -> FilterPresetOut:
    with session_scope() as session:
        preset = session.get(FilterPreset, preset_id)
        if preset is None or preset.user_id != LOCAL_USER_ID:
            raise HTTPException(status_code=404, detail="Unknown preset")
        if req.name is not None:
            preset.name = _preset_name(req.name, session, exclude_id=preset_id)
        if req.filters is not None:
            preset.filters_json = _filters_json(req.filters)
        preset.updated_at = _utcnow()
        session.add(preset)
        session.flush()
        return _preset_out(preset)


def _delete_filter_preset(preset_id: int) -> None:
    with session_scope() as session:
        preset = session.get(FilterPreset, preset_id)
        if preset is None or preset.user_id != LOCAL_USER_ID:
            raise HTTPException(status_code=404, detail="Unknown preset")
        session.delete(preset)


@router.post("/register", response_model=StateOut)
async def register(req: RegisterRequest) -> StateOut:
    """Register a measurement and return its heart and trash state."""
    try:
        if req.folder:
            return await asyncio.to_thread(_register_folder, req.path)
        uuid, origin, attrs = await _resolve(req.path, req.attrs)
        return await asyncio.to_thread(_register, req.path, attrs, uuid, origin)
    except HTTPException:
        raise
    except Exception:
        logger.exception("library.register failed for %s", req.path)
        raise HTTPException(status_code=500, detail="Failed to register measurement")


@router.post("/heart", response_model=StateOut)
async def heart(req: HeartRequest) -> StateOut:
    return await asyncio.to_thread(_set_heart, req.uuid, req.hearted)


@router.post("/trash", response_model=StateOut)
async def trash(req: TrashRequest) -> StateOut:
    return await asyncio.to_thread(_set_trash, req.uuid, req.trashed)


@router.get("/states", response_model=list[MeasurementStateOut])
async def states() -> list[MeasurementStateOut]:
    """All hearted/trashed/tagged measurements for the current user (DirTree filters)."""
    return await asyncio.to_thread(_list_states)


@router.get("/tags", response_model=list[TagOut])
async def list_tags() -> list[TagOut]:
    return await asyncio.to_thread(_list_tags)


@router.post("/tags", response_model=TagOut)
async def create_tag(req: CreateTagRequest) -> TagOut:
    return await asyncio.to_thread(_create_tag, req.name)


@router.patch("/tags/{tag_id}", response_model=TagOut)
async def rename_tag(tag_id: int, req: RenameTagRequest) -> TagOut:
    return await asyncio.to_thread(_rename_tag, tag_id, req.name)


@router.delete("/tags/{tag_id}")
async def delete_tag(tag_id: int) -> dict:
    await asyncio.to_thread(_delete_tag, tag_id)
    return {"deleted": tag_id}


@router.post("/tag", response_model=list[int])
async def tag_measurement(req: TagMeasurementRequest) -> list[int]:
    """Add/remove a tag on a measurement; returns the measurement's tag ids."""
    return await asyncio.to_thread(_set_measurement_tag, req.uuid, req.tag_id, req.add)


@router.get("/filter-presets", response_model=list[FilterPresetOut])
async def list_filter_presets() -> list[FilterPresetOut]:
    return await asyncio.to_thread(_list_filter_presets)


@router.post("/filter-presets", response_model=FilterPresetOut)
async def create_filter_preset(req: CreateFilterPresetRequest) -> FilterPresetOut:
    return await asyncio.to_thread(_create_filter_preset, req)


@router.patch("/filter-presets/{preset_id}", response_model=FilterPresetOut)
async def update_filter_preset(
    preset_id: int, req: UpdateFilterPresetRequest
) -> FilterPresetOut:
    return await asyncio.to_thread(_update_filter_preset, preset_id, req)


@router.delete("/filter-presets/{preset_id}")
async def delete_filter_preset(preset_id: int) -> dict:
    await asyncio.to_thread(_delete_filter_preset, preset_id)
    return {"deleted": preset_id}
