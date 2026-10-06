// WebGazer (GPL-3.0-or-later) fallback. Loaded ONLY through the dynamic import below so nothing links against it unless
// WebEyeTrack failed. Caveat (logged in docs/PROGRESS.md): webgazer 3.5.3 loads its face-mesh model from tfhub.dev at
// runtime, so this fallback is NOT offline-capable. Mouse-move training is removed right after begin(); click training is
// re-added only when `trainOnClicks`.
import type { GazeProvider, ProviderInitOptions, RawGaze } from '../types';
import { explainCameraError } from './camera';

type WG = {
  begin(onFail?: (e: unknown) => void): Promise<unknown>; end(): void; pause(): void; resume(): Promise<void>;
  setRegression(n: string): WG; setGazeListener(fn: (d: { x: number; y: number } | null, clock: number) => void): WG;
  removeMouseEventListeners(): WG; recordScreenPosition(x: number, y: number, type?: string): void;
  showVideoPreview(v: boolean): WG; showPredictionPoints(v: boolean): WG; saveDataAcrossSessions(v: boolean): WG; applyKalmanFilter(v: boolean): WG;
  getTracker(): { getPositions?: () => number[][] | false };
  params: { showVideo: boolean; showFaceOverlay: boolean; showFaceFeedbackBox: boolean; videoElementId: string };
};

export class WebGazerProvider implements GazeProvider {
  readonly id = 'webgazer' as const;
  version = '3.5.3';
  private wg: WG | null = null;
  private onSample: ((s: RawGaze) => void) | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private opts: ProviderInitOptions | null = null;
  private lastFaceAt = 0;

  async init(_video: HTMLVideoElement, opts: ProviderInitOptions): Promise<void> {
    this.opts = opts;
    const mod = (await import('webgazer')) as unknown as { default?: WG } & WG;
    const wg = (mod.default ?? mod) as WG;
    wg.params.showVideo = false; wg.params.showFaceOverlay = false; wg.params.showFaceFeedbackBox = false;
    wg.setRegression('ridge').saveDataAcrossSessions(false).applyKalmanFilter(true).showVideoPreview(false).showPredictionPoints(false);
    let failed: unknown = null;
    await wg.begin((e) => { failed = e; });
    if (failed) throw Object.assign(new Error(explainCameraError(failed).message), { name: (failed as Error).name });
    wg.removeMouseEventListeners(); // never train on mouse moves
    this.wg = wg;
  }

  start(onSample: (s: RawGaze) => void): void {
    const wg = this.wg; if (!wg) throw new Error('init() first');
    this.onSample = onSample;
    wg.setGazeListener((d, clock) => {
      const now = performance.now();
      const pos = wg.getTracker().getPositions?.();
      const hasFace = !!pos && pos.length > 0;
      if (hasFace) this.lastFaceAt = now;
      // webgazer gives no face box; approximate one from landmark extent so the head guard still works
      let face: RawGaze['face'];
      if (hasFace && pos) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of pos) { x0 = Math.min(x0, p[0]!); y0 = Math.min(y0, p[1]!); x1 = Math.max(x1, p[0]!); y1 = Math.max(y1, p[1]!); }
        face = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
      this.onSample?.({ tClient: clock || now, sx: d?.x ?? 0, sy: d?.y ?? 0, valid: !!d && hasFace, ...(face ? { face } : {}) });
    });
    if (this.opts?.trainOnClicks) {
      this.clickHandler = (e: MouseEvent) => wg.recordScreenPosition(e.clientX, e.clientY, 'click');
      document.addEventListener('click', this.clickHandler, true);
    }
  }

  async calibrate(point: { sx: number; sy: number }): Promise<void> {
    for (let i = 0; i < 5; i++) this.wg?.recordScreenPosition(point.sx, point.sy, 'click');
  }

  async stop(): Promise<void> {
    if (this.clickHandler) document.removeEventListener('click', this.clickHandler, true);
    this.wg?.end(); this.wg = null; this.onSample = null; // end() stops the camera stream
  }
}
