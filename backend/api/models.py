"""
Pydantic models for the Qimchi backend FastAPI endpoints. This module defines the data
structures used for type safety and validation in the request and response bodies.

"""

from typing import Dict, List
from pydantic import BaseModel, Field


class PathData(BaseModel):
    path: str


class PathsData(BaseModel):
    """
    Used for multi-select downloads

    """

    paths: list[str]


class NotesData(BaseModel):
    path: str
    notes: str


class PlotRequest(BaseModel):
    fpaths: List[str]
    indeps: List[str]
    deps: List[str]
    plotType: str
    filters_order: List[str] = Field(default_factory=list)
    filters_opts: Dict = Field(default_factory=dict)
    slider: Dict = Field(default_factory=dict)  # For data slicing/selection


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


class TransformPlotResponse(BaseModel):
    plot_json: dict
    plot_ref: str


class WatchPath(BaseModel):
    path: str
