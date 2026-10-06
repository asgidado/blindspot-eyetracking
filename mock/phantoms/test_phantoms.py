import json

import numpy as np

from gaze_analysis.masks import polygon_to_mask

from .generate import OUT, PLAN, build_case
from .zones import ZONE_IDS

CASES = sorted(OUT.glob("phantom_*.json"))


def test_committed_phantoms_exist_and_are_complete():
    assert len(CASES) == len(PLAN) == 8
    for p in CASES:
        c = json.loads(p.read_text())
        assert c["source"] == "synthetic"
        assert (c["width"], c["height"]) == (1024, 1024)
        assert set(c["zones"]) == set(ZONE_IDS)
        assert (p.with_suffix(".png")).exists()
        assert len(c["findings"]) <= 3
    normals = [json.loads(p.read_text())["normal"] for p in CASES]
    assert sum(normals) == 2


def test_generation_is_deterministic():
    img_a, case_a = build_case(0)
    img_b, case_b = build_case(0)
    assert np.array_equal(img_a, img_b)
    assert case_a == case_b
    committed = json.loads((OUT / "phantom_01.json").read_text())
    assert committed["findings"] == case_a["findings"]


def test_patient_side_convention_right_zone_has_smaller_mean_x():
    for p in CASES:
        c = json.loads(p.read_text())
        for pair in ("apex", "hilum", "costophrenic_angle", "mid_zone"):
            r = np.asarray(c["zones"][f"right_{pair}"]["polygon"])[:, 0].mean()
            l_ = np.asarray(c["zones"][f"left_{pair}"]["polygon"])[:, 0].mean()
            assert r < l_, f"{c['id']} right_{pair} not on image left"


def test_findings_sit_inside_their_planned_zone():
    for p in CASES:
        c = json.loads(p.read_text())
        for f in c["findings"]:
            zm = polygon_to_mask(c["zones"][f["zone"]]["polygon"], 1024, 1024)
            fm = polygon_to_mask(f["polygon"], 1024, 1024)
            assert (zm & fm).sum() / max(1, fm.sum()) > 0.3, (
                f"{c['id']} {f['finding_id']} outside {f['zone']}"
            )


def test_hard_review_areas_are_covered_by_findings():
    zones = {f["zone"] for p in CASES for f in json.loads(p.read_text())["findings"]}
    assert {
        "left_apex",
        "right_apex",
        "retrocardiac",
        "right_hilum",
        "left_hilum",
        "subdiaphragmatic",
    } <= zones
