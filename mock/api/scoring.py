"""Score a read against the case's findings: Hungarian matching on ROI hits, outcomes, cursor-proxy miss types."""

from __future__ import annotations

import numpy as np
from scipy.optimize import linear_sum_assignment

from gaze_analysis.cursor_proxy import CursorDwellConfig, MissTypeBands, dwell_ms, miss_type

from .cases import masks_for
from .config import mock_cfg


def score(case: dict, marks: list[dict], normal: bool, globals_: list[str], telemetry: list[dict]) -> dict:
    cfg = mock_cfg()
    m = masks_for(case["id"])
    dcfg = CursorDwellConfig(**cfg["cursor_dwell"])
    bands = MissTypeBands(cfg["miss_types"]["recognition_from_ms"], cfg["miss_types"]["decision_from_ms"])
    findings = case["findings"]
    marks = [] if normal else marks

    # cost matrix: distance to finding centre if the mark lands in the ROI, else unmatched
    big = 1e9
    cost = np.full((len(marks), len(findings)), big)
    for i, mk in enumerate(marks):
        for j, f in enumerate(findings):
            roi = m["rois"][f["finding_id"]]
            x, y = int(mk["x"]), int(mk["y"])
            if 0 <= y < roi.shape[0] and 0 <= x < roi.shape[1] and roi[y, x]:
                bx = f["bbox"]
                cost[i, j] = np.hypot(mk["x"] - (bx[0] + bx[2]) / 2, mk["y"] - (bx[1] + bx[3]) / 2)
    matched: dict[int, int] = {}
    if len(marks) and len(findings):
        ri, ci = linear_sum_assignment(cost)
        matched = {int(j): int(i) for i, j in zip(ri, ci, strict=True) if cost[i, j] < big}

    outcomes = []
    for j, f in enumerate(findings):
        d = dwell_ms(telemetry, m["rois"][f["finding_id"]], dcfg)
        o = {
            "finding_id": f["finding_id"],
            "label": f["label"],
            "zone": f["zone"],
            "cursor_dwell_ms": round(d, 1),
        }
        if j in matched:
            mk = marks[matched[j]]
            o["outcome"] = "found" if mk.get("label") == f["label"] else "mislabeled"
            o["mark"] = mk
            o["cursor_miss_type"] = None
        else:
            o["outcome"] = "missed"
            o["cursor_miss_type"] = miss_type(d, bands)
        outcomes.append(o)
    overcalls = [
        {"mark": mk, "outcome": "overcall"} for i, mk in enumerate(marks) if i not in matched.values()
    ]
    case_globals = set(case.get("global_findings", []))
    global_out = {
        "found": sorted(case_globals & set(globals_)),
        "missed": sorted(case_globals - set(globals_)),
        "overcall": sorted(set(globals_) - case_globals),
    }
    n_found = sum(o["outcome"] == "found" for o in outcomes)
    return {
        "findings": outcomes,
        "overcalls": overcalls,
        "globals": global_out,
        "called_normal": normal,
        "truly_normal": not findings and not case_globals,
        "summary": {
            "n_findings": len(findings),
            "n_found": n_found,
            "n_mislabeled": sum(o["outcome"] == "mislabeled" for o in outcomes),
            "n_missed": sum(o["outcome"] == "missed" for o in outcomes),
            "n_overcalls": len(overcalls),
        },
        "roi_px": round(m["rho"], 1),
        "bands_ms": {"recognition_from": bands.recognition_from_ms, "decision_from": bands.decision_from_ms},
    }


def review_area_cursor_dwell(case: dict, telemetry: list[dict]) -> dict[str, float]:
    cfg = mock_cfg()
    m = masks_for(case["id"])
    dcfg = CursorDwellConfig(**cfg["cursor_dwell"])
    return {
        zid: round(dwell_ms(telemetry, m["zones"][zid], dcfg), 1)
        for zid in cfg["review_areas"]["hardness"]
        if zid in m["zones"]
    }
