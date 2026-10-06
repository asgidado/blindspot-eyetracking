"""Step 5: Kundel miss type from probabilistic gaze dwell, with a confidence that falls as σ approaches the ROI size."""

from __future__ import annotations

from .dwell import RegionDwell, equivalent_radius, resolution_tier


def gaze_miss_type(
    rd: RegionDwell,
    roi_area_px: int,
    recognition_from_ms: float,
    decision_from_ms: float,
    lesion_sigma_max: float,
    zone_sigma_max: float,
) -> dict:
    """Returns {'resolution', 'miss_type' (None unless lesion), 'confidence', 'dwell_ms', 'sigma_px'}."""
    tier = resolution_tier(rd.median_sigma_px, lesion_sigma_max, zone_sigma_max)
    r_eq = equivalent_radius(int(roi_area_px))
    conf = 0.0
    if rd.median_sigma_px != float("inf") and r_eq > 0:
        conf = max(
            0.0, min(1.0, 1.0 - rd.median_sigma_px / (2 * r_eq))
        )  # 1 when σ ≪ ROI radius, 0 when σ ≥ ROI diameter
    mt = None
    if tier == "lesion":
        d = rd.prob_ms
        mt = "search" if d < recognition_from_ms else "recognition" if d < decision_from_ms else "decision"
    return {
        "resolution": tier,
        "miss_type": mt,
        "confidence": round(conf, 2),
        "dwell_ms": round(rd.prob_ms, 1),
        "point_dwell_ms": round(rd.point_ms, 1),
        "sigma_px": round(rd.median_sigma_px, 1) if rd.median_sigma_px != float("inf") else None,
        "time_to_first_ms": rd.first_touch_ms,
    }
