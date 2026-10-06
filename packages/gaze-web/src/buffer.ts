import type { GazeSample, RawGaze, ViewState } from './types';
import { clientToImage, visibleRect } from './view';

export type GazeBufferOptions = {
  now: () => number;
  getView: () => ViewState;
  /** Session validation accuracy in screen px (1-σ proxy). sigma_img = accuracy / scale. */
  accuracyPx: number;
  /** Returns true when the element at a client point is UI covering the film (rail, popover, dialog). */
  isUiAt?: ((clientX: number, clientY: number) => boolean) | undefined;
  cap?: number | undefined; // default 20000
  /** Face-box scale at calibration; samples are invalidated beyond `maxScaleChange`. */
  headGuard?: { calibFaceW: number; maxScaleChange: number } | undefined;
  /** Samples with face luminance below this are invalid ("Light your face"). */
  minFaceLum?: number | undefined;
};

/** Uniform downsampling that keeps the first and last element (Blindspot's §0 rule). */
export function downsample<T>(arr: T[], cap: number): T[] {
  if (arr.length <= cap) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (cap - 1);
  for (let i = 0; i < cap; i++) out.push(arr[Math.round(i * step)] as T);
  return out;
}

/** Map a client-px gaze point to a GazeSample using the view (and loupe) in effect right now. Pure. */
export function mapRawToSample(raw: RawGaze, t: number, vs: ViewState, accuracyPx: number, isUi: boolean): GazeSample {
  const { view, stageRect, imgW, imgH, zoom, loupe } = vs;
  const sx = raw.sx - stageRect.left, sy = raw.sy - stageRect.top;
  const vp = visibleRect(stageRect.width, stageRect.height, view, imgW, imgH);
  const base: GazeSample = { t, sx, sy, sigma: accuracyPx / view.scale, valid: raw.valid, zoom, vp };
  if (raw.face?.lum !== undefined) base.face_lum = raw.face.lum;
  if (!raw.valid) return { ...base, target: 'off' };
  if (isUi) return { ...base, target: 'ui' };
  // Loupe-aware mapping: inside the loupe circle the screen shows magnified content from under the cursor.
  if (loupe?.on && Math.hypot(raw.sx - loupe.cx, raw.sy - loupe.cy) <= loupe.radius) {
    const k = loupe.mag * view.scale;
    const x = loupe.imgX + (raw.sx - loupe.cx) / k, y = loupe.imgY + (raw.sy - loupe.cy) / k;
    return { ...base, x, y, sigma: accuracyPx / k, on_loupe: true, target: 'image' };
  }
  const p = clientToImage(raw.sx, raw.sy, stageRect, view);
  if (p.x < 0 || p.y < 0 || p.x > imgW || p.y > imgH) return { ...base, target: 'off' };
  return { ...base, x: p.x, y: p.y, target: 'image' };
}

/**
 * Collects GazeSamples on the case clock. start() resets the clock when a case is shown.
 * Knows nothing about findings or the app; everything app-specific comes through the options.
 */
export class GazeBuffer {
  private samples: GazeSample[] = [];
  private t0 = 0;
  private running = false;
  private readonly cap: number;
  constructor(private readonly o: GazeBufferOptions) { this.cap = o.cap ?? 20000; }

  start(): void { this.t0 = this.o.now(); this.samples = []; this.running = true; }
  stop(): void { this.running = false; }
  get active(): boolean { return this.running; }
  get length(): number { return this.samples.length; }

  push(raw: RawGaze): GazeSample | undefined {
    if (!this.running) return undefined;
    const t = raw.tClient - this.t0;
    let valid = raw.valid;
    const hg = this.o.headGuard;
    if (valid && hg && raw.face && Math.abs(raw.face.w / hg.calibFaceW - 1) > hg.maxScaleChange) valid = false;
    if (valid && this.o.minFaceLum !== undefined && raw.face?.lum !== undefined && raw.face.lum < this.o.minFaceLum) valid = false;
    const isUi = valid && !!this.o.isUiAt && this.o.isUiAt(raw.sx, raw.sy);
    const s = mapRawToSample({ ...raw, valid }, t, this.o.getView(), this.o.accuracyPx, isUi);
    this.samples.push(s);
    if (this.samples.length > this.cap * 1.25) this.samples = downsample(this.samples, this.cap);
    return s;
  }

  /** Samples in case-clock order, capped at `cap` with first/last preserved. */
  drain(): GazeSample[] { return downsample(this.samples, this.cap); }
}
