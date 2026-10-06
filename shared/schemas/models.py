"""Pydantic v2 mirrors of shared/schemas/*.schema.json. test_schema_drift.py checks they agree."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Source = Literal["gaze", "cursor"]
Resolution = Literal["lesion", "zone", "none"]
MissType = Literal["search", "recognition", "decision"] | None
QualityTier = Literal["good", "coarse", "poor"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GazeSample(_Strict):
    t: float
    sx: float
    sy: float
    x: float | None = None
    y: float | None = None
    sigma: float = Field(ge=0)
    valid: bool
    zoom: float
    vp: tuple[float, float, float, float]
    on_loupe: bool | None = None
    target: Literal["image", "ui", "off"] | None = None
    face_lum: float | None = None
    slice: int | None = None


class Screen(_Strict):
    width: float
    height: float
    dpr: float | None = None


class Validation(_Strict):
    accuracy_px: float = Field(ge=0)
    precision_px: float = Field(ge=0)
    loss_pct: float = Field(ge=0, le=100)
    n_points: int = Field(ge=0)


class FaceBox(_Strict):
    w: float
    h: float


class Calibration(_Strict):
    n_points: int = Field(ge=0)
    face_box: FaceBox
    face_lum: float | None = None


class DriftCheck(_Strict):
    case_index: int
    error_px: float
    recalibrated: bool


class GazeSessionMeta(_Strict):
    schema_: Literal["gaze_session_meta.v1"] = Field(alias="schema", default="gaze_session_meta.v1")
    provider: Literal["webeyetrack", "webgazer", "mock"]
    provider_version: str
    screen: Screen
    validation: Validation
    calibration: Calibration
    camera: Screen | None = None
    quality_tier: QualityTier
    px_per_cm: float | None = None
    pipeline_latency_ms: float | None = None
    inference_hz: float | None = None
    train_on_clicks: bool
    study_mode: bool
    drift_checks: list[DriftCheck] | None = None
    timestamp: str

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ZoneRef(_Strict):
    zone: str
    human: str
    source: Source


class Attention(_Strict):
    sources: list[Source]
    gaze_quality: QualityTier | None = None
    gaze_accuracy_img_px_at_fit: float | None = None
    supports: Literal["lesion_level", "zone_level", "cursor_only"]


class ZoneSegment(_Strict):
    zone: str
    human: str | None = None
    enter_ms: float
    dwell_ms: float
    source: Source


class LongestDwell(_Strict):
    zone: str
    human: str
    dwell_ms: float
    source: Source


class Search(_Strict):
    total_read_ms: float
    first_mark_ms: float | None = None
    first_zone: ZoneRef | None = None
    last_zone_before_first_mark: ZoneRef | None = None
    last_zone_before_submit: ZoneRef | None = None
    zone_sequence: list[ZoneSegment] = Field(max_length=15)
    revisits: dict[str, int] | None = None
    longest_dwell_zones: list[LongestDwell] | None = None
    fixation_count: int | None = None
    order_note: str | None = None


class ReviewArea(_Strict):
    zone: str
    human: str
    hardness: float
    gaze_dwell_ms: float | None = None
    gaze_resolution: Resolution | None = None
    cursor_dwell_ms: float
    visited_gaze: bool | None = None
    visited_cursor: bool
    visit_threshold_ms: float
    reference: Literal["review_area_checklist"] = "review_area_checklist"


class Coverage(_Strict):
    gaze_weighted_pct: float | None = None
    cursor_weighted_pct: float | None = None
    unvisited_hard_gaze: list[str] | None = None
    unvisited_hard_cursor: list[str] | None = None


class GazeFinding(_Strict):
    dwell_ms: float
    resolution: Resolution
    miss_type: MissType
    miss_type_confidence: float | None = None
    time_to_first_ms: float | None = None
    sigma_px: float | None = None


class CursorFinding(_Strict):
    dwell_ms: float
    miss_type: MissType


class Bands(_Strict):
    recognition_from: float
    decision_from: float


class Finding(_Strict):
    finding_id: str
    label: str
    location: str
    outcome: Literal["found", "mislabeled", "missed", "overcall"]
    gaze: GazeFinding | None = None
    cursor: CursorFinding
    bands_ms: Bands
    agreement: Literal["agree", "disagree", "n/a"] | None = None
    reference: Literal["expert_annotation"] = "expert_annotation"


class Agreement(_Strict):
    n_samples: int | None = None
    median_gaze_cursor_px: dict[str, float | None] | None = None
    gaze_leads_cursor_ms: float | None = None
    review_area_visited_agreement_pct: float | None = None
    review_area_kappa: float | None = None


class History(_Strict):
    n_cases: int
    review_area_unvisited: dict[str, int] | None = None
    miss_types: dict[str, dict[str, int]] | None = None


class ClaimLimits(_Strict):
    never_say: list[str]
    finding_level_gaze_claims_only_if: str
    describe_order_as: str


class GazeFacts(_Strict):
    schema_: Literal["gaze_facts.v1"] = Field(alias="schema", default="gaze_facts.v1")
    phase: Literal["pre_submit", "post_submit"]
    synthetic: bool | None = None
    attention: Attention
    search: Search
    review_areas: list[ReviewArea]
    coverage: Coverage | None = None
    findings: list[Finding] | None = None
    agreement: Agreement | None = None
    history: History | None = None
    references: dict[str, str]
    claim_limits: ClaimLimits

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


def dump(model: BaseModel) -> dict:
    """JSON-ready dict with aliases and without None-valued optionals (matches the JSON schemas)."""
    return model.model_dump(by_alias=True, exclude_none=True, mode="json")
