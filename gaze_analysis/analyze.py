"""Orchestrator: samples + telemetry + masks + config → everything the mock (or Blindspot) needs for one case."""

from __future__ import annotations

from typing import Any

from .agreement import gaze_cursor_agreement, visited_agreement
from .clean import clean
from .config import GazeAnalysisConfig
from .coverage import coverage
from .cursor_proxy import CursorDwellConfig, dwell_ms, miss_type
from .dwell import BlurCache, region_dwell, resolution_tier
from .fixations import dispersion_threshold_px, idt
from .heatmap import heatmap_png
from .masks import Mask
from .miss_types import gaze_miss_type
from .scanpath import scanpath_facts, zone_of


def analyze_case(
    *,
    gaze: list[dict[str, Any]] | None,
    gaze_meta: dict[str, Any] | None,
    telemetry: list[dict[str, Any]],
    zones: dict[str, Mask],
    rois: dict[str, Mask],
    finding_info: dict[str, dict],
    cfg: GazeAnalysisConfig,
    cursor_cfg: CursorDwellConfig,
    img_w: int,
    img_h: int,
    fit_scale: float,
    submit_ms: float,
    first_mark_ms: float | None,
    heatmaps: bool = True,
) -> dict[str, Any]:
    """finding_info: finding_id -> {label, zone, outcome}. Returns a dict (see keys below)."""
    out: dict[str, Any] = {"gaze_used": False}
    hard = cfg.review_hardness
    # ---- cursor (always)
    cursor_ra = {z: dwell_ms(telemetry, zones[z], cursor_cfg) for z in hard if z in zones}
    cursor_cov = coverage(cursor_ra, hard, cfg.visit_ms, cfg.hard_min)
    cursor_find = {fid: dwell_ms(telemetry, rois[fid], cursor_cfg) for fid in rois}
    out["cursor"] = {
        "review_dwell_ms": cursor_ra,
        "coverage": cursor_cov,
        "finding_dwell_ms": cursor_find,
        "finding_miss_type": {fid: miss_type(d, _bands(cfg)) for fid, d in cursor_find.items()},
    }
    # cursor "scanpath" from telemetry positions (for the timeline and first/last zone when gaze is absent)
    cur_pts = [
        {"t": e["t"], "sx": e["x"], "sy": e["y"], "x": e["x"], "y": e["y"], "sigma": 0.0}
        for e in telemetry
        if e.get("x") is not None
    ]
    cur_fix = idt(cur_pts, 24.0, cfg.fixation_min_duration_ms) if cur_pts else []
    out["cursor"]["scanpath"] = scanpath_facts(cur_fix, zones, rois, first_mark_ms, submit_ms, "cursor")
    out["cursor"]["timeline"] = _timeline(cur_pts, zones, hard, cfg.max_dt_ms, point_only=True)
    if heatmaps and cur_pts:
        out["cursor"]["heatmap_png"] = heatmap_png(
            cur_pts, img_w, img_h, cfg.heatmap_size, fixed_sigma_px=20.0, max_dt_ms=cfg.max_dt_ms
        )

    # ---- gaze (when present)
    if not gaze:
        return out
    samples, gaps, stats = clean(gaze, cfg.max_gap_ms, cfg.median_window)
    out["gaze"] = {"stats": stats, "gaps": gaps}
    if len(samples) < 5:
        return out
    out["gaze_used"] = True
    precision = (gaze_meta or {}).get("validation", {}).get("precision_px")
    disp = dispersion_threshold_px(cfg.fixation_min_dispersion_px, cfg.fixation_dispersion_k, precision)
    fix = idt(samples, disp, cfg.fixation_min_duration_ms)
    cache = BlurCache(cfg.sigma_bins_px)
    ra = {z: region_dwell(samples, f"zone:{z}", zones[z], cache, cfg.max_dt_ms) for z in hard if z in zones}
    gaze_ra = {z: rd.prob_ms for z, rd in ra.items()}
    gaze_cov = coverage(gaze_ra, hard, cfg.visit_ms, cfg.hard_min)
    fr = {fid: region_dwell(samples, f"roi:{fid}", rois[fid], cache, cfg.max_dt_ms) for fid in rois}
    gaze_find = {
        fid: gaze_miss_type(
            rd,
            int(rois[fid].sum()),
            cfg.recognition_from_ms,
            cfg.decision_from_ms,
            cfg.lesion_sigma_max,
            cfg.zone_sigma_max,
        )
        for fid, rd in fr.items()
    }
    ag = gaze_cursor_agreement(samples, telemetry, cfg.agreement_max_lag_ms, cfg.agreement_lag_step_ms)
    va = visited_agreement(cursor_cov["visited"], gaze_cov["visited"])
    acc_px = (gaze_meta or {}).get("validation", {}).get("accuracy_px", 0.0)
    out["gaze"].update(
        {
            "fixations": [
                {
                    "t_start": f.t_start,
                    "t_end": f.t_end,
                    "sx": f.sx,
                    "sy": f.sy,
                    "x": f.x,
                    "y": f.y,
                    "sigma": f.sigma,
                    "zone": zone_of(zones, f.x, f.y) if f.x is not None else None,
                }
                for f in fix
            ],
            "dispersion_px": disp,
            "review_dwell_ms": gaze_ra,
            "review_point_dwell_ms": {z: rd.point_ms for z, rd in ra.items()},
            "review_resolution": {
                z: resolution_tier(rd.median_sigma_px, cfg.lesion_sigma_max, cfg.zone_sigma_max)
                for z, rd in ra.items()
            },
            "coverage": gaze_cov,
            "finding": gaze_find,
            "scanpath": scanpath_facts(fix, zones, rois, first_mark_ms, submit_ms, "gaze"),
            "timeline": _timeline(samples, zones, hard, cfg.max_dt_ms, cache=cache),
            "agreement": ag
            | {
                "review_area_visited_agreement_pct": va["pct"],
                "review_area_kappa": va["kappa"],
                "review_area_n": va["n"],
            },
            "quality": (gaze_meta or {}).get("quality_tier", "poor"),
            # what the session actually achieved at fit zoom: time-weighted median σ of samples recorded at zoom ≈ 1
            "accuracy_img_px_at_fit": _median(
                [float(s["sigma"]) for s in samples if s.get("zoom", 1.0) <= 1.05 and s.get("sigma")]
            )
            or ((acc_px / fit_scale) if fit_scale else None),
        }
    )
    if heatmaps:
        out["gaze"]["heatmap_png"] = heatmap_png(
            samples, img_w, img_h, cfg.heatmap_size, max_dt_ms=cfg.max_dt_ms
        )
    return out


def _median(xs: list[float]) -> float | None:
    if not xs:
        return None
    xs = sorted(xs)
    return float(xs[len(xs) // 2])


def _bands(cfg: GazeAnalysisConfig):
    from .cursor_proxy import MissTypeBands

    return MissTypeBands(cfg.recognition_from_ms, cfg.decision_from_ms)


def _timeline(
    samples: list[dict],
    zones: dict[str, Mask],
    hard: dict[str, float],
    max_dt_ms: float,
    cache: BlurCache | None = None,
    point_only: bool = False,
    bin_ms: float = 250,
) -> dict:
    """Per review-area (plus 'other_lung') presence per time bin, for the zone-timeline view. Values 0..1 = fraction of bin."""
    if not samples:
        return {"bin_ms": bin_ms, "rows": {}}
    t_end = samples[-1]["t"] + 33
    nb = int(t_end // bin_ms) + 1
    extra = [
        z for z in ("cardiac_silhouette",) if z in zones
    ]  # shown on its own row; everything else non-review → other_lung
    rows = {z: [0.0] * nb for z in list(hard) + extra + ["other_lung"]}
    from .masks import point_in

    for s0, s1 in zip(samples, samples[1:] + [None], strict=False):
        dt = min((s1["t"] - s0["t"]) if s1 else 33.0, max_dt_ms)
        b = int(s0["t"] // bin_ms)
        if b >= nb:
            continue
        placed = False
        for z in hard:
            m = zones.get(z)
            if m is None:
                continue
            if point_only or cache is None:
                p = 1.0 if point_in(m, s0["x"], s0["y"]) else 0.0
            else:
                blurred, _ = cache.get(f"zone:{z}", m, float(s0.get("sigma", 0.0)))
                xi, yi = int(round(s0["x"])), int(round(s0["y"]))
                p = float(blurred[yi, xi]) if 0 <= yi < m.shape[0] and 0 <= xi < m.shape[1] else 0.0
            if p > 0.05:
                rows[z][b] += p * dt / bin_ms
                placed = placed or p >= 0.5
        if not placed:
            z = zone_of(zones, s0["x"], s0["y"])
            if z is not None and z not in hard:
                rows[z if z in extra else "other_lung"][b] += dt / bin_ms
    return {"bin_ms": bin_ms, "rows": {z: [round(min(1.0, v), 3) for v in vals] for z, vals in rows.items()}}
