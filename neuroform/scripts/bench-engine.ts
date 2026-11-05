// Engine benchmark: the real WebAssembly engine in Node (V8, same as Chrome),
// single-threaded, no rendering. Builds the Neural Observatory brain at each tier
// and runs it as fast as possible.
//
//   node scripts/bench-engine.ts [seconds-per-size] [sizes...]
//
// Writes bench/results/engine-<date>.json and prints a Markdown table.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import { EngineModule } from '../src/engine/wasmEngine.ts';
import { observatory, TIERS } from '../src/config/presets.ts';

const args = process.argv.slice(2).map(Number).filter((x) => x > 0);
const seconds = args[0] ?? 3;
const sizes = args.length > 1 ? args.slice(1) : TIERS.map((t) => t.neurons);
const mod = await EngineModule.load(readFileSync(new URL('../src/engine/generated/neuroform_engine.wasm', import.meta.url)));

interface Row { neurons: number; synapses: number; buildMs: number; msPerSimSecond: number; realtimeFactor: number; spikesPerSimSecond: number; eventsPerWallSecond: number; meanRateHz: number; engineMiB: number; wasmHeapMiB: number; }
const rows: Row[] = [];
for (const n of sizes) {
  const cfg = observatory(n, 1);
  const t0 = performance.now();
  const net = mod.build(cfg);
  const buildMs = performance.now() - t0;
  net.run(Math.round(300 / cfg.timestepMs));
  net.telemetry();
  net.clearBuffers(true, true, true);
  let steps = 0;
  const start = performance.now();
  while (performance.now() - start < seconds * 1000) {
    net.run(100);
    steps += 100;
    net.clearBuffers(true, true, true);
  }
  const wall = (performance.now() - start) / 1000;
  const t = net.telemetry();
  const simSec = (steps * cfg.timestepMs) / 1000;
  const spikes = t.regions.reduce((a, r) => a + r.spikesExc + r.spikesInh, 0);
  const row: Row = {
    neurons: net.info.neurons,
    synapses: net.info.synapses,
    buildMs: Math.round(buildMs),
    msPerSimSecond: Math.round((wall * 1000) / simSec),
    realtimeFactor: Number((simSec / wall).toFixed(3)),
    spikesPerSimSecond: Math.round(spikes / simSec),
    eventsPerWallSecond: Math.round(t.eventsScheduled / wall),
    meanRateHz: Number((spikes / net.info.neurons / simSec).toFixed(2)),
    engineMiB: Number((net.info.memoryBytes / 2 ** 20).toFixed(1)),
    wasmHeapMiB: Number((mod.memoryBytes / 2 ** 20).toFixed(1)),
  };
  rows.push(row);
  net.free();
  console.error(`measured ${n}`);
}

const meta = { date: new Date().toISOString(), node: process.version, cpu: os.cpus()[0]?.model, cores: os.cpus().length, platform: `${os.platform()} ${os.arch()}`, secondsPerSize: seconds, preset: 'observatory', timestepMs: 0.5 };
mkdirSync(new URL('../bench/results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`../bench/results/engine-${meta.date.slice(0, 10)}.json`, import.meta.url), JSON.stringify({ meta, rows }, null, 2));
console.log(`\n${meta.cpu} · ${meta.cores} cores · Node ${meta.node} · ${seconds} s per size\n`);
console.log('| Neurons | Synapses | Build | ms per simulated s | Real-time factor | Synaptic events / s | Mean rate | Engine memory |');
console.log('|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const r of rows) console.log(`| ${r.neurons.toLocaleString('en-GB')} | ${(r.synapses / 1e6).toFixed(2)} M | ${r.buildMs} ms | ${r.msPerSimSecond.toLocaleString('en-GB')} | ${r.realtimeFactor.toFixed(2)}× | ${(r.eventsPerWallSecond / 1e6).toFixed(1)} M | ${r.meanRateHz} Hz | ${r.engineMiB} MiB |`);
