import json

import numpy as np

from gaze_analysis.masks import polygon_to_mask

from .fetch import LABEL_MAP, lung_masks_template, parse_annotation, region_hint, select, zones_for


def test_label_map_covers_all_13_categories_and_maps_to_section0_ids():
    assert len(LABEL_MAP) == 13
    assert (
        LABEL_MAP["Effusion"] == "effusion"
        and LABEL_MAP["Diffuse Nodule"] == "diffuse_nodule"
        and LABEL_MAP["Pleural Thickening"] == "pleural_thickening"
    )


def test_parse_annotation_formats_and_unmapped_skip(capsys):
    aj = json.dumps(
        {
            "file_name": "1.png",
            "syms": ["Nodule", "Alien", "Cardiomegaly"],
            "boxes": [[100, 100, 140, 140], [0, 0, 10, 10], [300, 500, 700, 800]],
            "polygons": [
                [[100, 100], [140, 100], [140, 140], [100, 140]],
                [[0, 0], [10, 0], [10, 10]],
                [300, 500, 700, 500, 700, 800, 300, 800],
            ],
        }
    )
    fs = parse_annotation(aj)
    assert [f["label"] for f in fs] == ["nodule", "cardiomegaly"]
    assert fs[0]["kind"] == "focal" and fs[1]["kind"] == "global"
    assert fs[1]["polygon"][0] == [300.0, 500.0]  # flat list parsed
    assert "Alien" in capsys.readouterr().err


def test_seeded_selection_prefers_hard_regions_and_is_deterministic():
    def row(i, neg, boxes):
        return {
            "image_id": str(i),
            "is_negative": neg,
            "image_url": "",
            "findings": [
                {"label": "nodule", "kind": "focal", "polygon": [[0, 0], [1, 0], [1, 1]], "bbox": b}
                for b in boxes
            ],
        }

    rows = [row(i, True, []) for i in range(10)]
    rows += [row(100 + i, False, [[700, 200, 740, 240]]) for i in range(3)]  # left apex
    rows += [row(200 + i, False, [[400, 500, 440, 540]]) for i in range(3)]  # right hilum
    rows += [row(300 + i, False, [[600, 650, 660, 720]]) for i in range(3)]  # retrocardiac
    rows += [row(400 + i, False, [[150, 760, 200, 800]]) for i in range(3)]  # right costophrenic angle
    rows += [row(500 + i, False, [[300, 400, 340, 440]]) for i in range(10)]  # elsewhere
    a, b = select(rows), select(rows)
    assert [r["image_id"] for r in a] == [r["image_id"] for r in b]
    assert len(a) == 20 and sum(r["is_negative"] for r in a) == 6
    hints = [region_hint(f) for r in a for f in r["findings"]]
    for want in ("apex", "hilum", "retrocardiac", "costophrenic_angle"):
        assert sum(1 for h in hints if h and want in h) >= 2, want


def test_template_zones_keep_patient_side_convention_on_a_phantom():
    import cv2

    img = cv2.imread("mock/phantoms/cases/phantom_07.png", cv2.IMREAD_GRAYSCALE)
    rl, ll, heart, clav_y, spine = lung_masks_template(img)
    assert rl.any() and ll.any() and np.nonzero(rl)[1].mean() < np.nonzero(ll)[1].mean()
    zones, method = zones_for(img, use_xrv=False)
    assert method.startswith("template") and all(z["approximate"] for z in zones.values())
    for pair in ("apex", "hilum", "costophrenic_angle"):
        r = np.asarray(zones[f"right_{pair}"]["polygon"])[:, 0].mean()
        l_ = np.asarray(zones[f"left_{pair}"]["polygon"])[:, 0].mean()
        assert r < l_, pair
    assert polygon_to_mask(zones["retrocardiac"]["polygon"], 1024, 1024).any()
