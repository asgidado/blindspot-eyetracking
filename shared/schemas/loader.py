"""Load the JSON schemas and validate dicts against them (used by tests, the mock API and the study export)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator

HERE = Path(__file__).parent
NAMES = {"GazeSample": "gaze_sample", "GazeSessionMeta": "gaze_session_meta", "GazeFacts": "gaze_facts"}


@lru_cache
def schema(name: str) -> dict:
    return json.loads((HERE / f"{NAMES[name]}.schema.json").read_text())


def validate(name: str, obj: dict) -> None:
    Draft202012Validator(schema(name)).validate(obj)
