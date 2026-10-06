"""Step 9: heatmaps. Gaussian splats with per-sample σ (gaze) or a fixed σ (cursor) → size×size PNG (base64)."""

from __future__ import annotations

import base64
from typing import Any

import cv2
import numpy as np


def heatmap_png(
    samples: list[dict[str, Any]],
    img_w: int,
    img_h: int,
    size: int = 256,
    fixed_sigma_px: float | None = None,
    max_dt_ms: float = 250,
) -> str:
    acc = np.zeros((size, size), np.float32)
    k = size / max(img_w, img_h)
    pts = [s for s in samples if s.get("x") is not None and s.get("y") is not None]
    # group by quantised σ so one blur per group instead of one per sample
    groups: dict[int, np.ndarray] = {}
    for s0, s1 in zip(pts, pts[1:] + [None], strict=False):
        dt = min((s1["t"] - s0["t"]) if s1 else 33.0, max_dt_ms)
        sig = fixed_sigma_px if fixed_sigma_px is not None else float(s0.get("sigma", 40.0))
        key = int(max(1, round(sig * k / 2) * 2))
        g = groups.setdefault(key, np.zeros((size, size), np.float32))
        xi, yi = int(s0["x"] * k), int(s0["y"] * k)
        if 0 <= xi < size and 0 <= yi < size:
            g[yi, xi] += dt
    for key, g in groups.items():
        acc += cv2.GaussianBlur(g, (0, 0), key)
    if acc.max() > 0:
        acc /= acc.max()
    rgba = np.zeros((size, size, 4), np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = 240, 169, 46  # amber, alpha = intensity
    rgba[..., 3] = (np.sqrt(acc) * 230).astype(np.uint8)
    ok, buf = cv2.imencode(".png", cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
    return base64.b64encode(buf.tobytes()).decode() if ok else ""
