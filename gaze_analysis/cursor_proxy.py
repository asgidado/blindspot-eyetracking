"""Blindspot's cursor-dwell proxy (SPEC §7.1), reimplemented so agreement analysis runs here.

Blindspot uses cursor, loupe and zoom as a proxy for where the learner looked. Thresholds are passed in.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise
from typing import Any

from .masks import Mask, center_in, point_in


@dataclass(frozen=True)
class CursorDwellConfig:
    max_dt_ms: float = 250
    max_still_ms: float = 1500
    zoom_dwell_min: float = 2.0
    zoom_dwell_weight: float = 0.5


@dataclass(frozen=True)
class MissTypeBands:
    recognition_from_ms: float = 300
    decision_from_ms: float = 1000


def dwell_ms(events: list[dict[str, Any]], region: Mask, cfg: CursorDwellConfig) -> float:
    """Verbatim port of Blindspot's dwell_ms. `events` are TelemetryEvent dicts sorted by t."""
    total, still = 0.0, 0.0
    for e0, e1 in pairwise(events):
        dt = min(e1["t"] - e0["t"], cfg.max_dt_ms)
        if e0.get("x") is None:
            continue  # pointer off-image
        moved = e1.get("x") is None or (abs(e1["x"] - e0["x"]) + abs(e1["y"] - e0["y"])) > 1.0
        still = 0.0 if moved else still + dt
        if still > cfg.max_still_ms:
            continue  # idle cap
        if point_in(region, e0["x"], e0["y"]):
            total += dt
        if e0.get("zoom", 1) >= cfg.zoom_dwell_min and center_in(e0["vp"], region):
            total += cfg.zoom_dwell_weight * dt
    return total


def miss_type(dwell: float, bands: MissTypeBands) -> str:
    """Kundel taxonomy from dwell in the finding ROI."""
    if dwell < bands.recognition_from_ms:
        return "search"
    if dwell < bands.decision_from_ms:
        return "recognition"
    return "decision"
