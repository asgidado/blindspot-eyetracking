"""Step 1: drop invalid samples, median-filter positions over N samples, flag gaps."""

from __future__ import annotations

from typing import Any

import numpy as np

Sample = dict[str, Any]


def clean(
    samples: list[Sample], max_gap_ms: float, median_window: int = 3
) -> tuple[list[Sample], list[tuple[float, float]], dict]:
    """Returns (clean samples with image coords, gaps as (t0, t1), stats). Samples keep their original keys."""
    n_total = len(samples)
    valid = [s for s in samples if s.get("valid") and s.get("x") is not None and s.get("y") is not None]
    valid.sort(key=lambda s: s["t"])
    if len(valid) >= median_window and median_window > 1:
        xs = np.array([s["x"] for s in valid], float)
        ys = np.array([s["y"] for s in valid], float)
        k = median_window // 2
        fx, fy = xs.copy(), ys.copy()
        for i in range(k, len(xs) - k):
            fx[i] = np.median(xs[i - k : i + k + 1])
            fy[i] = np.median(ys[i - k : i + k + 1])
        valid = [dict(s, x=float(fx[i]), y=float(fy[i])) for i, s in enumerate(valid)]
    gaps = [(a["t"], b["t"]) for a, b in zip(valid, valid[1:], strict=False) if b["t"] - a["t"] > max_gap_ms]
    on_ui = sum(1 for s in samples if s.get("target") == "ui")
    stats = {
        "n_total": n_total,
        "n_valid": len(valid),
        "n_invalid": n_total - len(valid),
        "n_on_ui": on_ui,
        "loss_pct": round(100 * (n_total - len(valid)) / n_total, 1) if n_total else 100.0,
        "n_gaps": len(gaps),
        "gap_ms_total": round(sum(b - a for a, b in gaps), 1),
    }
    return valid, gaps, stats
