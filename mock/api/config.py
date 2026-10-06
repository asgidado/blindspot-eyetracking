from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


def gaze_cfg() -> dict:
    return _load(ROOT / "config" / "gaze.yaml")


def mock_cfg() -> dict:
    return _load(ROOT / "config" / "mock.yaml")


def _load(p: Path) -> dict:
    return _cached(str(p), p.stat().st_mtime_ns)


@lru_cache(maxsize=8)
def _cached(path: str, _mtime: int) -> dict:  # re-read when the YAML changes; no server restart needed
    return yaml.safe_load(Path(path).read_text())
