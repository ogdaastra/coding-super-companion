// Native (non-WebAssembly) engine benchmark for comparison: writes each tier's
// configuration to a temporary file and runs the Rust example on it.
//   node scripts/bench-native.ts [seconds]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observatory, TIERS } from '../src/config/presets.ts';

const seconds = Number(process.argv[2] ?? 3);
const dir = mkdtempSync(join(tmpdir(), 'nf-bench-'));
const manifest = new URL('../engine/Cargo.toml', import.meta.url).pathname;
execFileSync('cargo', ['build', '--release', '--manifest-path', manifest, '-p', 'neuroform-core', '--example', 'bench'], { stdio: 'inherit' });
console.log('| Neurons | Synapses | Build | ms per simulated s | Real-time factor |');
console.log('|---:|---:|---:|---:|---:|');
for (const t of TIERS) {
  const file = join(dir, `${t.id}.json`);
  writeFileSync(file, JSON.stringify(observatory(t.neurons, 1)));
  const out = execFileSync('cargo', ['run', '--quiet', '--release', '--manifest-path', manifest, '-p', 'neuroform-core', '--example', 'bench', '--', file, String(seconds)], { encoding: 'utf8' });
  const r = JSON.parse(out.trim());
  console.log(`| ${r.neurons.toLocaleString('en-GB')} | ${(r.synapses / 1e6).toFixed(2)} M | ${r.buildMs} ms | ${r.msPerSimSecond} | ${r.realtimeFactor.toFixed(2)}× |`);
}
