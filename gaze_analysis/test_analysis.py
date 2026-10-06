"""Scripted-session tests for the §5 pipeline (G3 acceptance checks)."""

from __future__ import annotations

import numpy as np
import pytest

from .agreement import confusion, visited_agreement
from .analyze import analyze_case
from .config import GazeAnalysisConfig
from .cursor_proxy import CursorDwellConfig
from .dwell import BlurCache, quantize_sigma, region_dwell, resolution_tier
from .facts import build_facts, to_prompt_text, validate_claim
from .fixations import idt
from .masks import dilate
from .scanpath import merge_segments

H = W = 1024
CFG = GazeAnalysisConfig(
    review_hardness={"left_apex": 0.8, "retrocardiac": 1.0},
    zone_human={
        "left_apex": "left apex",
        "retrocardiac": "retrocardiac region",
        "left_upper_zone": "left upper zone",
    },
)
CUR = CursorDwellConfig()


def rect(x0, y0, x1, y1):
    m = np.zeros((H, W), bool)
    m[y0:y1, x0:x1] = True
    return m


ZONES = {
    "left_apex": rect(600, 150, 800, 300),
    "retrocardiac": rect(560, 600, 700, 760),
    "left_upper_zone": rect(600, 300, 800, 450),
}
FINDING = rect(700, 220, 724, 244)  # a 24-px nodule in the left apex
ROI = dilate(FINDING, 36)


def path(points, hz=30.0, sigma=30.0, zoom=1.0):
    """points: [(x, y, hold_ms)] → gaze samples on the case clock (image coords == stage px for simplicity)."""
    out, t = [], 0.0
    for x, y, hold in points:
        n = max(1, int(hold * hz / 1000))
        for _ in range(n):
            out.append(
                {
                    "t": t,
                    "sx": x,
                    "sy": y,
                    "x": x,
                    "y": y,
                    "sigma": sigma,
                    "valid": True,
                    "zoom": zoom,
                    "vp": [0, 0, W, H],
                }
            )
            t += 1000 / hz
    return out


def run(gaze, telemetry=None, sigma_meta=30.0):
    return analyze_case(
        gaze=gaze,
        gaze_meta={"validation": {"accuracy_px": sigma_meta, "precision_px": 10}, "quality_tier": "good"},
        telemetry=telemetry or [],
        zones=ZONES,
        rois={"F1": ROI},
        finding_info={"F1": {"label": "nodule", "zone": "left_apex", "outcome": "missed"}},
        cfg=CFG,
        cursor_cfg=CUR,
        img_w=W,
        img_h=H,
        fit_scale=0.8,
        submit_ms=gaze[-1]["t"] if gaze else 0,
        first_mark_ms=None,
        heatmaps=False,
    )


def test_never_enters_roi_is_search():
    g = path(
        [(640, 680, 2000), (650, 400, 1500)]
    )  # retrocardiac then left upper zone; never near the apex nodule
    r = run(g)
    f = r["gaze"]["finding"]["F1"]
    assert f["resolution"] == "lesion" and f["miss_type"] == "search"
    assert f["dwell_ms"] < 50


def test_passes_through_about_500ms_is_recognition():
    g = path([(640, 680, 1500), (712, 232, 500), (650, 400, 1500)])
    f = run(g)["gaze"]["finding"]["F1"]
    assert f["resolution"] == "lesion"
    assert 300 <= f["dwell_ms"] < 1000
    assert f["miss_type"] == "recognition"
    assert f["time_to_first_ms"] is not None and 1400 <= f["time_to_first_ms"] <= 1600


def test_lingers_two_seconds_is_decision():
    g = path([(640, 680, 1000), (712, 232, 2000), (650, 400, 500)])
    f = run(g)["gaze"]["finding"]["F1"]
    assert f["miss_type"] == "decision" and f["dwell_ms"] >= 1000


def test_same_path_with_large_sigma_is_zone_resolution_and_no_miss_type():
    g = path([(640, 680, 1000), (712, 232, 2000), (650, 400, 500)], sigma=120.0)
    r = run(g, sigma_meta=120.0)
    f = r["gaze"]["finding"]["F1"]
    assert f["resolution"] == "zone" and f["miss_type"] is None
    assert f["confidence"] == 0.0
    # zone-level coverage still works: the apex was visited
    assert r["gaze"]["coverage"]["visited"]["left_apex"] is True
    assert r["gaze"]["review_resolution"]["left_apex"] == "zone"


def test_probabilistic_dwell_is_between_zero_and_point_dwell_near_an_edge():
    cache = BlurCache(CFG.sigma_bins_px)
    region = rect(500, 500, 600, 600)
    inside = path([(550, 550, 1000)], sigma=20)
    edge = path([(600, 550, 1000)], sigma=20)  # exactly on the edge → P ≈ 0.5
    far = path([(900, 900, 1000)], sigma=20)
    d_in = region_dwell(inside, "r", region, cache, 250)
    d_edge = region_dwell(edge, "r", region, cache, 250)
    d_far = region_dwell(far, "r", region, cache, 250)
    assert d_in.prob_ms > 900 and d_in.point_ms > 900
    assert 350 < d_edge.prob_ms < 650
    assert d_far.prob_ms < 1 and d_far.point_ms == 0
    assert quantize_sigma(22, CFG.sigma_bins_px) == 35 and quantize_sigma(999, CFG.sigma_bins_px) == 300
    assert (
        resolution_tier(72, 72, 150) == "lesion"
        and resolution_tier(72.1, 72, 150) == "zone"
        and resolution_tier(151, 72, 150) == "none"
    )


def test_idt_fixations_and_min_duration():
    g = path(
        [(100, 100, 400), (500, 500, 60), (900, 900, 400)]
    )  # the 60 ms stop is too short to be a fixation
    fx = idt(g, 40, 100)
    assert len(fx) == 2
    assert fx[0].duration_ms >= 300 and fx[1].x == pytest.approx(900)


def test_scanpath_descriptive_and_segments_capped():
    g = path([(640, 680, 600), (712, 232, 600), (650, 400, 600), (640, 680, 600)])
    sp = run(g)["gaze"]["scanpath"]
    assert sp["first_zone"] == "retrocardiac"
    assert sp["first_visits"] == ["retrocardiac", "left_apex", "left_upper_zone"]
    assert sp["revisits"] == {"retrocardiac": 1}
    assert sp["last_zone_before_submit"] == "retrocardiac"
    seq = [
        {"zone": f"z{i % 7}", "enter_ms": i * 100, "dwell_ms": 100 + i, "source": "gaze"} for i in range(40)
    ]
    assert len(merge_segments(seq, 15)) <= 15


def test_cursor_gaze_agreement_lag_and_kappa():
    # cursor follows gaze with a 500 ms lag along the same path
    g = path([(200, 200, 1000), (800, 200, 1000), (800, 800, 1000), (200, 800, 1000)])
    tele = [
        {
            "t": s["t"] + 500,
            "kind": "move",
            "x": s["x"] + 10,
            "y": s["y"],
            "zoom": 1,
            "vp": [0, 0, W, H],
            "loupe": False,
        }
        for s in g
    ]
    r = run(g, tele)
    ag = r["gaze"]["agreement"]
    assert ag["n_samples"] == len(g)
    assert ag["gaze_leads_cursor_ms"] is not None and 400 <= ag["gaze_leads_cursor_ms"] <= 600
    assert ag["median_px_at_best_lag"] < 15
    va = visited_agreement(
        {"a": True, "b": False, "c": True, "d": False}, {"a": True, "b": False, "c": False, "d": False}
    )
    assert va["pct"] == 75.0 and 0.4 < va["kappa"] < 0.6
    cm = confusion([("search", "search"), ("search", "recognition"), ("decision", "decision")])
    assert cm["n"] == 3 and cm["matrix"]["search"]["recognition"] == 1 and cm["pct"] == pytest.approx(66.7)


def test_facts_block_is_compact_anatomical_and_validates_claims():
    g = path([(640, 680, 1500), (712, 232, 500), (650, 400, 1500)])
    r = run(g)
    ra = [
        {
            "zone": z,
            "human": CFG.zone_human[z],
            "hardness": h,
            "gaze_dwell_ms": round(r["gaze"]["review_dwell_ms"][z]),
            "gaze_resolution": r["gaze"]["review_resolution"][z],
            "cursor_dwell_ms": 0.0,
            "visited_gaze": r["gaze"]["coverage"]["visited"][z],
            "visited_cursor": False,
            "visit_threshold_ms": 300,
            "reference": "review_area_checklist",
        }
        for z, h in CFG.review_hardness.items()
    ]
    gf = r["gaze"]["finding"]["F1"]
    findings = [
        {
            "finding_id": "F1",
            "label": "nodule",
            "location": "left apex",
            "outcome": "missed",
            "gaze": {
                "dwell_ms": gf["dwell_ms"],
                "resolution": gf["resolution"],
                "miss_type": gf["miss_type"],
                "miss_type_confidence": gf["confidence"],
                "time_to_first_ms": gf["time_to_first_ms"],
            },
            "cursor": {"dwell_ms": 0, "miss_type": "search"},
            "agreement": "disagree",
        }
    ]
    facts = build_facts(
        phase="post_submit",
        synthetic=True,
        zone_human=CFG.zone_human,
        total_read_ms=3500,
        first_mark_ms=None,
        search=r["gaze"]["scanpath"],
        search_source="gaze",
        review_areas=ra,
        coverage={
            "gaze_weighted_pct": r["gaze"]["coverage"]["weighted_pct"],
            "unvisited_hard_gaze": r["gaze"]["coverage"]["unvisited_hard"],
        },
        findings=findings,
        agreement=None,
        history={"n_cases": 1},
        gaze_quality="good",
        gaze_accuracy_img_px_at_fit=37.5,
        supports="lesion_level",
        bands=(300, 1000),
    )
    from shared.schemas.loader import validate

    validate("GazeFacts", facts)
    import json

    blob = json.dumps(facts, separators=(",", ":"))
    assert len(blob) < 3072, len(blob)  # ~2 KB target; see PROGRESS.md on review-area density
    assert not any(k in blob for k in ('"x":', '"y":', '"sx"'))  # anatomy, not pixels
    txt = to_prompt_text(facts)
    assert txt == to_prompt_text(facts)  # deterministic
    assert "left apex" in txt and "recognition" in txt and "descriptive only" in txt
    assert (
        validate_claim(
            "Your eyes reached the left apex for about 500 ms — a recognition error by gaze.", facts
        )
        == []
    )
    assert validate_claim("You saw the nodule but ignored it.", facts)
    assert validate_claim("You should have looked in this order: apex, hilum, bases.", facts)
    assert any("not in facts" in v for v in validate_claim("You dwelt there for 4321 ms.", facts))
    # finding-level claim at zone resolution is flagged
    facts["findings"][0]["gaze"]["resolution"] = "zone"
    facts["findings"][0]["gaze"]["miss_type"] = None
    assert validate_claim("Gaze shows a recognition error on the nodule in the left apex.", facts)
