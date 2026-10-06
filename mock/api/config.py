from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


@lru_cache
def gaze_cfg() -> dict:
    return yaml.safe_load((ROOT / "config" / "gaze.yaml").read_text())


@lru_cache
def mock_cfg() -> dict:
    return yaml.safe_load((ROOT / "config" / "mock.yaml").read_text())
