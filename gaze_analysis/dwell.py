"""Steps 3-4: probabilistic dwell with per-sample σ, cached blurred masks, and the resolution tier per region.

Each sample is a Gaussian N((x, y), σ²). P(true gaze in region) = (mask * G_σ)(x, y). Dwell = Σ P·dt.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import cv2
import numpy as np

from .masks import Mask, point_in


def quantize_sigma(sigma: float, bins: tuple[float, ...]) -> float:
    """Smallest bin ≥ σ (so uncertainty is never understated); the largest bin for anything bigger."""
    for b in bins:
        if sigma <= b:
            return float(b)
    return float(bins[-1])


class BlurCache:
    """Blurred-mask cache keyed by (region key, σ bin). Masks are float32 in [0, 1]."""

    def __init__(self, bins: tuple[float, ...]):
        self.bins = bins
        self._cache: dict[tuple[str, float], np.ndarray] = {}

    def get(self, key: str, mask: Mask, sigma: float) -> tuple[np.ndarray, float]:
        b = quantize_sigma(sigma, self.bins)
        k = (key, b)
        if k not in self._cache:
            m = mask.astype(np.float32)
            self._cache[k] = cv2.GaussianBlur(m, (0, 0), b, borderType=cv2.BORDER_CONSTANT) if b > 0 else m
        return self._cache[k], b


@dataclass
class RegionDwell:
    prob_ms: float  # Σ P·dt
    point_ms: float  # plain point-hit dwell
    median_sigma_px: float  # time-weighted median σ of samples that touch the region (P ≥ 0.05), else overall
    first_touch_ms: float | None  # first t with P ≥ 0.5 (or point hit)
    n_touch: int


def region_dwell(
    samples: list[dict[str, Any]], key: str, mask: Mask, cache: BlurCache, max_dt_ms: float
) -> RegionDwell:
    prob, point = 0.0, 0.0
    touch_w: list[tuple[float, float]] = []  # (σ, dt)
    all_w: list[tuple[float, float]] = []
    first: float | None = None
    h, w = mask.shape
    for s0, s1 in zip(samples, samples[1:] + [None], strict=False):
        dt = min(s1["t"] - s0["t"], max_dt_ms) if s1 is not None else min(33.0, max_dt_ms)
        if dt <= 0:
            continue
        x, y, sig = s0["x"], s0["y"], float(s0.get("sigma", 0.0))
        xi, yi = int(round(x)), int(round(y))
        if not (0 <= xi < w and 0 <= yi < h):
            continue
        blurred, _ = cache.get(key, mask, sig)
        p = float(blurred[yi, xi])
        prob += p * dt
        hit = point_in(mask, x, y)
        if hit:
            point += dt
        all_w.append((sig, dt))
        if p >= 0.05:
            touch_w.append((sig, dt))
        if first is None and (p >= 0.5 or hit):
            first = s0["t"]
    return RegionDwell(
        prob_ms=prob,
        point_ms=point,
        median_sigma_px=_wmedian(touch_w or all_w),
        first_touch_ms=first,
        n_touch=len(touch_w),
    )


def _wmedian(pairs: list[tuple[float, float]]) -> float:
    if not pairs:
        return float("inf")
    arr = sorted(pairs)
    total = sum(w for _, w in arr)
    acc = 0.0
    for v, w in arr:
        acc += w
        if acc >= total / 2:
            return float(v)
    return float(arr[-1][0])


def resolution_tier(median_sigma_px: float, lesion_sigma_max: float, zone_sigma_max: float) -> str:
    if median_sigma_px <= lesion_sigma_max:
        return "lesion"
    if median_sigma_px <= zone_sigma_max:
        return "zone"
    return "none"


@lru_cache(maxsize=256)
def equivalent_radius(area_px: int) -> float:
    return float(np.sqrt(area_px / np.pi))
