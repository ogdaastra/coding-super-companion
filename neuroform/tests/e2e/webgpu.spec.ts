import { test, expect } from '@playwright/test';

// WebGPU is optional. Where the browser exposes it, NEUROFORM must choose it and
// start; where it does not, the WebGL2 path is covered by app.spec.ts.
test.use({ launchOptions: { args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'] } });

test('initialises the WebGPU backend when available', async ({ page }) => {
  await page.goto('/?renderer=auto&preset=microscopic');
  const hasGpu = await page.evaluate(async () => !!(navigator as any).gpu && !!(await (navigator as any).gpu.requestAdapter()));
  test.skip(!hasGpu, 'This browser does not expose a WebGPU adapter');
  await page.waitForFunction(() => (window as any).neuroform?.store.get().ready === true, null, { timeout: 90_000 });
  const s = await page.evaluate(() => (window as any).neuroform.store.get());
  // WebGPU is chosen first when an adapter exists.
  expect(s.render.history[0]).toBe('WebGPU');
  // If the device is later lost (headless software adapters drop it), the
  // renderer recovers on WebGL2 and the simulation keeps running.
  if (s.render.backend !== 'WebGPU') expect(s.render.history.some((h: string) => h.startsWith('lost:'))).toBe(true);
  expect(['WebGPU', 'WebGL2']).toContain(s.render.backend);
  expect(s.sim.status).toBe('running');
});
