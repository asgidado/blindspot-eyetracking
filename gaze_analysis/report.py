"""`python -m gaze_analysis.report sessions/*.json` → reports/AGREEMENT.md: the §5.8 cursor–gaze agreement tables with n.

Works from stored per-attempt results (facts + agreement + scoring), so it needs no case masks and no app code.
Sessions that are synthetic or scripted are labelled as such; nothing simulated is presented as real.
"""

from __future__ import annotations

import json
import statistics as st
import sys
from pathlib import Path

from .agreement import confusion, visited_agreement


def _med(xs: list[float]) -> str:
    xs = [x for x in xs if x is not None]
    return f"{st.median(xs):.0f}" if xs else "n/a"


def build_report(sessions: list[dict]) -> str:
    synthetic = any(s.get("synthetic", True) for s in sessions)
    all_scripted = all(
        ((s.get("gaze_meta") or {}).get("provider") == "mock") for s in sessions if s.get("gaze_meta")
    )
    L: list[str] = ["# Cursor–gaze agreement report", ""]
    label = []
    if synthetic:
        label.append("**SYNTHETIC** (phantom films)")
    if all_scripted and sessions:
        label.append("**SCRIPTED gaze** (mock provider — no human eyes were tracked)")
    L.append(
        "Status: "
        + (", ".join(label) if label else "real films, live webcam gaze")
        + f". Sessions n = {len(sessions)}."
    )
    L.append("")
    L.append(
        "Webcam gaze is coarse and accuracy varies by person (glasses, lighting, camera). Every number below is an estimate from the session's own calibration; see the per-participant table."
    )
    L.append("")

    attempts = [(s, a) for s in sessions for a in s.get("attempts", [])]
    gaze_attempts = [(s, a) for s, a in attempts if a.get("result", {}).get("gaze_used")]
    L += [
        "## Data",
        "",
        "| | n |",
        "|---|---|",
        f"| sessions | {len(sessions)} |",
        f"| cases read | {len(attempts)} |",
        f"| cases with usable gaze | {len(gaze_attempts)} |",
        f"| gaze samples (valid) | {sum((a['result'].get('gaze_stats') or {}).get('n_valid', 0) for _, a in gaze_attempts)} |",
        "",
    ]

    # per-participant accuracy (anonymous codes)
    L += [
        "## Per-participant validation (anonymous codes)",
        "",
        "| code | provider | tier | accuracy screen px | precision px | loss % | drift checks | recalibrated |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for i, s in enumerate(sessions):
        m = s.get("gaze_meta")
        if not m:
            L.append(f"| P{i + 1:02d} | — | no gaze | | | | | |")
            continue
        v, dc = m["validation"], m.get("drift_checks") or []
        L.append(
            f"| P{i + 1:02d} | {m['provider']} {m.get('provider_version', '')} | {m['quality_tier']} | {v['accuracy_px']:.0f} | {v['precision_px']:.0f} | {v['loss_pct']:.0f} | {len(dc)} | {sum(1 for d in dc if d.get('recalibrated'))} |"
        )
    L.append("")

    # §5.8 distances and lag
    idle, moving, loupe, lag = [], [], [], []
    for _, a in gaze_attempts:
        ag = (a["result"].get("facts") or {}).get("agreement") or {}
        med = ag.get("median_gaze_cursor_px") or {}
        idle.append(med.get("idle"))
        moving.append(med.get("moving"))
        loupe.append(med.get("loupe"))
        lag.append(ag.get("gaze_leads_cursor_ms"))
    L += [
        "## Gaze–cursor distance by cursor state (image px, median of per-case medians)",
        "",
        "| cursor state | median px | n cases |",
        "|---|---|---|",
        f"| idle | {_med(idle)} | {sum(x is not None for x in idle)} |",
        f"| moving | {_med(moving)} | {sum(x is not None for x in moving)} |",
        f"| loupe on | {_med(loupe)} | {sum(x is not None for x in loupe)} |",
        "",
        f"Gaze-leads-cursor lag (cross-correlation, median over cases): **{_med(lag)} ms** (n = {sum(x is not None for x in lag)}). Positive = cursor lags gaze.",
        "",
    ]

    # review-area visited agreement
    pairs_c, pairs_g = {}, {}
    pc_all, pg_all = [], []
    for k, (_, a) in enumerate(gaze_attempts):
        for ra in a["result"].get("review_areas", []):
            if "visited_gaze" in ra:
                pairs_c[f"{k}:{ra['zone']}"] = bool(ra["visited_cursor"])
                pairs_g[f"{k}:{ra['zone']}"] = bool(ra["visited_gaze"])
                pc_all.append(ra["visited_cursor"])
                pg_all.append(ra["visited_gaze"])
    va = visited_agreement(pairs_c, pairs_g)
    L += [
        "## Review-area visited: cursor vs gaze",
        "",
        "| | value |",
        "|---|---|",
        f"| area-cases compared (n) | {va['n']} |",
        f"| % agreement | {va['pct'] if va['pct'] is not None else 'n/a'} |",
        f"| Cohen's κ | {va['kappa'] if va['kappa'] is not None else 'n/a'} |",
        f"| visited by cursor | {sum(pc_all)} / {len(pc_all)} |",
        f"| visited by gaze | {sum(pg_all)} / {len(pg_all)} |",
        "",
    ]

    # miss-type confusion
    pairs = [
        (f["cursor_miss_type"], f["gaze_miss_type"])
        for _, a in gaze_attempts
        for f in a["result"]["scoring"]["findings"]
        if f.get("cursor_miss_type") and f.get("gaze_miss_type")
    ]
    zone_only = sum(
        1
        for _, a in gaze_attempts
        for f in a["result"]["scoring"]["findings"]
        if f.get("cursor_miss_type") and f.get("gaze") and not f.get("gaze_miss_type")
    )
    cm = confusion(pairs)
    labs = ("search", "recognition", "decision")
    L += [
        "## Miss types: cursor proxy (rows) vs webcam gaze (columns)",
        "",
        f"n = {cm['n']} missed findings with a gaze type at `lesion` resolution; {zone_only} more were missed but gaze was zone-level only (no type).",
        "",
        "| cursor \\ gaze | " + " | ".join(labs) + " |",
        "|---|" + "---|" * len(labs),
    ]
    for r in labs:
        L.append(f"| {r} | " + " | ".join(str(cm["matrix"][r][c]) for c in labs) + " |")
    L += [
        "",
        f"% agreement: **{cm['pct'] if cm['pct'] is not None else 'n/a'}**, Cohen's κ: **{cm['kappa'] if cm['kappa'] is not None else 'n/a'}**.",
        "",
    ]
    L += [
        "## Notes",
        "",
        "- Cursor dwell follows Blindspot's §7.1 proxy (cursor, loupe, zoom); gaze dwell is probabilistic with per-sample σ.",
        "- Kundel bands (300 / 1000 ms) come from lab eye trackers and are applied here to webcam and cursor estimates.",
        "- Systematic viewing order is not reported as a score (Kok 2016; van Geel 2017).",
        "",
    ]
    return "\n".join(L)


def main(argv: list[str]) -> int:
    paths = [Path(p) for p in argv if Path(p).exists()]
    if not paths:
        print("usage: python -m gaze_analysis.report sessions/*.json", file=sys.stderr)
        return 2
    sessions = [json.loads(p.read_text()) for p in sorted(paths)]
    out = Path("reports") / "AGREEMENT.md"
    out.parent.mkdir(exist_ok=True)
    out.write_text(build_report(sessions))
    print(f"wrote {out} from {len(sessions)} session(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
