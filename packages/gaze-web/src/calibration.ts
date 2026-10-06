// Pure calibration/validation math. No DOM.
import type { QualityTier } from './types';

export type Pt = { sx: number; sy: number };

/** n-point grid inside a rect with a margin (9 → 3×3, 5 → centre + 4 off-centre, 4 → corners, 1 → centre). */
export function gridPoints(n: number, w: number, h: number, margin = 0.1): Pt[] {
  const xs = (k: number) => Array.from({ length: k }, (_, i) => w * (margin + (1 - 2 * margin) * (k === 1 ? 0.5 : i / (k - 1))));
  if (n === 1) return [{ sx: w / 2, sy: h / 2 }];
  if (n === 5) return [{ sx: w / 2, sy: h / 2 }, ...[[0.25, 0.3], [0.75, 0.3], [0.25, 0.7], [0.75, 0.7]].map(([a, b]) => ({ sx: w * a!, sy: h * b! }))];
  const k = Math.max(2, Math.round(Math.sqrt(n)));
  const out: Pt[] = [];
  for (const sy of xs(k).map((v) => (v / w) * h)) for (const sx of xs(k)) out.push({ sx, sy });
  return out.slice(0, n);
}

export type ValidationSamples = { target: Pt; samples: Pt[]; invalid: number }[];

/** accuracy = mean over targets of mean |sample − target|; precision = RMS sample-to-sample distance; loss % of invalid samples. */
export function validationMetrics(v: ValidationSamples): { accuracy_px: number; precision_px: number; loss_pct: number; n_points: number; per_point: number[] } {
  const per: number[] = [], prec: number[] = [];
  let valid = 0, invalid = 0;
  for (const { target, samples, invalid: inv } of v) {
    invalid += inv; valid += samples.length;
    if (!samples.length) { per.push(NaN); continue; }
    per.push(samples.reduce((a, s) => a + Math.hypot(s.sx - target.sx, s.sy - target.sy), 0) / samples.length);
    for (let i = 1; i < samples.length; i++) prec.push((samples[i]!.sx - samples[i - 1]!.sx) ** 2 + (samples[i]!.sy - samples[i - 1]!.sy) ** 2);
  }
  const ok = per.filter((x) => !Number.isNaN(x));
  return {
    accuracy_px: ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : Infinity,
    precision_px: prec.length ? Math.sqrt(prec.reduce((a, b) => a + b, 0) / prec.length) : Infinity,
    loss_pct: valid + invalid ? (100 * invalid) / (valid + invalid) : 100,
    n_points: v.length, per_point: per,
  };
}

export type QualityCfg = { good: { accuracy_px_max: number; loss_pct_max: number }; coarse: { accuracy_px_max: number; loss_pct_max: number } };

export function qualityTier(accuracy_px: number, loss_pct: number, q: QualityCfg): QualityTier {
  if (accuracy_px <= q.good.accuracy_px_max && loss_pct <= q.good.loss_pct_max) return 'good';
  if (accuracy_px <= q.coarse.accuracy_px_max && loss_pct <= q.coarse.loss_pct_max) return 'coarse';
  return 'poor';
}

/** What a tier supports, in words the result screen shows. */
export function tierSupports(tier: QualityTier): string {
  return tier === 'good' ? 'finding-level feedback when zoomed in; zone-level at fit'
    : tier === 'coarse' ? 'zone-level feedback only (finding-level only when zoomed in a lot)'
      : 'gaze recorded for research only; feedback falls back to the cursor proxy';
}

/** Drift check: error at a single dot vs baseline accuracy. */
export function needsRecalibration(error_px: number, baseline_px: number, factor: number): boolean {
  return error_px > factor * Math.max(baseline_px, 1);
}
