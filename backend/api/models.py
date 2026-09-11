"""
Pydantic models for the Qimchi backend FastAPI endpoints. This module defines the data
structures used for type safety and validation in the request and response bodies.

"""

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class PathData(BaseModel):
    path: str
    note_scope: Literal["measurement", "sample"] = "measurement"
    uuid: Optional[str] = None
    run_id: Optional[int] = Field(default=None, ge=1)
    sample_path: Optional[str] = None
    sample_name: Optional[str] = None
    cryostat_name: Optional[str] = None


class PathsData(BaseModel):
    """
    Used for multi-select downloads

    """

    paths: list[str]


class NotesData(BaseModel):
    path: str
    notes: str
    note_scope: Literal["measurement", "sample"] = "measurement"
    uuid: Optional[str] = None
    run_id: Optional[int] = Field(default=None, ge=1)
    sample_path: Optional[str] = None
    sample_name: Optional[str] = None
    cryostat_name: Optional[str] = None


class PlotRequest(BaseModel):
    fpaths: List[str]
    indeps: List[str]
    deps: List[str]
    plotType: str
    filters_order: List[str] = Field(default_factory=list)
    filters_opts: Dict = Field(default_factory=dict)
    slider: Dict = Field(default_factory=dict)  # For data slicing/selection
    swap_xy: bool = False


class PlotResponse(BaseModel):
    plots: List[Dict]
    success: bool
    message: str = ""
    skip_update: bool = False  # E.g., transient file locks or other transient errors


class TransformPlotRequest(BaseModel):
    plot_ref: str
    filters_order: List[str] = Field(default_factory=list)
    filters_opts: Dict[str, dict] = Field(default_factory=dict)
    slider: Dict[str, dict] = Field(default_factory=dict)
    swap_xy: bool = False


class TransformPlotResponse(BaseModel):
    plot_json: dict
    plot_ref: str
    warnings: List[str] = Field(default_factory=list)


class WatchPath(BaseModel):
    path: str
