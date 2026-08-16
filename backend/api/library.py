"""
Library endpoints: per-measurement state (hearts/trash) backed by the Qimchi DB.

Register a measurement when it is opened and toggle heart/trash/tags, so the
DirTree can filter on them. Keyed on the measurement UUID resolved by
``shared/identity.py``: the qcutils ``Measurement ID``, else a QCoDeS run
``guid``, else a content-signature uuid5. ``measurements.uuid_origin`` records
which tier answered. Only datasets that fail every tier (unreadable) stay
unpersisted -- those calls return ``uuid=None`` and are no-ops.

All DB work runs off the event loop via ``asyncio.to_thread`` (repo convention).

"""

import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from .db_models import (
    LOCAL_USER_ID,
    Measurement,
    MeasurementState,
    MeasurementTag,
    Tag,
    _utcnow,
)
from .logger import logger
from .shared.db import require_db, session_scope
from .shared.identity import resolve_from_attrs, resolve_identity

# Every library endpoint needs the database; require_db turns a failed startup
# migration into a 503 with the reason, rather than an opaque 500.
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


class StateOut(BaseModel):
    uuid: str | None = None
    hearted: bool = False
    trashed: bool = False


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


class CreateTagRequest(BaseModel):
    name: str


class TagMeasurementRequest(BaseModel):
    uuid: str
    tag_id: int
    add: bool = True


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
    suffix = Path(path).suffix.lower()
    return {
        ".zarr": "zarr",
        ".nc": "netcdf",
        ".h5": "hdf5",
        ".hdf5": "hdf5",
        ".db": "qcodes",
        ".sqlite": "container",
        ".csv": "csv",
        ".txt": "csv",
    }.get(suffix)


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
    """
    Build the attrs payload cached for a dataset.

    Deliberately the same shape ``/load-attrs/`` returns (via
    ``dirtree.build_attrs_payload``) plus the QCoDeS ``guid`` used for identity
    resolution -- the metadata cache is read back as that endpoint's response,
    so a narrower projection here would make a cache hit differ from a miss.

    """
    from .dirtree import build_attrs_payload

    out = build_attrs_payload(ds)
    guid = dict(ds.attrs).get("guid")
    if guid is not None:
        out["guid"] = guid if isinstance(guid, (str, int, float, bool)) else str(guid)
    return out


async def _resolve(
    path: str, attrs: dict | None
) -> tuple[str | None, str | None, dict | None]:
    """
    Resolve ``(uuid, origin, attrs)`` for a dataset.

    Native ids (qcutils / QCoDeS) are answered straight from ``attrs`` when the
    caller already has them, so the common path costs no dataset load. Only the
    content-signature tier needs the dataset opened.

    """
    uuid, origin = resolve_from_attrs(attrs)
    if uuid:
        return uuid, origin, attrs

    # Imported lazily to avoid a module-load cycle with the dirtree router.
    from .dirtree import _load_dataset_for_metadata

    try:
        ds = await _load_dataset_for_metadata(path)
    except Exception:
        logger.debug("library: could not load %s to resolve identity", path, exc_info=True)
        return None, None, attrs

    if attrs is None:
        attrs = _lean_attrs(ds)
    uuid, origin = await asyncio.to_thread(resolve_identity, attrs, ds)
    return uuid, origin, attrs


# --------------------------------------------------------------------------- #
# Metadata read-through cache
# --------------------------------------------------------------------------- #
# Metadata is assumed unchanging, so once a dataset has been opened its attrs
# are served from `measurements.metadata_json` instead of re-reading the file.
#
# The lookup keys on `abs_path` (an indexed column), NOT the measurement UUID:
# resolving a UUID can require opening the dataset, which is exactly the work
# the cache exists to avoid.
#
# "Assumed unchanging" is not "guaranteed unchanging", so a cheap stat
# signature guards it -- a rewritten dataset reloads instead of serving stale
# attrs. Live (`memory://`) datasets are never cached: they grow as the
# measurement runs, so their attrs genuinely change.


def _fingerprint(path: str) -> str | None:
    """Cheap change signature for a dataset (None if it can't be stat'd)."""
    try:
        st = Path(path).stat()
    except OSError:
        return None
    return f"{st.st_mtime_ns}:{st.st_size}"


def _is_cacheable(path: str) -> bool:
    # memory:// is live and mutating; a "#run_id=" reference points into a
    # QCoDeS db whose mtime changes whenever ANY run is added, so its
    # fingerprint would churn even though the run itself is fixed.
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
        # Only serve a payload complete enough to BE the endpoint's response;
        # older rows were written before independents/dependents were cached.
        if not isinstance(cached, dict) or "independents" not in cached:
            return None
        return cached


def _update_existing_cached_attrs(path: str, attrs: dict) -> bool:
    """
    Refresh the cache on a measurement that is already registered.

    Returns True when a row was found and updated. Kept separate from the
    create path so the common case costs one indexed lookup -- resolving a
    content-signature UUID means sampling the dataset's coordinates, which is
    pointless when the row it would key already exists.

    """
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
    """
    Upsert the measurement row carrying the cached attrs.

    The row is CREATED when absent. It has to be: nothing registers a
    measurement merely because it was opened -- ``/library/register`` is called
    lazily, only when the user first hearts/trashes/tags something. If this
    returned early on a missing row, the cache would never populate for a
    measurement the user never annotated, i.e. the common case.

    """
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
    """
    Cache a freshly built ``/load-attrs/`` payload, registering the measurement
    if this is the first time it has been opened. Best-effort: a DB problem must
    never break metadata loading.

    ``dataset`` is the already-open xarray Dataset, passed so a content-signature
    UUID can be derived without re-reading the file.

    """
    if not _is_cacheable(path) or not attrs:
        return
    try:
        # Already registered? Cheap indexed update, no identity work.
        if await asyncio.to_thread(_update_existing_cached_attrs, path, attrs):
            return
        # First time this measurement has been opened -- resolve its identity
        # and create the row, so the cache works without waiting for the user
        # to heart/tag it (which is what triggers /library/register).
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


def _set_heart(uuid: str, hearted: bool) -> StateOut:
    with session_scope() as session:
        if session.get(Measurement, uuid) is None:
            raise HTTPException(status_code=404, detail=f"Unknown measurement {uuid}")
        state = _get_state_row(session, uuid)
        state.hearted = hearted
        state.updated_at = _utcnow()
        return StateOut(uuid=uuid, hearted=hearted, trashed=bool(state.trashed))


def _set_trash(uuid: str, trashed: bool) -> StateOut:
    with session_scope() as session:
        if session.get(Measurement, uuid) is None:
            raise HTTPException(status_code=404, detail=f"Unknown measurement {uuid}")
        state = _get_state_row(session, uuid)
        state.trashed = trashed
        state.updated_at = _utcnow()
        return StateOut(uuid=uuid, hearted=bool(state.hearted), trashed=trashed)


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
        return [TagOut(id=t.id, name=t.name) for t in rows]


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
@router.post("/register", response_model=StateOut)
async def register(req: RegisterRequest) -> StateOut:
    """Register/refresh a measurement on open; returns its heart/trash state.

    The dataset is loaded only when ``attrs`` carries no native id and a content
    signature has to be derived.
    """
    try:
        uuid, origin, attrs = await _resolve(req.path, req.attrs)
        return await asyncio.to_thread(_register, req.path, attrs, uuid, origin)
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


@router.delete("/tags/{tag_id}")
async def delete_tag(tag_id: int) -> dict:
    await asyncio.to_thread(_delete_tag, tag_id)
    return {"deleted": tag_id}


@router.post("/tag", response_model=list[int])
async def tag_measurement(req: TagMeasurementRequest) -> list[int]:
    """Add/remove a tag on a measurement; returns the measurement's tag ids."""
    return await asyncio.to_thread(
        _set_measurement_tag, req.uuid, req.tag_id, req.add
    )
