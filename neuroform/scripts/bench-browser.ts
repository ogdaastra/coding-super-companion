// In-browser engine benchmark: serves the production build, opens it in headless
// Chromium and asks the application's own simulation worker to run its benchmark
// (the same request as Performance → Run benchmark). This measures the engine
// exactly as shipped: WebAssembly inside a dedicated Web Worker.
//
//   npm run build
//   node scripts/bench-browser.ts [seconds-per-size] [sizes...]
//
// Set PW_CHROMIUM to use a specific Chromium binary. Rendering is switched to
// WebGL2 and the live simulation is paused so the benchmark has the worker to
// itself; frame rates are not measured here (headless Chromium usually renders
// in software, which says nothing about a real GPU).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { TIERS } from '../src/config/presets.ts';
import type { BenchmarkResult } from '../src/sim/protocol.ts';

const args = process.argv.slice(2).map(Number).filter((x) => x > 0);
const seconds = args[0] ?? 3;
const sizes = args.length > 1 ? args.slice(1) : TIERS.map((t) => t.neurons).filter((n) => n <= 50_000);
const port = 4179;
const root = new URL('..', import.meta.url).pathname;

if (!existsSync(new URL('../dist/index.html', import.meta.url))) {
  console.error('No production build found: run `npm run build` first.');
  process.exit(1);
}

// Run Vite's CLI directly with this Node binary (not through npx), so stopping
// this one process stops the server.
const vite = new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname;
const server = spawn(process.execPath, [vite, 'preview', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
const stop = () => { if (!server.killed) server.kill(); };
process.on('exit', stop);

async function waitForServer(url: string, ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Preview server did not start on ${url}`);
}

try {
  await waitForServer(`http://localhost:${port}/`, 30_000);
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(30 * 60_000);
  await page.goto(`http://localhost:${port}/?renderer=webgl2&preset=microscopic`);
  await page.waitForFunction(() => (window as unknown as { neuroform?: { store: { get(): { ready: boolean } } } }).neuroform?.store.get().ready, null, { timeout: 120_000 });
  const userAgent = await page.evaluate(() => navigator.userAgent);
  const rows = await page.evaluate(async ({ sizes, seconds }) => {
    const app = (window as unknown as { neuroform: { pause(): void; client: { request(type: 'benchmark', req: { sizes: number[]; seconds: number }): Promise<unknown> } } }).neuroform;
    app.pause();
    return app.client.request('benchmark', { sizes, seconds });
  }, { sizes, seconds }) as BenchmarkResult[];
  await browser.close();

  console.log(`\n${userAgent} · ${seconds} s per size\n`);
  console.log('| Neurons | Synapses | Build | ms per simulated s | Real-time factor | Mean rate |');
  console.log('|---:|---:|---:|---:|---:|---:|');
  for (const r of rows) {
    console.log(`| ${r.neurons.toLocaleString('en-GB')} | ${(r.synapses / 1e6).toFixed(2)} M | ${r.buildMs.toFixed(0)} ms | ${r.msPerSimSecond.toFixed(0)} | ${r.realtimeFactor.toFixed(2)}× | ${r.meanRateHz.toFixed(1)} Hz |`);
  }
} finally {
  stop();
}
