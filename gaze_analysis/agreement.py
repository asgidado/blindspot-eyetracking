"""Step 8: cursor–gaze agreement. Distances by cursor state, gaze-leads-cursor lag, visited agreement and Cohen's κ."""

from __future__ import annotations

from typing import Any

import numpy as np


def _cursor_track(events: list[dict[str, Any]]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """t, x, y, loupe for events with image coords, sorted."""
    ev = sorted(
        (e for e in events if e.get("x") is not None and e.get("y") is not None), key=lambda e: e["t"]
    )
    if not ev:
        return np.array([]), np.array([]), np.array([]), np.array([])
    return (
        np.array([e["t"] for e in ev], float),
        np.array([e["x"] for e in ev], float),
        np.array([e["y"] for e in ev], float),
        np.array([bool(e.get("loupe")) for e in ev]),
    )


def _interp(
    t: np.ndarray, ct: np.ndarray, cx: np.ndarray, cy: np.ndarray, max_hold_ms: float = 400
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Cursor position at times t (step-hold to the last known event ≤ t, valid only within max_hold_ms)."""
    idx = np.searchsorted(ct, t, side="right") - 1
    ok = idx >= 0
    idx = np.clip(idx, 0, len(ct) - 1)
    ok &= (t - ct[idx]) <= max_hold_ms
    return cx[idx], cy[idx], ok


def gaze_cursor_agreement(
    gaze: list[dict[str, Any]],
    events: list[dict[str, Any]],
    max_lag_ms: float,
    lag_step_ms: float,
    idle_ms: float = 300,
) -> dict:
    g = [s for s in gaze if s.get("x") is not None and s.get("y") is not None]
    ct, cx, cy, cl = _cursor_track(events)
    out: dict[str, Any] = {
        "n_samples": len(g),
        "median_px": {"idle": None, "moving": None, "loupe": None, "all": None},
        "gaze_leads_cursor_ms": None,
    }
    if len(g) < 5 or len(ct) < 2:
        return out
    gt = np.array([s["t"] for s in g], float)
    gx = np.array([s["x"] for s in g], float)
    gy = np.array([s["y"] for s in g], float)
    px, py, ok = _interp(gt, ct, cx, cy)
    d = np.hypot(gx - px, gy - py)
    # cursor state at each gaze sample: moving if a move event (position change) occurred within idle_ms before t
    move_t = ct[1:][(np.abs(np.diff(cx)) + np.abs(np.diff(cy))) > 1.0]
    j = np.searchsorted(move_t, gt, side="right") - 1
    moving = (
        (j >= 0) & ((gt - move_t[np.clip(j, 0, max(0, len(move_t) - 1))]) <= idle_ms)
        if len(move_t)
        else np.zeros(len(gt), bool)
    )
    li = np.searchsorted(ct, gt, side="right") - 1
    loupe = cl[np.clip(li, 0, len(cl) - 1)] & (li >= 0)
    med = lambda m: float(np.median(d[m])) if m.any() else None  # noqa: E731
    out["median_px"] = {
        "idle": med(ok & ~moving),
        "moving": med(ok & moving),
        "loupe": med(ok & loupe),
        "all": med(ok),
    }
    out["n_matched"] = int(ok.sum())
    # lag: shift cursor by +lag (cursor at t+lag vs gaze at t); best lag > 0 means the cursor lags gaze.
    # Objective = mean clipped distance (the median is flat for step-like paths and picks arbitrary lags).
    lags = np.arange(-max_lag_ms, max_lag_ms + 1, lag_step_ms)
    best, best_lag, best_med = None, None, None
    for lag in lags:
        qx, qy, qok = _interp(gt + lag, ct, cx, cy)
        if qok.sum() < max(5, 0.5 * ok.sum()):
            continue
        dd = np.hypot(gx - qx, gy - qy)[qok]
        m = float(np.mean(np.minimum(dd, 500.0)))
        if best is None or m < best:
            best, best_lag, best_med = m, float(lag), float(np.median(dd))
    # report a lag only when shifting clearly helps (≥ 10 % lower objective than lag 0); otherwise the series are too
    # weakly related for the number to mean anything
    qx0, qy0, qok0 = _interp(gt, ct, cx, cy)
    base = float(np.mean(np.minimum(np.hypot(gx - qx0, gy - qy0)[qok0], 500.0))) if qok0.sum() >= 5 else None
    meaningful = best is not None and base is not None and best < 0.9 * base
    out["gaze_leads_cursor_ms"] = best_lag if meaningful else None
    out["median_px_at_best_lag"] = best_med if meaningful else None
    out["lag_note"] = (
        None
        if meaningful
        else "lag not reported: shifting the cursor in time does not reduce the gaze–cursor distance"
    )

    return out


def visited_agreement(a: dict[str, bool], b: dict[str, bool]) -> dict:
    """% agreement and Cohen's κ over the shared keys."""
    keys = sorted(set(a) & set(b))
    n = len(keys)
    if n == 0:
        return {"n": 0, "pct": None, "kappa": None}
    agree = sum(a[k] == b[k] for k in keys)
    pa = agree / n
    p_yes = (sum(a[k] for k in keys) / n) * (sum(b[k] for k in keys) / n)
    p_no = (sum(not a[k] for k in keys) / n) * (sum(not b[k] for k in keys) / n)
    pe = p_yes + p_no
    kappa = None if pe == 1 else (pa - pe) / (1 - pe)
    return {"n": n, "pct": round(100 * pa, 1), "kappa": None if kappa is None else round(kappa, 3)}


def confusion(
    pairs: list[tuple[str, str]], labels: tuple[str, ...] = ("search", "recognition", "decision")
) -> dict:
    """Miss-type confusion matrix (rows cursor, cols gaze) with % agreement and κ. pairs = (cursor, gaze)."""
    n = len(pairs)
    mat = {r: {c: 0 for c in labels} for r in labels}
    for r, c in pairs:
        if r in mat and c in mat[r]:
            mat[r][c] += 1
    if n == 0:
        return {"n": 0, "matrix": mat, "pct": None, "kappa": None}
    agree = sum(mat[k][k] for k in labels)
    pa = agree / n
    pe = sum((sum(mat[k].values()) / n) * (sum(mat[r][k] for r in labels) / n) for k in labels)
    kappa = None if pe == 1 else (pa - pe) / (1 - pe)
    return {
        "n": n,
        "matrix": mat,
        "pct": round(100 * pa, 1),
        "kappa": None if kappa is None else round(kappa, 3),
    }
