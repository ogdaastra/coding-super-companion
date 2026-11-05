import { test, expect } from '@playwright/test';
import { fruitPhoto, rng, toBmp } from '../helpers/vision.ts';
import { GRID } from '../../src/vision/retina.ts';

// The Vision Lab flow in the browser: add photos of two classes, build the
// vision network, train, test, and classify a new photo. (Whether it learns is
// measured deterministically in tests/unit/vision.test.ts; this checks the
// whole path through files, canvas, worker and interface.)
const START = '/?renderer=webgl2&preset=observatory&neurons=2000&seed=3';

test('Vision Lab: photos in, train with reward and punishment, test, classify', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(START);
  await page.waitForFunction(() => (window as any).neuroform?.store.get().ready === true, null, { timeout: 90_000 });
  await expect(page.locator('.intro')).toHaveCount(0, { timeout: 30_000 });

  // Through the command palette, as a user would find it.
  await page.keyboard.press('Control+k');
  const search = page.getByPlaceholder(/Search commands/);
  await search.fill('vision lab');
  await search.press('Enter');
  await expect(page.getByText('Teach it to recognise photos', { exact: false })).toBeVisible();

  const rand = rng(9);
  const photos = (kind: 'apple' | 'banana', n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `${kind}-${i}.bmp`, mimeType: 'image/bmp', buffer: Buffer.from(toBmp(fruitPhoto(kind, rand), GRID, 4)) }));
  await page.locator('.vision-class__head .input').nth(1).fill('Banana');
  for (const [k, kind] of [[0, 'apple'], [1, 'banana']] as const) {
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.vision-class').nth(k).getByRole('button', { name: 'Add photos' }).click();
    await (await chooser).setFiles(photos(kind, 20));
  }
  await expect(page.locator('.vision-class').nth(1)).toContainText('20 photos · 16 to train on, 4 kept back for testing');

  await page.getByRole('button', { name: 'Build vision network' }).click();
  await expect(page.locator('.chip', { hasText: 'Ready' })).toBeVisible({ timeout: 120_000 });
  const regions = await page.evaluate(() => (window as any).neuroform.store.get().info.regions.map((r: any) => r.name));
  expect(regions).toEqual(['Red cones', 'Green cones', 'Blue cones', 'Visual Cortex', 'Apple', 'Banana']);

  await page.locator('.field__row', { hasText: 'Passes over the photos' }).locator('select').selectOption('3');
  await page.getByRole('button', { name: 'Train', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Train', exact: true })).toBeVisible({ timeout: 360_000 });

  const v = await page.evaluate(() => (window as any).neuroform.vision.store.get());
  expect(v.message).toBeNull();
  expect(v.trained).toBe(3 * 32);
  expect(v.tests).toHaveLength(3);
  // Every held-out photo got an answer slot in the confusion table.
  expect(v.confusion.flat().reduce((a: number, b: number) => a + b, 0)).toBe(8);
  await expect(page.getByText('Last test, answer by answer')).toBeVisible();
  await expect(page.getByText('Test accuracy after each pass')).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose a photo' }).click();
  await (await chooser).setFiles(photos('banana', 1));
  await expect(page.getByText('Your photo')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.vision-answer').first()).toContainText('Answer:');
  expect(await page.evaluate(() => (window as any).neuroform.vision.store.get().trained)).toBe(3 * 32); // trying a photo does not train

  expect(errors).toEqual([]);
});
