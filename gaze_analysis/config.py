"""Typed analysis config. Built from config/gaze.yaml (+ the app's own thresholds) by the caller; never read here."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class GazeAnalysisConfig:
    max_gap_ms: float = 500
    median_window: int = 3
    fixation_min_dispersion_px: float = 40
    fixation_dispersion_k: float = 2.0
    fixation_min_duration_ms: float = 100
    max_dt_ms: float = 250
    sigma_bins_px: tuple[float, ...] = (10, 20, 35, 50, 75, 100, 150, 200, 300)
    lesion_sigma_max: float = 72
    zone_sigma_max: float = 150
    visit_ms: float = 300
    recognition_from_ms: float = 300
    decision_from_ms: float = 1000
    hard_min: float = 0.8
    agreement_max_lag_ms: float = 2000
    agreement_lag_step_ms: float = 33
    heatmap_size: int = 256
    review_hardness: dict[str, float] = field(default_factory=dict)
    zone_human: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_yaml_dicts(
        cls,
        gaze: dict,
        review_hardness: dict[str, float],
        zone_human: dict[str, str],
        visit_ms: float,
        recognition_from_ms: float,
        decision_from_ms: float,
    ) -> GazeAnalysisConfig:
        return cls(
            max_gap_ms=gaze["clean"]["max_gap_ms"],
            median_window=gaze["clean"]["median_window"],
            fixation_min_dispersion_px=gaze["fixation"]["min_dispersion_px"],
            fixation_dispersion_k=gaze["fixation"]["dispersion_k"],
            fixation_min_duration_ms=gaze["fixation"]["min_duration_ms"],
            max_dt_ms=gaze["dwell"]["max_dt_ms"],
            sigma_bins_px=tuple(gaze["dwell"]["sigma_bins_px"]),
            lesion_sigma_max=gaze["resolution"]["lesion_sigma_max"],
            zone_sigma_max=gaze["resolution"]["zone_sigma_max"],
            visit_ms=visit_ms,
            recognition_from_ms=recognition_from_ms,
            decision_from_ms=decision_from_ms,
            hard_min=gaze.get("coverage", {}).get("hard_min", 0.8),
            agreement_max_lag_ms=gaze["agreement"]["max_lag_ms"],
            agreement_lag_step_ms=gaze["agreement"]["lag_step_ms"],
            heatmap_size=gaze["heatmap"]["size"],
            review_hardness=dict(review_hardness),
            zone_human=dict(zone_human),
        )
