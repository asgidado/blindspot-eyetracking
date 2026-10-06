from .report import build_report


def test_report_renders_with_n_and_kappa_and_synthetic_label():
    sessions = [
        {
            "synthetic": True,
            "name": "P01",
            "gaze_meta": {
                "provider": "mock",
                "provider_version": "0.1.0",
                "quality_tier": "coarse",
                "validation": {"accuracy_px": 55, "precision_px": 18, "loss_pct": 3},
                "drift_checks": [{"case_index": 1, "error_px": 60, "recalibrated": False}],
            },
            "attempts": [
                {
                    "result": {
                        "gaze_used": True,
                        "gaze_stats": {"n_valid": 300},
                        "facts": {
                            "agreement": {
                                "median_gaze_cursor_px": {"idle": 150, "moving": 80, "loupe": 70},
                                "gaze_leads_cursor_ms": 600,
                            }
                        },
                        "review_areas": [
                            {"zone": "retrocardiac", "visited_cursor": False, "visited_gaze": True},
                            {"zone": "left_apex", "visited_cursor": True, "visited_gaze": True},
                            {"zone": "right_apex", "visited_cursor": False, "visited_gaze": False},
                        ],
                        "scoring": {
                            "findings": [
                                {"cursor_miss_type": "search", "gaze_miss_type": "recognition", "gaze": {}},
                                {"cursor_miss_type": "search", "gaze_miss_type": "search", "gaze": {}},
                            ]
                        },
                    }
                }
            ],
        }
    ]
    md = build_report(sessions)
    assert "SYNTHETIC" in md and "SCRIPTED" in md
    assert "| sessions | 1 |" in md and "n = 2 missed findings" in md
    assert "Cohen's κ" in md and "| P01 | mock 0.1.0 | coarse | 55 | 18 | 3 | 1 | 0 |" in md
    assert "**600 ms**" in md
