import { GazeBuffer, downsample, mapRawToSample } from './buffer';
import { fitView, imageToScreen, zoomAt, type View } from './view';
import type { ViewState } from './types';

const stage = { left: 100, top: 50, width: 1200, height: 800 };
const fit = fitView(stage.width, stage.height, 1024, 1024);
const vs = (view: View, zoom: number, loupe?: ViewState['loupe']): ViewState => ({ view, stageRect: stage, imgW: 1024, imgH: 1024, zoom, loupe });

test('synthetic gaze at a known screen point maps to the expected image point within 2 px at 1x and 3x', () => {
  for (const [view, zoom] of [[fit, 1], [zoomAt(fit, 3, 600, 400, fit.scale, fit.scale * 6), 3]] as const) {
    const target = { x: 300.5, y: 700.25 };
    const sp = imageToScreen(target.x, target.y, view);
    const s = mapRawToSample({ tClient: 1000, sx: sp.x + stage.left, sy: sp.y + stage.top, valid: true }, 10, vs(view, zoom), 60, false);
    expect(s.target).toBe('image');
    expect(Math.abs((s.x ?? NaN) - target.x)).toBeLessThan(2);
    expect(Math.abs((s.y ?? NaN) - target.y)).toBeLessThan(2);
    expect(s.sigma).toBeCloseTo(60 / view.scale, 6);
    expect(s.zoom).toBe(zoom);
  }
});

test('sigma shrinks with zoom (image-space error = screen error / scale)', () => {
  const z3 = zoomAt(fit, 3, 600, 400, fit.scale, fit.scale * 6);
  const a = mapRawToSample({ tClient: 0, sx: 600, sy: 400, valid: true }, 0, vs(fit, 1), 60, false);
  const b = mapRawToSample({ tClient: 0, sx: 600, sy: 400, valid: true }, 0, vs(z3, 3), 60, false);
  expect(b.sigma).toBeCloseTo(a.sigma / 3, 6);
});

test('loupe-aware mapping: gaze inside the loupe circle maps through the loupe transform', () => {
  const cursorImg = { x: 400, y: 500 };
  const c = imageToScreen(cursorImg.x, cursorImg.y, fit);
  const loupe = { on: true, cx: c.x + stage.left, cy: c.y + stage.top, radius: 90, mag: 2.5, imgX: cursorImg.x, imgY: cursorImg.y };
  // 40 screen px right of the loupe center => 40 / (2.5*scale) image px right of the cursor's image point
  const s = mapRawToSample({ tClient: 0, sx: loupe.cx + 40, sy: loupe.cy, valid: true }, 0, vs(fit, 1, loupe), 60, false);
  expect(s.on_loupe).toBe(true);
  expect(s.x).toBeCloseTo(cursorImg.x + 40 / (2.5 * fit.scale), 6);
  expect(s.y).toBeCloseTo(cursorImg.y, 6);
  expect(s.sigma).toBeCloseTo(60 / (2.5 * fit.scale), 6);
  // outside the circle: base view mapping, no on_loupe flag
  const o = mapRawToSample({ tClient: 0, sx: loupe.cx + 200, sy: loupe.cy, valid: true }, 0, vs(fit, 1, loupe), 60, false);
  expect(o.on_loupe).toBeUndefined();
  expect(o.x).toBeCloseTo(cursorImg.x + 200 / fit.scale, 6);
});

test('UI occlusion: gaze over the rail/popover has no image coords and target ui', () => {
  const s = mapRawToSample({ tClient: 0, sx: 600, sy: 400, valid: true }, 0, vs(fit, 1), 60, true);
  expect(s.target).toBe('ui');
  expect(s.x).toBeUndefined();
  expect(s.y).toBeUndefined();
});

test('off-image and invalid samples carry no image coords', () => {
  const off = mapRawToSample({ tClient: 0, sx: stage.left + 1, sy: stage.top + 1, valid: true }, 0, vs(fit, 1), 60, false);
  expect(off.target).toBe('off');
  const inv = mapRawToSample({ tClient: 0, sx: 600, sy: 400, valid: false }, 0, vs(fit, 1), 60, false);
  expect(inv.valid).toBe(false);
  expect(inv.x).toBeUndefined();
});

test('GazeBuffer: case clock, head guard, face-lum guard, isUiAt, and cap with first/last preserved', () => {
  let now = 5000;
  const buf = new GazeBuffer({
    now: () => now, getView: () => vs(fit, 1), accuracyPx: 60, cap: 100,
    isUiAt: (x) => x > 1200, headGuard: { calibFaceW: 180, maxScaleChange: 0.25 }, minFaceLum: 40,
  });
  buf.start();
  const s0 = buf.push({ tClient: 5100, sx: 600, sy: 400, valid: true, face: { x: 0, y: 0, w: 180, h: 200, lum: 120 } });
  expect(s0?.t).toBe(100);
  expect(buf.push({ tClient: 5200, sx: 600, sy: 400, valid: true, face: { x: 0, y: 0, w: 300, h: 300, lum: 120 } })?.valid).toBe(false); // moved closer
  expect(buf.push({ tClient: 5300, sx: 600, sy: 400, valid: true, face: { x: 0, y: 0, w: 180, h: 200, lum: 10 } })?.valid).toBe(false); // too dark
  expect(buf.push({ tClient: 5400, sx: 1250, sy: 400, valid: true, face: { x: 0, y: 0, w: 180, h: 200, lum: 120 } })?.target).toBe('ui');
  for (let i = 0; i < 1000; i++) buf.push({ tClient: 5500 + i * 33, sx: 600, sy: 400, valid: true });
  const out = buf.drain();
  expect(out.length).toBe(100);
  expect(out[0]?.t).toBe(100);
  expect(out.at(-1)?.t).toBe(5500 + 999 * 33 - 5000);
  buf.stop();
  expect(buf.push({ tClient: 99999, sx: 600, sy: 400, valid: true })).toBeUndefined();
});

test('downsample keeps first and last', () => {
  const d = downsample(Array.from({ length: 1000 }, (_, i) => i), 10);
  expect(d.length).toBe(10);
  expect(d[0]).toBe(0);
  expect(d[9]).toBe(999);
});
