"""Step 6: review-area coverage (hardness-weighted) from per-area dwell. Source-agnostic: works for gaze or cursor dwell."""

from __future__ import annotations


def coverage(
    dwell_by_area: dict[str, float], hardness: dict[str, float], visit_ms: float, hard_min: float
) -> dict:
    visited = {z: dwell_by_area.get(z, 0.0) >= visit_ms for z in hardness}
    wsum = sum(hardness.values()) or 1.0
    weighted = 100.0 * sum(h for z, h in hardness.items() if visited[z]) / wsum
    unvisited_hard = [
        z for z, h in sorted(hardness.items(), key=lambda kv: -kv[1]) if h >= hard_min and not visited[z]
    ]
    return {
        "visited": visited,
        "weighted_pct": round(weighted, 1),
        "unvisited_hard": unvisited_hard,
        "n_areas": len(hardness),
    }
