"""Glue: scoring + cursor analysis (+ gaze analysis and facts once G3 lands) for one attempt and the session summary."""

from __future__ import annotations

from typing import Any

from .config import mock_cfg
from .scoring import review_area_cursor_dwell, score


def analyse_attempt(
    case: dict,
    marks: list[dict],
    normal: bool,
    globals_: list[str],
    telemetry: list[dict],
    gaze: list[dict] | None,
    gaze_meta: dict | None,
    session: dict,
    read_ms: float | None,
) -> dict[str, Any]:
    cfg = mock_cfg()
    sc = score(case, marks, normal, globals_, telemetry)
    ra_cursor = review_area_cursor_dwell(case, telemetry)
    visit_ms = cfg["review_areas"]["visit_ms"]
    review_areas = [
        {
            "zone": zid,
            "human": cfg["zones"][zid],
            "hardness": hard,
            "cursor_dwell_ms": ra_cursor.get(zid, 0.0),
            "visited_cursor": ra_cursor.get(zid, 0.0) >= visit_ms,
            "visit_threshold_ms": visit_ms,
            "reference": "review_area_checklist",
        }
        for zid, hard in sorted(cfg["review_areas"]["hardness"].items(), key=lambda kv: -kv[1])
    ]
    total_ms = read_ms if read_ms is not None else (telemetry[-1]["t"] if telemetry else 0)
    return {
        "scoring": sc,
        "review_areas": review_areas,
        "attention": {"sources": ["cursor"], "supports": "cursor_only"},
        "total_read_ms": total_ms,
        "synthetic": session.get("synthetic", True),
        "gaze_used": False,
    }


def session_summary(session: dict) -> dict:
    cfg = mock_cfg()
    unvisited: dict[str, int] = {}
    miss_types: dict[str, dict[str, int]] = {"cursor": {}, "gaze": {}}
    for a in session["attempts"]:
        r = a["result"]
        for ra in r.get("review_areas", []):
            if not ra.get("visited_cursor"):
                unvisited[ra["zone"]] = unvisited.get(ra["zone"], 0) + 1
        for f in r["scoring"]["findings"]:
            if f.get("cursor_miss_type"):
                miss_types["cursor"][f["cursor_miss_type"]] = (
                    miss_types["cursor"].get(f["cursor_miss_type"], 0) + 1
                )
            gm = f.get("gaze_miss_type")
            if gm:
                miss_types["gaze"][gm] = miss_types["gaze"].get(gm, 0) + 1
    return {
        "n_cases": len(session["attempts"]),
        "synthetic": session.get("synthetic", True),
        "name": session["name"],
        "review_area_unvisited": dict(sorted(unvisited.items(), key=lambda kv: -kv[1])),
        "review_area_human": {z: cfg["zones"][z] for z in unvisited},
        "miss_types": miss_types,
        "gaze": bool(session.get("gaze_meta")),
    }
