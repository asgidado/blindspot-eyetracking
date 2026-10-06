"""Case store: real films from data/films/ when present, otherwise the committed synthetic phantoms."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np

from gaze_analysis.masks import dilate, polygon_to_mask

from .config import ROOT, mock_cfg

PHANTOMS = ROOT / "mock" / "phantoms" / "cases"
FILMS = ROOT / "data" / "films"


def source_dir() -> Path:
    return FILMS if (FILMS / "index.json").exists() else PHANTOMS


def badge() -> str:
    return "Mock · Real films (ChestX-Det)" if source_dir() == FILMS else "Mock · Synthetic films"


def is_synthetic() -> bool:
    return source_dir() == PHANTOMS


def case_ids() -> list[str]:
    return json.loads((source_dir() / "index.json").read_text())["cases"]


@lru_cache(maxsize=64)
def load_case(cid: str) -> dict:
    p = source_dir() / f"{cid}.json"
    if not p.exists():
        raise KeyError(cid)
    return json.loads(p.read_text())


def image_path(cid: str) -> Path:
    return source_dir() / f"{cid}.png"


def public_view(case: dict, index: int, total: int) -> dict:
    """What the client may see BEFORE submit: no findings, no zones."""
    return {
        "id": case["id"],
        "width": case["width"],
        "height": case["height"],
        "index": index,
        "total": total,
        "source": case["source"],
    }


@lru_cache(maxsize=64)
def masks_for(cid: str) -> dict:
    """Zone masks, finding masks and finding ROIs (mask dilated by ρ = roi_frac·W)."""
    c = load_case(cid)
    h, w = c["height"], c["width"]
    rho = mock_cfg()["image"]["roi_frac"] * w
    zones = {zid: polygon_to_mask(z["polygon"], h, w) for zid, z in c["zones"].items()}
    findings = {f["finding_id"]: polygon_to_mask(f["polygon"], h, w) for f in c["findings"]}
    rois = {fid: dilate(m, rho) for fid, m in findings.items()}
    return {"zones": zones, "findings": findings, "rois": rois, "rho": rho, "shape": (h, w)}


def zone_of_point(zones: dict[str, np.ndarray], x: float, y: float, priority: list[str]) -> str | None:
    """Most specific zone containing a point (review areas first, then lung thirds, then the rest)."""
    for zid in priority:
        m = zones.get(zid)
        if m is not None and 0 <= int(y) < m.shape[0] and 0 <= int(x) < m.shape[1] and m[int(y), int(x)]:
            return zid
    return None
