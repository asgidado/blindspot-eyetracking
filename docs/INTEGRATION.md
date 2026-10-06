# Integrating blindspot-gaze into Blindspot

**Blindspot may have changed since this was written. Before editing, confirm each contract below against the Blindspot
repo and adjust.** This guide was written against the §0 contracts quoted in the kickoff prompt (coords.ts `View`,
`TelemetryEvent`, SPEC §7.1 dwell, review areas, labels) without seeing Blindspot itself. It is addressed to a coding
agent working inside the Blindspot repo.

## 1. What to copy, what not to copy

Copy (portable; nothing in them imports from `mock/`, enforced by `tests/boundary.test.ts`):

| From this repo | Into Blindspot | Notes |
|---|---|---|
| `packages/gaze-web/` | the web package (next to the viewer) | TS, no React. Depends on `webeyetrack` (MIT), `@mediapipe/tasks-vision` (Apache-2.0) and, by dynamic import only, `webgazer` (GPL-3.0). Decide on the GPL fallback before copying `providers/webgazer.ts`; deleting that one file removes it. `src/view.ts` is a verbatim copy of Blindspot's `coords.ts` — delete it and import Blindspot's own. |
| `gaze_analysis/` | the Python service, next to the cursor search engine | Pure functions over samples, telemetry, bool masks and a `GazeAnalysisConfig`. `cursor_proxy.py` is a port of SPEC §7.1 for agreement analysis — keep Blindspot's own implementation as the source of truth and compare outputs once. |
| `shared/schemas/*.schema.json` + `index.ts` + `models.py` | wherever Blindspot keeps shared contracts | `GazeSample`, `GazeSessionMeta`, `GazeFacts` (`gaze_facts.v1`). Keep the drift tests. |
| `config/gaze.yaml` | Blindspot's config dir | Every gaze threshold, documented inline. |
| `mock/api/assets.py` (adapt) | setup script | Copies MediaPipe wasm + downloads `face_landmarker.task` and BlazeGaze weights into a gitignored folder served by the app (needed for offline tracking). |

Do **not** copy anything else under `mock/` (phantoms, the FastAPI mock, the React reading room, `config/mock.yaml`).
`config/mock.yaml` only mirrors Blindspot numbers; Blindspot's `config/scoring.yaml` and `config/review_areas.yaml`
stay authoritative.

## 2. Mapping: mock component → the Blindspot role that plays the same part

Roles, not file paths — find the real files.

| Mock (this repo) | Blindspot role |
|---|---|
| `mock/web/src/Viewer.tsx` (owns `View`, stage rect, loupe state, emits `TelemetryEvent`s, exposes `getViewState()`) | the **viewer component** that owns the `View` and the cursor telemetry buffer |
| `mock/web/src/ReadingRoom.tsx` (`GazeBuffer` start on case shown, `isUiAt`, submit payload) | the **case/reading screen** that starts the case clock and submits the attempt |
| `mock/web/src/gaze/session.ts` (`GazeSession`: provider + buffer + status) | a new **gaze session controller** in the session flow (lives for the whole session, not per case) |
| `mock/web/src/gaze/GazeSetup.tsx` (opt-in, camera guide, calibration, validation, drift check) | new **screens in the session flow**, before the first case and between cases |
| `mock/api/main.py` `POST /attempts/{id}/submit` | the **attempt-submit route** |
| `mock/api/store.py` (telemetry + gaze stored beside each other) | the **attempt store** |
| `mock/api/analysis.py` (`analyze_case` → review areas, findings, agreement) | the **search engine / miss-type classifier** that runs the cursor proxy |
| `mock/api/analysis.py` → `build_facts` / `facts_text` | the **tutor facts builder** that feeds Claude |
| `gaze_analysis/facts.py` `validate_claim` | the **tutor output validator** |
| `mock/api/debrief.py` | nothing — Blindspot's tutor writes the debrief from the facts |
| `mock/web/src/Reveal.tsx` + `replay/ReplayPanel.tsx` | the **reveal / rail** (add the gaze attribution line and the replay panel) |
| `mock/web/src/Summary.tsx` | the **session summary** |

## 3. Steps with code sketches

### 3.1 Hand `getView()` to `GazeBuffer` and share the case clock

In the viewer, expose the view in effect *now* (the buffer calls this per sample, so zoom/pan mid-case is handled):

```ts
// viewer: expose for the gaze controller
getViewState(): ViewState {
  const r = stageEl.getBoundingClientRect();
  return {
    view, stageRect: { left: r.left, top: r.top, width: r.width, height: r.height }, imgW, imgH,
    zoom: view.scale / fitScale,
    loupe: loupeOn && cursor ? { on: true, cx: r.left + cursor.sx, cy: r.top + cursor.sy, radius: 90, mag: 2.5, imgX: cursorImg.x, imgY: cursorImg.y } : undefined,
  };
}
```

When the case is shown (the same instant Blindspot resets `TelemetryEvent.t`), start the buffer:

```ts
import { GazeBuffer } from '<gaze-web>/buffer';
const buffer = new GazeBuffer({
  now: () => performance.now(),            // the SAME clock the telemetry buffer uses
  getView: () => viewer.getViewState(),
  accuracyPx: meta.validation.accuracy_px, // from calibration
  isUiAt: (cx, cy) => { const el = document.elementFromPoint(cx, cy); return !stage.contains(el) || !!el?.closest('.rail, .popover, dialog'); },
  headGuard: { calibFaceW: meta.calibration.face_box.w, maxScaleChange: cfg.head.max_scale_change },
  minFaceLum: cfg.calibration.min_face_lum,
});
buffer.start();                             // resets t = 0 for gaze, exactly when telemetry resets
provider.start((raw) => buffer.push(raw));  // raw = { tClient, sx, sy, valid, face? } in client px
```

Both buffers use ms-since-case-shown and the §0 downsampling rule, so a gaze sample and a telemetry event with the same
`t` are simultaneous.

### 3.2 Opt-in, calibration, drift check in the session flow

- Gaze is **off by default**. Add an opt-in screen that states what is recorded (coordinates, σ, quality numbers; never
  frames). Reuse the copy in `mock/web/src/Landing.tsx`.
- Provider selection: `selectProvider(cfg.providers.order, videoEl, { trainOnClicks, targetHz, assetBaseUrl })`; it returns a
  plain-language `CameraError` for `NotAllowedError` / `NotFoundError` / `NotReadableError` / insecure context. Never block
  reading on gaze: any failure → continue with cursor only.
- Calibration/validation math is in `gaze-web/calibration.ts` (`gridPoints`, `validationMetrics`, `qualityTier`,
  `tierSupports`, `needsRecalibration`); the screen flow in `GazeSetup.tsx` is React but small enough to port.
- Store the resulting `GazeSessionMeta` once per session (`PUT` it when calibration finishes; update after a drift
  recalibration). Drift check between cases: one dot for `cfg.drift.dot_ms`; recalibrate when
  `needsRecalibration(err, meta.validation.accuracy_px, cfg.drift.recalibrate_factor)`.
- Never render a live gaze dot during reading (debug flag only).

### 3.3 Send `gaze` and `gaze_meta` with the submit; store them beside telemetry

```ts
const g = buffer.drain(); buffer.stop();
await submit({ ...existingPayload, telemetry, gaze: g, gaze_meta: meta });
```

Validate with the JSON schemas on the server (`shared/schemas/loader.py` → `validate("GazeSample", s)`), store raw samples
next to the telemetry for replay/audit, and **never** send raw samples to a language model.

### 3.4 Run `gaze_analysis` next to the cursor search engine

```python
from gaze_analysis.analyze import analyze_case
from gaze_analysis.config import GazeAnalysisConfig
from gaze_analysis.cursor_proxy import CursorDwellConfig

cfg = GazeAnalysisConfig.from_yaml_dicts(gaze_yaml, review_hardness, zone_human, visit_ms=300, recognition_from_ms=300, decision_from_ms=1000)
an = analyze_case(gaze=attempt.gaze, gaze_meta=session.gaze_meta, telemetry=attempt.telemetry,
                  zones=zone_masks, rois=finding_roi_masks,                 # H×W bool, ROI = mask dilated by ρ
                  finding_info={fid: {"label": ..., "zone": ..., "outcome": ...}},
                  cfg=cfg, cursor_cfg=CursorDwellConfig(**scoring_yaml["cursor_dwell"]),
                  img_w=W, img_h=H, fit_scale=fit_scale, submit_ms=read_ms, first_mark_ms=first_mark_ms)
```

`an["gaze_used"]` is false when gaze is absent or < 5 clean samples — fall back to the cursor path unchanged.

### 3.5 Choose the miss-type source; store both

```python
g = an["gaze"]["finding"][fid] if an["gaze_used"] else None
use_gaze = g is not None and g["resolution"] == "lesion" and session.gaze_meta["quality_tier"] == "good"
miss_type = g["miss_type"] if use_gaze else cursor_miss_type
attempt.finding_attribution[fid] = {"cursor": cursor_miss_type, "gaze": g, "chosen": "gaze" if use_gaze else "cursor"}
```

Gaze contributes finding-level types **only** at `lesion` resolution and `good` quality; otherwise it contributes
zone-level coverage and the scanpath. Always keep both attributions for the reveal and for the agreement report.

### 3.6 Facts builder and validator

Add the `GazeFacts` fields (`gaze_facts.v1`) to the tutor facts: `build_facts(...)` in `gaze_analysis/facts.py` produces
the block; `to_prompt_text(facts)` renders it as bullets; `validate_claim(sentence, facts)` returns violations for a
generated sentence (forbidden phrases, finding-level gaze claims at zone resolution, prescriptive order, numbers not in
the facts). Enforce `facts["claim_limits"]` in the existing validator. Rules the facts already encode:

- anatomy only (zone id + human name), never coordinates;
- every number with units and source (`gaze`/`cursor`), gaze numbers with resolution tier;
- comparisons precomputed (threshold next to value; `bands_ms`, `visit_threshold_ms`);
- references: `expert_annotation`, `review_area_checklist`, `kundel_dwell_bands` (never fabricate `expert_scanpath`);
- `phase: "pre_submit"` blocks have search + coverage only (call `build_facts(phase="pre_submit", findings=None, agreement=None, ...)`).

### 3.7 UI captions

Keep Blindspot's "Based on your cursor, loupe and zoom — a proxy for where you looked." and add the gaze variant wherever a
gaze number is shown: **"Webcam gaze estimate, ±N px"** with N = the finding's σ (or `attention.gaze_accuracy_img_px_at_fit`
for zone-level items). Text about gaze says "your eyes reached this area for about N ms", never "you saw".

## 4. Rollback switch

`BLINDSPOT_GAZE=0` must remove every gaze path:

- web: do not render the opt-in; `gaze = null` so no `GazeSession` is created and the submit payload has no `gaze` keys;
- server: skip `analyze_case`, omit `GazeFacts` fields, select `cursor` for every attribution;
- the schemas and the stored raw data stay, so sessions recorded with gaze remain replayable.

A single env read at startup on each side is enough; the mock's `App.tsx` + `analysis.py` show the two seams.

## 5. Demo note

Live calibration on a projector stage is risky: room light, distance and the projector's resolution all change the
numbers, and a failed calibration in front of an audience derails the story. Make the main demo a **pre-recorded,
labelled session replay** (`POST /replay` with a session export → full reveal, timeline, facts; badge "Recorded
session") and keep live gaze optional with the "Demo without camera" scripted path as a fallback.

## 6. First three steps

1. Copy the three schemas + `gaze_analysis/` and run its tests inside Blindspot; compare `cursor_proxy.dwell_ms` against Blindspot's own on one stored attempt.
2. Copy `packages/gaze-web/`, delete its `view.ts` in favour of Blindspot's `coords.ts`, and wire `GazeBuffer` to the viewer's `getViewState()` + the case clock (3.1); verify with the buffer tests (2 px at 1× and 3×, loupe, UI occlusion).
3. Add opt-in + calibration + drift screens (3.2) and the `gaze`/`gaze_meta` submit fields (3.3); then 3.4–3.7 behind `BLINDSPOT_GAZE`.
