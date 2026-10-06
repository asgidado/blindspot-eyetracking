import type { View } from './view';
export type { GazeSample, GazeSessionMeta, QualityTier, ProviderId, Vp } from '../../../shared/schemas/index';

export type FaceBox = { x: number; y: number; w: number; h: number; lum?: number };

/** A raw provider estimate in CLIENT (viewport) px, timestamped at frame capture. */
export type RawGaze = { tClient: number; sx: number; sy: number; valid: boolean; face?: FaceBox };

export type StageRect = { left: number; top: number; width: number; height: number };

/** Everything app-specific the buffer needs to map a client point into image px, evaluated per sample. */
export type ViewState = {
  view: View;
  stageRect: StageRect;
  imgW: number;
  imgH: number;
  /** zoom factor relative to fit (1 = fit) */
  zoom: number;
  /** Loupe state, if the app has one. Center in client px; `imgX/imgY` = image point under the cursor. */
  loupe?: { on: boolean; cx: number; cy: number; radius: number; mag: number; imgX: number; imgY: number } | undefined;
};

export type GazeProvider = {
  id: 'webeyetrack' | 'webgazer' | 'mock';
  version: string;
  init(video: HTMLVideoElement, opts: ProviderInitOptions): Promise<void>;
  start(onSample: (s: RawGaze) => void): void;
  calibrate(point: { sx: number; sy: number }): Promise<void>;
  stop(): Promise<void>;
};

export type ProviderInitOptions = {
  /** Train the regression on clicks (never on mouse moves). Forced false in validation-study mode. */
  trainOnClicks: boolean;
  /** Target inference rate; providers may degrade to a lower rate under load. */
  targetHz: number;
  /** Local path to model weights / wasm (no CDN at runtime). */
  assetBaseUrl?: string | undefined;
};
