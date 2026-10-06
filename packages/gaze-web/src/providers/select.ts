import type { GazeProvider, ProviderInitOptions } from '../types';
import { explainCameraError, type CameraError } from './camera';

export type ProviderOrder = ('webeyetrack' | 'webgazer')[];

/** Try providers in order; the first whose init() succeeds wins. Camera errors are returned in plain language. */
export async function selectProvider(order: ProviderOrder, video: HTMLVideoElement, opts: ProviderInitOptions, log: (m: string) => void = console.info)
  : Promise<{ provider: GazeProvider } | { error: CameraError; tried: string[] }> {
  const tried: string[] = [];
  let lastErr: unknown = null;
  for (const id of order) {
    tried.push(id);
    try {
      const p: GazeProvider = id === 'webeyetrack'
        ? new (await import('./webeyetrack')).WebEyeTrackProvider()
        : new (await import('./webgazer')).WebGazerProvider();
      await withTimeout(p.init(video, opts), 45_000, `${id} init timed out`);
      log(`gaze provider: ${id} ready`);
      return { provider: p };
    } catch (e) {
      lastErr = e; log(`gaze provider ${id} failed: ${(e as Error)?.message ?? e}`);
      const code = explainCameraError(e).code;
      if (code === 'NotAllowedError' || code === 'NotFoundError' || code === 'InsecureContext') break; // no point trying the next one
    }
  }
  return { error: explainCameraError(lastErr), tried };
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error(msg)), ms); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });
}
