"""JSON schema <-> Pydantic drift test: same required keys, same property names, and fixtures validate in both."""

from __future__ import annotations

import pytest
from jsonschema import ValidationError
from pydantic import ValidationError as PydanticValidationError

from shared.schemas import models
from shared.schemas.loader import schema, validate

SAMPLE = {
    "t": 120.0,
    "sx": 400.0,
    "sy": 300.0,
    "x": 512.0,
    "y": 300.0,
    "sigma": 140.0,
    "valid": True,
    "zoom": 1.0,
    "vp": [0, 0, 1024, 1024],
}
META = {
    "schema": "gaze_session_meta.v1",
    "provider": "mock",
    "provider_version": "0.1.0",
    "screen": {"width": 1440, "height": 900, "dpr": 2},
    "validation": {"accuracy_px": 60, "precision_px": 12, "loss_pct": 3, "n_points": 5},
    "calibration": {"n_points": 9, "face_box": {"w": 180, "h": 220}},
    "quality_tier": "coarse",
    "train_on_clicks": True,
    "study_mode": False,
    "timestamp": "2026-10-06T12:00:00Z",
}
FACTS = {
    "schema": "gaze_facts.v1",
    "phase": "pre_submit",
    "synthetic": True,
    "attention": {"sources": ["cursor"], "supports": "cursor_only"},
    "search": {"total_read_ms": 1000, "zone_sequence": []},
    "review_areas": [],
    "references": {},
    "claim_limits": {
        "never_say": [],
        "finding_level_gaze_claims_only_if": "x",
        "describe_order_as": "descriptive only",
    },
}


def _props(s: dict) -> set[str]:
    return set(s["properties"])


@pytest.mark.parametrize(
    "name,model,fixture",
    [
        ("GazeSample", models.GazeSample, SAMPLE),
        ("GazeSessionMeta", models.GazeSessionMeta, META),
        ("GazeFacts", models.GazeFacts, FACTS),
    ],
)
def test_top_level_keys_match(name, model, fixture):
    js = schema(name)
    py = model.model_json_schema(by_alias=True)
    assert _props(js) == _props(py), f"{name}: property drift {_props(js) ^ _props(py)}"
    # JSON-schema required == Pydantic fields without defaults (schema const has a default in pydantic by design)
    py_required = set(py.get("required", [])) | ({"schema"} if "schema" in py["properties"] else set())
    assert set(js["required"]) == py_required, f"{name}: required drift {set(js['required']) ^ py_required}"
    validate(name, fixture)
    roundtrip = models.dump(model.model_validate(fixture))
    validate(name, roundtrip)
    assert roundtrip == fixture


def test_extra_keys_rejected():
    with pytest.raises(ValidationError):
        validate("GazeSample", {**SAMPLE, "frame": "base64..."})
    with pytest.raises(PydanticValidationError):
        models.GazeSample.model_validate({**SAMPLE, "frame": "base64..."})
