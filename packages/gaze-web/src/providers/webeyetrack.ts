// WebEyeTrack (MIT) adapter. Runs the library's main-thread WebEyeTrack class with OUR face landmarker so that every
// model asset (MediaPipe wasm + face_landmarker.task, BlazeGaze weights) is served locally — webeyetrack 0.0.2 hardcodes
// CDN URLs in its own FaceLandmarkerClient. Mouse-move training does not exist in this library; click training is
// opt-in through `trainOnClicks` and routed through handleClick().
import type { FaceBox, GazeProvider, ProviderInitOptions, RawGaze } from '../types';
import { boxFromLandmarks, faceLuminance, openCamera, pumpFrames, stopCamera, type Pump } from './camera';

type GazeResult = { facialLandmarks: { x: number; y: number }[]; eyePatch: ImageData; headVector: number[]; faceOrigin3D: number[]; gazeState: 'open' | 'closed'; normPog: number[]; durations: Record<string, number>; timestamp: number };

type Wet = {
  loaded: boolean;
  initialize(): Promise<void>;
  step(frame: ImageData, ts: number): Promise<GazeResult>;
  adapt(eyePatches: ImageData[], headVectors: number[][], faceOrigins3D: number[][], normPogs: number[][], steps?: number, lr?: number, ptType?: 'calib' | 'click'): void;
  handleClick(nx: number, ny: number): void;
  faceLandmarkerClient: unknown;
};

export class WebEyeTrackProvider implements GazeProvider {
  readonly id = 'webeyetrack' as const;
  version = '0.0.2';
  private wet: Wet | null = null;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private pump: Pump | null = null;
  private frameCanvas = document.createElement('canvas');
  private smallCanvas = document.createElement('canvas');
  private onSample: ((s: RawGaze) => void) | null = null;
  private recent: GazeResult[] = [];
  private hz = 30;
  private opts: ProviderInitOptions | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  /** measured pipeline latency (frame capture → result), ms, EMA */
  latencyMs = 0;
  /** UI frame rate as seen by the pump (median rAF gap), for logging */
  get uiFps() { return this.pump?.uiFps ?? 0; }
  lastDurations: Record<string, number> = {};

  async init(video: HTMLVideoElement, opts: ProviderInitOptions): Promise<void> {
    this.opts = opts; this.hz = opts.targetHz; this.video = video;
    const base = (opts.assetBaseUrl ?? '/vendor/models').replace(/\/$/, '');
    const [{ WebEyeTrack }, vision] = await Promise.all([import('webeyetrack'), import('@mediapipe/tasks-vision')]);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${base}/mediapipe/wasm`);
    const landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}/mediapipe/face_landmarker.task`, delegate: 'GPU' },
      outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true, runningMode: 'VIDEO', numFaces: 1,
    });
    // VIDEO mode tracks the face between frames instead of re-detecting it every frame: much cheaper on the main thread.
    let lastTs = 0;
    const wet = new WebEyeTrack(24, 120) as unknown as Wet; // keep up to 24 support sets (9 calib + clicks), click TTL 120 s
    // swap in a landmarker that uses local assets; the library's own client would fetch from a CDN
    wet.faceLandmarkerClient = {
      initialize: async () => {},
      processFrame: async (frame: ImageData) => { lastTs = Math.max(lastTs + 1, Math.round(performance.now())); return landmarker.detectForVideo(frame, lastTs); },
    };
    await wet.initialize(); // loads BlazeGaze from <origin>/web/model.json (served from vendor/models/web)
    this.wet = wet;
    this.stream = await openCamera(video);
    this.frameCanvas.width = video.videoWidth || 640; this.frameCanvas.height = video.videoHeight || 480;
    this.smallCanvas.width = 64; this.smallCanvas.height = 48;
  }

  start(onSample: (s: RawGaze) => void): void {
    if (!this.wet || !this.video) throw new Error('init() first');
    this.onSample = onSample;
    const video = this.video, wet = this.wet;
    const ctx = this.frameCanvas.getContext('2d', { willReadFrequently: true })!;
    const sctx = this.smallCanvas.getContext('2d', { willReadFrequently: true })!;
    this.pump = pumpFrames(video, { targetHz: this.opts?.targetHz ?? 20, minHz: this.opts?.minHz ?? 8 }, async (ts) => {
      if (video.videoWidth === 0) return;
      if (this.frameCanvas.width !== video.videoWidth) { this.frameCanvas.width = video.videoWidth; this.frameCanvas.height = video.videoHeight; }
      ctx.drawImage(video, 0, 0);
      const frame = ctx.getImageData(0, 0, this.frameCanvas.width, this.frameCanvas.height);
      const r = await wet.step(frame, ts);
      const t1 = performance.now();
      this.latencyMs = this.latencyMs ? this.latencyMs * 0.9 + (t1 - ts) * 0.1 : t1 - ts;
      this.lastDurations = r.durations;
      this.hz = this.pump?.hz ?? this.hz; // rate is governed by the pump's jank guard
      let face: FaceBox | undefined;
      const hasFace = r.facialLandmarks && r.facialLandmarks.length > 0;
      if (hasFace) {
        face = boxFromLandmarks(r.facialLandmarks, frame.width, frame.height);
        sctx.drawImage(video, 0, 0, 64, 48);
        face.lum = faceLuminance(sctx.getImageData(0, 0, 64, 48), face, 64 / frame.width);
      }
      const valid = hasFace && r.gazeState === 'open' && wet.loaded;
      if (valid) { this.recent.push(r); if (this.recent.length > 90) this.recent.shift(); }
      const sx = (r.normPog[0]! + 0.5) * window.innerWidth, sy = (r.normPog[1]! + 0.5) * window.innerHeight; // library convention
      this.onSample?.({ tClient: ts, sx, sy, valid, ...(face ? { face } : {}) });
    });
    if (this.opts?.trainOnClicks) {
      this.clickHandler = (e: MouseEvent) => wet.handleClick(e.clientX / window.innerWidth - 0.5, e.clientY / window.innerHeight - 0.5);
      document.addEventListener('click', this.clickHandler, true);
    }
  }

  /** Few-shot adaptation: use the GazeResults collected while the user fixated the dot (last ~0.7 s). */
  async calibrate(point: { sx: number; sy: number }): Promise<void> {
    if (!this.wet) return;
    const nx = point.sx / window.innerWidth - 0.5, ny = point.sy / window.innerHeight - 0.5;
    const take = this.recent.slice(-Math.max(3, Math.round(this.hz * 0.7)));
    if (take.length < 3) return; // nothing usable (face lost); UI will report data loss
    this.wet.adapt(take.map((r) => r.eyePatch), take.map((r) => r.headVector), take.map((r) => r.faceOrigin3D), take.map(() => [nx, ny]), 3, 1e-4, 'calib');
    this.recent = [];
  }

  async stop(): Promise<void> {
    this.pump?.stop(); this.pump = null;
    if (this.clickHandler) document.removeEventListener('click', this.clickHandler, true);
    if (this.video) stopCamera(this.video, this.stream);
    this.stream = null; this.onSample = null;
  }
}
