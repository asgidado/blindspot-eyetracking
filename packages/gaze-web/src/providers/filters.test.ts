import { OneEuro } from './filters';

test('one-euro smooths jitter when still and follows a step without overshoot', () => {
  const f = new OneEuro(1.0, 0.02);
  const still = Array.from({ length: 60 }, (_, i) => f.filter(100 + ((i % 2) * 2 - 1) * 10, i * 33));
  const tail = still.slice(30);
  expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(8); // ±10 jitter squeezed
  const out: number[] = [];
  for (let i = 60; i < 120; i++) out.push(f.filter(500, i * 33));
  expect(Math.max(...out)).toBeLessThanOrEqual(500.0001); // no overshoot past the target
  expect(out.at(-1)!).toBeGreaterThan(480); // and it gets there within 2 s
});
