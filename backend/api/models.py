"""
Pydantic models for the Qimchi backend FastAPI endpoints. This module defines the data
structures used for type safety and validation in the request and response bodies.

"""

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class PinnedParametersRequest(BaseModel):
    path: str
    names: List[str]


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


class LineCut(BaseModel):
    """Endpoints and optional sample count for a heat-map line cut."""

    start: Dict[str, float]
    end: Dict[str, float]
    points: Optional[int] = Field(default=None, ge=2, le=2000)


class PlotRequest(BaseModel):
    fpaths: List[str]
    indeps: List[str]
    deps: List[str]
    plotType: str
    filters_order: List[str] = Field(default_factory=list)
    filters_opts: Dict = Field(default_factory=dict)
    slider: Dict = Field(default_factory=dict)  # For data slicing/selection
    swap_xy: bool = False
    # Optional line cut through the two independent axes.
    cut: Optional[LineCut] = None


class PlotResponse(BaseModel):
    plots: List[Dict]
    success: bool
    message: str = ""
    skip_update: bool = False  # E.g., transient file locks or other transient errors
    # Marks an invalid request that should not be retried.
    invalid: bool = False


class PlotContext(BaseModel):
    """Plot parameters the client can resend to restore a missing server context."""

    fpath: str
    indeps: List[str]
    deps: List[str]
    plotType: Literal["LinePlot", "HeatMap"]
    cut: Optional[LineCut] = None


class TransformPlotRequest(BaseModel):
    plot_ref: str
    filters_order: List[str] = Field(default_factory=list)
    filters_opts: Dict[str, dict] = Field(default_factory=dict)
    slider: Dict[str, dict] = Field(default_factory=dict)
    swap_xy: bool = False
    context: Optional[PlotContext] = None


class ReleasePlotContextsRequest(BaseModel):
    plot_refs: List[str] = Field(default_factory=list, max_length=1000)


class TransformPlotResponse(BaseModel):
    plot_json: dict
    plot_ref: str
    warnings: List[str] = Field(default_factory=list)


class WatchPath(BaseModel):
    path: str


class LiveRefreshSummary(BaseModel):
    """Local live-plot timing summary written to the app log."""

    plotType: str = ""
    count: int = 0
    medianMs: float = 0
    p90Ms: float = 0
    minMs: float = 0
    maxMs: float = 0
    windowSeconds: float = 0
    points: int = 0
    concurrentPlots: int = 0
