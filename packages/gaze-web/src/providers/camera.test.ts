import { boxFromLandmarks, explainCameraError, faceLuminance } from './camera';

test('camera errors become plain language', () => {
  expect(explainCameraError({ name: 'NotAllowedError' }).message).toMatch(/permission was denied/);
  expect(explainCameraError({ name: 'NotFoundError' }).message).toMatch(/No camera/);
  expect(explainCameraError({ name: 'NotReadableError' }).message).toMatch(/in use/);
  expect(explainCameraError(new Error('boom')).code).toBe('Other');
});

test('face box and luminance', () => {
  const box = boxFromLandmarks([{ x: 0.25, y: 0.2 }, { x: 0.75, y: 0.8 }], 640, 480);
  expect(box.x).toBeCloseTo(160); expect(box.y).toBeCloseTo(96); expect(box.w).toBeCloseTo(320); expect(box.h).toBeCloseTo(288);
  const small = { width: 64, height: 48, data: new Uint8ClampedArray(64 * 48 * 4).fill(200) } as unknown as ImageData;
  expect(faceLuminance(small, box, 64 / 640)).toBeCloseTo(200, 0);
});
