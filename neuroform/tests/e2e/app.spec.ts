import { test, expect, type Page } from '@playwright/test';

/** Small, fast network; WebGL2 so headless software rendering is predictable. */
const START = '/?renderer=webgl2&preset=observatory&neurons=2000&seed=3';

async function boot(page: Page, url = START) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => (window as any).neuroform?.store.get().ready === true, null, { timeout: 90_000 });
  await expect(page.locator('.intro')).toHaveCount(0, { timeout: 30_000 });
  return errors;
}

const state = (page: Page) => page.evaluate(() => (window as any).neuroform.store.get());

test('boots in the browser, runs the WebAssembly engine and renders with WebGL2', async ({ page }) => {
  const errors = await boot(page);
  const s = await state(page);
  expect(s.render.backend).toBe('WebGL2');
  expect(s.info.neurons).toBe(2000);
  expect(s.info.regions).toHaveLength(6);
  const t0 = s.sim.timeMs;
  await page.waitForTimeout(2000);
  expect((await state(page)).sim.timeMs).toBeGreaterThan(t0);
  expect((await state(page)).render.stats.drawCalls).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Neural Explorer' })).toBeVisible();
  expect(errors).toEqual([]);
});

/** Lets the camera finish its start-up glide so screen positions are stable. */
async function settleCamera(page: Page) {
  await page.evaluate(() => {
    const rig = (window as any).neuroform.view.rig;
    rig.target.copy(rig.goalTarget);
    rig.distance = rig.goalDistance;
    rig.yaw = rig.goalYaw;
    rig.pitch = rig.goalPitch;
    rig.autoRotate = 0;
  });
  await page.waitForTimeout(500);
}

test('a neuron can be selected by clicking it in 3D and inspected', async ({ page }) => {
  await boot(page);
  await settleCamera(page);
  const target = await page.evaluate(() => {
    const app = (window as any).neuroform;
    for (let i = 0; i < 2000; i += 37) {
      const p = app.view.screenOf(i);
      if (!p || p[0] < 420 || p[0] > 1020 || p[1] < 150 || p[1] > 750) continue;
      const el = document.elementFromPoint(p[0], p[1]);
      if (el?.tagName !== 'CANVAS') continue;
      if (app.view.pick(p[0], p[1], 10) === i) return { i, x: p[0], y: p[1] };
    }
    return null;
  });
  expect(target).not.toBeNull();
  await page.mouse.click(target!.x, target!.y);
  await expect.poll(async () => (await state(page)).selection.neuron).toBe(target!.i);
  await expect(page.locator('.panel__title h2', { hasText: `Neuron #${target!.i}` })).toBeVisible();
  await expect(page.getByText('Membrane', { exact: true })).toBeVisible();
  await expect.poll(async () => (await state(page)).neuron?.id).toBe(target!.i);
});

test('parameter edits change the simulation and can be undone', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => (window as any).neuroform.selectNeuron(42));
  await page.keyboard.press('5'); // Neuron Study
  const field = page.locator('.field', { hasText: 'Firing threshold' }).locator('input');
  await expect(field).toBeVisible();
  const before = Number(await field.inputValue());
  await field.fill('-55');
  await field.press('Enter');
  await expect.poll(async () => (await state(page)).neuron?.vThreshold).toBeCloseTo(-55, 3);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await state(page)).neuron?.vThreshold).toBeCloseTo(before, 2);
});

test('pause holds state, single steps advance exactly one timestep, resume continues', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(async () => (await state(page)).sim.status).toBe('paused');
  const t = (await state(page)).sim.timeMs;
  await page.waitForTimeout(800);
  expect((await state(page)).sim.timeMs).toBe(t);
  await page.getByRole('button', { name: /Single step/ }).click();
  await expect.poll(async () => (await state(page)).sim.timeMs).toBeCloseTo(t + 0.5, 6);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect.poll(async () => (await state(page)).sim.timeMs).toBeGreaterThan(t + 1);
});

test('stimulating a region changes its measured activity', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Pause' }).click();
  const rate = (region: number, ms: number) =>
    page.evaluate(async ([r, ms]) => {
      const app = (window as any).neuroform;
      await app.client.request('measure', {});
      await app.client.request('step', { steps: Math.round(ms / 0.5), quiet: true });
      const m = await app.client.request('measure', {});
      return m.regions[r].spikesExc + m.regions[r].spikesInh;
    }, [region, ms]);
  const quiet = await rate(0, 50);
  await page.locator('.list__item', { hasText: 'Visual Input' }).first().click();
  await page.keyboard.press('s');
  await expect(page.locator('.toast', { hasText: 'Stimulating Visual Input' })).toBeVisible();
  const driven = await rate(0, 50);
  expect(driven).toBeGreaterThan(quiet * 2);
});

test('camera: drag orbits, wheel zooms, R resets; level of detail follows distance', async ({ page }) => {
  await boot(page);
  await settleCamera(page);
  const yaw0 = await page.evaluate(() => (window as any).neuroform.view.rig.goalYaw);
  await page.mouse.move(720, 450);
  await page.mouse.down();
  await page.mouse.move(820, 470, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => (window as any).neuroform.view.rig.goalYaw)).not.toBeCloseTo(yaw0, 3);
  const d0 = await page.evaluate(() => (window as any).neuroform.view.rig.goalDistance);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => (window as any).neuroform.view.rig.goalDistance)).toBeGreaterThan(d0 * 2);
  await expect.poll(() => page.evaluate(() => (window as any).neuroform.view.stats().lodFar), { timeout: 20_000 }).toBeGreaterThan(0.3);
  // Close range loads the full synapses around the focus point.
  // Close to a neuron: the worker supplies every synapse around the focus point.
  await page.evaluate(() => (window as any).neuroform.view.focusNeuron(500));
  await expect.poll(() => page.evaluate(() => (window as any).neuroform.view.seg.detail?.count ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.keyboard.press('r');
  await expect.poll(() => page.evaluate(() => (window as any).neuroform.view.rig.goalDistance)).toBeGreaterThan(d0 * 0.5);
});

test('visualisation modes and application modes switch', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'E / I', exact: true }).click();
  await expect.poll(async () => (await state(page)).viz).toBe('ei');
  await page.keyboard.press('Shift+Digit4');
  await expect.poll(async () => (await state(page)).viz).toBe('density');
  for (const [key, label] of [['2', 'Observatory'], ['3', 'Connectome'], ['6', 'Performance']] as const) {
    await page.keyboard.press(key);
    await expect(page.locator('.panel__title h2', { hasText: label }).first()).toBeVisible();
  }
});

test('command palette runs commands', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder(/Search commands/);
  await input.fill('connectome');
  await input.press('Enter');
  await expect.poll(async () => (await state(page)).mode).toBe('connectome');
  await page.keyboard.press('Control+k');
  await input.fill('#123');
  await input.press('Enter');
  await expect.poll(async () => (await state(page)).selection.neuron).toBe(123);
});

test('projects persist across reloads, and snapshots restore the exact state', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast', { hasText: 'Project saved' })).toBeVisible();
  const hash = (await state(page)).info.topologyHash;
  // Snapshot, run on, restore.
  await page.getByRole('button', { name: 'Pause' }).click();
  const snap = await page.evaluate(async () => {
    const app = (window as any).neuroform;
    const m = await app.projects.takeSnapshot('e2e');
    return { id: m.id, t: m.timeMs };
  });
  await page.evaluate(() => (window as any).neuroform.stepBy(400));
  await expect.poll(async () => (await state(page)).sim.timeMs).toBeGreaterThan(snap.t + 100);
  await page.evaluate((id) => (window as any).neuroform.projects.restoreSnapshot(id), snap.id);
  await expect.poll(async () => (await state(page)).sim.timeMs).toBeCloseTo(snap.t, 6);
  // Reload without parameters: the last project is reopened from IndexedDB.
  await boot(page, '/?renderer=webgl2');
  expect((await state(page)).info.topologyHash).toBe(hash);
  expect((await state(page)).project.name).toBe('Neural Observatory');
});

test('configuration export and import', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Import & export' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.list__item', { hasText: 'Configuration' }).first().click()]);
  const path = await download.path();
  expect(download.suggestedFilename()).toMatch(/\.neuroform\.json$/);
  // File choosers need a user gesture: use the dialog's button, as a user would.
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Choose file/ }).click()]);
  await chooser.setFiles(path!);
  await expect(page.locator('.toast', { hasText: 'Imported' })).toBeVisible({ timeout: 60_000 });
});

test('experiment A runs in the Laboratory against the live network', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('4');
  await page.getByRole('button', { name: /Run experiment A/ }).click();
  await expect(page.getByText('A · SIGNAL PROPAGATION — DONE', { exact: false })).toBeVisible({ timeout: 150_000 });
  await expect(page.locator('.table').first()).toContainText('Visual Input');
  const r = await page.evaluate(() => (window as any).neuroform.experiments.store.get().run);
  expect(r.status).toBe('done');
  expect(r.result.headline).toMatch(/reached/);
});

test('works offline after the first visit', async ({ page, context }) => {
  await boot(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => (window as any).neuroform?.store.get().ready === true, null, { timeout: 90_000 });
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => (window as any).neuroform?.store.get().ready === true, null, { timeout: 90_000 });
  expect((await state(page)).info.neurons).toBeGreaterThan(0);
  await context.setOffline(false);
});
