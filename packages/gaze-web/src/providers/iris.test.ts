import { RidgeGaze, irisFeatures, solve } from './iris';

test('solve recovers a known system', () => {
  const W = solve([[2, 0], [0, 4]], [[2, 4], [4, 8]]);
  expect(W![0]![0]).toBeCloseTo(1); expect(W![0]![1]).toBeCloseTo(2); expect(W![1]![0]).toBeCloseTo(1); expect(W![1]![1]).toBeCloseTo(2);
});

function fakeLandmarks(hx: number, vy: number): { x: number; y: number; z: number }[] {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  // right eye corners/lids at x 0.35..0.42, left eye 0.58..0.65; iris placed by ratio
  const set = (i: number, x: number, y: number) => { lm[i] = { x, y, z: 0 }; };
  set(33, 0.35, 0.45); set(133, 0.42, 0.45); set(159, 0.385, 0.43); set(145, 0.385, 0.47);
  set(362, 0.58, 0.45); set(263, 0.65, 0.45); set(386, 0.615, 0.43); set(374, 0.615, 0.47);
  set(468, 0.35 + hx * 0.07, 0.43 + vy * 0.04); set(473, 0.58 + hx * 0.07, 0.43 + vy * 0.04);
  set(1, 0.5, 0.55);
  return lm;
}

test('iris features respond to iris position and the ridge fits a linear screen mapping', () => {
  const rt = { rows: 4, columns: 4, data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -40, 0, 0, 0, 1] };
  const f0 = irisFeatures(fakeLandmarks(0.3, 0.5), rt)!, f1 = irisFeatures(fakeLandmarks(0.7, 0.5), rt)!;
  expect(f1[1]).toBeGreaterThan(f0[1]!); // mean horizontal ratio moved right
  const rg = new RidgeGaze(1e-3);  // weak ridge for the exact synthetic mapping
  const pts: [number, number][] = [];
  for (let i = 0; i < 9; i++) pts.push([(i % 3) / 2 - 0.5, Math.floor(i / 3) / 2 - 0.5]);
  for (const [tx, ty] of pts) for (let k = 0; k < 8; k++) {
    const noise = () => (Math.random() - 0.5) * 0.01;
    rg.add(irisFeatures(fakeLandmarks(0.5 + tx * 0.4 + noise(), 0.5 + ty * 0.4 + noise()), rt)!, [tx, ty]);
  }
  expect(rg.fit()).toBe(true);
  const p = rg.predict(irisFeatures(fakeLandmarks(0.5 + 0.25 * 0.4, 0.5 - 0.25 * 0.4), rt)!)!;
  expect(p[0]).toBeCloseTo(0.25, 1); expect(p[1]).toBeCloseTo(-0.25, 1);
  expect(irisFeatures(fakeLandmarks(0.5, 0.5).slice(0, 100), rt)).toBeNull();
});
