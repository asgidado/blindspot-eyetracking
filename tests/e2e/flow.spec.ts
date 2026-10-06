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
  await expect(page.locator('.badge', { hasText: /^Synthetic$/ })).toBeVisible();
  await expect(page.getByText(/found ·/)).toBeVisible();
  await expect(page.getByText('For education. Not for clinical use.')).toBeVisible();
}

test('reads two phantoms without gaze and reaches the reveal each time', async ({ page }) => {
  await page.goto('/?study=1');
  await expect(page.getByTestId('badge')).toHaveText(/Mock · (Synthetic films|Real films)/);
  await page.getByTestId('name').fill('e2e');
  await page.getByTestId('start').click();
  await readOneCase(page, 0);
  // phantom_01 (study order) has a nodule in the left apex and a consolidation: both appear in the outcome list
  await expect(page.getByText('F1 Nodule')).toBeVisible();
  await expect(page.getByText(/Cursor proxy:/).first()).toBeVisible();
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
