// WebEyeTrack (MIT) adapter. The pipeline (MediaPipe face landmarker + BlazeGaze, both from local assets) runs in a
// classic Web Worker (../../worker/webeyetrack.worker.js) so GPU readbacks never stall the UI thread. The main thread
// only grabs ImageBitmaps from the camera, maps results to screen px, filters them (one-euro), and computes the second
// estimator (iris-landmark ridge regression) from the landmarks the worker sends back.
import type { FaceBox, GazeProvider, ProviderInitOptions, RawGaze } from '../types';
import { openCamera, pumpFrames, stopCamera, type Pump } from './camera';
import { OneEuro2D } from './filters';
import { RidgeGaze, irisFeatures, type Landmark } from './iris';

type Result = {
  type: 'result'; ts: number; normPog: number[]; valid: boolean; face: (FaceBox & { lum: number }) | null;
  landmarks: Float32Array | null; faceRt: number[] | null; rtCols: number; durations: Record<string, number>; inferMs: number; frame: { width: number; height: number };
};

export class WebEyeTrackProvider implements GazeProvider {
  readonly id = 'webeyetrack' as const;
  version = '0.0.2';
  private worker: Worker | null = null;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private pump: Pump | null = null;
  private onSample: ((s: RawGaze) => void) | null = null;
  private opts: ProviderInitOptions | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private hz = 20;
  private readonly smooth = new OneEuro2D(1.0, 0.02);
  /** measured pipeline latency (frame capture → result on the main thread), ms, EMA */
  latencyMs = 0;
  lastDurations: Record<string, number> = {};
  frame = { width: 0, height: 0 };
  readonly iris = new RidgeGaze();
  active: 'blazegaze' | 'iris' = 'blazegaze';
  private lastFeatures: number[] | null = null;
  private recentFeatures: number[][] = [];
  estimators() { return ['blazegaze', 'iris']; }
  setEstimator(id: string) { if (id === 'blazegaze' || id === 'iris') this.active = id; }
  get uiFps() { return this.pump?.uiFps ?? 0; }

  async init(video: HTMLVideoElement, opts: ProviderInitOptions): Promise<void> {
    this.opts = opts; this.hz = opts.targetHz; this.video = video;
    const base = (opts.assetBaseUrl ?? '').replace(/\/$/, '');
    // a classic worker, served as a static asset (Vite copies it; no bundling, so importScripts works inside)
    const url = new URL('../../worker/webeyetrack.worker.js', import.meta.url).href;
    const worker = new Worker(url);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('gaze worker init timed out')), 60_000);
      worker.onmessage = (e: MessageEvent) => {
        if (e.data?.type === 'ready') { clearTimeout(t); resolve(); }
        else if (e.data?.type === 'error') { clearTimeout(t); reject(new Error(e.data.message)); }
      };
      worker.onerror = (e) => { clearTimeout(t); reject(new Error(e.message || 'gaze worker failed to load')); };
      worker.postMessage({ type: 'init', base: base || location.origin, maxPoints: 24 });
    });
    this.worker = worker;
    this.stream = await openCamera(video);
    this.frame = { width: video.videoWidth || 640, height: video.videoHeight || 480 };
  }

  start(onSample: (s: RawGaze) => void): void {
    const worker = this.worker, video = this.video;
    if (!worker || !video) throw new Error('init() first');
    this.onSample = onSample;
    worker.onmessage = (e: MessageEvent) => { if (e.data?.type === 'result') this.onResult(e.data as Result); };
    this.pump = pumpFrames(video, { targetHz: this.opts?.targetHz ?? 20, minHz: this.opts?.minHz ?? 8 }, async (ts) => {
      if (video.videoWidth === 0) return;
      const bitmap = await createImageBitmap(video); // GPU-side copy; no readback on this thread
      worker.postMessage({ type: 'frame', bitmap, ts }, [bitmap]);
    });
    if (this.opts?.trainOnClicks) {
      this.clickHandler = (e: MouseEvent) => {
        const nx = e.clientX / window.innerWidth - 0.5, ny = e.clientY / window.innerHeight - 0.5;
        worker.postMessage({ type: 'click', nx, ny });
        if (this.lastFeatures) { this.iris.add(this.lastFeatures, [nx, ny]); this.iris.fit(); }
      };
      document.addEventListener('click', this.clickHandler, true);
    }
  }

  private onResult(r: Result) {
    const now = performance.now();
    this.latencyMs = this.latencyMs ? this.latencyMs * 0.9 + (now - r.ts) * 0.1 : now - r.ts;
    this.lastDurations = { ...r.durations, worker_total: r.inferMs };
    this.frame = r.frame;
    this.hz = this.pump?.hz ?? this.hz;
    const W = window.innerWidth, H = window.innerHeight;
    let bg: { sx: number; sy: number };
    if (r.valid) {
      const [fx, fy] = this.smooth.filter(r.normPog[0]!, r.normPog[1]!, r.ts);
      bg = { sx: (fx + 0.5) * W, sy: (fy + 0.5) * H };
    } else { this.smooth.reset(); bg = { sx: (r.normPog[0]! + 0.5) * W, sy: (r.normPog[1]! + 0.5) * H }; }
    let lm: Landmark[] | null = null;
    if (r.landmarks) { lm = []; for (let i = 0; i < r.landmarks.length; i += 3) lm.push({ x: r.landmarks[i]!, y: r.landmarks[i + 1]!, z: r.landmarks[i + 2]! }); }
    this.lastFeatures = r.valid && lm ? irisFeatures(lm, r.faceRt ? { rows: 4, columns: r.rtCols, data: r.faceRt } : undefined) : null;
    if (this.lastFeatures) { this.recentFeatures.push(this.lastFeatures); if (this.recentFeatures.length > 90) this.recentFeatures.shift(); }
    const ip = this.lastFeatures ? this.iris.predict(this.lastFeatures) : null;
    if (!r.valid) this.iris.resetSmoothing();
    const ir = ip ? { sx: (ip[0] + 0.5) * W, sy: (ip[1] + 0.5) * H } : null;
    const main = this.active === 'iris' && ir ? ir : bg;
    const alt = this.active === 'iris' ? { id: 'blazegaze', ...bg } : ir ? { id: 'iris', ...ir } : undefined;
    const face: FaceBox | undefined = r.face ? { x: r.face.x, y: r.face.y, w: r.face.w, h: r.face.h, lum: r.face.lum } : undefined;
    this.onSample?.({ tClient: r.ts, sx: main.sx, sy: main.sy, valid: r.valid && (this.active !== 'iris' || !!ir), ...(face ? { face } : {}), ...(alt ? { alt } : {}) });
  }

  /** Few-shot adaptation in the worker from the results collected while the user fixated the dot (~0.8 s). */
  async calibrate(point: { sx: number; sy: number }): Promise<void> {
    const worker = this.worker; if (!worker) return;
    const nx = point.sx / window.innerWidth - 0.5, ny = point.sy / window.innerHeight - 0.5;
    const n = Math.max(3, Math.round(this.hz * 0.8));
    await new Promise<void>((resolve) => {
      const prev = worker.onmessage;
      const t = setTimeout(() => { worker.onmessage = prev; resolve(); }, 3000);
      worker.onmessage = (e: MessageEvent) => { if (e.data?.type === 'calibrated') { clearTimeout(t); worker.onmessage = prev; resolve(); } else prev?.call(worker, e); };
      worker.postMessage({ type: 'calibrate', nx, ny, n });
    });
    for (const f of this.recentFeatures.slice(-n)) this.iris.add(f, [nx, ny]);
    this.iris.fit();
    this.recentFeatures = [];
    this.smooth.reset();
  }

  async stop(): Promise<void> {
    this.pump?.stop(); this.pump = null;
    if (this.clickHandler) document.removeEventListener('click', this.clickHandler, true);
    this.worker?.postMessage({ type: 'stop' }); this.worker?.terminate(); this.worker = null;
    if (this.video) stopCamera(this.video, this.stream);
    this.stream = null; this.onSample = null;
  }
}
