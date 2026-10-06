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
