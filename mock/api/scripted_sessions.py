"""Generate N synthetic validation-study sessions with scripted gaze + cursor through the real API code path.
`uv run python -m mock.api.scripted_sessions 4` → sessions/*.json (gitignored). Labelled synthetic + scripted."""

from __future__ import annotations

import random
import sys

import numpy as np
from fastapi.testclient import TestClient

from gaze_analysis.masks import centroid, polygon_to_mask

from .main import app


def scripted_attempt(
    case: dict, rng: random.Random, accuracy_px: float
) -> tuple[list[dict], list[dict], list[dict], float]:
    """A plausible read: visit 5-8 zones (hard ones skipped with some probability), linger near 0-2 findings; the
    cursor trails gaze by ~600 ms with extra idle time. Returns (gaze, telemetry, marks, read_ms)."""
    fit = 0.75
    zones = {
        z: polygon_to_mask(v["polygon"], case["height"], case["width"]) for z, v in case["zones"].items()
    }
    order = [
        z
        for z in zones
        if rng.random()
        < (
            0.45
            if z
            in ("retrocardiac", "subdiaphragmatic", "right_apex", "left_apex", "right_hilum", "left_hilum")
            else 0.75
        )
    ]
    rng.shuffle(order)
    stops: list[tuple[float, float, float]] = []
    for z in order[: rng.randint(5, 8)]:
        c = centroid(zones[z])
        if c:
            stops.append((c[0] + rng.gauss(0, 20), c[1] + rng.gauss(0, 20), rng.uniform(400, 1800)))
    marks = []
    for f in case["findings"]:
        r = rng.random()
        bx = f["bbox"]
        cx, cy = (bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2
        if r < 0.35:  # found: look, then mark
            stops.append((cx + rng.gauss(0, 8), cy + rng.gauss(0, 8), rng.uniform(1200, 2500)))
            marks.append(
                {
                    "x": cx + rng.gauss(0, 6),
                    "y": cy + rng.gauss(0, 6),
                    "label": f["label"] if rng.random() < 0.8 else "mass",
                    "confidence": rng.randint(2, 5),
                }
            )
        elif r < 0.6:  # looked but missed (recognition/decision)
            stops.append((cx + rng.gauss(0, 10), cy + rng.gauss(0, 10), rng.uniform(350, 1600)))
        # else: never looked (search)
    rng.shuffle(stops)
    gaze, tele, t = [], [], 0.0
    sigma = accuracy_px / fit
    for i, (x, y, hold) in enumerate(stops):
        n = int(hold / 33)
        for k in range(n):
            jx, jy = rng.gauss(0, sigma * 0.35), rng.gauss(0, sigma * 0.35)
            gaze.append(
                {
                    "t": round(t, 1),
                    "sx": (x + jx) * fit,
                    "sy": (y + jy) * fit,
                    "x": x + jx,
                    "y": y + jy,
                    "sigma": round(sigma, 1),
                    "valid": rng.random() > 0.03,
                    "zoom": 1.0,
                    "vp": [0, 0, case["width"], case["height"]],
                }
            )
            # cursor: follows ~600 ms later, only on ~70 % of stops, with pointer jitter > 1 px to avoid the idle cap
            if i % 10 != 3 and k * 33 >= 600:
                tele.append(
                    {
                        "t": round(t, 1),
                        "kind": "move",
                        "x": x + rng.gauss(0, 12) + (k % 2) * 1.5,
                        "y": y + rng.gauss(0, 12),
                        "zoom": 1.0,
                        "vp": [0, 0, case["width"], case["height"]],
                        "loupe": True,
                    }
                )
            t += 33
    for m in marks:
        m["t"] = round(rng.uniform(t * 0.4, t * 0.95), 1)
    return gaze, tele, marks, t


def main(n: int, seed: int = 11) -> None:
    c = TestClient(app)
    rng = random.Random(seed)
    for p in range(n):
        acc = rng.choice([28, 40, 55, 70, 95])
        s = c.post("/api/sessions", json={"name": f"P{p + 1:02d}", "study": True, "gaze": True}).json()
        meta = {
            "schema": "gaze_session_meta.v1",
            "provider": "mock",
            "provider_version": "0.1.0",
            "screen": {"width": 1440, "height": 900, "dpr": 2},
            "validation": {
                "accuracy_px": acc,
                "precision_px": round(acc / 3, 1),
                "loss_pct": rng.choice([1, 3, 6, 12]),
                "n_points": 5,
            },
            "calibration": {"n_points": 9, "face_box": {"w": 180, "h": 220}, "face_lum": 110},
            "quality_tier": "good" if acc <= 50 else "coarse",
            "train_on_clicks": False,
            "study_mode": True,
            "timestamp": "2026-10-06T12:00:00Z",
            "drift_checks": [
                {"case_index": i, "error_px": round(acc * rng.uniform(0.8, 2.3), 1), "recalibrated": False}
                for i in range(1, 4)
            ],
        }
        c.put(f"/api/sessions/{s['id']}/gaze_meta", json=meta)
        while True:
            nxt = c.get("/api/cases/next", params={"session": s["id"]}).json()
            if nxt["done"]:
                break
            from .cases import load_case

            case = load_case(nxt["id"])
            gaze, tele, marks, read_ms = scripted_attempt(case, rng, acc)
            r = c.post(
                f"/api/attempts/{nxt['id']}/submit",
                json={
                    "session": s["id"],
                    "marks": marks,
                    "normal": not marks and rng.random() < 0.5,
                    "telemetry": tele,
                    "gaze": gaze,
                    "read_ms": read_ms,
                },
            )
            assert r.status_code == 200, r.text
        print(f"session {s['id']} ({meta['quality_tier']}, ±{acc} px) written")


if __name__ == "__main__":
    np.random.seed(0)
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 4)
