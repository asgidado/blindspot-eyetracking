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
