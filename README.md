# blindspot-gaze

Standalone webcam eye-tracking for **Blindspot**, a chest X-ray perception trainer.

This repo never imports, clones or fetches the Blindspot repo. It contains:

1. `packages/gaze-web/` — browser gaze capture (providers, calibration, quality, `GazeBuffer`). Portable.
2. `gaze_analysis/` — Python analysis (cleaning, fixations, probabilistic dwell, miss types, scanpath, cursor–gaze agreement, facts). Portable.
3. `mock/` — a mock Blindspot reading room that uses the two packages so people can try the full flow with gaze on.
4. `docs/INTEGRATION.md` — guide for merging the portable packages into the real Blindspot.

Webcam gaze is coarse (≈100–300 image px at fit zoom) and accuracy varies by person, glasses, lighting and camera. Every gaze result in this repo is labeled "Webcam gaze estimate, ±N px".

**For education. Not for clinical use.**

## Quick start

```bash
make setup && make test && make dev
```

Camera access needs `https` or `localhost`.
