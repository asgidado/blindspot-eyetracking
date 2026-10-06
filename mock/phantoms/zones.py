"""Derive the §0 zone masks from lung / heart / clavicle / spine masks with simple geometric rules.

Shared by the synthetic phantoms and the real-film pipeline (mock/films). Patient RIGHT is on image LEFT, so
`right_*` zones are computed from the lung with the smaller x.
"""

from __future__ import annotations

import numpy as np

from gaze_analysis.masks import Mask


def _rows(mask: Mask) -> tuple[int, int]:
    ys = np.nonzero(mask.any(axis=1))[0]
    return (int(ys.min()), int(ys.max())) if len(ys) else (0, 0)


def _cols(mask: Mask) -> tuple[int, int]:
    xs = np.nonzero(mask.any(axis=0))[0]
    return (int(xs.min()), int(xs.max())) if len(xs) else (0, 0)


def derive_zones(
    right_lung: Mask,
    left_lung: Mask,
    heart: Mask,
    clavicle_y: float,
    spine: Mask,
    *,
    hilum_band_frac: float = 0.35,
    periphery_px: int = 50,
    cpa_frac: float = 0.25,
    subdiaphragm_px: int = 80,
) -> dict[str, Mask]:
    """Every §0 zone id -> bool mask. Rules (documented here, applied identically to phantoms and real films):

    - upper/mid/lower zone: each lung split into vertical thirds of its own height
    - apex: lung above the clavicle line (fallback: top 12 % of the lung when that is empty)
    - hilum: medial band (hilum_band_frac of lung width) of the mid third
    - periphery: lateral periphery_px band of the lung
    - costophrenic angle: lateral-inferior corner (lateral cpa_frac of width x inferior cpa_frac of height)
    - retrocardiac: left lung ∩ heart (plus heart ∩ dilated-left-lung bounding box lower-medial corner is NOT added)
    - subdiaphragmatic: band of subdiaphragm_px below each lung's lowest row, within the lung's column extent
    - mediastinum: columns between the lungs' medial edges, rows from apex line to heart top, minus the heart
    - cardiac_silhouette: heart
    - clavicles: thin band around clavicle_y over each lung's column extent
    - spine: given
    """
    h, w = right_lung.shape
    yy, xx = np.mgrid[0:h, 0:w]
    z: dict[str, Mask] = {}

    for side, lung, lateral_is_left in (("right", right_lung, True), ("left", left_lung, False)):
        y0, y1 = _rows(lung)
        x0, x1 = _cols(lung)
        lh, lw = max(1, y1 - y0), max(1, x1 - x0)
        t1, t2 = y0 + lh / 3, y0 + 2 * lh / 3
        z[f"{side}_upper_zone"] = lung & (yy < t1)
        z[f"{side}_mid_zone"] = lung & (yy >= t1) & (yy < t2)
        z[f"{side}_lower_zone"] = lung & (yy >= t2)
        apex = lung & (yy < clavicle_y)
        if not apex.any():  # clavicle line above the lung top (segmentation quirk): use the lung's top 12 %
            apex = lung & (yy < y0 + 0.12 * lh)
        z[f"{side}_apex"] = apex
        medial_edge, lateral_edge = (x1, x0) if lateral_is_left else (x0, x1)
        band = lw * hilum_band_frac
        medial = (xx > medial_edge - band) if lateral_is_left else (xx < medial_edge + band)
        z[f"{side}_hilum"] = z[f"{side}_mid_zone"] & medial
        lateral = (
            (xx < lateral_edge + periphery_px) if lateral_is_left else (xx > lateral_edge - periphery_px)
        )
        z[f"{side}_periphery"] = lung & lateral
        cpa_lat = (xx < x0 + lw * cpa_frac) if lateral_is_left else (xx > x1 - lw * cpa_frac)
        z[f"{side}_costophrenic_angle"] = lung & cpa_lat & (yy > y1 - lh * cpa_frac)
        z[f"{side}_clavicle"] = (np.abs(yy - clavicle_y) < 12) & (xx >= x0) & (xx <= x1)
        sub = (yy > y1) & (yy <= y1 + subdiaphragm_px) & (xx >= x0) & (xx <= x1) & ~heart
        z.setdefault("subdiaphragmatic", np.zeros((h, w), bool))
        z["subdiaphragmatic"] = z["subdiaphragmatic"] | sub

    z["retrocardiac"] = left_lung & heart
    if not z[
        "retrocardiac"
    ].any():  # real films: segmented lung excludes the heart; use heart ∩ left-lung bbox lower half
        ly0, ly1 = _rows(left_lung)
        lx0, lx1 = _cols(left_lung)
        z["retrocardiac"] = heart & (xx >= lx0) & (xx <= lx1) & (yy >= (ly0 + ly1) / 2)
    z["cardiac_silhouette"] = heart
    _, r_x1 = _cols(right_lung)
    l_x0, _ = _cols(left_lung)
    heart_top = _rows(heart)[0]
    apex_top = min(_rows(right_lung)[0], _rows(left_lung)[0])
    z["mediastinum"] = (xx > r_x1) & (xx < l_x0) & (yy >= apex_top) & (yy < heart_top + 40) & ~heart
    z["spine"] = spine
    return z


ZONE_IDS = [
    "right_apex",
    "left_apex",
    "right_upper_zone",
    "left_upper_zone",
    "right_mid_zone",
    "left_mid_zone",
    "right_lower_zone",
    "left_lower_zone",
    "right_hilum",
    "left_hilum",
    "right_periphery",
    "left_periphery",
    "right_costophrenic_angle",
    "left_costophrenic_angle",
    "retrocardiac",
    "subdiaphragmatic",
    "mediastinum",
    "cardiac_silhouette",
    "right_clavicle",
    "left_clavicle",
    "spine",
]
