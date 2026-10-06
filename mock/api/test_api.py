from fastapi.testclient import TestClient

from mock.api.main import app

c = TestClient(app)


def test_flow_phantoms_no_ground_truth_before_submit(tmp_path, monkeypatch):
    from mock.api import store

    monkeypatch.setattr(store, "SESSIONS", tmp_path)
    cfg = c.get("/api/config").json()
    assert cfg["synthetic"] is True and "Synthetic" in cfg["badge"]
    s = c.post("/api/sessions", json={"name": "t", "study": True}).json()
    nxt = c.get("/api/cases/next", params={"session": s["id"]}).json()
    assert nxt["done"] is False and "findings" not in nxt and "zones" not in nxt
    assert c.get(f"/api/cases/{nxt['id']}/image").headers["content-type"] == "image/png"
    # study mode: fixed order == first 8 case ids
    assert s["case_order"][0] == "phantom_01"
    tele = [
        {
            "t": i * 33,
            "kind": "move",
            "x": 700 + (i % 3),
            "y": 240,
            "zoom": 1,
            "vp": [0, 0, 1024, 1024],
            "loupe": False,
        }
        for i in range(60)
    ]
    r = c.post(
        f"/api/attempts/{nxt['id']}/submit",
        json={
            "session": s["id"],
            "marks": [{"x": 703, "y": 238, "label": "nodule", "confidence": 4}],
            "telemetry": tele,
            "read_ms": 2000,
        },
    ).json()
    sc = r["scoring"]
    assert sc["summary"]["n_findings"] == 2
    f1 = next(f for f in sc["findings"] if f["finding_id"] == "F1")
    assert f1["outcome"] == "found"
    f2 = next(f for f in sc["findings"] if f["finding_id"] == "F2")
    assert f2["outcome"] == "missed" and f2["cursor_miss_type"] == "search"
    assert r["reveal"]["findings"] and r["reveal"]["zones"]
    assert r["synthetic"] is True
    la = next(ra for ra in r["review_areas"] if ra["zone"] == "left_apex")
    assert la["visited_cursor"] is True
    summ = c.get(f"/api/sessions/{s['id']}/summary").json()
    assert summ["n_cases"] == 1 and summ["miss_types"]["cursor"] == {"search": 1}


def test_overcall_and_mislabel(tmp_path, monkeypatch):
    from mock.api import store

    monkeypatch.setattr(store, "SESSIONS", tmp_path)
    s = c.post("/api/sessions", json={"name": "t", "study": True}).json()
    nxt = c.get("/api/cases/next", params={"session": s["id"]}).json()
    r = c.post(
        f"/api/attempts/{nxt['id']}/submit",
        json={
            "session": s["id"],
            "marks": [{"x": 703, "y": 238, "label": "mass"}, {"x": 100, "y": 100, "label": "nodule"}],
            "telemetry": [],
            "read_ms": 1000,
        },
    ).json()
    sc = r["scoring"]
    assert sc["summary"]["n_mislabeled"] == 1 and sc["summary"]["n_overcalls"] == 1


def test_replay_reanalyses_an_export(tmp_path, monkeypatch):
    from mock.api import store

    monkeypatch.setattr(store, "SESSIONS", tmp_path)
    s = c.post("/api/sessions", json={"name": "t", "study": True}).json()
    nxt = c.get("/api/cases/next", params={"session": s["id"]}).json()
    c.post(
        f"/api/attempts/{nxt['id']}/submit",
        json={"session": s["id"], "marks": [], "normal": True, "telemetry": [], "read_ms": 500},
    )
    exp = c.get(f"/api/sessions/{s['id']}/export").json()
    r = c.post("/api/replay", json=exp).json()
    assert r["recorded"] is True and len(r["results"]) == 1
    assert r["results"][0]["scoring"]["summary"]["n_missed"] == 2
    assert r["results"][0]["reveal"]["findings"]


def test_submit_with_gaze_yields_facts_and_both_attributions(tmp_path, monkeypatch):
    from mock.api import store

    monkeypatch.setattr(store, "SESSIONS", tmp_path)
    s = c.post("/api/sessions", json={"name": "t", "study": True, "gaze": True}).json()
    nxt = c.get(
        "/api/cases/next", params={"session": s["id"]}
    ).json()  # phantom_01: F1 nodule left apex (~703,238), F2 consolidation right lower zone
    # gaze: 1.5 s retrocardiac, then ~0.5 s on the apex nodule (sigma 30 => lesion), then 1.5 s elsewhere; cursor stays idle
    pts = [(620, 660, 1500), (703, 238, 500), (330, 520, 1500)]
    gaze, t = [], 0.0
    for x, y, hold in pts:
        for _ in range(int(hold / 33)):
            gaze.append(
                {
                    "t": t,
                    "sx": x * 0.8,
                    "sy": y * 0.8,
                    "x": x,
                    "y": y,
                    "sigma": 30.0,
                    "valid": True,
                    "zoom": 1.0,
                    "vp": [0, 0, 1024, 1024],
                }
            )
            t += 33
    meta = {
        "schema": "gaze_session_meta.v1",
        "provider": "mock",
        "provider_version": "0.1.0",
        "screen": {"width": 1440, "height": 900, "dpr": 2},
        "validation": {"accuracy_px": 24, "precision_px": 8, "loss_pct": 1, "n_points": 5},
        "calibration": {"n_points": 9, "face_box": {"w": 180, "h": 220}},
        "quality_tier": "good",
        "train_on_clicks": False,
        "study_mode": True,
        "timestamp": "2026-10-06T12:00:00Z",
    }
    tele = [
        {
            "t": i * 33,
            "kind": "move",
            "x": 330 + (i % 2),
            "y": 520,
            "zoom": 1,
            "vp": [0, 0, 1024, 1024],
            "loupe": False,
        }
        for i in range(100)
    ]
    r = c.post(
        f"/api/attempts/{nxt['id']}/submit",
        json={
            "session": s["id"],
            "marks": [],
            "telemetry": tele,
            "gaze": gaze,
            "gaze_meta": meta,
            "read_ms": t,
        },
    ).json()
    assert r["gaze_used"] is True
    f1 = next(f for f in r["scoring"]["findings"] if f["finding_id"] == "F1")
    assert f1["cursor_miss_type"] == "search"
    assert f1["gaze"]["resolution"] == "lesion" and f1["gaze"]["miss_type"] == "recognition"
    facts = r["facts"]
    assert (
        facts["schema"] == "gaze_facts.v1" and facts["phase"] == "post_submit" and facts["synthetic"] is True
    )
    assert "gaze" in facts["attention"]["sources"]
    ff = next(f for f in facts["findings"] if f["finding_id"] == "F1")
    assert ff["agreement"] == "disagree" and ff["location"] == "left apex"
    assert r["facts_bytes"] < 6000
    assert "Template" not in r["debrief"] and "saw" not in r["debrief"].lower()
    assert "your eyes reached" in r["debrief"]
    rp = r["replay"]
    assert rp["gaze_rows"] and rp["heatmap_gaze_png"] and rp["fixations"]
    assert any(ra["zone"] == "retrocardiac" and ra["visited_gaze"] for ra in r["review_areas"])
    summ = c.get(f"/api/sessions/{s['id']}/summary").json()
    assert (
        summ["miss_types"]["gaze"] == {"recognition": 1, "search": 1}
        and summ["miss_type_confusion"]["n"] == 2
    )


def test_real_films_badge_switches_and_removal_returns_to_phantoms(tmp_path, monkeypatch):
    import json
    import shutil

    from mock.api import cases

    films = tmp_path / "films"
    films.mkdir()
    shutil.copy("mock/phantoms/cases/phantom_01.png", films / "film_1.png")
    case = json.loads(open("mock/phantoms/cases/phantom_01.json").read()) | {
        "id": "film_1",
        "source": "chestx-det",
    }
    (films / "film_1.json").write_text(json.dumps(case))
    (films / "index.json").write_text(json.dumps({"source": "chestx-det", "cases": ["film_1"]}))
    monkeypatch.setattr(cases, "FILMS", films)
    cases.load_case.cache_clear()
    cases.masks_for.cache_clear()
    assert c.get("/api/config").json()["badge"] == "Mock · Real films (ChestX-Det)"
    assert c.get("/api/config").json()["synthetic"] is False
    shutil.rmtree(films)
    assert c.get("/api/config").json()["badge"] == "Mock · Synthetic films"
    cases.load_case.cache_clear()
    cases.masks_for.cache_clear()
