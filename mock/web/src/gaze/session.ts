// App-side gaze controller: owns the provider + GazeBuffer, hands the case clock/view getter to the buffer.
// The portable package knows nothing about this file.
import { GazeBuffer } from '@gaze/buffer';
import type { GazeProvider, GazeSample, GazeSessionMeta, RawGaze, ViewState } from '@gaze/types';

export type GazeStatus = 'off' | 'tracking' | 'low' | 'lost' | 'dark';

export class GazeSession {
  private buffer: GazeBuffer | null = null;
  private lastRaw: RawGaze | null = null;
  private lastFaceAt = 0;
  private listeners = new Set<() => void>();
  private taps = new Set<(r: RawGaze) => void>();
  private started = false;
  debugDot: { sx: number; sy: number } | null = null;
  status: GazeStatus = 'off';
  readonly debug: boolean;
  private rateWindow: number[] = [];
  inferenceHz = 0;

  /** The camera <video> element. Owned here (not by React) so it survives screen changes; removed in end(). */
  videoEl: HTMLVideoElement | null = null;

  constructor(
    public readonly provider: GazeProvider,
    public meta: GazeSessionMeta,
    private readonly cfg: { headMaxScaleChange: number; minFaceLum: number; qualityCoarsePx: number },
    opts: { debug?: boolean } = {},
  ) { this.debug = !!opts.debug; }

  onChange(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  /** Exposed for debugging and e2e checks (sample rate, status). Never used by the app itself. */
  expose() { (window as unknown as { __gazeSession?: GazeSession }).__gazeSession = this; return this; }
  private emit() { for (const l of this.listeners) l(); }

  /** Tap the raw sample stream (calibration, validation, drift check). */
  tapRaw(fn: (r: RawGaze) => void) { this.taps.add(fn); return () => { this.taps.delete(fn); }; }

  /** Start receiving samples from the provider. Idempotent. */
  begin() {
    if (!this.started) { this.started = true; this.provider.start((raw) => this.onRaw(raw)); }
    this.status = this.meta.quality_tier === 'poor' ? 'low' : 'tracking';
    this.emit();
  }

  private onRaw(raw: RawGaze) {
    this.lastRaw = raw;
    for (const t of this.taps) t(raw);
    const now = performance.now();
    this.rateWindow.push(now);
    while (this.rateWindow.length && now - this.rateWindow[0]! > 2000) this.rateWindow.shift();
    this.inferenceHz = this.rateWindow.length / 2;
    if (raw.face) this.lastFaceAt = now;
    const s = this.buffer?.push(raw);
    const prev = this.status;
    if (!raw.face && now - this.lastFaceAt > 1500) this.status = 'lost';
    else if (raw.face?.lum !== undefined && raw.face.lum < this.cfg.minFaceLum) this.status = 'dark';
    else if (this.meta.quality_tier === 'poor') this.status = 'low';
    else this.status = 'tracking';
    if (this.debug && s) this.debugDot = { sx: s.sx, sy: s.sy };
    if (prev !== this.status) this.emit();
  }

  /** Called when a case is shown; resets the case clock. */
  attachCase(getView: () => ViewState, isUiAt: (cx: number, cy: number) => boolean) {
    this.buffer = new GazeBuffer({
      now: () => performance.now(), getView, isUiAt,
      accuracyPx: Math.max(1, this.meta.validation.accuracy_px),
      headGuard: { calibFaceW: Math.max(1, this.meta.calibration.face_box.w), maxScaleChange: this.cfg.headMaxScaleChange },
      minFaceLum: this.cfg.minFaceLum,
    });
    this.buffer.start();
  }

  /** Stop recording for this case and return what was captured (undefined if nothing was attached). */
  detachCase(): { samples: GazeSample[]; meta: GazeSessionMeta } | undefined {
    if (!this.buffer) return undefined;
    const samples = this.buffer.drain();
    this.buffer.stop(); this.buffer = null;
    const lat = (this.provider as unknown as { latencyMs?: number }).latencyMs;
    const ui = (this.provider as unknown as { uiFps?: number }).uiFps;
    if (ui) console.info(`[gaze] ui ≈ ${ui.toFixed(0)} fps, inference ≈ ${this.inferenceHz.toFixed(1)} Hz`);
    this.meta = { ...this.meta, inference_hz: Math.round(this.inferenceHz * 10) / 10, ...(lat ? { pipeline_latency_ms: Math.round(lat) } : {}) };
    return { samples, meta: this.meta };
  }

  get lastPoint() { return this.lastRaw; }

  /** Releases the camera and removes the video element. */
  async end() { await this.provider.stop(); this.videoEl?.remove(); this.videoEl = null; this.status = 'off'; this.emit(); }
}

/** Create the session-long camera element, parked invisibly on <body>. GazeSetup moves it into the preview box. */
export function createGazeVideo(): HTMLVideoElement {
  const v = document.createElement('video');
  v.autoplay = true; v.playsInline = true; v.muted = true; v.className = 'gaze-video';
  parkGazeVideo(v);
  return v;
}

export function parkGazeVideo(v: HTMLVideoElement) {
  v.classList.add('parked');
  document.body.appendChild(v);
}
