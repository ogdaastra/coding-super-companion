// Builds presets with the real WASM engine and reports firing rates per region,
// synchrony and cost. Used to tune presets: `node scripts/probe-dynamics.ts [preset] [neurons] [simMs]`
import { readFileSync } from 'node:fs';
import { EngineModule } from '../src/engine/wasmEngine.ts';
import { PRESETS } from '../src/config/presets.ts';

const [only, nArg, msArg] = process.argv.slice(2);
const neurons = Number(nArg ?? 10000);
const simMs = Number(msArg ?? 2000);
const mod = await EngineModule.load(readFileSync(new URL('../src/engine/generated/neuroform_engine.wasm', import.meta.url)));

for (const p of PRESETS) {
  if (only && only !== 'all' && p.id !== only) continue;
  const cfg = p.create(neurons, 1);
  const t0 = performance.now();
  const net = mod.build(cfg);
  const buildMs = performance.now() - t0;
  const steps = Math.round(simMs / cfg.timestepMs);
  net.run(Math.round(200 / cfg.timestepMs)); // warm-up
  net.telemetry();
  const t1 = performance.now();
  net.run(steps);
  const runMs = performance.now() - t1;
  const t = net.telemetry();
  const secs = t.windowMs / 1000;
  console.log(`\n${p.name}: ${net.info.neurons} neurons, ${net.info.synapses} synapses (${(net.info.synapses / net.info.neurons).toFixed(0)}/n), build ${buildMs.toFixed(0)} ms`);
  console.log(`  ${(runMs / secs).toFixed(0)} ms per simulated second (RTF ${(secs * 1000 / runMs).toFixed(2)}×), χ=${t.synchrony.toFixed(3)}, V̄=${t.vMean.toFixed(1)}`);
  net.info.regions.forEach((r, i) => {
    const rr = t.regions[i];
    const ne = r.excEnd - r.start, ni = r.end - r.excEnd;
    const re = rr.spikesExc / Math.max(1, ne) / secs, ri = rr.spikesInh / Math.max(1, ni) / secs;
    console.log(`  ${r.name.padEnd(22)} E ${re.toFixed(1).padStart(6)} Hz  I ${ri.toFixed(1).padStart(6)} Hz  active ${(rr.active / (r.end - r.start) * 100).toFixed(0)}%  χ ${rr.synchrony.toFixed(2)}`);
  });
  net.free();
}
