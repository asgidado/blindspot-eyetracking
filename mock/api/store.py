"""Session storage: one JSON file per session under sessions/ (gitignored). Raw telemetry and gaze stay here for replay/audit."""

from __future__ import annotations

import json
import secrets
from datetime import UTC, datetime
from pathlib import Path

from .config import ROOT

SESSIONS = ROOT / "sessions"


def _path(sid: str) -> Path:
    if not sid.replace("-", "").replace("_", "").isalnum():
        raise ValueError("bad session id")
    return SESSIONS / f"{sid}.json"


def new_session(name: str, study: bool, gaze: bool, source: str, case_order: list[str]) -> dict:
    SESSIONS.mkdir(exist_ok=True)
    s = {
        "id": datetime.now(UTC).strftime("%Y%m%dT%H%M%S") + "-" + secrets.token_hex(3),
        "name": name[:80],
        "study": study,
        "gaze": gaze,
        "source": source,
        "synthetic": source == "synthetic",
        "created": datetime.now(UTC).isoformat(),
        "case_order": case_order,
        "attempts": [],
        "gaze_meta": None,
    }
    save(s)
    return s


def load(sid: str) -> dict:
    p = _path(sid)
    if not p.exists():
        raise KeyError(sid)
    return json.loads(p.read_text())


def save(s: dict) -> None:
    _path(s["id"]).write_text(json.dumps(s, separators=(",", ":")))
