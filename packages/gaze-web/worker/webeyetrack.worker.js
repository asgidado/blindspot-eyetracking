/* eslint-disable */
// Classic Web Worker running the whole gaze pipeline (MediaPipe face landmarker + WebEyeTrack BlazeGaze) off the UI
// thread, with every asset served locally. The library's own worker proxy bakes in CDN URLs, so this one is ours.
// Protocol (main → worker): {type:'init', base, maxPoints} · {type:'frame', bitmap, ts} · {type:'calibrate', nx, ny, n}
//                           {type:'click', nx, ny} · {type:'stop'}
//          (worker → main): {type:'ready'} · {type:'error', message} · {type:'result', ...}
// Camera frames arrive as transferable ImageBitmaps and never leave this worker.

let wet = null, landmarker = null, frameCanvas = null, frameCtx = null, smallCanvas = null, smallCtx = null;
let recent = []; // GazeResults with a face and open eyes, for few-shot adaptation
let lastTs = 0;

function loadLibs(base) {
  // webeyetrack's UMD attaches to self when no CommonJS globals exist
  importScripts(base + '/lib/webeyetrack.js');
  const WET = self.WebEyeTrack;
  // MediaPipe's bundle is CommonJS: give it module/exports, then remove them so the wasm loader (also UMD) attaches
  // ModuleFactory to self as MediaPipe expects inside workers
  self.module = { exports: {} }; self.exports = self.module.exports;
  importScripts(base + '/lib/vision_bundle.cjs');
  const vision = self.module.exports;
  delete self.module; delete self.exports;
  return { WET, vision };
}

async function init(base, maxPoints) {
  if (typeof document === 'undefined') {
    // the library builds canvases for the eye patch; OffscreenCanvas stands in
    self.document = { createElement: (tag) => (tag === 'canvas' ? new OffscreenCanvas(1, 1) : {}) };
  }
  const { WET, vision } = loadLibs(base);
  const fileset = await vision.FilesetResolver.forVisionTasks(base + '/mediapipe/wasm');
  landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: base + '/mediapipe/face_landmarker.task', delegate: 'GPU' },
    outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true, runningMode: 'VIDEO', numFaces: 1,
  });
  wet = new WET(maxPoints || 24, 120);
  wet.faceLandmarkerClient = {
    initialize: async () => {},
    processFrame: async (frame) => { lastTs = Math.max(lastTs + 1, Math.round(performance.now())); return landmarker.detectForVideo(frame, lastTs); },
  };
  wet.kalmanFilter = { step: (x) => x }; // no constant-velocity Kalman: it overshoots after saccades; the main thread filters
  await wet.initialize(); // BlazeGaze weights from <origin>/web/model.json
  smallCanvas = new OffscreenCanvas(64, 48); smallCtx = smallCanvas.getContext('2d', { willReadFrequently: true });
}

function faceBox(lm, w, h) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of lm) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }
  return { x: x0 * w, y: y0 * h, w: (x1 - x0) * w, h: (y1 - y0) * h };
}

function faceLum(bitmapW, bitmapH, box) {
  const k = 64 / bitmapW, d = smallCtx.getImageData(0, 0, 64, 48).data;
  const x0 = Math.max(0, Math.floor(box.x * k)), y0 = Math.max(0, Math.floor(box.y * k));
  const x1 = Math.min(64, Math.ceil((box.x + box.w) * k)), y1 = Math.min(48, Math.ceil((box.y + box.h) * k));
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * 64 + x) * 4; s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; }
  return n ? s / n : 0;
}

async function onFrame(bitmap, ts) {
  const w = bitmap.width, h = bitmap.height;
  if (!frameCanvas || frameCanvas.width !== w || frameCanvas.height !== h) {
    frameCanvas = new OffscreenCanvas(w, h); frameCtx = frameCanvas.getContext('2d', { willReadFrequently: true });
  }
  frameCtx.drawImage(bitmap, 0, 0);
  smallCtx.drawImage(bitmap, 0, 0, 64, 48);
  bitmap.close();
  const frame = frameCtx.getImageData(0, 0, w, h); // readback stalls THIS thread only
  const t0 = performance.now();
  const r = await wet.step(frame, ts);
  const hasFace = r.facialLandmarks && r.facialLandmarks.length > 0;
  let face = null;
  if (hasFace) { face = faceBox(r.facialLandmarks, w, h); face.lum = faceLum(w, h, face); }
  const valid = hasFace && r.gazeState === 'open' && wet.loaded;
  if (valid) { recent.push(r); if (recent.length > 90) recent.shift(); }
  const lm = hasFace ? new Float32Array(r.facialLandmarks.length * 3) : null;
  if (lm) r.facialLandmarks.forEach((p, i) => { lm[i * 3] = p.x; lm[i * 3 + 1] = p.y; lm[i * 3 + 2] = p.z; });
  const rt = hasFace && r.faceRt && r.faceRt.data ? Array.from(r.faceRt.data) : null;
  self.postMessage({ type: 'result', ts, normPog: r.normPog, valid, face, landmarks: lm, faceRt: rt, rtCols: r.faceRt ? r.faceRt.columns : 4, durations: r.durations, inferMs: performance.now() - t0, frame: { width: w, height: h } }, lm ? [lm.buffer] : []);
}

function calibrate(nx, ny, n) {
  const take = recent.slice(-Math.max(3, n));
  if (take.length < 3) return 0;
  wet.adapt(take.map((r) => r.eyePatch), take.map((r) => r.headVector), take.map((r) => r.faceOrigin3D), take.map(() => [nx, ny]), 1, 1e-5, 'calib');
  recent = [];
  return take.length;
}

let busy = false;
self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') { await init(m.base, m.maxPoints); self.postMessage({ type: 'ready' }); }
    else if (m.type === 'frame') { if (busy) { m.bitmap.close(); return; } busy = true; try { await onFrame(m.bitmap, m.ts); } finally { busy = false; } }
    else if (m.type === 'calibrate') { const n = calibrate(m.nx, m.ny, m.n); self.postMessage({ type: 'calibrated', n }); }
    else if (m.type === 'click') { if (wet && wet.loaded) wet.handleClick(m.nx, m.ny); }
    else if (m.type === 'stop') { try { landmarker && landmarker.close && landmarker.close(); } catch (_) {} self.close(); }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
  }
};
