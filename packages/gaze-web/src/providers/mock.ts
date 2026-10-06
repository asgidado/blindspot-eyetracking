import type { GazeProvider, ProviderInitOptions, RawGaze } from '../types';

export type ScriptedPoint = { tMs: number; sx: number; sy: number; valid?: boolean };

/**
 * Replays a scripted or recorded gaze path with no camera. Used by tests, CI, "Demo without camera"
 * and "Recorded session" replay. Points are in client px; linear interpolation between keyframes at `hz`.
 */
export class MockProvider implements GazeProvider {
  readonly id = 'mock' as const;
  readonly version = '0.1.0';
  private timer: ReturnType<typeof setInterval> | undefined;
  private startedAt = 0;
  constructor(
    private readonly script: ScriptedPoint[],
    private readonly opts: { hz?: number; jitterPx?: number; now?: () => number; seed?: number; loop?: boolean } = {},
  ) {}

  async init(_video: HTMLVideoElement, _opts: ProviderInitOptions): Promise<void> { /* no camera */ }

  start(onSample: (s: RawGaze) => void): void {
    const hz = this.opts.hz ?? 30, now = this.opts.now ?? (() => performance.now());
    const rnd = mulberry32(this.opts.seed ?? 1), jitter = this.opts.jitterPx ?? 0;
    this.startedAt = now();
    const last = this.script.at(-1)?.tMs ?? 0;
    this.timer = setInterval(() => {
      let el = now() - this.startedAt;
      if (el > last) { if (this.opts.loop) el %= Math.max(1, last); else { this.stopTimer(); return; } }
      const p = this.at(el);
      onSample({ tClient: now(), sx: p.sx + (rnd() - 0.5) * 2 * jitter, sy: p.sy + (rnd() - 0.5) * 2 * jitter, valid: p.valid, face: { x: 0, y: 0, w: 180, h: 220, lum: 128 } });
    }, 1000 / hz);
  }

  /** Interpolated point at elapsed ms. Exposed for deterministic tests. */
  at(el: number): { sx: number; sy: number; valid: boolean } {
    const s = this.script;
    if (s.length === 0) return { sx: 0, sy: 0, valid: false };
    if (el <= (s[0] as ScriptedPoint).tMs) return { ...(s[0] as ScriptedPoint), valid: s[0]?.valid ?? true };
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1] as ScriptedPoint, b = s[i] as ScriptedPoint;
      if (el <= b.tMs) {
        const u = (el - a.tMs) / Math.max(1, b.tMs - a.tMs);
        return { sx: a.sx + (b.sx - a.sx) * u, sy: a.sy + (b.sy - a.sy) * u, valid: (b.valid ?? true) && (a.valid ?? true) };
      }
    }
    const l = s.at(-1) as ScriptedPoint;
    return { sx: l.sx, sy: l.sy, valid: l.valid ?? true };
  }

  async calibrate(_p: { sx: number; sy: number }): Promise<void> { /* nothing to train */ }
  async stop(): Promise<void> { this.stopTimer(); }
  private stopTimer() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
