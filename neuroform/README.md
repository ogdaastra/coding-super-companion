# NEUROFORM — The Neural Observatory

NEUROFORM is a browser-native artificial brain observatory. It simulates a
spiking neural network — every neuron and every synapse individually — in a Rust
engine compiled to WebAssembly, running on the visitor's own machine, and
presents it as an explorable, real-time 3D structure with scientific
instrumentation around it.

Everything you see is connected to the simulation: a neuron flashes because its
membrane potential crossed its threshold in the engine; a pulse travels along a
synapse that exists in the engine, after a real spike; every chart is drawn from
measurements of the running network. No telemetry is invented and nothing is
animated independently of the model.

* **Simulation**: leaky integrate-and-fire neurons with individual parameters,
  individually stored synapses with delays, excitatory and inhibitory currents
  with exponential decay, an event-driven calendar queue, STDP and
  reward-modulated STDP, stimulation (DC, pulse trains, Poisson input).
* **The brain**: six functional regions (Visual Input, Sensory Processing,
  Association Cortex, Memory Network, Motor Output, Reward & Modulation) with
  local, topographic and long-range connectivity; plus six other presets
  (Microscopic, Cortical, Modular, Highly Connected, Synchronisation Lab,
  Learning Lab) at six size tiers.
* **Six modes**: Neural Explorer (3D), Observatory (live measurements), Connectome
  (pathways, densities, communities), Laboratory (experiments A–G), Neuron Study
  (one neuron in depth) and Performance (engine, worker and renderer
  instrumentation).
* **Browser platform**: WebGPU when available, WebGL2 otherwise (same shaders),
  simulation in a Web Worker, projects and snapshots in IndexedDB, offline after
  the first visit, deployable to any static host.

**Live:** https://neuroform-ogdaastra.vercel.app (runs entirely in your browser).

## Quick start

Requirements: Node.js ≥ 22.18, Rust (stable) with the `wasm32-unknown-unknown`
target.

```bash
rustup target add wasm32-unknown-unknown
```

```bash
cd neuroform
npm install
npm run dev
```

Open the printed URL (default http://localhost:5173). `npm run dev` builds the
WebAssembly engine first (`scripts/build-wasm.mjs`), then starts Vite.

### Build and preview

```bash
npm run build
```

```bash
npm run preview
```

`npm run build` type-checks, builds the engine and writes static files to
`dist/`. `npm run preview` serves them exactly as a static host would.

### Tests

```bash
npm run test:engine   # Rust: neuron, synapse, plasticity and network tests (native)
npm test              # Vitest: WebAssembly engine, experiments, formats, persistence
npm run test:e2e      # Playwright: the built application in Chromium
```

### Benchmarks

```bash
npm run bench:engine            # WebAssembly engine in Node, all tiers
npm run bench:native            # same engine compiled natively, for comparison
npm run bench:browser           # shipped build in headless Chromium (after npm run build)
npm run probe all 10000 2000    # firing rates per region for every preset
```

The application also has an in-browser benchmark: Performance → Run benchmark.

## Deploying

The build is static. Copy `dist/` to any static host (Vercel, Netlify,
Cloudflare Pages, GitHub Pages, S3, nginx). No backend, no environment variables,
no special headers are required. Details and host configurations:
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Using NEUROFORM

* **Navigate**: drag to orbit, right-drag (or Shift-drag) to pan, scroll or pinch to
  zoom. `G` toggles free flight (W A S D, Q / E, Shift); `T` starts a cinematic tour;
  `R` resets the view; double-click a neuron to fly to it.
* **Inspect**: click a neuron for its live state, membrane trace, parameters and
  synapses; click a region label, the region list or the minimap for the region.
  Right-click anything for actions.
* **Experiment**: stimulate a neuron, its neighbourhood or a region (`S`); change
  parameters (undo with Ctrl Z); disable regions; cut or scale pathways; enable
  plasticity (`P`) and deliver reward; run experiments A–G in the Laboratory.
* **Keep work**: Ctrl S saves the project (IndexedDB); snapshots restore the exact
  state; recordings capture every spike for playback; everything exports to files.
* **Everything else**: Ctrl K / ⌘K opens the command palette; `?` lists shortcuts.

## Network sizes

Sizes are chosen in the brain designer (`N`) as tiers. They are engineering
targets; what a given machine sustains is measured, not promised.

| Tier | Neurons | Synapses (Neural Observatory) |
|---|---:|---:|
| Micro | 2,000 | ≈ 0.1 M |
| Small | 5,000 | ≈ 0.3 M |
| Medium | 10,000 | ≈ 0.6 M |
| Large | 25,000 | ≈ 1.6 M |
| Experimental | 50,000 | ≈ 3.1 M |
| Extreme | 100,000 | ≈ 6.2 M |

On first launch NEUROFORM picks Micro, Small or Medium from the device's core
count and memory. Measured performance per tier, and the targets derived from it,
are in [docs/PERFORMANCE.md](docs/PERFORMANCE.md). Run Performance → Run benchmark
to measure your own machine. The engine's hard limits are 500,000 neurons and 40
million synapses.

## How it works

```
React interface ─ controller ─┬─ Three.js renderer (WebGPU / WebGL2, TSL shaders)
                               ├─ telemetry rings · IndexedDB · file formats
                               └─ Web Worker ─ C ABI ─ Rust engine (WebAssembly)
```

* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): subsystems, threads, data flow,
  rendering, level of detail, change policy, decisions.
* [docs/SIMULATION.md](docs/SIMULATION.md): the model, numerical integration,
  synapses, event scheduling, plasticity, stimulation, telemetry definitions.
* [docs/PERFORMANCE.md](docs/PERFORMANCE.md): measurements and targets.
* [docs/FORMATS.md](docs/FORMATS.md): configuration, snapshot, recording and export
  formats.

### Repository layout

```
engine/core      Rust simulation engine (platform independent) + tests + benchmark example
engine/wasm      C ABI exposing the engine to WebAssembly
src/engine       TypeScript side of the ABI
src/sim          worker, scheduler, protocol, client, recordings
src/render       renderer, layers, camera, picking, quality
src/config       schema, presets, validation, structural adjustments
src/experiments  experiment definitions, runner, spike analysis
src/persistence  IndexedDB repository and file formats
src/telemetry    bounded histories
src/app          controller, state, commands, edits, projects, playback
src/ui           interface
tests            unit/integration (Vitest) and end-to-end (Playwright)
scripts          engine build, benchmarks, service-worker plugin
```

## Troubleshooting

* **"NEUROFORM could not start"**: the browser lacks WebAssembly, Web Workers, or
  both WebGPU and WebGL2. Use a current Chrome, Edge, Firefox or Safari with
  hardware acceleration enabled.
* **"Software rendering detected"**: the browser is drawing without the GPU (GPU
  blocklisted or acceleration disabled). Quality is lowered automatically; enable
  hardware acceleration in the browser settings for full quality. The simulation is
  unaffected.
* **Simulation shows "limited"**: the network is too large for this machine at the
  requested speed. Lower the speed, choose a smaller tier, or accept slower than
  real time; results are unaffected.
* **Low frame rate**: lower the quality preset (Settings), keep adaptive quality on,
  or enable "Reduce interface effects".
* **Projects are not kept**: the browser has no IndexedDB in this context (some
  private modes). The Projects dialog says so; export work to files.
* **"cargo not found" during build**: install Rust from https://rustup.rs and run
  `rustup target add wasm32-unknown-unknown`. If `src/engine/generated/` already
  contains a built engine, the web build proceeds without Rust.
* **WebGPU not used**: WebGPU needs a supporting browser and GPU. Settings shows the
  backend in use and lets you choose WebGL2 explicitly.

## Licences

Fonts: Inter (SIL OFL 1.1) and JetBrains Mono (SIL OFL 1.1), licences in
`src/assets/fonts/`.
