"""`make setup` step: put every runtime model asset under vendor/models/ (gitignored) so tracking works offline.

- MediaPipe tasks-vision wasm: copied from node_modules (Apache-2.0, ~33 MB — too big to commit)
- MediaPipe face_landmarker.task (float16, Apache-2.0, 3.7 MB): downloaded once from Google's model storage
- WebEyeTrack BlazeGaze weights (MIT, 0.67 MB): downloaded once from the WebEyeTrack GitHub repo; webeyetrack 0.0.2
  loads them from `<origin>/web/model.json`, so they are served at that path by Vite's publicDir and by the API.
Decision (logged in docs/PROGRESS.md): nothing is committed; total > 10 MB and the wasm is not ours.
"""

from __future__ import annotations

import shutil
import sys
import urllib.request

from .config import ROOT

VENDOR = ROOT / "vendor" / "models"
WASM_SRC = ROOT / "node_modules" / "@mediapipe" / "tasks-vision" / "wasm"
FILES = {
    "mediapipe/face_landmarker.task": "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    "web/model.json": "https://raw.githubusercontent.com/RedForestAI/WebEyeTrack/main/js/examples/minimal-example/public/web/model.json",
    "web/group1-shard1of1.bin": "https://raw.githubusercontent.com/RedForestAI/WebEyeTrack/main/js/examples/minimal-example/public/web/group1-shard1of1.bin",
}


def main() -> int:
    VENDOR.mkdir(parents=True, exist_ok=True)
    dst = VENDOR / "mediapipe" / "wasm"
    if WASM_SRC.exists():
        dst.mkdir(parents=True, exist_ok=True)
        for f in WASM_SRC.iterdir():
            if not (dst / f.name).exists():
                shutil.copy2(f, dst / f.name)
        print(f"wasm: {len(list(dst.iterdir()))} files in {dst}")
    else:
        print("wasm: node_modules/@mediapipe/tasks-vision missing — run npm install first", file=sys.stderr)
    for rel, url in FILES.items():
        p = VENDOR / rel
        if p.exists() and p.stat().st_size > 0:
            print(f"ok   {rel} ({p.stat().st_size} B)")
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        try:
            with urllib.request.urlopen(url, timeout=60) as r, open(p, "wb") as f:  # noqa: S310
                shutil.copyfileobj(r, f)
            print(f"got  {rel} ({p.stat().st_size} B)")
        except Exception as e:  # noqa: BLE001
            print(
                f"FAIL {rel}: {e} — live webcam tracking will not work until this is fetched", file=sys.stderr
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
