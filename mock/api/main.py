"""Mock Blindspot API. Ground truth never reaches the client before submit."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import cases, store
from .analysis import analyse_attempt, session_summary
from .config import ROOT, gaze_cfg, mock_cfg

app = FastAPI(title="blindspot-gaze mock API")
api = FastAPI()
app.mount("/api", api)


@api.get("/config")
def config() -> dict:
    return {
        "gaze": gaze_cfg(),
        "mock": mock_cfg(),
        "badge": cases.badge(),
        "synthetic": cases.is_synthetic(),
        "n_cases": len(cases.case_ids()),
    }


class NewSession(BaseModel):
    name: str = "Learner"
    study: bool = False
    gaze: bool = False


@api.post("/sessions")
def create_session(body: NewSession) -> dict:
    ids = cases.case_ids()
    n = mock_cfg()["session"]["cases_per_session"]
    if body.study:
        order = ids[:n]  # fixed order in study mode
    else:
        import random

        order = random.Random().sample(ids, min(n, len(ids)))
    return store.new_session(
        body.name, body.study, body.gaze, "synthetic" if cases.is_synthetic() else "chestx-det", order
    )


@api.get("/sessions/{sid}")
def get_session(sid: str) -> dict:
    try:
        s = store.load(sid)
    except KeyError as e:
        raise HTTPException(404) from e
    return {k: v for k, v in s.items() if k != "attempts"} | {"n_attempts": len(s["attempts"])}


class GazeMetaBody(BaseModel):
    model_config = {"extra": "allow"}


@api.put("/sessions/{sid}/gaze_meta")
def put_gaze_meta(sid: str, body: dict[str, Any]) -> dict:
    from shared.schemas.loader import validate

    try:
        validate("GazeSessionMeta", body)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, str(e)) from e
    s = store.load(sid)
    s["gaze_meta"] = body
    store.save(s)
    return {"ok": True}


@api.get("/cases/next")
def next_case(session: str = Query(...)) -> dict:
    s = store.load(session)
    i = len(s["attempts"])
    if i >= len(s["case_order"]):
        return {"done": True, "index": i, "total": len(s["case_order"])}
    c = cases.load_case(s["case_order"][i])
    return cases.public_view(c, i, len(s["case_order"])) | {"done": False}


@api.get("/cases/{cid}/image")
def case_image(cid: str) -> FileResponse:
    p = cases.image_path(cid)
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p, media_type="image/png")


class Mark(BaseModel):
    x: float
    y: float
    label: str
    confidence: int = Field(ge=1, le=5, default=3)
    t: float | None = None


class Submit(BaseModel):
    session: str
    marks: list[Mark] = []
    normal: bool = False
    globals_: list[str] = Field(default=[], alias="globals")
    telemetry: list[dict[str, Any]] = []
    gaze: list[dict[str, Any]] | None = None
    gaze_meta: dict[str, Any] | None = None
    read_ms: float | None = None

    model_config = {"populate_by_name": True}


@api.post("/attempts/{cid}/submit")
def submit(cid: str, body: Submit) -> dict:
    try:
        s = store.load(body.session)
        case = cases.load_case(cid)
    except KeyError as e:
        raise HTTPException(404, "unknown session or case") from e
    if body.gaze_meta:
        s["gaze_meta"] = body.gaze_meta
    if s.get("study"):
        from shared.schemas.loader import validate

        try:
            if s.get("gaze_meta"):
                validate("GazeSessionMeta", s["gaze_meta"])
            for smp in body.gaze or []:
                validate("GazeSample", smp)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(422, f"study-mode export must be schema-valid: {e}") from e
    marks = [m.model_dump() for m in body.marks]
    result = analyse_attempt(
        case,
        marks,
        body.normal,
        body.globals_,
        body.telemetry,
        body.gaze,
        s.get("gaze_meta"),
        s,
        body.read_ms,
    )
    s["attempts"].append(
        {
            "case_id": cid,
            "marks": marks,
            "normal": body.normal,
            "globals": body.globals_,
            "read_ms": body.read_ms,
            "telemetry": body.telemetry,
            "gaze": body.gaze,
            "result": {k: v for k, v in result.items() if k not in ("telemetry", "gaze")},
        }
    )
    store.save(s)
    return result | {
        "reveal": {
            "zones": case["zones"],
            "findings": case["findings"],
            "global_findings": case.get("global_findings", []),
        }
    }


class ReplayBody(BaseModel):
    """A session export (GET /sessions/{id}/export) uploaded for replay. Re-analysed; never stored."""

    model_config = {"extra": "allow"}
    attempts: list[dict[str, Any]]
    gaze_meta: dict[str, Any] | None = None
    name: str = "Recorded session"
    synthetic: bool = True


@api.post("/replay")
def replay(body: ReplayBody) -> dict:
    out = []
    pseudo = {"synthetic": body.synthetic, "attempts": [], "name": body.name, "gaze_meta": body.gaze_meta}
    for a in body.attempts:
        try:
            case = cases.load_case(a["case_id"])
        except KeyError:
            out.append({"case_id": a.get("case_id"), "error": "case not available in this install"})
            continue
        r = analyse_attempt(
            case,
            a.get("marks", []),
            a.get("normal", False),
            a.get("globals", []),
            a.get("telemetry", []),
            a.get("gaze"),
            body.gaze_meta,
            pseudo,
            a.get("read_ms"),
        )
        pseudo["attempts"].append({"case_id": a["case_id"], "result": r})
        out.append(
            r
            | {
                "case_id": case["id"],
                "width": case["width"],
                "height": case["height"],
                "reveal": {
                    "zones": case["zones"],
                    "findings": case["findings"],
                    "global_findings": case.get("global_findings", []),
                },
            }
        )
    return {
        "recorded": True,
        "name": body.name,
        "synthetic": body.synthetic,
        "results": out,
        "summary": session_summary(pseudo),
    }


@api.get("/sessions/{sid}/summary")
def summary(sid: str) -> dict:
    try:
        s = store.load(sid)
    except KeyError as e:
        raise HTTPException(404) from e
    return session_summary(s)


@api.get("/sessions/{sid}/export")
def export(sid: str) -> dict:
    """Full session for study mode / recorded replay: raw samples + telemetry + results. Never camera frames."""
    try:
        return store.load(sid)
    except KeyError as e:
        raise HTTPException(404) from e


@api.get("/sessions/{sid}/attempts/{index}")
def attempt(sid: str, index: int) -> dict:
    s = store.load(sid)
    if index >= len(s["attempts"]):
        raise HTTPException(404)
    a = s["attempts"][index]
    case = cases.load_case(a["case_id"])
    return a | {
        "reveal": {
            "zones": case["zones"],
            "findings": case["findings"],
            "global_findings": case.get("global_findings", []),
        }
    }


# Local model assets (no CDN at runtime) and, after `make build`, the built web app.
_vendor = ROOT / "vendor"
if _vendor.exists():
    app.mount("/vendor", StaticFiles(directory=_vendor), name="vendor")
_dist = ROOT / "mock" / "web" / "dist"
if (_dist / "index.html").exists():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="web")
else:

    @app.get("/")
    def root() -> dict:
        return {
            "ok": True,
            "hint": "run `make dev` (web on :5173) or `make build` to serve the app from here",
            "badge": cases.badge(),
        }


def dist_path() -> Path:
    return _dist
