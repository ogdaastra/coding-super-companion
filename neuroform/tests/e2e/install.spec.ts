import { test, expect, type Page } from '@playwright/test';

/** Small, fast network; WebGL2 so headless software rendering is predictable. */
const START = '/?renderer=webgl2&preset=observatory&neurons=2000&seed=3';

async function bootControlled(page: Page) {
  await page.goto(START);
  await page.waitForFunction(() => (window as any).neuroform?.store.get().ready === true, null, { timeout: 90_000 });
  // The service worker claims the page once it activates.
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60_000 });
}

test('Chromium considers the app installable; manifest and icons are available offline', async ({ page, context }) => {
  await bootControlled(page);
  const cdp = await context.newCDPSession(page);

  const manifest = await cdp.send('Page.getAppManifest');
  expect(manifest.errors).toEqual([]);
  expect(manifest.url).toMatch(/manifest\.webmanifest$/);
  const parsed = JSON.parse(manifest.data ?? '{}');
  expect(parsed.display).toBe('standalone');
  expect(parsed.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);

  // The same check Chromium runs before offering "Install". Test contexts are
  // incognito-like, which Chromium reports on its own; nothing else may fail.
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors.map((e) => e.errorId).filter((id) => id !== 'in-incognito')).toEqual([]);

  await context.setOffline(true);
  const statuses = await page.evaluate(() =>
    Promise.all(
      ['./manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './favicon.svg'].map(
        async (u) => [u, (await fetch(u)).status] as const,
      ),
    ),
  );
  await context.setOffline(false);
  for (const [u, status] of statuses) expect(status, u).toBe(200);
});

test('the install button appears only when the browser offers installation', async ({ page }) => {
  await bootControlled(page);
  const button = page.getByRole('button', { name: 'Install app' });
  await expect(button).toHaveCount(0);

  // Headless test browsers never offer installation themselves, so the
  // browser's offer is simulated with the same event shape Chromium uses.
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
    (window as any).__prompted = false;
    e.prompt = async () => {
      (window as any).__prompted = true;
    };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  await expect(button).toBeVisible();
  expect((await page.evaluate(() => (window as any).neuroform.store.get().install))).toBe('available');

  await button.click();
  await expect.poll(() => page.evaluate(() => (window as any).__prompted)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.getByText('NEUROFORM is installed')).toBeVisible();
  await expect(button).toHaveCount(0);
  expect((await page.evaluate(() => (window as any).neuroform.store.get().install))).toBe('installed');
});
