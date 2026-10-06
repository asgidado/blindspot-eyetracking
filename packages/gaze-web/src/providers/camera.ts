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

/** Ask for 720p: at laptop distance a face is ~120 px wide in a 640 px frame (eyes ~25 px) — too little for the gaze
 *  network. 1280×720 roughly doubles the eye-patch detail at the same seating distance. Falls back to what the camera has. */
export async function openCamera(video: HTMLVideoElement, width = 1280, height = 720): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30 }, facingMode: 'user' }, audio: false });
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

/**
 * Frame pump. Grabs frames on a requestAnimationFrame loop whenever `video.currentTime` has advanced, rate-limited to
 * the current rate. Chrome throttles requestVideoFrameCallback for tiny/hidden/detached video elements (the hidden
 * preview during calibration and reading), which starved the pipeline (3.5 Hz measured); drawImage() still sees fresh
 * frames, so rAF is the source of frames and rVFC only refines the capture timestamp (§4.4.3).
 *
 * Jank guard: inference runs on the main thread, so the pump watches its own rAF gaps. When the UI drops below ~40 fps
 * (median gap > 25 ms over the last ticks) the rate backs off toward `minHz`; when the UI is smooth it recovers toward
 * `targetHz`. The viewer keeps its frame budget before gaze keeps its sample rate.
 */
export type Pump = { stop(): void; readonly hz: number; readonly uiFps: number };

export function pumpFrames(video: HTMLVideoElement, rate: { targetHz: number; minHz: number }, onFrame: (ts: number) => Promise<void> | void): Pump {
  let stopped = false, last = 0, busy = false, lastMediaTime = -1, hz = rate.targetHz, prevTick = 0;
  const gaps: number[] = [];
  let capture: { ts: number; at: number } | null = null;
  const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { captureTime?: number; presentationTime?: number; mediaTime: number }) => void) => number };
  const rvfc = () => {
    if (stopped || !v.requestVideoFrameCallback) return;
    v.requestVideoFrameCallback((now, meta) => { capture = { ts: meta.captureTime ?? meta.presentationTime ?? now, at: performance.now() }; rvfc(); });
  };
  rvfc();
  const medianGap = () => { const a = [...gaps].sort((x, y) => x - y); return a.length ? a[a.length >> 1]! : 16; };
  const loop = async () => {
    if (stopped) return;
    const now = performance.now();
    if (prevTick) { gaps.push(now - prevTick); if (gaps.length > 20) gaps.shift(); }
    prevTick = now;
    if (gaps.length >= 10) {
      const g = medianGap();
      if (g > 25) hz = Math.max(rate.minHz, hz - 1); // UI below ~40 fps: back off
      else if (g < 19 && hz < rate.targetHz) hz += 0.25; // smooth: recover slowly
    }
    if (!busy && video.readyState >= 2 && video.currentTime !== lastMediaTime && now - last >= 1000 / hz - 2) {
      lastMediaTime = video.currentTime; last = now; busy = true;
      const ts = capture && now - capture.at < 60 ? capture.ts : now;
      try { await onFrame(ts); } finally { busy = false; }
    }
    requestAnimationFrame(() => void loop());
  };
  requestAnimationFrame(() => void loop());
  return { stop() { stopped = true; }, get hz() { return hz; }, get uiFps() { return 1000 / medianGap(); } };
}
