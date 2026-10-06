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
