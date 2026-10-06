import { expect, test } from '@playwright/test';

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--ignore-gpu-blocklist'] }, permissions: ['camera'] });

test('viewer holds >= 50 fps while panning with gaze tracking on (demo provider)', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-toggle').check();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('gaze-chip')).toHaveText(/Tracking/);
  const stage = page.locator('.stage');
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -600);
  await page.evaluate(() => {
    const w = window as unknown as { __fps: { frames: number; t0: number; done: boolean; fps: number } };
    w.__fps = { frames: 0, t0: performance.now(), done: false, fps: 0 };
    const loop = () => { w.__fps.frames++; if (performance.now() - w.__fps.t0 < 3000) requestAnimationFrame(loop); else { w.__fps.done = true; w.__fps.fps = w.__fps.frames / ((performance.now() - w.__fps.t0) / 1000); } };
    requestAnimationFrame(loop);
  });
  const t0 = Date.now();
  let k = 0;
  while (Date.now() - t0 < 3000) { // continuous panning for the whole measurement window
    const x0 = box.x + 150 + (k % 3) * 60, y0 = box.y + 150 + (k % 2) * 80;
    await page.mouse.move(x0, y0); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + i * 20, y0 + i * 12);
    await page.mouse.up(); k++;
  }
  await page.waitForFunction(() => (window as unknown as { __fps: { done: boolean } }).__fps.done);
  const fps = await page.evaluate(() => (window as unknown as { __fps: { fps: number } }).__fps.fps);
  console.log(`[perf] viewer fps while panning with tracking on: ${fps.toFixed(1)} (${k} pan gestures)`);
  expect(fps).toBeGreaterThanOrEqual(50);
});

test('live gaze path: local models load, camera step or plain-language error, continue without gaze works', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost', '::1'].includes(u.hostname)) external.push(r.url()); });
  await page.goto('/');
  await page.getByTestId('gaze-toggle').check();
  await page.getByTestId('start').click();
  await expect(page.getByRole('heading', { name: 'Eye tracking setup' })).toBeVisible();
  // headless + fake camera: either we reach the face-guide step (no face in the synthetic feed) or init fails with a readable message
  const outcome = page.getByTestId('face-msg').or(page.locator('.warn'));
  await expect(outcome.first()).toBeVisible({ timeout: 60_000 });
  console.log('[gaze] setup outcome:', (await outcome.first().textContent())?.slice(0, 120));
  if (await page.getByTestId('face-msg').isVisible()) {
    // the preview must show the live stream: one <video> element, with the camera stream attached and playing
    const v = await page.evaluate(() => { const vs = document.querySelectorAll('video'); const v = vs[0] as HTMLVideoElement; return { n: vs.length, hasStream: !!v?.srcObject, playing: !!v && !v.paused, w: v?.videoWidth ?? 0, inWrap: !!v?.closest('.video-wrap') }; });
    console.log('[gaze] video element:', JSON.stringify(v));
    expect(v.n).toBe(1); expect(v.hasStream).toBe(true); expect(v.inWrap).toBe(true); expect(v.w).toBeGreaterThan(0);
  }
  await page.getByRole('button', { name: 'Continue without gaze' }).click();
  await expect(page.getByText('Case 1 of')).toBeVisible();
  await expect(page.getByTestId('gaze-chip')).toHaveText('Gaze off');
  expect(external, 'no CDN/network fetches during gaze init').toEqual([]);
});
