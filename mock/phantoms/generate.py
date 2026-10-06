"""Deterministic synthetic chest phantoms: 8 cases at 1024x1024 with zone polygons and 0-3 findings.

Run `make phantoms` (or `python -m mock.phantoms.generate`). Output: mock/phantoms/cases/phantom_XX.{png,json}.
These are committed so every test runs without downloads. Everything here is SYNTHETIC and labelled as such.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from gaze_analysis.masks import bbox, centroid, mask_to_polygon, polygon_to_mask

from .zones import ZONE_IDS, derive_zones

W = H = 1024
OUT = Path(__file__).parent / "cases"

# finding plan per phantom: (label, zone to place it in, radius px, kind). Several sit in hard review areas.
PLAN: list[list[tuple[str, str, int]]] = [
    [("nodule", "left_apex", 16), ("consolidation", "right_lower_zone", 42)],
    [("mass", "retrocardiac", 34), ("nodule", "right_mid_zone", 14)],
    [("nodule", "right_hilum", 15)],
    [("effusion", "left_costophrenic_angle", 40), ("calcification", "subdiaphragmatic", 12)],
    [("nodule", "right_apex", 14), ("fracture", "right_periphery", 30), ("nodule", "left_lower_zone", 13)],
    [("consolidation", "left_hilum", 38), ("atelectasis", "right_lower_zone", 36)],
    [],  # normal
    [],  # normal
]


def _ellipse(cx: float, cy: float, rx: float, ry: float, angle: float = 0.0) -> np.ndarray:
    m = np.zeros((H, W), np.uint8)
    cv2.ellipse(m, (int(cx), int(cy)), (int(rx), int(ry)), angle, 0, 360, 1, -1)
    return m.astype(bool)


def anatomy(rng: np.random.Generator) -> dict:
    """Seeded anatomy masks with small per-case variation."""
    j = lambda s: float(rng.normal(0, s))  # noqa: E731
    body = _ellipse(512 + j(5), 560, 420 + j(10), 520)
    rl = _ellipse(330 + j(8), 520 + j(8), 165 + j(6), 300 + j(8), -4)
    ll = _ellipse(694 + j(8), 520 + j(8), 158 + j(6), 300 + j(8), 4)
    heart = _ellipse(575 + j(8), 650 + j(6), 150 + j(6), 128 + j(5), -15)
    spine = np.zeros((H, W), bool)
    spine[150:980, 490:534] = True
    clav_y = 255 + j(5)
    # diaphragm domes: cut lungs below a parabola (right dome higher than left, as in life)
    yy, xx = np.mgrid[0:H, 0:W]
    r_dome = 790 + j(6) + ((xx - 330) / 165) ** 2 * 45
    l_dome = 820 + j(6) + ((xx - 694) / 158) ** 2 * 45
    rl &= yy < r_dome
    ll &= yy < l_dome
    return {
        "body": body,
        "rl": rl,
        "ll": ll,
        "heart": heart,
        "spine": spine,
        "clav_y": clav_y,
        "r_dome": r_dome,
        "l_dome": l_dome,
    }


def render(a: dict, rng: np.random.Generator) -> np.ndarray:
    img = np.full((H, W), 12, np.float32)  # near-black surround
    img[a["body"]] = 95  # soft tissue
    yy, xx = np.mgrid[0:H, 0:W]
    img[(yy > a["r_dome"]) & a["body"] & (xx < 512)] = 150  # abdomen
    img[(yy > a["l_dome"]) & a["body"] & (xx >= 512)] = 150
    lungs = a["rl"] | a["ll"]
    img[lungs] = 38
    # vascular markings: brighter toward hila
    for cx in (480, 544):
        d = np.hypot(xx - cx, yy - 520) / 320
        img[lungs] += np.clip(28 * (1 - d), 0, 28)[lungs]
    # ribs: soft bright arcs across the thorax
    for k in range(9):
        y = 230 + k * 70
        for sgn, cx in ((1, 330), (-1, 694)):
            pts = np.array(
                [
                    [
                        int(cx + sgn * (-170 + t * 340 / 40)),
                        int(y + 60 * np.sin(np.pi * t / 40) - 18 * (t / 40)),
                    ]
                    for t in range(41)
                ],
                np.int32,
            )
            cv2.polylines(img, [pts], False, 1.0, 1)  # dummy to keep shapes; real drawing below
            ribs = np.zeros((H, W), np.uint8)
            cv2.polylines(ribs, [pts], False, 1, 9)
            ribs = cv2.GaussianBlur(ribs.astype(np.float32), (0, 0), 4)
            img += 22 * ribs
    # mediastinum/heart/spine
    med = (xx > 495) & (xx < 530) & (yy > 150) & (yy < 980)
    img[
        a["body"]
        & ~lungs
        & (yy < a["heart"].nonzero()[0].min() if a["heart"].any() else 600)
        & (xx > 440)
        & (xx < 590)
    ] = 120
    img[a["heart"]] = 135
    img[med] += 30
    # clavicles: bright arcs
    for cx in (330, 694):
        clav = np.zeros((H, W), np.uint8)
        pts = np.array(
            [
                [int(cx - 150 + t * 300 / 30), int(a["clav_y"] - 22 * np.sin(np.pi * t / 30))]
                for t in range(31)
            ],
            np.int32,
        )
        cv2.polylines(clav, [pts], False, 1, 12)
        img += 45 * cv2.GaussianBlur(clav.astype(np.float32), (0, 0), 2)
    img = cv2.GaussianBlur(img, (0, 0), 2.5)
    img += rng.normal(0, 4.5, img.shape).astype(np.float32)
    return img


def draw_finding(
    img: np.ndarray, label: str, cx: float, cy: float, r: int, rng: np.random.Generator
) -> np.ndarray:
    """Returns the finding mask; draws the finding into img in place. Subtle on purpose."""
    yy, xx = np.mgrid[0:H, 0:W]
    m = np.zeros((H, W), bool)
    if label == "fracture":
        ang = rng.uniform(-0.6, 0.6)
        pts = np.array(
            [
                [int(cx - r * np.cos(ang)), int(cy - r * np.sin(ang))],
                [int(cx), int(cy + 4)],
                [int(cx + r * np.cos(ang)), int(cy + r * np.sin(ang) - 6)],
            ],
            np.int32,
        )
        line = np.zeros((H, W), np.uint8)
        cv2.polylines(line, [pts], False, 1, 3)
        img -= 35 * cv2.GaussianBlur(line.astype(np.float32), (0, 0), 1.0)
        m = cv2.dilate(line, np.ones((9, 9), np.uint8)).astype(bool)
    elif label == "effusion":
        # meniscus: brighten the costophrenic corner below a curve
        m = (np.hypot(xx - cx, yy - cy) < r) & (yy > cy - r * 0.2)
        img[m] += 55 * np.clip((yy[m] - (cy - r * 0.2)) / r, 0, 1)
    else:
        d = np.hypot(xx - cx, yy - cy)
        gain = {"nodule": 48, "mass": 60, "consolidation": 42, "atelectasis": 40, "calcification": 90}[label]
        soft = {"nodule": 0.45, "mass": 0.4, "consolidation": 0.9, "atelectasis": 0.8, "calcification": 0.2}[
            label
        ]
        img += gain * np.exp(-((d / r) ** 2) / (2 * soft**2))
        m = d < r
    return m


def largest_component(mask: np.ndarray) -> np.ndarray:
    n, lab = cv2.connectedComponents(mask.astype(np.uint8))
    if n <= 2:
        return mask
    sizes = [(lab == k).sum() for k in range(1, n)]
    return lab == (1 + int(np.argmax(sizes)))


def build_case(i: int) -> tuple[np.ndarray, dict]:
    rng = np.random.default_rng(1000 + i)
    a = anatomy(rng)
    img = render(a, rng)
    zones = derive_zones(a["rl"], a["ll"], a["heart"], a["clav_y"], a["spine"])
    findings = []
    for k, (label, zone, r) in enumerate(PLAN[i]):
        zm = zones[zone]
        c = centroid(largest_component(zm))
        assert c is not None, zone
        cx, cy = c[0] + rng.normal(0, 6), c[1] + rng.normal(0, 6)
        fm = draw_finding(img, label, cx, cy, r, rng)
        findings.append(
            {
                "finding_id": f"F{k + 1}",
                "label": label,
                "kind": "focal",
                "zone": zone,
                "polygon": mask_to_polygon(fm, 1.5),
                "bbox": bbox(fm),
            }
        )
    img = np.clip(img, 0, 255).astype(np.uint8)
    case = {
        "id": f"phantom_{i + 1:02d}",
        "source": "synthetic",
        "width": W,
        "height": H,
        "normal": not findings,
        "zones": {
            zid: {"polygon": mask_to_polygon(zones[zid], 2.0), "approximate": False} for zid in ZONE_IDS
        },
        "findings": findings,
        "global_findings": [],
        "note": "Synthetic phantom generated by mock/phantoms/generate.py. Not a radiograph.",
    }
    return img, case


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ids = []
    for i in range(len(PLAN)):
        img, case = build_case(i)
        cv2.imwrite(str(OUT / f"{case['id']}.png"), img, [cv2.IMWRITE_PNG_COMPRESSION, 9])
        (OUT / f"{case['id']}.json").write_text(json.dumps(case, separators=(",", ":")))
        ids.append(case["id"])
        # sanity: every zone polygon rasterises back to something
        for zid, zz in case["zones"].items():
            assert polygon_to_mask(zz["polygon"], H, W).any(), f"{case['id']} empty zone {zid}"
    (OUT / "index.json").write_text(json.dumps({"source": "synthetic", "cases": ids}, indent=1))
    print(f"wrote {len(ids)} phantoms to {OUT}")


if __name__ == "__main__":
    main()
