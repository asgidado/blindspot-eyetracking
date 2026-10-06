// Iris-landmark gaze estimator: a ridge regression from MediaPipe iris/eye-corner geometry + head pose to a normalised
// point of gaze. Pure math, no extra inference — it reuses the 478 landmarks (incl. irises) the landmarker already
// produces for WebEyeTrack. Calibrated at the same dots; validation decides per session which estimator to keep.
// Landmark-ratio methods with a short calibration reach ~2–4° in good light; webcam glare and dim rooms degrade them.

export type Landmark = { x: number; y: number; z: number };
export type Mat = { rows: number; columns: number; data: number[] | Float32Array };

const R = { outer: 33, inner: 133, upper: 159, lower: 145 }; // subject's right eye (image left)
const L = { inner: 362, outer: 263, upper: 386, lower: 374 }; // subject's left eye (image right)
const IRIS = [468, 473];
const NOSE = 1;

/** Feature vector (with bias) or null when landmarks are missing/degenerate. */
export function irisFeatures(lm: Landmark[], rt: Mat | undefined): number[] | null {
  if (!lm || lm.length < 478) return null;
  const eye = (e: { outer: number; inner: number; upper: number; lower: number }) => {
    const a = lm[e.outer]!, b = lm[e.inner]!, u = lm[e.upper]!, d = lm[e.lower]!;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const iris = IRIS.map((i) => lm[i]!).sort((p, q) => Math.hypot(p.x - mid.x, p.y - mid.y) - Math.hypot(q.x - mid.x, q.y - mid.y))[0]!;
    // horizontal ratio measured left→right in IMAGE space for both eyes, so a gaze shift moves both ratios the same way
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), w = x1 - x0, h = d.y - u.y;
    if (w < 1e-4 || Math.abs(h) < 1e-4) return null;
    return { hx: (iris.x - x0) / w, vy: (iris.y - u.y) / h, open: Math.abs(h / w) };
  };
  const r = eye(R), l = eye(L);
  if (!r || !l) return null;
  // head pose from the facial transformation matrix (rotation columns ~ yaw/pitch proxies, translation in cm)
  const m = rt && rt.data && rt.data.length >= 16 ? Array.from(rt.data) : null;
  const g = (i: number, j: number) => (m ? m[rt!.columns === 4 ? i * 4 + j : j * 4 + i]! : 0);
  const yaw = g(0, 2), pitch = g(1, 2), r20 = g(2, 0), r21 = g(2, 1);
  const tx = g(0, 3) / 10, ty = g(1, 3) / 10, tz = g(2, 3) / 50;
  const nose = lm[NOSE]!;
  const scale = Math.hypot(lm[L.outer]!.x - lm[R.outer]!.x, lm[L.outer]!.y - lm[R.outer]!.y);
  const hx = (r.hx + l.hx) / 2, vy = (r.vy + l.vy) / 2;
  void r20; void r21; void tz; void scale; // kept out: near-constant during a still calibration → amplified noise after standardisation
  return [1, hx, vy, r.hx, l.hx, r.vy, l.vy, hx * hx, vy * vy, hx * vy, yaw, pitch, tx, ty, nose.x - 0.5, nose.y - 0.5];
}

/** Ridge regression with feature standardisation; closed form via Gaussian elimination. */
export class RidgeGaze {
  private X: number[][] = [];
  private Y: number[][] = [];
  private W: number[][] | null = null; // (d × 2)
  private mu: number[] = [];
  private sd: number[] = [];
  private ema: [number, number] | null = null;
  constructor(private readonly lambda = 0.3, private readonly emaAlpha = 0.45) {} // strong ridge: ~135 samples at 9 dots

  get n() { return this.X.length; }
  get fitted() { return this.W !== null; }

  add(features: number[], target: [number, number]) { this.X.push(features); this.Y.push(target); }
  clear() { this.X = []; this.Y = []; this.W = null; this.ema = null; }

  fit(): boolean {
    const n = this.X.length, d = this.X[0]?.length ?? 0;
    if (n < Math.max(30, d + 5)) return false;
    this.mu = Array.from({ length: d }, (_, j) => (j === 0 ? 0 : this.X.reduce((a, r) => a + r[j]!, 0) / n));
    // sd floor: a feature that barely moved during calibration must not be blown up at test time
    this.sd = Array.from({ length: d }, (_, j) => (j === 0 ? 1 : Math.max(0.02, Math.sqrt(this.X.reduce((a, r) => a + (r[j]! - this.mu[j]!) ** 2, 0) / n))));
    const Z = this.X.map((r) => this.std(r));
    const A = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    const B = Array.from({ length: d }, () => [0, 0]);
    for (let k = 0; k < n; k++) {
      const z = Z[k]!, y = this.Y[k]!;
      for (let i = 0; i < d; i++) { for (let j = 0; j < d; j++) A[i]![j]! += z[i]! * z[j]!; B[i]![0]! += z[i]! * y[0]!; B[i]![1]! += z[i]! * y[1]!; }
    }
    for (let i = 1; i < d; i++) A[i]![i]! += this.lambda * n; // no penalty on the bias
    const W = solve(A, B);
    if (!W) return false;
    this.W = W; this.ema = null;
    return true;
  }

  private std(r: number[]) { return r.map((v, j) => (j === 0 ? 1 : (v - this.mu[j]!) / this.sd[j]!)); }

  /** Normalised PoG in [-0.5, 0.5]² (EMA-smoothed), or null before fit. */
  predict(features: number[]): [number, number] | null {
    if (!this.W) return null;
    const z = this.std(features);
    let x = 0, y = 0;
    for (let j = 0; j < z.length; j++) { x += z[j]! * this.W[j]![0]!; y += z[j]! * this.W[j]![1]!; }
    x = Math.max(-0.6, Math.min(0.6, x)); y = Math.max(-0.6, Math.min(0.6, y));
    this.ema = this.ema ? [this.ema[0] + this.emaAlpha * (x - this.ema[0]), this.ema[1] + this.emaAlpha * (y - this.ema[1])] : [x, y];
    return this.ema;
  }
  resetSmoothing() { this.ema = null; }
}

/** Solve A W = B for W (A: d×d, B: d×2) by Gaussian elimination with partial pivoting. */
export function solve(A: number[][], B: number[][]): number[][] | null {
  const d = A.length;
  const M = A.map((row, i) => [...row, ...B[i]!]);
  for (let c = 0; c < d; c++) {
    let p = c;
    for (let r = c + 1; r < d; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-12) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < d; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k < d + 2; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => [row[d]! / row[i]!, row[d + 1]! / row[i]!]);
}
