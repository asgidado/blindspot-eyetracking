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
    // first inference compiles shaders in the worker (slow on a software GPU): wait for the first sample, then measure
    await page.waitForFunction(() => (window as unknown as { __gazeSession: { inferenceHz: number } }).__gazeSession.inferenceHz > 0, null, { timeout: 30_000 });
    await page.waitForTimeout(3000);
    const hz = await page.evaluate(() => (window as unknown as { __gazeSession: { inferenceHz: number } }).__gazeSession.inferenceHz);
    const dbg = await page.evaluate(() => { const g = (window as unknown as { __gazeSession: { provider: { hz: number; latencyMs: number; lastDurations: Record<string, number> } } }).__gazeSession; return { pumpHz: g.provider.hz, latency: Math.round(g.provider.latencyMs), dur: g.provider.lastDurations }; });
    console.log(`[gaze] pipeline rate at the camera step: ${hz.toFixed(1)} Hz · pump ${dbg.pumpHz.toFixed(1)} Hz · latency ${dbg.latency} ms · worker ${JSON.stringify(dbg.dur)}`);
    expect(hz).toBeGreaterThanOrEqual(8); // was 3.5 Hz with the throttled rVFC pump
  }
  await page.getByRole('button', { name: 'Continue without gaze' }).click();
  await expect(page.getByText('Case 1 of')).toBeVisible();
  await expect(page.getByTestId('gaze-chip')).toHaveText('Gaze off');
  expect(external, 'no CDN/network fetches during gaze init').toEqual([]);
});


test('live pipeline keeps running through calibration and a read (dev mode, fake camera)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?gazedev=1');
  await page.getByTestId('gaze-toggle').check();
  await page.getByTestId('start').click();
  const outcome = page.getByTestId('face-msg').or(page.locator('.warn'));
  await expect(outcome.first()).toBeVisible({ timeout: 60_000 });
  test.skip(!(await page.getByTestId('face-msg').isVisible()), 'provider could not start in this environment');
  await page.getByRole('button', { name: 'Begin calibration' }).click();
  await page.getByRole('button', { name: /Skip sizing/ }).click();
  await expect(page.getByTestId('cal-continue')).toBeVisible({ timeout: 60_000 }); // 14 dots × 0.4 s in dev mode
  const meta = await page.evaluate(() => (window as unknown as { __gazeSession: { meta: unknown } }).__gazeSession.meta);
  console.log('[gaze] validation (fake camera, no face):', JSON.stringify((meta as { validation: unknown }).validation));
  await page.getByTestId('cal-continue').click();
  await expect(page.getByText('Case 1 of')).toBeVisible();
  // UI frame rate while panning WITH the live pipeline running (headless software GPU: a pessimistic environment)
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
  while (Date.now() - t0 < 3000) {
    const x0 = box.x + 150, y0 = box.y + 150;
    await page.mouse.move(x0, y0); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + i * 20, y0 + i * 12);
    await page.mouse.up();
  }
  await page.waitForFunction(() => (window as unknown as { __fps: { done: boolean } }).__fps.done);
  const live = await page.evaluate(() => ({ fps: (window as unknown as { __fps: { fps: number } }).__fps.fps, hz: (window as unknown as { __gazeSession: { inferenceHz: number } }).__gazeSession.inferenceHz }));
  console.log(`[perf] LIVE pipeline: viewer ${live.fps.toFixed(1)} fps while panning, gaze ${live.hz.toFixed(1)} Hz (jank guard active)`);
  expect(live.fps).toBeGreaterThanOrEqual(30);
  const n = await page.evaluate(() => document.querySelectorAll('video').length);
  expect(n).toBe(1); // the session-long element survived the setup screen unmounting
  const [req] = await Promise.all([page.waitForRequest((r) => r.url().includes('/submit')), page.keyboard.press('n')]);
  const body = req.postDataJSON();
  console.log(`[gaze] samples recorded during a 3 s read: ${body.gaze.length} (meta hz ${body.gaze_meta.inference_hz})`);
  expect(body.gaze.length).toBeGreaterThan(20); // was 1 before the fix (now ≥ 6 s of samples at ≥ 8 Hz)
  await expect(page.getByRole('heading', { name: /Reveal/ })).toBeVisible();
  await page.getByTestId('next').click();
  await expect(page.getByText('Case 2 of').or(page.getByText(/drift check/i))).toBeVisible({ timeout: 15_000 });
});
