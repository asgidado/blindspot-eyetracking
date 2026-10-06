"""`make films`: fetch 20 real ChestX-Det frontal radiographs into gitignored data/films/ (OPTIONAL).

Human checkpoint first: prints the dataset licence line and the NIH attribution requirement and waits for "yes"
(or `--yes`). Then:
1. pages the Hugging Face datasets-server rows API for the `test` split (553 rows; metadata + per-row image URLs —
   no parquet shard is pulled), parses each row's upstream `annotation_json` (`syms`, `boxes`, `polygons`);
2. picks 14 abnormal films whose findings fall across review areas (≥ 2 each near an apex, a hilum, the retrocardiac
   region and a costophrenic angle where available) and 6 normals, by a seeded rule; writes `mock/films/manifest.json`
   (image ids only, no pixels);
3. downloads only those 20 PNGs, maps categories to §0 label ids (unmappable → logged and skipped);
4. derives zones: TorchXRayVision chest segmentation when installed (`uv sync --extra films`), else template zones
   fitted to each lung's bounding box from a threshold mask. All real-film zones are `approximate: true`.
Writes data/films/<id>.png + <id>.json + index.json in the same case format as the phantoms.
"""

from __future__ import annotations

import json
import random
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import cv2
import numpy as np

from gaze_analysis.masks import bbox, mask_to_polygon, polygon_to_mask

from ..phantoms.zones import ZONE_IDS, derive_zones

DATASET = "MedOtter/ChestX-Det"
ROWS_API = "https://datasets-server.huggingface.co/rows"
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "films"
MANIFEST = Path(__file__).parent / "manifest.json"
W = H = 1024
N_ABNORMAL, N_NORMAL, SEED = 14, 6, 2026

LABEL_MAP = {  # dataset category → §0 label id
    "Consolidation": "consolidation",
    "Effusion": "effusion",
    "Fibrosis": "fibrosis",
    "Pleural Thickening": "pleural_thickening",
    "Nodule": "nodule",
    "Fracture": "fracture",
    "Atelectasis": "atelectasis",
    "Cardiomegaly": "cardiomegaly",
    "Calcification": "calcification",
    "Pneumothorax": "pneumothorax",
    "Emphysema": "emphysema",
    "Diffuse Nodule": "diffuse_nodule",
    "Mass": "mass",
}
GLOBAL = {"cardiomegaly", "emphysema", "fibrosis", "diffuse_nodule"}

CHECKPOINT = """
About to download 20 radiographs from Hugging Face dataset {ds}.

  Licence (dataset card): Apache-2.0 (annotations) over NIH ChestX-ray14 images (no use restrictions, attribution required).
  Attribution required by NIH terms:
    1. link to https://nihcc.app.box.com/v/ChestXray-NIHCC
    2. cite Wang et al., CVPR 2017 (ChestX-ray8/14)
    3. acknowledge the NIH Clinical Center as the data provider
  Also cite ChestX-Det: Lian et al., arXiv:2104.10326 and Liu et al., arXiv:2006.10550.
  Images are stored ONLY under data/films/ (gitignored) and are never committed or hosted.

Proceed? [yes/N] """


def rows(split: str = "test", page: int = 100):
    offset = 0
    while True:
        q = urllib.parse.urlencode(
            {"dataset": DATASET, "config": "default", "split": split, "offset": offset, "length": page}
        )
        with urllib.request.urlopen(f"{ROWS_API}?{q}", timeout=120) as r:  # noqa: S310
            d = json.load(r)
        for row in d["rows"]:
            yield row["row"]
        offset += page
        if offset >= d.get("num_rows_total", 0) or not d["rows"]:
            break


def parse_annotation(aj: str | dict) -> list[dict]:
    """Upstream entry → [{label, polygon, bbox}] with §0 label ids; unmappable categories are logged and skipped."""
    a = json.loads(aj) if isinstance(aj, str) else aj
    out = []
    for i, sym in enumerate(a.get("syms") or []):
        label = LABEL_MAP.get(sym)
        if label is None:
            print(f"  skip unmapped category {sym!r}", file=sys.stderr)
            continue
        poly = (a.get("polygons") or [[]] * (i + 1))[i] if i < len(a.get("polygons") or []) else []
        pts = _points(poly)
        box = (a.get("boxes") or [None] * (i + 1))[i] if i < len(a.get("boxes") or []) else None
        if not pts and box:
            x0, y0, x1, y1 = box
            pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
        if len(pts) < 3:
            continue
        out.append(
            {
                "label": label,
                "kind": "global" if label in GLOBAL else "focal",
                "polygon": pts,
                "bbox": [float(v) for v in box] if box else bbox(polygon_to_mask(pts, H, W)),
            }
        )
    return out


def _points(poly) -> list[list[float]]:
    if not poly:
        return []
    if isinstance(poly[0], (int, float)):  # flat [x0, y0, x1, y1, ...]
        return [[float(poly[i]), float(poly[i + 1])] for i in range(0, len(poly) - 1, 2)]
    if (
        isinstance(poly[0], (list, tuple)) and poly[0] and isinstance(poly[0][0], (list, tuple))
    ):  # nested rings: take the first
        return _points(poly[0])
    return [[float(p[0]), float(p[1])] for p in poly if len(p) >= 2]


def region_hint(f: dict) -> str | None:
    """Coarse location of a focal finding from its bbox (image frame; patient right = image left). Used ONLY for the
    seeded selection so findings land across review areas; the final zones come from segmentation."""
    x0, y0, x1, y1 = f["bbox"]
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    side = "right" if cx < 512 else "left"
    if cy < 280:
        return f"{side}_apex"
    if cy > 700 and (cx < 260 or cx > 764):
        return f"{side}_costophrenic_angle"
    if 420 < cy < 620 and 330 < cx < 700:
        return f"{side}_hilum"
    if side == "left" and 560 < cy < 820 and 540 < cx < 720:
        return "retrocardiac"
    return None


def select(
    rows_meta: list[dict], seed: int = SEED, n_abn: int = N_ABNORMAL, n_norm: int = N_NORMAL
) -> list[dict]:
    """Seeded rule: ≥ 2 films per hard region hint where available, then fill with other focal-abnormal films; plus normals."""
    rng = random.Random(seed)
    abn = [r for r in rows_meta if not r["is_negative"] and any(f["kind"] == "focal" for f in r["findings"])]
    normals = [r for r in rows_meta if r["is_negative"]]
    rng.shuffle(abn)
    rng.shuffle(normals)
    chosen: list[dict] = []
    for want in ("apex", "hilum", "retrocardiac", "costophrenic_angle"):
        k = 0
        for r in abn:
            if r in chosen or k >= 2:
                continue
            if any(h and want in h for h in (region_hint(f) for f in r["findings"] if f["kind"] == "focal")):
                chosen.append(r)
                k += 1
    for r in abn:
        if len(chosen) >= n_abn:
            break
        if r not in chosen:
            chosen.append(r)
    return chosen[:n_abn] + normals[:n_norm]


# ---------------- zones for real films
def lung_masks_template(img: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, float, np.ndarray]:
    """Fallback: threshold the dark lung fields inside the body, split left/right at the column of least lung,
    fit the heart as an ellipse in the lower medial left lung bay, clavicle line at the lungs' top + 12 %.
    Crude by design — every zone is marked approximate."""
    blur = cv2.GaussianBlur(img, (0, 0), 6)
    body = blur > 25
    thr = np.percentile(blur[body], 35) if body.any() else 90
    lungs = (blur < thr) & body
    lungs = cv2.morphologyEx(lungs.astype(np.uint8), cv2.MORPH_OPEN, np.ones((15, 15), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(lungs)
    comps = sorted(range(1, n), key=lambda k: -stats[k, cv2.CC_STAT_AREA])[:2]
    if len(comps) < 2:
        # single blob: split at the middle column
        m = lab > 0
        rl, ll = m.copy(), m.copy()
        rl[:, 512:] = False
        ll[:, :512] = False
    else:
        a, b = (lab == comps[0]), (lab == comps[1])
        rl, ll = (a, b) if stats[comps[0], cv2.CC_STAT_LEFT] < stats[comps[1], cv2.CC_STAT_LEFT] else (b, a)
    ys = np.nonzero(rl | ll)[0]
    top, bot = (int(ys.min()), int(ys.max())) if len(ys) else (200, 850)
    clav_y = top + 0.12 * (bot - top)
    lx = np.nonzero(ll.any(axis=0))[0]
    rx = np.nonzero(rl.any(axis=0))[0]
    gap_c = ((rx.max() if len(rx) else 450) + (lx.min() if len(lx) else 574)) / 2
    heart = np.zeros((H, W), np.uint8)
    cv2.ellipse(
        heart,
        (int(gap_c + 60), int(top + 0.68 * (bot - top))),
        (int(0.17 * W), int(0.14 * H)),
        -15,
        0,
        360,
        1,
        -1,
    )
    spine = np.zeros((H, W), bool)
    spine[top - 40 : bot + 100, int(gap_c) - 24 : int(gap_c) + 24] = True
    return rl.astype(bool), ll.astype(bool), heart.astype(bool), float(clav_y), spine


def lung_masks_xrv(img: np.ndarray):
    """TorchXRayVision PSPNet chest segmentation (CPU). Returns the same tuple as the template fallback."""
    import torch  # noqa: F401
    import torchxrayvision as xrv

    model = xrv.baseline_models.chestx_det.PSPNet()
    x = xrv.datasets.normalize(img.astype(np.float32), 255)
    x = cv2.resize(x, (512, 512))
    with torch.no_grad():
        pred = model(torch.from_numpy(x)[None, None]).squeeze(0).numpy()
    names = model.targets

    def up(k: str) -> np.ndarray:
        return cv2.resize(
            (pred[names.index(k)] > 0.5).astype(np.uint8), (W, H), interpolation=cv2.INTER_NEAREST
        ).astype(bool)

    # XRV names are in image frame: "Left Lung" is the lung on image left? XRV follows radiological convention
    # (anatomical left = image right). We assign by mean x to be safe: smaller mean x = patient right.
    a, b = up("Left Lung"), up("Right Lung")
    ax, bx = (np.nonzero(a)[1].mean() if a.any() else 1024), (np.nonzero(b)[1].mean() if b.any() else 0)
    rl, ll = (a, b) if ax < bx else (b, a)
    heart = up("Heart")
    clav = up("Left Clavicle") | up("Right Clavicle")
    clav_y = float(np.nonzero(clav)[0].mean()) if clav.any() else float(np.nonzero(rl | ll)[0].min() + 60)
    spine = up("Spine") if "Spine" in names else lung_masks_template(img)[4]
    return rl, ll, heart, clav_y, spine


def zones_for(img: np.ndarray, use_xrv: bool) -> tuple[dict, str]:
    try:
        if use_xrv:
            parts = lung_masks_xrv(img)
            method = "torchxrayvision PSPNet"
        else:
            raise ImportError("xrv disabled")
    except Exception as e:  # noqa: BLE001
        print(f"  zones: template fallback ({e})", file=sys.stderr)
        parts = lung_masks_template(img)
        method = "template (threshold lungs + fitted heart ellipse)"
    z = derive_zones(*parts)
    return {
        zid: {"polygon": mask_to_polygon(z[zid], 2.5), "approximate": True} for zid in ZONE_IDS if zid in z
    }, method


def main(argv: list[str]) -> int:
    yes = "--yes" in argv
    if not yes:
        print(CHECKPOINT.format(ds=DATASET), end="")
        if input().strip().lower() not in ("y", "yes"):
            print("aborted; no files downloaded")
            return 1
    try:
        import torchxrayvision  # noqa: F401

        use_xrv = "--no-xrv" not in argv
    except ImportError:
        use_xrv = False
        print("torchxrayvision not installed (uv sync --extra films); using template zones", file=sys.stderr)
    print("listing rows (metadata only)…")
    meta = []
    for r in rows():
        meta.append(
            {
                "image_id": str(r["image_id"]),
                "is_negative": bool(r["is_negative"]),
                "image_url": r["image"]["src"],
                "findings": parse_annotation(r["annotation_json"]),
            }
        )
    chosen = select(meta)
    MANIFEST.write_text(
        json.dumps(
            {
                "dataset": DATASET,
                "split": "test",
                "seed": SEED,
                "rule": "≥2 films per apex/hilum/retrocardiac/costophrenic hint, fill to 14 abnormal, + 6 normals",
                "ids": [c["image_id"] for c in chosen],
            },
            indent=1,
        )
    )
    OUT.mkdir(parents=True, exist_ok=True)
    ids = []
    for c in chosen:
        cid = f"film_{c['image_id']}"
        png = OUT / f"{cid}.png"
        if not png.exists():
            with urllib.request.urlopen(c["image_url"], timeout=120) as r:  # noqa: S310
                png.write_bytes(r.read())
        img = cv2.imread(str(png), cv2.IMREAD_GRAYSCALE)
        if img is None or img.shape != (H, W):
            print(f"  {cid}: unexpected image, skipping", file=sys.stderr)
            continue
        zones, method = zones_for(img, use_xrv)
        zmasks = {k: polygon_to_mask(v["polygon"], H, W) for k, v in zones.items()}
        from gaze_analysis.scanpath import ZONE_PRIORITY

        from ..api.cases import zone_of_point

        findings = []
        for k, f in enumerate([f for f in c["findings"] if f["kind"] == "focal"]):
            bx = f["bbox"]
            zone = (
                zone_of_point(zmasks, (bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2, ZONE_PRIORITY)
                or "right_mid_zone"
            )
            findings.append(
                {
                    "finding_id": f"F{k + 1}",
                    "label": f["label"],
                    "kind": "focal",
                    "zone": zone,
                    "polygon": f["polygon"],
                    "bbox": bx,
                }
            )
        case = {
            "id": cid,
            "source": "chestx-det",
            "width": W,
            "height": H,
            "normal": c["is_negative"],
            "zones": zones,
            "zone_method": method,
            "findings": findings,
            "global_findings": sorted({f["label"] for f in c["findings"] if f["kind"] == "global"}),
            "attribution": "NIH Clinical Center ChestX-ray14 (Wang et al. 2017); ChestX-Det annotations (Lian et al. 2021, arXiv:2104.10326; Liu et al. 2020, arXiv:2006.10550). Local use only.",
        }
        (OUT / f"{cid}.json").write_text(json.dumps(case, separators=(",", ":")))
        ids.append(cid)
        print(f"  {cid}: {len(findings)} focal, {len(case['global_findings'])} global, zones via {method}")
    (OUT / "index.json").write_text(json.dumps({"source": "chestx-det", "cases": ids}, indent=1))
    print(
        f"wrote {len(ids)} films to {OUT}; the mock now shows 'Mock · Real films (ChestX-Det)'. Delete data/films/ to return to phantoms."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
