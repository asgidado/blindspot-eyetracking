import { MockProvider } from './mock';

test('mock provider interpolates a scripted scanpath deterministically and stops at the end', async () => {
  const p = new MockProvider([{ tMs: 0, sx: 0, sy: 0 }, { tMs: 1000, sx: 100, sy: 200 }, { tMs: 2000, sx: 100, sy: 200, valid: false }]);
  expect(p.at(500)).toEqual({ sx: 50, sy: 100, valid: true });
  expect(p.at(1500).valid).toBe(false);
  expect(p.at(5000)).toEqual({ sx: 100, sy: 200, valid: false });
  vi.useFakeTimers();
  let t = 0;
  const got: number[] = [];
  const q = new MockProvider([{ tMs: 0, sx: 10, sy: 10 }, { tMs: 100, sx: 20, sy: 20 }], { hz: 100, now: () => t });
  q.start((s) => got.push(s.sx));
  for (let i = 0; i < 20; i++) { t += 10; vi.advanceTimersByTime(10); }
  await q.stop();
  expect(got.length).toBeGreaterThanOrEqual(9);
  expect(got.length).toBeLessThanOrEqual(11);
  expect(got[0]).toBeCloseTo(11, 5);
  vi.useRealTimers();
});
