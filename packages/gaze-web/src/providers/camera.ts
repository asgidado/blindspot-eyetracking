// Shared camera helpers for live providers. Frames stay in the browser; nothing here stores or transmits them.
import type { FaceBox } from '../types';

export type CameraError = { code: 'NotAllowedError' | 'NotFoundError' | 'NotReadableError' | 'InsecureContext' | 'Other'; message: string };

export function explainCameraError(e: unknown): CameraError {
  if (typeof window !== 'undefined' && !window.isSecureContext)
    return { code: 'InsecureContext', message: 'Camera access needs https or localhost. Open the app over https or on localhost.' };
  const name = (e as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError') return { code: name, message: 'Camera permission was denied. Allow the camera in the browser address bar, then try again — or continue without gaze.' };
  if (name === 'NotFoundError') return { code: name, message: 'No camera was found on this device. You can continue without gaze.' };
  if (name === 'NotReadableError') return { code: name, message: 'The camera is in use by another app (video call?). Close it and try again, or continue without gaze.' };
  return { code: 'Other', message: `Could not start eye tracking: ${(e as Error)?.message ?? String(e)}` };
}

export async function openCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
  video.srcObject = stream;
  video.muted = true; video.playsInline = true;
  await video.play();
  return stream;
}

export function stopCamera(video: HTMLVideoElement, stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}

/** Mean luminance (0-255) of a face box, sampled from a tiny downscaled frame. Cheap enough for every frame. */
export function faceLuminance(small: ImageData, box: { x: number; y: number; w: number; h: number }, scale: number): number {
  const x0 = Math.max(0, Math.floor(box.x * scale)), y0 = Math.max(0, Math.floor(box.y * scale));
  const x1 = Math.min(small.width, Math.ceil((box.x + box.w) * scale)), y1 = Math.min(small.height, Math.ceil((box.y + box.h) * scale));
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * small.width + x) * 4;
    sum += 0.299 * small.data[i]! + 0.587 * small.data[i + 1]! + 0.114 * small.data[i + 2]!; n++;
  }
  return n ? sum / n : 0;
}

export function boxFromLandmarks(lm: { x: number; y: number }[], vw: number, vh: number): FaceBox {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of lm) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }
  return { x: x0 * vw, y: y0 * vh, w: (x1 - x0) * vw, h: (y1 - y0) * vh };
}

/** Frame pump using requestVideoFrameCallback (capture-time stamps) with a rAF fallback; rate-limited to `hz`. */
export function pumpFrames(video: HTMLVideoElement, hz: () => number, onFrame: (ts: number) => Promise<void> | void): () => void {
  let stopped = false, last = 0, busy = false;
  const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { captureTime?: number; presentationTime?: number; expectedDisplayTime?: number }) => void) => number };
  const tick = async (now: number, meta?: { captureTime?: number; presentationTime?: number }) => {
    if (stopped) return;
    const ts = meta?.captureTime ?? meta?.presentationTime ?? now; // §4.4.3: stamp at capture, not inference end
    if (!busy && ts - last >= 1000 / hz() - 2) {
      busy = true; last = ts;
      try { await onFrame(ts); } finally { busy = false; }
    }
    schedule();
  };
  const schedule = () => {
    if (stopped) return;
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback((now, meta) => void tick(now, meta));
    else requestAnimationFrame((now) => void tick(now));
  };
  schedule();
  return () => { stopped = true; };
}
