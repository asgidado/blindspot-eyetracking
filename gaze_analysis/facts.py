"""Step 10: the GazeFacts block — the ONLY gaze-derived thing any language model receives — plus a prose rendering
and a claim validator. Anatomy not pixels; units and sources on every number; comparisons precomputed."""

from __future__ import annotations

import json
import re
from typing import Any

REFERENCES = {
    "expert_annotation": "radiologist-drawn finding outlines; ground truth",
    "review_area_checklist": "commonly taught chest X-ray blind spots; teaching convention",
    "kundel_dwell_bands": "published eye-tracker thresholds, applied to webcam/cursor estimates",
}
CLAIM_LIMITS = {
    "never_say": [
        "saw",
        "noticed",
        "should have looked in this order",
        "radiologists always look",
        "you missed because",
        "perceived",
    ],
    "finding_level_gaze_claims_only_if": "finding.gaze.resolution == 'lesion'",
    "describe_order_as": "descriptive only",
}


def zone_ref(zone: str | None, human: dict[str, str], source: str) -> dict | None:
    return (
        None
        if zone is None
        else {"zone": zone, "human": human.get(zone, zone.replace("_", " ")), "source": source}
    )


def build_facts(
    *,
    phase: str,
    synthetic: bool,
    zone_human: dict[str, str],
    total_read_ms: float,
    first_mark_ms: float | None,
    search: dict | None,
    search_source: str,
    review_areas: list[dict],
    coverage: dict | None,
    findings: list[dict] | None,
    agreement: dict | None,
    history: dict | None,
    gaze_quality: str | None,
    gaze_accuracy_img_px_at_fit: float | None,
    supports: str,
    bands: tuple[float, float],
) -> dict[str, Any]:
    attention: dict[str, Any] = {
        "sources": ["gaze", "cursor"] if gaze_quality else ["cursor"],
        "supports": supports,
    }
    if gaze_quality:
        attention["gaze_quality"] = gaze_quality
        attention["gaze_accuracy_img_px_at_fit"] = round(gaze_accuracy_img_px_at_fit or 0)
    s: dict[str, Any] = {
        "total_read_ms": round(total_read_ms),
        "first_mark_ms": None if first_mark_ms is None else round(first_mark_ms),
        "zone_sequence": [],
    }
    if search:
        for k in ("first_zone", "last_zone_before_first_mark", "last_zone_before_submit"):
            zr = zone_ref(search.get(k), zone_human, search_source)
            if zr:
                s[k] = zr
        s["zone_sequence"] = [
            dict(seg, human=zone_human.get(seg["zone"], seg["zone"]))
            for seg in search.get("zone_sequence", [])
        ][:15]
        if search.get("revisits"):
            s["revisits"] = search["revisits"]
        s["longest_dwell_zones"] = [
            {"zone": z, "human": zone_human.get(z, z), "dwell_ms": round(d), "source": search_source}
            for z, d in search.get("longest_dwell_zones", [])
        ]
        s["fixation_count"] = search.get("fixation_count", 0)
        s["order_note"] = (
            "viewing order is reported descriptively; systematic order is not validated as improving detection"
        )
    facts: dict[str, Any] = {
        "schema": "gaze_facts.v1",
        "phase": phase,
        "synthetic": synthetic,
        "attention": attention,
        "search": s,
        "review_areas": review_areas,
        "references": REFERENCES,
        "claim_limits": CLAIM_LIMITS,
    }
    if coverage:
        facts["coverage"] = coverage
    if phase == "post_submit":
        facts["findings"] = [
            dict(
                f,
                bands_ms={"recognition_from": bands[0], "decision_from": bands[1]},
                reference="expert_annotation",
            )
            for f in (findings or [])
        ]
        if agreement:
            facts["agreement"] = agreement
    if history:
        facts["history"] = history
    return facts


def to_prompt_text(f: dict[str, Any]) -> str:
    """Deterministic plain-text rendering: short labelled bullets."""
    L: list[str] = []
    a = f["attention"]
    L.append(f"- phase: {f['phase']}" + (" (SYNTHETIC case/session)" if f.get("synthetic") else ""))
    L.append(
        f"- attention sources: {', '.join(a['sources'])}; supports: {a['supports'].replace('_', ' ')}"
        + (
            f"; webcam gaze quality {a['gaze_quality']}, ±{a['gaze_accuracy_img_px_at_fit']} image px at fit"
            if "gaze_quality" in a
            else ""
        )
    )
    s = f["search"]
    L.append(
        f"- total read: {s['total_read_ms']} ms"
        + (
            f"; first mark at {s['first_mark_ms']} ms"
            if s.get("first_mark_ms") is not None
            else "; no marks placed"
        )
    )
    for k, lab in (
        ("first_zone", "first zone"),
        ("last_zone_before_first_mark", "last zone before first mark"),
        ("last_zone_before_submit", "last zone before submit"),
    ):
        if k in s:
            L.append(f"- {lab}: {s[k]['human']} ({s[k]['source']})")
    if s.get("zone_sequence"):
        L.append(
            "- zone order (descriptive only): "
            + " → ".join(
                f"{seg.get('human', seg['zone'])} {seg['dwell_ms']:.0f} ms" for seg in s["zone_sequence"]
            )
        )
    if s.get("longest_dwell_zones"):
        L.append(
            "- longest dwell: "
            + ", ".join(f"{z['human']} {z['dwell_ms']} ms" for z in s["longest_dwell_zones"])
        )
    for ra in f.get("review_areas", []):
        g = (
            f"gaze {ra['gaze_dwell_ms']:.0f} ms ({ra.get('gaze_resolution', '?')}) → {'visited' if ra.get('visited_gaze') else 'not visited'}; "
            if "gaze_dwell_ms" in ra
            else ""
        )
        L.append(
            f"- review area {ra['human']} (hardness {ra['hardness']}): {g}cursor {ra['cursor_dwell_ms']:.0f} ms → {'visited' if ra['visited_cursor'] else 'not visited'}; visit threshold {ra['visit_threshold_ms']} ms [review_area_checklist]"
        )
    if f.get("coverage"):
        c = f["coverage"]
        L.append(
            "- coverage (hardness-weighted): "
            + "; ".join(
                x
                for x in [
                    f"gaze {c['gaze_weighted_pct']}%" if "gaze_weighted_pct" in c else "",
                    f"cursor {c['cursor_weighted_pct']}%" if "cursor_weighted_pct" in c else "",
                ]
                if x
            )
            + (
                f"; unvisited hard areas (gaze): {', '.join(c['unvisited_hard_gaze']) or 'none'}"
                if "unvisited_hard_gaze" in c
                else ""
            )
        )
    for fi in f.get("findings", []):
        b = fi["bands_ms"]
        line = (
            f"- finding {fi['finding_id']} {fi['label']} in {fi['location']}: {fi['outcome']}; cursor dwell {fi['cursor']['dwell_ms']:.0f} ms"
            + (f" → {fi['cursor']['miss_type']} error" if fi["cursor"].get("miss_type") else "")
        )
        if fi.get("gaze"):
            g = fi["gaze"]
            line += f"; gaze dwell {g['dwell_ms']:.0f} ms at {g['resolution']} resolution" + (
                f" → {g['miss_type']} error (confidence {g.get('miss_type_confidence', 0):.2f})"
                if g.get("miss_type")
                else " → no finding-level type (zone-level only)"
            )
            if g.get("time_to_first_ms") is not None:
                line += f"; eyes first reached the area at {g['time_to_first_ms']:.0f} ms"
        line += (
            f"; bands: recognition from {b['recognition_from']:.0f} ms, decision from {b['decision_from']:.0f} ms [kundel_dwell_bands]"
            + (f"; sources {fi['agreement']}" if fi.get("agreement") else "")
        )
        L.append(line)
    if f.get("agreement"):
        ag = f["agreement"]
        med = ag.get("median_gaze_cursor_px") or {}
        L.append(
            f"- cursor–gaze agreement (n={ag.get('n_samples', 0)} samples): median distance idle {_fmt(med.get('idle'))} px, moving {_fmt(med.get('moving'))} px, loupe {_fmt(med.get('loupe'))} px; gaze leads cursor by {_fmt(ag.get('gaze_leads_cursor_ms'))} ms; review-area visited agreement {_fmt(ag.get('review_area_visited_agreement_pct'))}% (κ {_fmt(ag.get('review_area_kappa'))})"
        )
    if f.get("history"):
        h = f["history"]
        L.append(
            f"- history over {h['n_cases']} cases: unvisited review areas "
            + (", ".join(f"{z} ×{n}" for z, n in h.get("review_area_unvisited", {}).items()) or "none")
            + "; miss types "
            + json.dumps(h.get("miss_types", {}), separators=(",", ":"))
        )
    L.append(
        "- claim limits: never say "
        + ", ".join(f'"{w}"' for w in f["claim_limits"]["never_say"])
        + "; finding-level gaze claims only if gaze resolution is 'lesion'; describe order as descriptive only."
    )
    return "\n".join(L)


def validate_claim(sentence: str, facts: dict[str, Any]) -> list[str]:
    """Returns a list of violations (empty = OK) for one generated sentence against claim_limits and the facts."""
    v: list[str] = []
    low = sentence.lower()
    for w in facts["claim_limits"]["never_say"]:
        if re.search(rf"\b{re.escape(w.lower())}\b", low):
            v.append(f"forbidden phrase: '{w}'")
    for fi in facts.get("findings", []):
        g = fi.get("gaze")
        mentions = (
            fi["finding_id"].lower() in low or fi["label"].lower() in low or fi["location"].lower() in low
        )
        if (
            mentions
            and re.search(r"\b(gaze|eyes?|looked|glance)\b", low)
            and g
            and g.get("resolution") != "lesion"
            and re.search(r"\b(search|recognition|decision) error\b", low)
        ):
            v.append(f"finding-level gaze claim for {fi['finding_id']} at {g.get('resolution')} resolution")
    if re.search(r"\b(should|must|always)\b.*\border\b|\bcorrect order\b|\bright order\b", low):
        v.append("prescriptive viewing-order claim")
    nums = _numbers(facts)
    for m in re.finditer(r"(\d{2,6})\s*ms", low):
        n = int(m.group(1))
        if not any(
            abs(n - n0) <= max(50, 0.15 * n0) for n0 in nums
        ):  # "about 500 ms" for a 467 ms fact is fine
            v.append(f"number {n} ms not in facts")
    return v


def _fmt(x: Any) -> str:
    return (
        "n/a"
        if x is None
        else f"{x:.0f}"
        if isinstance(x, int | float) and abs(x) >= 10
        else f"{x:.2f}"
        if isinstance(x, int | float)
        else str(x)
    )


def _numbers(facts: dict[str, Any]) -> set[int]:
    out: set[int] = set()

    def walk(x: Any) -> None:
        if isinstance(x, dict):
            for k, val in x.items():
                if k.endswith("_ms") or k in ("recognition_from", "decision_from"):
                    if isinstance(val, int | float) and val is not None:
                        out.add(int(round(val)))
                walk(val)
        elif isinstance(x, list):
            for i in x:
                walk(i)

    walk(facts)
    return out
