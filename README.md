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

Then open <http://localhost:5173>. `make dev` runs the mock API (`:8000`) and the web app (`:5173`).

## Eye tracking: what to expect

- **Secure context.** Camera access needs `https` or `localhost`. Over plain `http` on another host the browser refuses
  the camera; the app explains this and continues without gaze.
- **Offline.** `make setup` copies/downloads every model asset (MediaPipe face landmarker + wasm, WebEyeTrack BlazeGaze
  weights) into gitignored `vendor/models/`. After that, calibration and tracking make no network requests. (The GPL
  WebGazer fallback is the exception: it fetches its face model from TF Hub and is only tried if WebEyeTrack fails.)
- **Accuracy varies by person.** Glasses, eye shape, skin tone, camera quality and above all lighting change webcam
  accuracy. A dark reading room is the worst case: light your face from the front. The validation screen shows the
  accuracy your session actually reached, and every gaze result repeats it ("Webcam gaze estimate, ±N px").
- **Expect centimetres, not millimetres.** WebEyeTrack's own laptop-webcam evaluation reports ≈ 7 cm error after a
  9-point calibration (its 2.3 cm figure is on phone data). Our first live sessions measured ≈ 5–7 cm. The setup
  therefore calibrates two estimators at the same dots — WebEyeTrack's BlazeGaze network and an iris-landmark
  regression on the same MediaPipe landmarks — and keeps whichever validates better for you.
- **What gaze can say.** At fit zoom webcam error spans roughly 100–300 image px, several times a finding's 36 px ROI,
  so gaze supports zone-level claims; finding-level claims need small uncertainty, which mostly happens zoomed in.
  Gaze separates "never looked there" from "looked there for about N ms"; it never says what you *saw*.
- **Demo without camera** replays a scripted scanpath; **recorded-session replay** loads a session export. Both are
  labelled as such. These are the safe demo paths for a projector.

## Layout

| Path | What | Portable? |
|---|---|---|
| `packages/gaze-web/` | providers (WebEyeTrack, WebGazer, mock), calibration math, `GazeBuffer`, vendored `view.ts` | yes |
| `gaze_analysis/` | cleaning, fixations, probabilistic dwell, miss types, scanpath, agreement, facts, report | yes |
| `shared/schemas/` | JSON Schemas + TS/Pydantic mirrors for `GazeSample`, `GazeSessionMeta`, `GazeFacts` | yes |
| `config/gaze.yaml` | every gaze threshold | yes |
| `config/mock.yaml` | Blindspot numbers mirrored for the mock | no (re-check against Blindspot) |
| `mock/` | phantoms, FastAPI mock API, React reading room | no |
| `docs/INTEGRATION.md` | how to merge the portable parts into Blindspot | — |

Real films: `make films` fetches 20 ChestX-Det radiographs (NIH ChestX-ray14 images, radiologist polygons) into
gitignored `data/films/` after you accept the dataset terms. Attribution: NIH Clinical Center; Lian et al.,
arXiv:2006.10550 and arXiv:2104.10326. Never committed, never hosted.
