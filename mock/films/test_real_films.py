"""Checks on the optional real-film pack. Skipped when data/films/ is absent, so CI and fresh clones stay green."""

import json
from pathlib import Path

import numpy as np
import pytest

from gaze_analysis.masks import polygon_to_mask

FILMS = Path(__file__).resolve().parents[2] / "data" / "films"
pytestmark = pytest.mark.skipif(
    not (FILMS / "index.json").exists(), reason="real films not downloaded (make films)"
)


def _cases():
    ids = json.loads((FILMS / "index.json").read_text())["cases"]
    return [json.loads((FILMS / f"{i}.json").read_text()) for i in ids]


def test_twenty_films_fourteen_abnormal_six_normal_all_approximate():
    cs = _cases()
    assert len(cs) == 20
    assert sum(c["normal"] for c in cs) == 6
    for c in cs:
        assert c["source"] == "chestx-det" and (c["width"], c["height"]) == (1024, 1024)
        assert (FILMS / f"{c['id']}.png").exists()
        assert all(z["approximate"] for z in c["zones"].values())
        assert "attribution" in c


def test_patient_side_convention_on_real_zones():
    for c in _cases():
        for pair in ("apex", "hilum", "costophrenic_angle", "mid_zone"):
            r = np.asarray(c["zones"][f"right_{pair}"]["polygon"])[:, 0].mean()
            l_ = np.asarray(c["zones"][f"left_{pair}"]["polygon"])[:, 0].mean()
            assert r < l_, f"{c['id']} right_{pair}"


def test_findings_are_mapped_and_inside_the_frame():
    labels = {
        "pneumothorax",
        "effusion",
        "consolidation",
        "atelectasis",
        "nodule",
        "mass",
        "fracture",
        "calcification",
        "pleural_thickening",
    }
    n = 0
    for c in _cases():
        for f in c["findings"]:
            assert f["label"] in labels
            m = polygon_to_mask(f["polygon"], 1024, 1024)
            assert m.any()
            n += 1
    assert n >= 14
