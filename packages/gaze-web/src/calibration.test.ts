import { gridPoints, needsRecalibration, qualityTier, validationMetrics } from './calibration';

test('grid points', () => {
  expect(gridPoints(9, 1000, 800)).toHaveLength(9);
  expect(gridPoints(9, 1000, 800)[4]).toEqual({ sx: 500, sy: 400 });
  expect(gridPoints(5, 1000, 800)[0]).toEqual({ sx: 500, sy: 400 });
  expect(gridPoints(1, 1000, 800)).toEqual([{ sx: 500, sy: 400 }]);
});

test('validation metrics: accuracy, precision, loss', () => {
  const m = validationMetrics([
    { target: { sx: 100, sy: 100 }, samples: [{ sx: 130, sy: 100 }, { sx: 130, sy: 140 }], invalid: 2 },
    { target: { sx: 500, sy: 500 }, samples: [{ sx: 500, sy: 550 }], invalid: 0 },
  ]);
  expect(m.accuracy_px).toBeCloseTo(((30 + 50) / 2 + 50) / 2, 6);
  expect(m.precision_px).toBeCloseTo(40, 6);
  expect(m.loss_pct).toBeCloseTo(40, 6);
  expect(m.n_points).toBe(2);
});

test('quality tiers and drift', () => {
  const q = { good: { accuracy_px_max: 50, loss_pct_max: 10 }, coarse: { accuracy_px_max: 120, loss_pct_max: 30 } };
  expect(qualityTier(40, 5, q)).toBe('good');
  expect(qualityTier(40, 20, q)).toBe('coarse');
  expect(qualityTier(100, 5, q)).toBe('coarse');
  expect(qualityTier(200, 5, q)).toBe('poor');
  expect(needsRecalibration(130, 60, 2)).toBe(true);
  expect(needsRecalibration(100, 60, 2)).toBe(false);
});
