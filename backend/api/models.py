"""
Pydantic models for the Qimchi backend FastAPI endpoints. This module defines the data
structures used for type safety and validation in the request and response bodies.

"""

from typing import Dict, List
from pydantic import BaseModel


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
    filters_order: List[str] = []
    filters_opts: Dict = {}
    slider: Dict = {}  # For data slicing/selection


class PlotResponse(BaseModel):
    plots: List[Dict]
    success: bool
    message: str = ""


class FilterRequest(BaseModel):
    plot_json: dict
    filters_order: List[str]
    filters_opts: Dict[str, dict]
    num_axes: int


class FilterResponse(BaseModel):
    filtered_plot_json: dict


class SliderRequest(BaseModel):
    filters_order: List[str]
    filters_opts: Dict[str, dict]
    slider: Dict[str, dict]  # {dim: {min, max, step, value}}
    fpath: str  # Dataset path for reloading data
    indeps: List[str]  # Independent variables being plotted
    deps: List[str]  # Dependent variables being plotted
    plotType: str  # "LinePlot" or "HeatMap"


class SliderResponse(BaseModel):
    sliced_plot_json: dict


class WatchPath(BaseModel):
    path: str
