/** One-euro filter (Casiez et al. 2012): smooths jitter when still, follows fast moves without the overshoot/ringing a
 *  constant-velocity Kalman shows after saccades. Units: input in any linear unit, rate in Hz from timestamps. */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t: number | null = null;
  constructor(private readonly minCutoff = 1.0, private readonly beta = 0.02, private readonly dCutoff = 1.0) {}
  reset() { this.x = null; this.dx = 0; this.t = null; }
  filter(v: number, tMs: number): number {
    if (this.x === null || this.t === null) { this.x = v; this.t = tMs; return v; }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000); this.t = tMs;
    const a = (cutoff: number) => { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); };
    const dxRaw = (v - this.x) / dt;
    this.dx = this.dx + a(this.dCutoff) * (dxRaw - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x = this.x + a(cutoff) * (v - this.x);
    return this.x;
  }
}

export class OneEuro2D {
  private fx: OneEuro; private fy: OneEuro;
  constructor(minCutoff = 1.0, beta = 0.02) { this.fx = new OneEuro(minCutoff, beta); this.fy = new OneEuro(minCutoff, beta); }
  reset() { this.fx.reset(); this.fy.reset(); }
  filter(x: number, y: number, tMs: number): [number, number] { return [this.fx.filter(x, tMs), this.fy.filter(y, tMs)]; }
}
