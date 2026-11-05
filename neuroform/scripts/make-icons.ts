// Renders the application icons in public/icons/ from the logo artwork, using
// headless Chromium so gradients render exactly as in the browser.
//
//   node scripts/make-icons.ts
//
// Output (committed; rerun only when the logo changes):
//   icon-192.png, icon-512.png    rounded icon on a transparent background ("any")
//   icon-maskable-512.png         full-bleed, artwork inside the central safe zone,
//                                 so operating systems can crop it to their shape
//   apple-touch-icon.png (180)    full-bleed; Apple platforms round the corners
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BG = '#02040a';
const ART = `
  <defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#eef6ff"/><stop offset=".35" stop-color="#38e6ff"/><stop offset="1" stop-color="#38e6ff" stop-opacity="0"/></radialGradient></defs>
  <g stroke="#38e6ff" stroke-opacity=".55" stroke-width="1.6"><path d="M32 32 14 18M32 32l19-11M32 32l-15 17M32 32l16 15M32 32V10"/></g>
  <g fill="#9b7bff"><circle cx="14" cy="18" r="3"/><circle cx="51" cy="21" r="3"/><circle cx="17" cy="49" r="3"/><circle cx="48" cy="47" r="3"/><circle cx="32" cy="10" r="2.6"/></g>
  <circle cx="32" cy="32" r="13" fill="url(#g)"/>`;

/** The logo with a rounded tile (as favicon.svg), or full-bleed with the artwork scaled into the centre. */
function svg(kind: 'rounded' | 'bleed', scale = 1): string {
  const tile = kind === 'rounded' ? `<rect width="64" height="64" rx="14" fill="${BG}"/>` : `<rect width="64" height="64" fill="${BG}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${tile}<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${ART}</g></svg>`;
}

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
const jobs: { file: string; size: number; source: string }[] = [
  { file: 'icon-192.png', size: 192, source: svg('rounded') },
  { file: 'icon-512.png', size: 512, source: svg('rounded') },
  // Maskable safe zone is the central circle of 80% diameter; the artwork's
  // outermost points sit at ~0.36 of the tile from the centre before scaling.
  { file: 'icon-maskable-512.png', size: 512, source: svg('bleed', 0.74) },
  { file: 'apple-touch-icon.png', size: 180, source: svg('bleed', 0.86) },
];

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
for (const j of jobs) {
  const page = await browser.newPage({ viewport: { width: j.size, height: j.size }, deviceScaleFactor: 1 });
  const src = `data:image/svg+xml;base64,${Buffer.from(j.source).toString('base64')}`;
  await page.setContent(`<html><body style="margin:0;background:transparent"><img src="${src}" width="${j.size}" height="${j.size}" style="display:block"></body></html>`);
  await page.locator('img').evaluate((img: HTMLImageElement) => img.decode());
  await page.screenshot({ path: new URL(j.file, out).pathname, omitBackground: true });
  await page.close();
  console.log(`icons/${j.file} (${j.size}×${j.size})`);
}
await browser.close();
