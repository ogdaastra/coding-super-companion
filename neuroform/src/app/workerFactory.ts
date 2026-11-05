/**
 * How the simulation worker and the WebAssembly engine are loaded in the normal
 * build: as separate files next to the page (cached by the service worker).
 * The single-file build replaces this module with `workerFactory.single.ts`
 * (see `vite.config.ts`).
 */
import wasmUrl from '../engine/generated/neuroform_engine.wasm?url';

export { wasmUrl };

export function createWorker(): Worker {
  return new Worker(new URL('../sim/simulation.worker.ts', import.meta.url), { type: 'module' });
}
