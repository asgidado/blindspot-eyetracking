import { expect, test, type Page } from '@playwright/test';

async function readOneCase(page: Page, i: number) {
  await expect(page.getByText(`Case ${i + 1} of`)).toBeVisible();
  const stage = page.locator('.stage');
  const box = (await stage.boundingBox())!;
  // sweep the cursor across the film so the cursor proxy has telemetry, then zoom and mark
  for (let k = 0; k < 12; k++) await page.mouse.move(box.x + 120 + k * 30, box.y + 200 + k * 25);
  await page.mouse.wheel(0, -300);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2 - 60, box.y + box.height / 2 - 80);
  await page.getByRole('button', { name: 'Nodule', exact: true }).click();
  await page.getByRole('button', { name: 'Add mark' }).click();
  await expect(page.locator('.rail li', { hasText: 'Nodule' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /Reveal/ })).toBeVisible();
  const synthetic = /Synthetic/.test((await page.getByTestId('badge').textContent()) ?? '');
  await expect(page.locator('.badge', { hasText: /^Synthetic$/ })).toHaveCount(synthetic ? 1 : 0); // label synthetic, never real
  await expect(page.getByText(/found ·/)).toBeVisible();
  await expect(page.getByText('For education. Not for clinical use.')).toBeVisible();
}

test('reads two phantoms without gaze and reaches the reveal each time', async ({ page }) => {
  await page.goto('/?study=1');
  await expect(page.getByTestId('badge')).toHaveText(/Mock · (Synthetic films|Real films)/);
  await page.getByTestId('name').fill('e2e');
  await page.getByTestId('start').click();
  await readOneCase(page, 0);
  // study order: first case has focal findings on both film packs (phantom_01 or ChestX-Det film_39996)
  await expect(page.locator('.outcome').first()).toBeVisible();
  if (await page.locator('.outcome.missed').count()) await expect(page.getByText(/Cursor proxy:/).first()).toBeVisible();
  await page.getByTestId('next').click();
  await readOneCase(page, 1);
});

test('demo without camera records scripted gaze and the chip shows tracking', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-toggle').check();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('gaze-chip')).toHaveText(/Tracking|Low quality/);
  await expect(page.getByText('Case 1 of')).toBeVisible();
  await page.waitForTimeout(1500);
  const [req] = await Promise.all([page.waitForRequest((r) => r.url().includes('/submit')), page.keyboard.press('n')]);
  const body = req.postDataJSON();
  expect(body.gaze.length).toBeGreaterThan(20);
  expect(body.gaze_meta.provider).toBe('mock');
  for (const s of body.gaze) { expect(s).not.toHaveProperty('frame'); expect(typeof s.sigma).toBe('number'); }
  await expect(page.getByRole('heading', { name: /Reveal/ })).toBeVisible();
});

test('demo gaze reveal shows both attributions, the search replay panel, facts and debrief', async ({ page }) => {
  await page.goto('/?study=1'); // fixed order; the first case has focal findings on both film packs
  await page.getByTestId('demo-toggle').check();
  await page.getByTestId('start').click();
  await expect(page.getByText('Case 1 of')).toBeVisible();
  await page.waitForTimeout(4000); // let the scripted scanpath run
  await page.keyboard.press('n');
  await expect(page.getByRole('heading', { name: /Reveal/ })).toBeVisible();
  await expect(page.getByText(/Cursor proxy:/).first()).toBeVisible();
  await expect(page.getByText(/Webcam gaze \(±\d+ px\):/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Search replay' }).click();
  await expect(page.getByRole('heading', { name: 'Zone timeline' })).toBeVisible();
  await expect(page.locator('svg.timeline')).toBeVisible();
  await expect(page.getByText(/retrocardiac/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Per-finding table' })).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'What the AI sees' }).click();
  const facts = JSON.parse((await page.getByTestId('facts-json').textContent())!);
  expect(facts.schema).toBe('gaze_facts.v1');
  expect(facts.phase).toBe('post_submit');
  expect(facts.synthetic).toBe(/Synthetic/.test((await page.getByTestId('badge').textContent()) ?? ''));
  expect(facts.attention.sources).toContain('gaze');
  expect(JSON.stringify(facts)).not.toMatch(/"(x|y|sx|sy)":/); // anatomy, not pixels
  await expect(page.getByText(/bytes · ≈\d+ tokens/)).toBeVisible();
  await page.getByRole('button', { name: 'Debrief' }).click();
  await expect(page.getByText('Template debrief (mock)')).toBeVisible();
  const debrief = (await page.locator('section p').first().textContent()) ?? '';
  expect(debrief.length).toBeGreaterThan(200);
  expect(debrief.toLowerCase()).not.toMatch(/\bsaw\b|\bnoticed\b/);
});
