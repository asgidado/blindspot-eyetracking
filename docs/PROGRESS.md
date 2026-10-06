# Progress log

Decisions and milestone check output. Newest at the bottom.

## Decisions

- 2026-10-06 — `webgazer` (GPL-3.0-or-later) is the fallback provider named in the kickoff prompt. It is installed as a
  dependency of `packages/gaze-web` but is only ever loaded through a dynamic `import()` inside its own provider file,
  so nothing else links against it. Recorded in `docs/LICENSES.md`. The human should confirm this is acceptable for the
  main build's licence; the primary provider `webeyetrack` is MIT.
- 2026-10-06 — Schemas are the source of truth (`shared/schemas/*.schema.json`). TS types and Pydantic models mirror them
  by hand; `shared/schemas/test_schema_drift.py` and `schemas.test.ts` fail on drift. No codegen (one fewer tool).
- 2026-10-06 — Config is served to the web app by the mock API (`GET /config`) instead of bundling YAML into the client,
  so the portable TS package has no YAML dependency and takes thresholds as parameters.
- 2026-10-06 — `GazeSample.target` (`image | ui | off`) and `on_loupe` are added to the §4.3 contract to carry the UI
  occlusion and loupe-mapping results (§4.4.1–2). `face_lum` carries the face-lighting measurement.

## G0 — contracts, mock provider, boundary

- `npx vitest run`: 4 files, 11 tests passed (buffer mapping within 2 px at 1× and 3×, loupe transform, UI occlusion,
  head guard, face-lum guard, 20k-style cap preserving first/last, mock provider interpolation, schema fixtures, boundary).
- `uv run pytest`: 4 passed (JSON schema ↔ Pydantic property/required parity for all three schemas; extra keys rejected).

## G1 — phantoms + mock reading room without gaze

- Decision: phantom PNGs (~660 KB each, 8 files, 5.1 MB) are committed under `mock/phantoms/cases/`; the Gaussian noise
  makes them incompressible but keeps the "film" look. Regenerate with `make phantoms` (deterministic, seeded).
- Decision: the API serves the built web app from `mock/web/dist` when it exists, so `make build && make api` is a
  one-process standalone demo; `make dev` runs Vite + uvicorn with a proxy.
- Decision: Hungarian matching uses distance-to-finding-centre as cost and only allows matches whose mark lands in the
  dilated ROI; "Not sure" marks count as `mislabeled` (interpretation error) when they hit a finding.
- `uv run pytest`: 15 passed (phantom determinism, 21 zones present, patient-side test — right zones have smaller mean x,
  findings inside planned zones, hard review areas covered; cursor dwell port incl. idle cap and zoom weighting; API flow
  with no ground truth before submit, found/missed/mislabeled/overcall, review-area visits, session summary).
- `npx playwright test`: 2 passed — reads 2 phantoms (study order) to the reveal with cursor-proxy miss types; "demo
  without camera" records > 20 scripted gaze samples with no frame data, chip shows "Tracking".

## G2 — live capture

- Spike result (≈40 min): `webeyetrack@0.0.2` exports a main-thread `WebEyeTrack` class (`initialize/step/adapt/handleClick`)
  and a worker proxy. Its own `FaceLandmarkerClient` hardcodes the MediaPipe wasm on jsdelivr and the face model on
  Google storage, and BlazeGaze weights are not in the npm package: they are loaded from `<origin>/web/model.json`.
  Decision: use the main-thread class, swap in our own `@mediapipe/tasks-vision` landmarker fed from `vendor/models/`,
  and serve BlazeGaze weights at `/web/` via Vite's publicDir. The library's worker proxy is not used (CDN URLs baked in).
  Samples are stable; WebEyeTrack stays primary. No mouse-move training exists in this library; click training goes through
  `handleClick()` only when `train_on_clicks` (forced off in study mode).
- `webgazer@3.5.3` fallback: GPL, loaded only by dynamic `import()`; `removeMouseEventListeners()` right after `begin()`;
  clicks re-added only when `train_on_clicks`. Caveat: it fetches its face-mesh model from tfhub.dev at runtime, so the
  fallback is not offline-capable. Logged here and in README.
- Decision: model assets (MediaPipe wasm 33 MB, face_landmarker.task 3.7 MB, BlazeGaze 0.67 MB) are NOT committed
  (> 10 MB total, not ours); `make setup` runs `mock/api/assets.py` which copies/downloads them once into gitignored
  `vendor/models/`. After that, gaze init makes zero external requests (asserted by `tests/e2e/gaze.spec.ts`).
- Decision: the Google Fonts `<link>` was removed so the app makes no network calls at all beyond the mock API;
  Atkinson Hyperlegible is used when installed locally, else system-ui.
- Timestamps come from `requestVideoFrameCallback` capture time (`captureTime`/`presentationTime`), and measured
  pipeline latency (EMA) is written to `GazeSessionMeta.pipeline_latency_ms`; achieved rate to `inference_hz`.
  Inference rate adapts between 30 and 15 Hz from the model's own per-frame `durations.total`.
- Checks: `npx vitest run` 16 passed (adds calibration metrics/tiers/drift, camera error wording, face box/luminance);
  `uv run pytest` 16 passed (adds replay endpoint); Playwright 4 passed:
  - `[perf] viewer fps while panning with tracking on: 60.0` (headless Chromium, demo provider; re-measure with the
    live provider on a laptop — the TF.js pipeline shares the main thread).
  - live path with a fake camera: MediaPipe graph + BlazeGaze load from 127.0.0.1 only, camera step reached
    ("Looking for your face…"), "Continue without gaze" lands in the reading room with the chip "Gaze off".
  - In the desktop Browser pane (camera blocked) the denied-permission path shows the plain-language message.
- **Human checkpoint still open:** a teammate calibrates in normal room light, the validation screen shows a number, the
  camera light goes off after "Continue without gaze"/session end. Not possible from this agent (no camera access).

## G3 — analysis

- Decision: probabilistic dwell quantises σ to the smallest configured bin ≥ σ (never understating uncertainty) and
  caches one Gaussian-blurred float mask per (region, bin). Resolution tier uses the time-weighted median σ of the
  samples that touch the region (P ≥ 0.05). Miss-type confidence = 1 − σ/(2·r_eq), r_eq = √(ROI area/π).
- Decision: gaze-leads-cursor lag minimises the mean clipped (≤ 500 px) gaze–cursor distance over lags ±2 s in 33 ms
  steps; the median is flat for step-like paths and picked arbitrary lags in tests.
- Decision: the zone timeline uses 250 ms bins; each bin holds the fraction of the bin the (probabilistic) gaze or the
  cursor spent in the review area, so bars read as confidence-weighted presence.
- Decision: `attention.gaze_accuracy_img_px_at_fit` is the median σ of samples recorded at zoom ≈ 1 (what the session
  actually achieved at fit), falling back to accuracy/fit-scale. Finding-level ±px uses the σ at that finding.
- Facts size: the §5.10 "under ~2 KB" target holds for the example's density (1 review area, 1 finding). With all nine
  review areas (the schema's per-area keys are ~230 B each) a full case is ≈ 3.5–4.5 KB (≈ 1 k tokens). The "What the
  AI sees" tab shows the exact bytes. Kept the schema as specified rather than abbreviating keys; the unit test bounds
  the two-area fixture at < 3 KB.
- Debrief: deterministic template, ~100 words, every sentence re-checked with `validate_claim` and dropped if it fails.
- `uv run pytest`: 29 passed — scripted sessions: never enters ROI → search (dwell < 50 ms); ~500 ms pass → recognition
  with time-to-first ≈ 1.5 s; ~2 s linger → decision; same path at σ = 120 px → `zone` resolution, no miss type,
  confidence 0, apex still "visited" at zone level; edge-of-region P ≈ 0.5; I-DT min-duration; descriptive scanpath
  (first/last zone, revisits, ≤ 15 segments); lag recovered 400–600 ms for a 500 ms cursor delay; κ and confusion;
  facts validate against the schema, contain no pixel keys, `to_prompt_text` is deterministic, claim validator catches
  "saw", prescriptive order, numbers not in facts, and finding-level claims at zone resolution; full API submit with
  gaze yields both attributions (cursor search vs gaze recognition → "disagree") and a debrief with "your eyes reached".
- Playwright 5 passed — demo-without-camera reveal shows "Cursor proxy:" and "Webcam gaze (±N px):" per miss, the zone
  timeline SVG with hard unvisited rows highlighted, scanpath Play, heatmap toggle, the per-finding table, the exact
  GazeFacts JSON (schema gaze_facts.v1, post_submit, synthetic, no pixel keys) with bytes/≈tokens, and the template debrief.
