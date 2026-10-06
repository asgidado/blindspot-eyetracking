"""Deterministic templated debrief (~100 words) filled from facts only. No AI here: in the real build Claude writes this
from the same GazeFacts under the same claim limits. Every gaze sentence obeys §5.10: 'your eyes reached …', never 'saw'."""

from __future__ import annotations

from gaze_analysis.facts import validate_claim


def template_debrief(facts: dict, scoring: dict) -> str:
    s = scoring["summary"]
    parts: list[str] = []
    n = s["n_findings"]
    if n == 0:
        parts.append(
            "This case had no focal findings."
            + (
                " You correctly called it normal."
                if scoring["called_normal"]
                else f" You placed {s['n_overcalls']} mark{'s' if s['n_overcalls'] != 1 else ''} that did not match an expert outline."
            )
        )
    else:
        parts.append(
            f"Of {n} expert finding{'s' if n != 1 else ''}, you found {s['n_found']}, mislabeled {s['n_mislabeled']} and missed {s['n_missed']}"
            + (
                f", with {s['n_overcalls']} overcall{'s' if s['n_overcalls'] != 1 else ''}."
                if s["n_overcalls"]
                else "."
            )
        )
    gaze_on = "gaze" in facts["attention"]["sources"]
    missed = [f for f in facts.get("findings", []) if f["outcome"] == "missed"]
    for f in missed[:2]:
        c = f["cursor"]
        line = f"The {f['label']} in the {f['location']}: by cursor, dwell {c['dwell_ms']:.0f} ms points to a {c['miss_type']} error."
        g = f.get("gaze")
        if gaze_on and g:
            if g["resolution"] == "lesion" and g.get("miss_type"):
                line += (
                    f" Webcam gaze agrees{' ' if f.get('agreement') == 'agree' else ' only partly: '}"
                    if f.get("agreement") == "agree"
                    else " Webcam gaze differs: "
                )
                line += f"your eyes reached this area for about {g['dwell_ms']:.0f} ms, a {g['miss_type']} error by the same bands."
            else:
                line += f" Webcam gaze (±{facts['attention'].get('gaze_accuracy_img_px_at_fit', '?')} px) is only zone-level here: your eyes reached the surrounding zone for about {g['dwell_ms']:.0f} ms; it cannot say more at this zoom."
        parts.append(line)
    cov = facts.get("coverage", {})
    unv = cov.get("unvisited_hard_gaze") if gaze_on else cov.get("unvisited_hard_cursor")
    src = "your eyes" if gaze_on else "your cursor"
    if unv:
        names = [ra["human"] for ra in facts["review_areas"] if ra["zone"] in unv][:3]
        parts.append(
            f"Review areas {src} never reached: {', '.join(names)}. These are commonly taught blind spots; dwelling there for at least {facts['review_areas'][0]['visit_threshold_ms']:.0f} ms counts as a visit."
        )
    else:
        parts.append(f"{src.capitalize()} reached every hard review area in this case.")
    sr = facts["search"]
    if sr.get("first_zone") and sr.get("last_zone_before_submit"):
        parts.append(
            f"You started in the {sr['first_zone']['human']} and finished in the {sr['last_zone_before_submit']['human']} ({sr['first_zone']['source']}); order is reported descriptively, not as a rule."
        )
    text = " ".join(parts)
    # self-check against the claim limits; strip any sentence that fails rather than ship it
    kept = [sent for sent in text.split(". ") if not validate_claim(sent, facts)]
    return ". ".join(kept).rstrip(".") + "."


def facts_card(facts: dict, scoring: dict) -> list[tuple[str, str]]:
    a, s, sr = facts["attention"], scoring["summary"], facts["search"]
    rows = [
        (
            "Findings",
            f"{s['n_found']} found · {s['n_mislabeled']} mislabeled · {s['n_missed']} missed · {s['n_overcalls']} overcalls",
        ),
        (
            "Attention sources",
            ", ".join(a["sources"])
            + (
                f" · webcam gaze {a.get('gaze_quality')} ±{a.get('gaze_accuracy_img_px_at_fit')} px at fit"
                if "gaze_quality" in a
                else ""
            ),
        ),
        (
            "Read time",
            f"{sr['total_read_ms'] / 1000:.1f} s"
            + (
                f" · first mark at {sr['first_mark_ms'] / 1000:.1f} s"
                if sr.get("first_mark_ms") is not None
                else ""
            ),
        ),
    ]
    if sr.get("first_zone"):
        rows.append(("Started in", f"{sr['first_zone']['human']} ({sr['first_zone']['source']})"))
    if sr.get("last_zone_before_submit"):
        rows.append(
            (
                "Ended in",
                f"{sr['last_zone_before_submit']['human']} ({sr['last_zone_before_submit']['source']})",
            )
        )
    cov = facts.get("coverage", {})
    if "gaze_weighted_pct" in cov:
        rows.append(
            (
                "Review-area coverage (gaze)",
                f"{cov['gaze_weighted_pct']} % hardness-weighted · unvisited hard: {', '.join(cov.get('unvisited_hard_gaze', [])) or 'none'}",
            )
        )
    if "cursor_weighted_pct" in cov:
        rows.append(
            (
                "Review-area coverage (cursor)",
                f"{cov['cursor_weighted_pct']} % hardness-weighted · unvisited hard: {', '.join(cov.get('unvisited_hard_cursor', [])) or 'none'}",
            )
        )
    ag = facts.get("agreement")
    if ag and ag.get("n_samples"):
        med = ag.get("median_gaze_cursor_px") or {}
        rows.append(
            (
                "Cursor–gaze",
                f"n={ag['n_samples']} · median distance idle {_f(med.get('idle'))} / moving {_f(med.get('moving'))} / loupe {_f(med.get('loupe'))} img px · gaze leads cursor {_f(ag.get('gaze_leads_cursor_ms'))} ms · review-area agreement {_f(ag.get('review_area_visited_agreement_pct'))} % (κ {ag.get('review_area_kappa')})",
            )
        )
    return rows


def _f(x):
    return "n/a" if x is None else f"{x:.0f}"
