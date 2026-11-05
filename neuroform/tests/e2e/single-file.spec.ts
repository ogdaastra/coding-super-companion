import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { test, expect, type Page } from '@playwright/test';

// The downloadable single-file build, opened straight from disk as a user would
// (double-click): no server, no service worker. Build it first with
// `npm run build:single`; CI does.
const FILE = new URL('../../dist-single/NEUROFORM.html', import.meta.url);
const START = `${pathToFileURL(FILE.pathname).href}?renderer=webgl2&preset=observatory&neurons=2000&seed=3`;

test.skip(!existsSync(FILE), 'dist-single/NEUROFORM.html not built (npm run build:single)');

async function boot(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => (window as any).neuroform?.store.get().ready === true, null, { timeout: 90_000 });
  await expect(page.locator('.intro')).toHaveCount(0, { timeout: 30_000 });
}

const state = (page: Page) => page.evaluate(() => (window as any).neuroform.store.get());

test('the single-file build runs from disk: engine, worker, simulation and storage', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page, START);

  const s = await state(page);
  expect(page.url()).toMatch(/^file:/);
  expect(s.install).toBe('file');
  expect(s.info.neurons).toBe(2000);
  expect(s.storage.persistent).toBe(true);

  // The embedded engine runs in the embedded worker: simulated time advances
  // and the network fires.
  const t0 = s.sim.timeMs;
  await expect.poll(async () => (await state(page)).sim.timeMs, { timeout: 30_000 }).toBeGreaterThan(t0 + 200);
  await expect.poll(() => page.evaluate(() => (window as any).neuroform.telemetry.rate.last() ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);

  // Projects are stored in the browser and reopened after a reload.
  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast', { hasText: 'Project saved' })).toBeVisible();
  const hash = s.info.topologyHash;
  await boot(page, `${pathToFileURL(FILE.pathname).href}?renderer=webgl2`);
  expect((await state(page)).info.topologyHash).toBe(hash);

  expect(errors).toEqual([]);
});
