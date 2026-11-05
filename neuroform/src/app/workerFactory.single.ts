/**
 * Single-file build (`npm run build:single`): the engine and the simulation
 * worker are embedded in the page, because a page opened from disk cannot load
 * separate files. The engine is a `data:` URL the worker fetches; the worker
 * runs from a `blob:` URL created from the embedded code.
 */
import wasmUrl from '../engine/generated/neuroform_engine.wasm?url&inline';
import SimulationWorker from '../sim/simulation.worker.ts?worker&inline';

export { wasmUrl };

export function createWorker(): Worker {
  return new SimulationWorker();
}
