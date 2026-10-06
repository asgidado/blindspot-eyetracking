"""Step 7: descriptive scanpath facts. No order-compliance score (Kok 2016; van Geel 2017)."""

from __future__ import annotations

from .fixations import Fixation
from .masks import Mask, point_in

# review areas first so a fixation in the retrocardiac region is called that, not "left lower zone"
ZONE_PRIORITY = [
    "retrocardiac",
    "right_apex",
    "left_apex",
    "right_hilum",
    "left_hilum",
    "right_costophrenic_angle",
    "left_costophrenic_angle",
    "subdiaphragmatic",
    "mediastinum",
    "right_clavicle",
    "left_clavicle",
    "cardiac_silhouette",
    "right_upper_zone",
    "left_upper_zone",
    "right_mid_zone",
    "left_mid_zone",
    "right_lower_zone",
    "left_lower_zone",
    "right_periphery",
    "left_periphery",
    "spine",
]


def zone_of(zones: dict[str, Mask], x: float, y: float, priority: list[str] = ZONE_PRIORITY) -> str | None:
    for z in priority:
        m = zones.get(z)
        if m is not None and point_in(m, x, y):
            return z
    for z, m in zones.items():  # any zone not in the priority list
        if point_in(m, x, y):
            return z
    return None


def merge_segments(seq: list[dict], max_segments: int) -> list[dict]:
    """Merge consecutive same-zone segments, then drop the shortest until ≤ max_segments (re-merging neighbours)."""
    out: list[dict] = []
    for s in seq:
        if out and out[-1]["zone"] == s["zone"]:
            out[-1]["dwell_ms"] += s["dwell_ms"]
        else:
            out.append(dict(s))
    while len(out) > max_segments:
        i = min(range(len(out)), key=lambda k: out[k]["dwell_ms"])
        out.pop(i)
        if 0 < i < len(out) and out[i - 1]["zone"] == out[i]["zone"]:
            out[i - 1]["dwell_ms"] += out[i]["dwell_ms"]
            out.pop(i)
    return out


def scanpath_facts(
    fix: list[Fixation],
    zones: dict[str, Mask],
    roi_masks: dict[str, Mask],
    first_mark_ms: float | None,
    submit_ms: float,
    source: str,
    max_segments: int = 15,
) -> dict:
    labelled = [(f, zone_of(zones, f.x, f.y)) for f in fix if f.x is not None and f.y is not None]
    labelled = [(f, z) for f, z in labelled if z is not None]
    seq = [
        {
            "zone": z,
            "enter_ms": int(round(f.t_start)),
            "dwell_ms": int(round(f.duration_ms)),
            "source": source,
        }
        for f, z in labelled
    ]
    first_visits: list[str] = []
    revisits: dict[str, int] = {}
    prev = None
    for _, z in labelled:
        if z != prev:
            if z in first_visits:
                revisits[z] = revisits.get(z, 0) + 1
            else:
                first_visits.append(z)
        prev = z
    dwell_by_zone: dict[str, float] = {}
    for f, z in labelled:
        dwell_by_zone[z] = dwell_by_zone.get(z, 0.0) + f.duration_ms
    before = lambda t: [(f, z) for f, z in labelled if f.t_start <= t]  # noqa: E731
    ttf = {}
    for fid, m in roi_masks.items():
        hits = [f.t_start for f in fix if f.x is not None and f.y is not None and point_in(m, f.x, f.y)]
        ttf[fid] = int(round(min(hits))) if hits else None
    return {
        "first_zone": labelled[0][1] if labelled else None,
        "last_zone_before_first_mark": before(first_mark_ms)[-1][1]
        if first_mark_ms is not None and before(first_mark_ms)
        else None,
        "last_zone_before_submit": before(submit_ms)[-1][1]
        if before(submit_ms)
        else (labelled[-1][1] if labelled else None),
        "first_visits": first_visits,
        "revisits": revisits,
        "zone_sequence": merge_segments(seq, max_segments),
        "longest_dwell_zones": [
            (z, int(round(d))) for z, d in sorted(dwell_by_zone.items(), key=lambda kv: -kv[1])[:3]
        ],
        "fixation_count": len(fix),
        "time_to_first_fixation_ms": ttf,
        "dwell_by_zone": dwell_by_zone,
    }
