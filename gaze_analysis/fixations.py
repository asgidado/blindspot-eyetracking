"""Step 2: I-DT fixation detection on screen px. At ~30 Hz saccades cannot be resolved, so none are reported."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np


@dataclass
class Fixation:
    t_start: float
    t_end: float
    sx: float
    sy: float
    x: float | None  # image px (mean), None if any sample lacked image coords
    y: float | None
    sigma: float  # median image-px sigma over the fixation
    n: int

    @property
    def duration_ms(self) -> float:
        return self.t_end - self.t_start


def dispersion_threshold_px(min_dispersion_px: float, k: float, precision_px: float | None) -> float:
    return max(min_dispersion_px, k * (precision_px or 0.0))


def idt(samples: list[dict[str, Any]], dispersion_px: float, min_duration_ms: float) -> list[Fixation]:
    """Classic I-DT (Salvucci & Goldberg 2000). `samples` sorted by t with sx, sy; image x/y optional."""
    out: list[Fixation] = []
    i, n = 0, len(samples)
    while i < n:
        j = i
        # grow the window until it covers min_duration
        while j < n and samples[j]["t"] - samples[i]["t"] < min_duration_ms:
            j += 1
        if j >= n:
            break
        win = samples[i : j + 1]
        if _disp(win) <= dispersion_px:
            while j + 1 < n and _disp(samples[i : j + 2]) <= dispersion_px:
                j += 1
            out.append(_make(samples[i : j + 1]))
            i = j + 1
        else:
            i += 1
    return out


def _disp(win: list[dict]) -> float:
    xs = [s["sx"] for s in win]
    ys = [s["sy"] for s in win]
    return (max(xs) - min(xs)) + (max(ys) - min(ys))


def _make(win: list[dict]) -> Fixation:
    has_img = all(s.get("x") is not None and s.get("y") is not None for s in win)
    return Fixation(
        t_start=win[0]["t"],
        t_end=win[-1]["t"],
        sx=float(np.mean([s["sx"] for s in win])),
        sy=float(np.mean([s["sy"] for s in win])),
        x=float(np.mean([s["x"] for s in win])) if has_img else None,
        y=float(np.mean([s["y"] for s in win])) if has_img else None,
        sigma=float(np.median([s.get("sigma", 0.0) for s in win])),
        n=len(win),
    )
