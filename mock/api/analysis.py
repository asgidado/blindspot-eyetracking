"""Glue between the mock and the portable gaze_analysis package: scoring + cursor + gaze → facts, debrief, replay data."""

from __future__ import annotations

from typing import Any

from gaze_analysis.agreement import confusion
from gaze_analysis.analyze import analyze_case
from gaze_analysis.config import GazeAnalysisConfig
from gaze_analysis.cursor_proxy import CursorDwellConfig
from gaze_analysis.facts import build_facts, to_prompt_text

from .cases import masks_for
from .config import gaze_cfg, mock_cfg
from .debrief import facts_card, template_debrief
from .scoring import score


def analysis_cfg() -> GazeAnalysisConfig:
    m = mock_cfg()
    return GazeAnalysisConfig.from_yaml_dicts(
        gaze_cfg(),
        m["review_areas"]["hardness"],
        m["zones"],
        m["review_areas"]["visit_ms"],
        m["miss_types"]["recognition_from_ms"],
        m["miss_types"]["decision_from_ms"],
    )


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
    mcfg = mock_cfg()
    cfg = analysis_cfg()
    m = masks_for(case["id"])
    sc = score(case, marks, normal, globals_, telemetry)
    total_ms = read_ms if read_ms is not None else (telemetry[-1]["t"] if telemetry else 0)
    first_mark_ms = min((mk["t"] for mk in marks if mk.get("t") is not None), default=None)
    # fit scale for a typical stage (rail 380 px, header/footer 80 px) — the client reports accuracy in screen px
    fit_scale = min(
        (mcfg.get("viewer", {}).get("ref_stage_h", 820)) / case["height"],
        (mcfg.get("viewer", {}).get("ref_stage_w", 1060)) / case["width"],
    )
    finding_info = {
        f["finding_id"]: {
            "label": f["label"],
            "zone": f["zone"],
            "outcome": next(o["outcome"] for o in sc["findings"] if o["finding_id"] == f["finding_id"]),
        }
        for f in case["findings"]
    }
    an = analyze_case(
        gaze=gaze,
        gaze_meta=gaze_meta,
        telemetry=telemetry,
        zones=m["zones"],
        rois=m["rois"],
        finding_info=finding_info,
        cfg=cfg,
        cursor_cfg=CursorDwellConfig(**mcfg["cursor_dwell"]),
        img_w=case["width"],
        img_h=case["height"],
        fit_scale=fit_scale,
        submit_ms=total_ms,
        first_mark_ms=first_mark_ms,
    )
    gaze_used = an["gaze_used"]
    g = an.get("gaze", {})
    zh = mcfg["zones"]
    hard = mcfg["review_areas"]["hardness"]
    visit_ms = mcfg["review_areas"]["visit_ms"]

    review_areas = []
    for zid, h in sorted(hard.items(), key=lambda kv: -kv[1]):
        cd = an["cursor"]["review_dwell_ms"].get(zid, 0.0)
        ra = {
            "zone": zid,
            "human": zh[zid],
            "hardness": h,
            "cursor_dwell_ms": round(cd),
            "visited_cursor": cd >= visit_ms,
            "visit_threshold_ms": visit_ms,
            "reference": "review_area_checklist",
        }
        if gaze_used:
            gd = g["review_dwell_ms"].get(zid, 0.0)
            ra |= {
                "gaze_dwell_ms": round(gd),
                "gaze_resolution": g["review_resolution"].get(zid, "none"),
                "visited_gaze": gd >= visit_ms,
            }
        review_areas.append(ra)
    coverage = {
        "cursor_weighted_pct": an["cursor"]["coverage"]["weighted_pct"],
        "unvisited_hard_cursor": an["cursor"]["coverage"]["unvisited_hard"],
    }
    if gaze_used:
        coverage |= {
            "gaze_weighted_pct": g["coverage"]["weighted_pct"],
            "unvisited_hard_gaze": g["coverage"]["unvisited_hard"],
        }

    findings = []
    for o in sc["findings"]:
        fid = o["finding_id"]
        f = {
            "finding_id": fid,
            "label": o["label"],
            "location": zh.get(o["zone"], o["zone"]),
            "outcome": o["outcome"],
            "cursor": {"dwell_ms": round(o["cursor_dwell_ms"]), "miss_type": o["cursor_miss_type"]},
        }
        if gaze_used:
            gf = g["finding"][fid]
            f["gaze"] = {
                "dwell_ms": gf["dwell_ms"],
                "resolution": gf["resolution"],
                "miss_type": gf["miss_type"],
                "miss_type_confidence": gf["confidence"],
                "time_to_first_ms": gf["time_to_first_ms"],
                **({"sigma_px": gf["sigma_px"]} if gf["sigma_px"] is not None else {}),
            }
            f["agreement"] = (
                "n/a"
                if o["outcome"] != "missed" or gf["miss_type"] is None
                else ("agree" if gf["miss_type"] == o["cursor_miss_type"] else "disagree")
            )
            o["gaze"] = f["gaze"]
            o["gaze_miss_type"] = gf["miss_type"]
        findings.append(f)

    quality = gaze_meta.get("quality_tier") if (gaze_used and gaze_meta) else None
    if gaze_used and quality in ("good", "coarse"):
        lesion_any = any(f.get("gaze", {}).get("resolution") == "lesion" for f in findings)
        supports = "lesion_level" if (quality == "good" and lesion_any) else "zone_level"
    else:
        supports = "cursor_only"
    search_src = "gaze" if gaze_used and quality != "poor" else "cursor"
    search = g["scanpath"] if search_src == "gaze" else an["cursor"]["scanpath"]
    agreement = None
    if gaze_used:
        ag = g["agreement"]
        agreement = {
            "n_samples": ag["n_samples"],
            "median_gaze_cursor_px": {
                k: (None if v is None else round(v)) for k, v in ag["median_px"].items()
            },
            "gaze_leads_cursor_ms": ag["gaze_leads_cursor_ms"],
            "review_area_visited_agreement_pct": ag["review_area_visited_agreement_pct"],
            "review_area_kappa": ag["review_area_kappa"],
        }
    history = _history(session, zh)
    facts = build_facts(
        phase="post_submit",
        synthetic=bool(session.get("synthetic", True)),
        zone_human=zh,
        total_read_ms=total_ms,
        first_mark_ms=first_mark_ms,
        search=search,
        search_source=search_src,
        review_areas=review_areas,
        coverage=coverage,
        findings=findings,
        agreement=agreement,
        history=history,
        gaze_quality=quality,
        gaze_accuracy_img_px_at_fit=g.get("accuracy_img_px_at_fit") if gaze_used else None,
        supports=supports,
        bands=(mcfg["miss_types"]["recognition_from_ms"], mcfg["miss_types"]["decision_from_ms"]),
    )
    from shared.schemas.loader import validate

    validate("GazeFacts", facts)
    text = to_prompt_text(facts)
    replay = {
        "bin_ms": an["cursor"]["timeline"]["bin_ms"],
        "total_ms": total_ms,
        "rows": [
            {"zone": zid, "human": zh[zid], "hardness": h}
            for zid, h in sorted(hard.items(), key=lambda kv: -kv[1])
        ]
        + [{"zone": "other_lung", "human": "other lung zones", "hardness": 0}],
        "cursor_rows": an["cursor"]["timeline"]["rows"],
        "gaze_rows": g.get("timeline", {}).get("rows") if gaze_used else None,
        "fixations": g.get("fixations", []) if gaze_used else [],
        "cursor_fixations": [],
        "marks_ms": [mk["t"] for mk in marks if mk.get("t") is not None],
        "submit_ms": total_ms,
        "heatmap_gaze_png": g.get("heatmap_png") if gaze_used else None,
        "heatmap_cursor_png": an["cursor"].get("heatmap_png"),
        "gaze_stats": g.get("stats"),
        "dispersion_px": g.get("dispersion_px"),
    }
    return {
        "scoring": sc,
        "review_areas": review_areas,
        "coverage": coverage,
        "attention": facts["attention"],
        "total_read_ms": total_ms,
        "synthetic": bool(session.get("synthetic", True)),
        "gaze_used": gaze_used,
        "gaze_stats": g.get("stats"),
        "facts": facts,
        "facts_text": text,
        "facts_bytes": len(__import__("json").dumps(facts, separators=(",", ":"))),
        "facts_card": facts_card(facts, sc),
        "debrief": template_debrief(facts, sc),
        "replay": replay,
    }


def _history(session: dict, zh: dict[str, str]) -> dict:
    unvisited: dict[str, int] = {}
    mt: dict[str, dict[str, int]] = {"cursor": {}, "gaze": {}}
    for a in session.get("attempts", []):
        r = a.get("result", {})
        for ra in r.get("review_areas", []):
            key = "visited_gaze" if "visited_gaze" in ra else "visited_cursor"
            if not ra.get(key):
                unvisited[ra["zone"]] = unvisited.get(ra["zone"], 0) + 1
        for f in r.get("scoring", {}).get("findings", []):
            if f.get("cursor_miss_type"):
                mt["cursor"][f["cursor_miss_type"]] = mt["cursor"].get(f["cursor_miss_type"], 0) + 1
            if f.get("gaze_miss_type"):
                mt["gaze"][f["gaze_miss_type"]] = mt["gaze"].get(f["gaze_miss_type"], 0) + 1
    return {
        "n_cases": len(session.get("attempts", [])),
        "review_area_unvisited": dict(sorted(unvisited.items(), key=lambda kv: -kv[1])),
        "miss_types": {k: v for k, v in mt.items() if v},
    }


def session_summary(session: dict) -> dict:
    cfg = mock_cfg()
    h = _history(session, cfg["zones"])
    pairs = [
        (f["cursor_miss_type"], f["gaze_miss_type"])
        for a in session.get("attempts", [])
        for f in a.get("result", {}).get("scoring", {}).get("findings", [])
        if f.get("cursor_miss_type") and f.get("gaze_miss_type")
    ]
    return h | {
        "synthetic": session.get("synthetic", True),
        "name": session.get("name", ""),
        "gaze": bool(session.get("gaze_meta")),
        "review_area_human": {z: cfg["zones"][z] for z in h["review_area_unvisited"]},
        "miss_types": {"cursor": h["miss_types"].get("cursor", {}), "gaze": h["miss_types"].get("gaze", {})},
        "miss_type_confusion": confusion(pairs),
    }
