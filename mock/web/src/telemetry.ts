// Blindspot's cursor TelemetryEvent contract (§0). Moves throttled to 33 ms (accept 4 ms early); cap 20,000.
import { downsample } from '@gaze/buffer';

export type TelemetryEvent = {
  t: number;
  kind: 'move' | 'down' | 'up' | 'wheel' | 'enter' | 'leave' | 'loupe' | 'wl' | 'pan';
  x?: number; y?: number;
  zoom: number;
  vp: [number, number, number, number];
  loupe: boolean;
};

export class TelemetryBuffer {
  private events: TelemetryEvent[] = [];
  private lastMove = -Infinity;
  private t0 = performance.now();
  constructor(private readonly cap = 20000, private readonly throttleMs = 33) {}
  start() { this.t0 = performance.now(); this.events = []; this.lastMove = -Infinity; }
  now() { return performance.now() - this.t0; }
  push(e: Omit<TelemetryEvent, 't'>) {
    const t = this.now();
    if (e.kind === 'move') {
      if (t - this.lastMove < this.throttleMs - 4) return;
      this.lastMove = t;
    }
    this.events.push({ t, ...e });
    if (this.events.length > this.cap * 1.25) this.events = downsample(this.events, this.cap);
  }
  drain(): TelemetryEvent[] { return downsample(this.events, this.cap); }
  get length() { return this.events.length; }
}
