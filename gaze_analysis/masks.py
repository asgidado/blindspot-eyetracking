"""Polygon <-> boolean mask helpers. Pure NumPy/OpenCV; no app knowledge."""

from __future__ import annotations

import cv2
import numpy as np

Mask = np.ndarray  # H x W bool
Polygon = list[list[float]]  # [[x, y], ...] in image px


def polygon_to_mask(polygon: Polygon, h: int, w: int) -> Mask:
    m = np.zeros((h, w), np.uint8)
    if len(polygon) >= 3:
        cv2.fillPoly(m, [np.asarray(polygon, np.int32).reshape(-1, 1, 2)], 1)
    return m.astype(bool)


def mask_to_polygon(mask: Mask, epsilon_px: float = 2.0) -> Polygon:
    """Largest external contour, simplified. Empty list for an empty mask."""
    cs, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cs:
        return []
    c = max(cs, key=cv2.contourArea)
    c = cv2.approxPolyDP(c, epsilon_px, True)
    return [[float(x), float(y)] for x, y in c.reshape(-1, 2)]


def dilate(mask: Mask, radius_px: float) -> Mask:
    r = int(round(radius_px))
    if r <= 0:
        return mask
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.dilate(mask.astype(np.uint8), k).astype(bool)


def bbox(mask: Mask) -> list[float] | None:
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    return [float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())]


def centroid(mask: Mask) -> tuple[float, float] | None:
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    return float(xs.mean()), float(ys.mean())


def center_in(vp: tuple[float, float, float, float] | list[float], mask: Mask) -> bool:
    cx, cy = (vp[0] + vp[2]) / 2, (vp[1] + vp[3]) / 2
    h, w = mask.shape
    xi, yi = int(cx), int(cy)
    return 0 <= xi < w and 0 <= yi < h and bool(mask[yi, xi])


def point_in(mask: Mask, x: float, y: float) -> bool:
    h, w = mask.shape
    xi, yi = int(x), int(y)
    return 0 <= xi < w and 0 <= yi < h and bool(mask[yi, xi])
