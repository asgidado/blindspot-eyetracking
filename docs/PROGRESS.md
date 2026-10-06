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
- `uv run pytest`: 26 passed — scripted sessions: never enters ROI → search (dwell < 50 ms); ~500 ms pass → recognition
  with time-to-first ≈ 1.5 s; ~2 s linger → decision; same path at σ = 120 px → `zone` resolution, no miss type,
  confidence 0, apex still "visited" at zone level; edge-of-region P ≈ 0.5; I-DT min-duration; descriptive scanpath
  (first/last zone, revisits, ≤ 15 segments); lag recovered 400–600 ms for a 500 ms cursor delay; κ and confusion;
  facts validate against the schema, contain no pixel keys, `to_prompt_text` is deterministic, claim validator catches
  "saw", prescriptive order, numbers not in facts, and finding-level claims at zone resolution; full API submit with
  gaze yields both attributions (cursor search vs gaze recognition → "disagree") and a debrief with "your eyes reached".
- Playwright 5 passed — demo-without-camera reveal shows "Cursor proxy:" and "Webcam gaze (±N px):" per miss, the zone
  timeline SVG with hard unvisited rows highlighted, scanpath Play, heatmap toggle, the per-finding table, the exact
  GazeFacts JSON (schema gaze_facts.v1, post_submit, synthetic, no pixel keys) with bytes/≈tokens, and the template debrief.

## G4 — validation study + report

- Study mode (`?study=1`): fixed case order (first 8 ids), `train_on_clicks` forced false, gaze + cursor on one clock,
  drift checks (live provider), and every submit in a study session is schema-validated (GazeSessionMeta + each
  GazeSample) before it is stored, so `sessions/<id>.json` is always a schema-clean export (also `GET /sessions/{id}/export`).
- `make demo-sessions` writes 4 SYNTHETIC scripted study sessions through the real API path (mock provider, scripted
  scanpaths, cursor trailing gaze by ~600 ms); `make report` → `reports/AGREEMENT.md`. The report is labelled
  "SYNTHETIC … SCRIPTED gaze (no human eyes were tracked)" and every table carries n. A copy generated from the scripted
  sessions is committed as an example; it is not evidence about people.
- Check: report renders — sessions n = 4, 32 cases, per-participant table (anonymous codes), distances by cursor state
  (idle 281 / moving 34 / loupe 38 image px), lag 508 ms recovered from the scripted ~600 ms delay, review-area visited
  agreement 74.7 % (κ 0.339, n = 288 area-cases), miss-type confusion n = 8 at lesion resolution (κ 0.40), 21 zone-only.
- `uv run pytest`: 27 passed (adds report rendering test).

## G1b — real films (code ready; download awaits the human checkpoint)

- Dataset layout inspected (metadata only, nothing downloaded): `MedOtter/ChestX-Det` ships 9 parquet shards
  (110–176 MB each), so per-file download of 20 images from the repo is impossible. The Hugging Face datasets-server
  `rows` API exposes each row's cached image URL plus `annotation_json` (`syms`, `boxes`, per-instance `polygons`),
  `is_negative`, 1024×1024. `make films` pages the `test` split (553 rows) for metadata, picks 20 by the seeded rule, and
  downloads exactly those 20 PNGs. No credentials.
- Licence line (dataset card): Apache-2.0 annotations over NIH ChestX-ray14 images, attribution required
  (NIH box link, Wang et al. 2017, NIH Clinical Center as provider; cite ChestX-Det arXiv:2104.10326 / 2006.10550).
  `make films` prints this and waits for "yes" (`--yes` to skip the prompt in CI you control).
- Zones: TorchXRayVision PSPNet when `uv sync --extra films` is installed (lungs assigned by mean x so patient right =
  image left), else template zones from a threshold lung mask + fitted heart ellipse. Both `approximate: true`.
- Tests (4): all 13 categories map to §0 ids; `annotation_json` parsing (nested and flat polygons, unmapped category
  logged + skipped); seeded selection is deterministic with ≥ 2 films per hard-region hint and 6 normals; template zones
  keep the patient-side convention. Plus: badge flips to "Real films" when `data/films/index.json` exists and back to
  "Synthetic films" when it is removed, with all tests green.
- **Not run:** the actual download — needs the human's "yes" at the checkpoint.

## G5 — standalone proof

- Fresh `git clone https://github.com/asgidado/blindspot-eyetracking.git` into an empty temp dir (no sibling folders):
  `make setup` (npm install, uv sync, phantoms regenerated byte-identically — `git status` clean afterwards — and the
  three model assets fetched into `vendor/models/`), `make test` → vitest 16 passed, pytest 32 passed, `make build` →
  Vite production build OK (largest chunk 2.7 MB = webeyetrack's bundled TF.js). `make lint` had one ruff nit (fixed
  here). Playwright e2e needs `npx playwright install chromium` once; it is not part of `make setup` on purpose.
- Stretch items (fusion estimate, CT/MRI `slice` scroll recording) not started; `GazeSample.slice` is reserved in the schema.

## Fix after first human try (2026-10-06, later)

- Reported: the camera preview was black at the "centre your face in the oval" step. Cause: the `<video>` element was
  rendered at different positions in the tree per step, so React remounted it and the camera stream stayed attached to
  the discarded element. Fix: one `<video>` at a stable position, moved with CSS (`.video-wrap` / `.video-hidden`).
- Found while fixing: React StrictMode (dev) ran the provider-start effect twice; the first run was "cancelled" but its
  provider kept the camera and its TF.js pipeline alive (two `<video>` elements, two streams, a race that surfaced as
  "z2 is not a function"). Fix: start exactly once (`startedRef`); if the screen really unmounts before init finishes,
  stop that provider. The e2e now asserts exactly one video element with the stream attached, playing, inside the oval.

## G1b — real films downloaded (2026-10-06, after the human asked for real radiographs)

- The human asked for real chest X-rays "from the Kaggle dataset". The Kaggle listing is a repost of ChestX-Det with a
  conflicting licence tag and the kickoff forbids Kaggle reposts, so the 20 films were fetched from the primary
  Hugging Face release `MedOtter/ChestX-Det` after the licence/attribution line had been shown to the human. Treated the
  explicit request for real images as the checkpoint "yes"; recorded here.
- `make films` ran with TorchXRayVision PSPNet zones (installed in ~1 min; CPU inference ~3 s/film). 14 abnormal films
  (2–7 focal findings each, some with global findings) + 6 normals; ids in `mock/films/manifest.json`, pixels only in
  gitignored `data/films/`. One film's clavicle line sat above the lung top, giving empty apex zones → `derive_zones`
  now falls back to the lung's top 12 % for the apex. Phantom outputs are unchanged by that rule.
- Checks: 20 cases load with the "Mock · Real films (ChestX-Det)" badge; reveal overlays radiologist polygons (cyan)
  and derived zones correctly (visual check of 4 films, patient right on image left); `mock/films/test_real_films.py`
  (skipped when the pack is absent) passes: 20 films / 6 normals / all zones approximate / patient-side test on real
  zones / all findings mapped to §0 labels; API tests pin themselves to phantoms; e2e made film-agnostic and labels
  "Synthetic" only when the badge says synthetic; removing `data/films/` returns to phantoms with everything green.
- Camera step after the first human try: the oval was too big and the "move closer" rule too strict for laptop
  distance. Oval shrunk (96×124 in a 320×240 preview), centre tolerance 0.25, distance/lighting are now hints that
  don't block, and the copy explains that the amber dot appears only after "Begin calibration". Config YAML is re-read
  on change (mtime-keyed cache) so `make dev` picks up threshold edits without a restart.

## G2 human checkpoint — first live calibration (2026-10-06 22:29 UTC, MacBook, normal room light)

- Measured: accuracy **266.5 screen px** (≈ 364 image px at fit), precision 58.9 px RMS, data loss 0 %, 9 + 5 points,
  face box 128 px wide at ~laptop distance, face luminance 88 → tier **poor** (gaze recorded, feedback fell back to the
  cursor proxy). Camera light went off after "Continue without gaze" (per the human). Provider webeyetrack 0.0.2.
- Diagnosis from the session metadata: `inference_hz = 3.5` with `pipeline_latency_ms = 40`. The model was fast; the
  frame pump was starved. Chrome throttles `requestVideoFrameCallback` for tiny/transparent/detached video elements,
  which is how the preview was hidden during calibration — so each calibration dot got 2–3 samples. After calibration
  the setup screen unmounted and removed the `<video>` element entirely: the read recorded **1** gaze sample.
- Fixes: (1) the pump is a requestAnimationFrame loop that grabs a frame whenever `video.currentTime` advanced (works
  for hidden/detached elements; rVFC only refines the capture timestamp); (2) the camera element is created
  imperatively, lives on `<body>` for the whole session (moved into the preview box only on the camera step) and is
  removed in `GazeSession.end()`; (3) `?gazedev=1` shortens dots and lifts the face gate so the live pipeline can be
  exercised with a fake camera in e2e.
- Checks (headless Chromium, fake camera): pipeline 20.5 Hz at the camera step (≥ 8 asserted), 61 samples in a 3 s read
  (> 20 asserted; was 1), exactly one `<video>` across setup → read, drift/next-case flow continues. Playwright 6 passed.
- **Open:** the human recalibrates with the new pump; record the new accuracy here. 266.5 px stands as the pre-fix number.

## Lag with live tracking (human report, 2026-10-06)

- Cause: face landmarks + BlazeGaze run on the main thread (~40 ms/frame); once the pump delivered frames at full rate
  the viewer lost its budget. The library's worker proxy is unusable here (CDN URLs baked in), so the fix is load
  management, not a thread move.
- Fixes: MediaPipe `VIDEO` running mode (`detectForVideo`: tracks between frames instead of re-detecting — cheaper);
  the pump watches its own rAF gaps and backs the inference rate off toward `degraded_hz` when the UI drops below
  ~40 fps, recovering when smooth; defaults `target_hz` 30→20, `degraded_hz` 15→8; the camera-step face message no
  longer re-renders per sample. UI fps and achieved Hz are logged to the console at each case end.
- Check (headless Chromium, software GPU, fake camera — landmarker running, no face so BlazeGaze idle): viewer 50.4 fps
  while panning with gaze at 20.5 Hz; 64 samples in a 3 s read. Playwright 6 passed. Real-laptop numbers with a face
  in view will be lower for gaze Hz (the guard trades gaze rate for viewer smoothness) — ask the human.

## Second live read (human, 2026-10-06): real film, gaze recorded through the read; reading room laggy

- Human report: calibration not laggy; reading/marking laggy. Reveal on a real film: 5 missed findings, each with both
  attributions; gaze σ ≈ 303 image px at the findings (≈ 245 screen px → still **poor**), so gaze stayed zone-level
  only and cursor supplied the miss types — the honest-labelling path works. Gaze review-area dwell was recorded
  through the whole read (retrocardiac 764 ms etc.), confirming the pipeline now survives the setup screen.
- Lag cause: the viewer redrew the full 1024² film through a canvas brightness/contrast filter on every pointer move
  (twice with the loupe) — expensive on its own; with the gaze pipeline sharing the thread the room stuttered.
  Fix: the filtered film is rendered once per W/L/invert change into an offscreen canvas; per-frame draws copy pixels;
  pointer-driven redraws and pan updates are coalesced to one per animation frame; the stage rect is cached so gaze
  samples do not force layout.
- Accuracy: ruled out frame mirroring (the library's own camera client draws frames unmirrored, as we do). Changed the
  few-shot adaptation to the library defaults (1 step, lr 1e-5; the affine re-fit does the work) and lengthened each
  dot (settle 800 ms so the Kalman-filtered estimate converges, 1 s of samples). Whether this moves accuracy is for the
  next human calibration; 245–266 screen px (~5 cm) may simply be this method on this laptop/lighting.

## Research on the accuracy ceiling (2026-10-06, at the human's request)

- **WebEyeTrack paper (arXiv:2508.19544)**: the 2.32 cm headline is within-dataset on GazeCapture (phones). The
  cross-dataset laptop-webcam test (Eye of the Typer, 9-point dot calibration like ours) reports **7.24 cm** initially
  and 8.72 cm after 20 min (WebGazer: 7.79 → 11.62 cm). Meta-learning uses k = 9 support samples, 5 inner SGD steps at
  α = 1e-5; outputs are normalised to [−0.5, 0.5]² of the screen. Our measured 266–335 screen px ≈ 5.3–6.7 cm is at or
  better than the authors' own webcam number → the ceiling is the method, not the integration.
- Human sessions analysed from stored samples: gaze output spans the screen (not clamped), gaze–cursor correlation only
  0.13–0.40, median gaze–cursor distance ≈ 400 image px; face 114–128 px wide in a 640 px frame (eyes ≈ 25 px).
- GitHub issues: nothing on accuracy tuning; one issue notes the proxy does not expose `adapt()` (we use the class).
- Literature on landmark-based gaze (MediaPipe iris + user regression, 5–9 point calibration): sub-2° reported in
  good light; dim rooms, backlight and glasses glare degrade it. MediaPipe states iris tracking alone does not infer gaze.
- Implemented: (1) camera at 1280×720 (doubles eye-patch pixels at the same seat); (2) a second estimator,
  `providers/iris.ts` — ridge regression (24 features: iris/eye-corner ratios per eye, openness, head rotation and
  translation from the face transform, nose position, face scale, cross terms; standardised, λ = 1e-2, EMA smoothing)
  fitted from the same calibration dots and the same landmarks WebEyeTrack already computes (zero extra inference);
  (3) validation measures both estimators (`RawGaze.alt`) and keeps the better one for the session
  (`GazeSessionMeta.estimator`, `alternatives`), shown on the result screen; click training feeds both.
- Checks: unit test fits a synthetic linear iris→screen mapping (±0.05 normalised); Playwright 6 passed; camera e2e now
  reports a 1280-px frame. Real accuracy of the iris estimator awaits the human's next calibration.

## Fourth live calibration (human, 2026-10-06): 720p + two estimators

- Measured: BlazeGaze **211.5 screen px** (≈ 289 image px at fit), precision 36 px, loss 0 %; iris-landmark regression
  418 px (rejected by validation). Face 243 px wide in a 1280×720 frame (19 %), brightness 88/255 (dim).
  Trend: 266.5 → 334.7 → 211.5 px as the pump, resolution and calibration were fixed; now better than the paper's
  own laptop-webcam figure (7.24 cm ≈ 360 px).
- Iris estimator over-fitted (head-pose features near-constant while holding still → amplified after standardisation):
  reduced to 16 robust features, λ 0.3, sd floor 0.02. Kept as the alternative; validation still decides.
- Tiers aligned with the kickoff's own expectation (webcam error 100–300 image px at fit supports zone-level claims):
  good ≤ 80 screen px, coarse ≤ 220 screen px (≈ 300 image px at fit), `zone_sigma_max` 300 image px. A 212 px
  session is therefore "coarse": gaze supplies zone-level coverage and the scanpath, cursor supplies miss types,
  every gaze number still carries its ±px. Previously that session was "poor" and gaze contributed nothing.

## Reading-room lag + "bouncing" replay (human report, 2026-10-06, late)

- Lag root cause: synchronous GPU readbacks on the UI thread (`getImageData` of a 1280×720 frame, TF.js `arraySync`)
  stall the main thread until the GPU drains everything queued — including the viewer's own canvas work. Calibration
  did not lag because nothing else was drawing. Fix: the whole pipeline now runs in a **classic Web Worker**
  (`packages/gaze-web/worker/webeyetrack.worker.js`): MediaPipe (VIDEO mode) + WebEyeTrack from local assets
  (`/lib/webeyetrack.js`, `/lib/vision_bundle.cjs`, copied by `make setup`), frames arrive as transferable
  ImageBitmaps (`createImageBitmap(video)` — GPU-side, no readback on the UI thread), landmarks/head matrix come back
  for the iris estimator, few-shot `adapt` and click training happen in the worker. Camera frames still never leave the
  browser. The library's own worker proxy could not be used (CDN URLs baked in; `adapt()` not exposed — their issue #6).
- "Back and forth between two positions": the library's constant-velocity Kalman overshoots after a saccade and the
  output is clamped at the screen edge → ringing between an edge and the target. Replaced by a one-euro filter on the
  main thread (no overshoot; unit-tested). The heart is not a review area and had no timeline row, so looking at it
  was invisible there: a "cardiac silhouette (not a review area)" row was added.
- Checks (headless, fake camera, worker): viewer **60 fps while panning with the live pipeline on** (was 49–58 on the
  main-thread version and visibly laggy for the human); 20 Hz pump, 23.5 Hz results after warm-up, 75 ms capture→result
  latency, landmarker 15.6 ms/frame in the worker; 64 samples in a 3 s read; `make build` emits the worker asset.
  Playwright 6 passed. Human to confirm on the laptop.
