// Builds the Rust engine for wasm32 and copies it to src/engine/generated/.
// Used by `npm run dev|build|test`. If cargo is unavailable but a previously built
// module exists, the existing module is kept (so the web app can still be built).
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = join(root, 'engine', 'Cargo.toml');
const built = join(root, 'engine', 'target', 'wasm32-unknown-unknown', 'release', 'neuroform_wasm.wasm');
const outDir = join(root, 'src', 'engine', 'generated');
const out = join(outDir, 'neuroform_engine.wasm');

const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
if (cargo.status !== 0) {
  if (existsSync(out)) {
    console.warn('[wasm] cargo not found; using the existing engine module');
    process.exit(0);
  }
  console.error(
    '[wasm] cargo (Rust) is required to build the simulation engine.\n' +
      '       Install Rust from https://rustup.rs and run: rustup target add wasm32-unknown-unknown',
  );
  process.exit(1);
}

try {
  execFileSync(
    'cargo',
    ['build', '--manifest-path', manifest, '-p', 'neuroform-wasm', '--target', 'wasm32-unknown-unknown', '--release'],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
} catch {
  console.error('[wasm] engine build failed. If the target is missing: rustup target add wasm32-unknown-unknown');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
copyFileSync(built, out);

// Optional size/speed optimisation when binaryen's wasm-opt is installed.
const opt = spawnSync('wasm-opt', ['--version'], { encoding: 'utf8' });
if (opt.status === 0) {
  execFileSync('wasm-opt', ['-O3', '--enable-bulk-memory', '--enable-nontrapping-float-to-int', out, '-o', out], {
    stdio: 'inherit',
  });
}
console.log(`[wasm] engine ready: ${(statSync(out).size / 1024).toFixed(0)} KiB`);
