"""
User settings: one JSON document per user, stored in the Qimchi DB.

The frontend owns the document's shape and merges it over its own defaults, so
only values the user changed are stored. The backend validates just the
sections it reads itself (export and desktop) and falls back to their defaults
when those are missing, invalid, or the database is unavailable.

"""

import asyncio
import json
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError, field_validator

from .db_models import LOCAL_USER_ID, UserSettings, _utcnow
from .logger import logger
from .shared.db import require_db, session_scope

router = APIRouter(prefix="/settings", dependencies=[Depends(require_db)])

MAX_SETTINGS_BYTES = 256 * 1024


def current_user_id() -> int:
    """The user a request acts for. Desktop mode has a single local user."""
    return LOCAL_USER_ID


class ExportSettings(BaseModel):
    formats: list[Literal["png", "svg"]] = Field(default_factory=lambda: ["png", "svg"])
    variants: list[Literal["light", "dark"]] = Field(
        default_factory=lambda: ["light", "dark"]
    )
    # None keeps each writer's built-in resolution.
    scale: float | None = Field(default=None, ge=1, le=4)
    # None saves desktop exports to QIMCHI_EXPORT_DIR, else ~/Downloads.
    folder: str | None = None

    @field_validator("formats", "variants")
    @classmethod
    def _not_empty(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("choose at least one")
        return list(dict.fromkeys(value))


class DesktopSettings(BaseModel):
    checkForUpdates: bool = True
    previewReleases: bool = False


_VALIDATED_SECTIONS: dict[str, type[BaseModel]] = {
    "export": ExportSettings,
    "desktop": DesktopSettings,
}


class SettingsPatch(BaseModel):
    settings: dict[str, Any]


class SettingsOut(BaseModel):
    settings: dict[str, Any]
    updatedAt: datetime | None = None


def deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """Merge ``patch`` into ``base``. A ``None`` value removes the key."""
    merged = dict(base)
    for key, value in patch.items():
        if value is None:
            merged.pop(key, None)
            continue
        if isinstance(value, dict):
            existing = merged.get(key)
            nested = deep_merge(existing if isinstance(existing, dict) else {}, value)
            if nested:
                merged[key] = nested
            else:
                merged.pop(key, None)
            continue
        merged[key] = value
    return merged


def _validate(document: dict[str, Any]) -> None:
    for section, model in _VALIDATED_SECTIONS.items():
        if section not in document:
            continue
        try:
            model.model_validate(document[section])
        except ValidationError as exc:
            raise HTTPException(
                status_code=422, detail=f"Invalid {section} settings: {exc}"
            ) from exc
    if len(json.dumps(document)) > MAX_SETTINGS_BYTES:
        raise HTTPException(status_code=413, detail="Settings are too large to save")


def _stored_document(row: UserSettings | None) -> dict[str, Any]:
    if row is None:
        return {}
    try:
        document = json.loads(row.settings_json or "{}")
    except json.JSONDecodeError:
        logger.warning("Stored settings for user %s are not valid JSON", row.user_id)
        return {}
    return document if isinstance(document, dict) else {}


def load_settings(user_id: int = LOCAL_USER_ID) -> SettingsOut:
    with session_scope() as session:
        row = session.get(UserSettings, user_id)
        return SettingsOut(
            settings=_stored_document(row),
            updatedAt=row.updated_at if row is not None else None,
        )


def save_settings(
    user_id: int, patch: dict[str, Any] | None, *, replace: bool = False
) -> SettingsOut:
    """
    Apply a partial update, or clear every setting when ``patch`` is None.

    With ``replace`` the patch becomes the whole document (an imported file).

    """
    with session_scope() as session:
        row = session.get(UserSettings, user_id)
        base = {} if replace else _stored_document(row)
        document = {} if patch is None else deep_merge(base, patch)
        _validate(document)
        now = _utcnow()
        if row is None:
            row = UserSettings(user_id=user_id)
        row.settings_json = json.dumps(document)
        row.updated_at = now
        session.add(row)
        return SettingsOut(settings=document, updatedAt=now)


def _section(name: str, model: type[BaseModel]) -> BaseModel:
    try:
        document = load_settings(current_user_id()).settings
        return model.model_validate(document.get(name, {}))
    except Exception:
        logger.debug("Using default %s settings", name, exc_info=True)
        return model()


def export_settings() -> ExportSettings:
    return _section("export", ExportSettings)  # type: ignore[return-value]


def desktop_settings() -> DesktopSettings:
    return _section("desktop", DesktopSettings)  # type: ignore[return-value]


@router.get("", response_model=SettingsOut)
async def get_settings(user_id: int = Depends(current_user_id)) -> SettingsOut:
    return await asyncio.to_thread(load_settings, user_id)


@router.patch("", response_model=SettingsOut)
async def patch_settings(
    body: SettingsPatch, user_id: int = Depends(current_user_id)
) -> SettingsOut:
    return await asyncio.to_thread(save_settings, user_id, body.settings)


@router.put("", response_model=SettingsOut)
async def replace_settings(
    body: SettingsPatch, user_id: int = Depends(current_user_id)
) -> SettingsOut:
    return await asyncio.to_thread(save_settings, user_id, body.settings, replace=True)


@router.delete("", response_model=SettingsOut)
async def reset_settings(user_id: int = Depends(current_user_id)) -> SettingsOut:
    return await asyncio.to_thread(save_settings, user_id, None)
