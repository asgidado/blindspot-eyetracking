# Cursor–gaze agreement report

Status: **SYNTHETIC** (phantom films), **SCRIPTED gaze** (mock provider — no human eyes were tracked). Sessions n = 4.

Webcam gaze is coarse and accuracy varies by person (glasses, lighting, camera). Every number below is an estimate from the session's own calibration; see the per-participant table.

## Data

| | n |
|---|---|
| sessions | 4 |
| cases read | 32 |
| cases with usable gaze | 32 |
| gaze samples (valid) | 8033 |

## Per-participant validation (anonymous codes)

| code | provider | tier | accuracy screen px | precision px | loss % | drift checks | recalibrated |
|---|---|---|---|---|---|---|---|
| P01 | mock 0.1.0 | coarse | 70 | 23 | 12 | 3 | 0 |
| P02 | mock 0.1.0 | coarse | 95 | 32 | 3 | 3 | 0 |
| P03 | mock 0.1.0 | good | 40 | 13 | 12 | 3 | 0 |
| P04 | mock 0.1.0 | coarse | 55 | 18 | 6 | 3 | 0 |

## Gaze–cursor distance by cursor state (image px, median of per-case medians)

| cursor state | median px | n cases |
|---|---|---|
| idle | 281 | 32 |
| moving | 34 | 32 |
| loupe on | 38 | 32 |

Gaze-leads-cursor lag (cross-correlation, median over cases): **508 ms** (n = 32). Positive = cursor lags gaze.

## Review-area visited: cursor vs gaze

| | value |
|---|---|
| area-cases compared (n) | 288 |
| % agreement | 74.7 |
| Cohen's κ | 0.339 |
| visited by cursor | 62 / 288 |
| visited by gaze | 85 / 288 |

## Miss types: cursor proxy (rows) vs webcam gaze (columns)

n = 8 missed findings with a gaze type at `lesion` resolution; 21 more were missed but gaze was zone-level only (no type).

| cursor \ gaze | search | recognition | decision |
|---|---|---|---|
| search | 4 | 1 | 0 |
| recognition | 0 | 1 | 0 |
| decision | 0 | 2 | 0 |

% agreement: **62.5**, Cohen's κ: **0.4**.

## Notes

- Cursor dwell follows Blindspot's §7.1 proxy (cursor, loupe, zoom); gaze dwell is probabilistic with per-sample σ.
- Kundel bands (300 / 1000 ms) come from lab eye trackers and are applied here to webcam and cursor estimates.
- Systematic viewing order is not reported as a score (Kok 2016; van Geel 2017).
