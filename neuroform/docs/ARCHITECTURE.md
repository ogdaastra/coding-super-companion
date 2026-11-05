# NEUROFORM architecture

NEUROFORM is a browser-native application. The production build is a folder of
static files (HTML, JavaScript, one WebAssembly module, fonts, a service worker)
that any static host can serve. All computation runs on the visitor's machine; no
backend is involved.

## Subsystems

```
┌────────────────────────── main thread ─────────────────────────────┐
│  Interface (React)  ── reads ──▶  Store (app state)                 │
│        │ calls                         ▲                            │
│        ▼                               │ updates                    │
│  AppController ── EditService · ProjectService · Playback           │
│        │              ExperimentRunner                              │
│        ├──▶ TelemetryStore (bounded rings) ◀── telemetry events      │
│        ├──▶ BrainView (Three.js renderer) ◀── frame events          │
│        ├──▶ LocalStore (IndexedDB)                                   │
│        └──▶ SimulationClient ── postMessage (transferables) ──┐      │
└───────────────────────────────────────────────────────────────┼──────┘
┌──────────────────── simulation worker ────────────────────────▼──────┐
│  request handlers · StepScheduler (time slicing) · RecordingWriter    │
│        │ C ABI calls, zero-copy views                                 │
│        ▼                                                              │
│  neuroform-wasm (C ABI)  →  neuroform-core (Rust engine)              │
└──────────────────────────────────────────────────────────────────────┘
```

| # | Subsystem | Location | Depends on |
|---|---|---|---|
| 1 | Application interface | `src/ui/` | Store, AppController |
| 2 | Simulation engine | `engine/core/` (Rust) | nothing (serde only) |
| 3 | Simulation worker | `src/sim/simulation.worker.ts` | engine ABI wrapper |
| 4 | 3D rendering engine | `src/render/` | Three.js; receives arrays only |
| 5 | Telemetry and statistics | `src/telemetry/`, engine `telemetry.rs` | protocol types |
| 6 | Experiment manager | `src/experiments/` | `ExperimentContext` interface |
| 7 | Persistence manager | `src/persistence/` | IndexedDB, file formats |
| 8 | Configuration management | `src/config/` | schema only |

Rules that keep them independent:

* The engine has no knowledge of browsers, WebAssembly, rendering or UI. It is a
  plain Rust library tested natively; the WASM crate is a thin ABI over it.
* The worker contains no simulation mathematics and no rendering. It schedules,
  answers requests and moves data.
* The renderer never computes neural behaviour. It receives positions, a set of
  synapses to display and per-frame spike lists, and turns them into light.
* React never runs the simulation loop and never touches the worker or the
  renderer directly; it calls controller methods and reads the store.
* Experiments are written against `ExperimentContext`. The browser runner
  implements it over the worker; the test suite implements it directly over the
  engine in Node (`tests/helpers/engine.ts`) and runs the same experiments.
* Platform services (file save/open, fullscreen, service worker) go through
  `src/platform/platform.ts`.

## Threads and data flow

**Simulation loop.** The worker runs the engine in slices of about 8 ms. Each
slice is credited with elapsed wall time × requested speed, runs that many steps
in calls of about 1 ms, then yields so messages are processed. If the engine is
slower than requested the backlog is capped and the simulation runs slower
(reported as *limited*); the mathematics is never changed to keep up.

**Frames (rendering).** The renderer runs at display rate on its own clock. While
the simulation runs it asks the worker for a frame each animation frame, with at
most one request in flight (back-pressure). A frame carries every spike since the
previous one as `(step, neuron)` pairs in a transferable buffer, and optionally
normalised membrane potentials (voltage mode) or spike counts (density mode),
reusing returned buffers.

**Telemetry.** At a configurable 1–30 Hz (default 10) the worker reads the
engine's telemetry window, the raster rows, probe samples and tracked synapses,
and posts them. The main thread appends to bounded rings
(`TelemetryStore`, 3,000 samples per series, 240,000 raster events, 24,000 probe
samples per neuron). Charts draw from the rings in their own animation frames;
React components subscribe to a throttled version counter, so high-frequency data
never causes high-frequency React renders.

**Requests.** Everything else (inspection, edits, stimulation, snapshots, analysis)
is a typed request with exactly one reply (`src/sim/protocol.ts`).

**WebAssembly memory.** The engine allocates every array once at build time; the
step loop allocates nothing. Large arrays are read through typed-array views over
linear memory that are re-derived on each use (memory can grow and detach old
views). Copies are made only to transfer data to the main thread, and the
transferred buffer is moved, not cloned. Networks are explicitly freed.

**SharedArrayBuffer** is not used and not required: static hosts often cannot send
the COOP/COEP headers that cross-origin isolation needs. The Settings dialog
reports whether the page is isolated; a threaded engine is a possible future
optimisation for hosts that are.

## Rendering

Three.js `WebGPURenderer` with node materials (TSL). Shaders are written once in
TSL and compiled to WGSL on WebGPU or GLSL on WebGL2, so both backends render the
same scene from one implementation. Backend selection (`BrainView.create`):

1. WebGPU when `navigator.gpu` exists and the user has not chosen WebGL2;
2. otherwise, or if WebGPU initialisation fails, WebGL2;
3. if neither works, a clear error explains what the browser lacks.

A lost GPU device or WebGL context is reported; the controller recreates the
renderer (on WebGL2 if WebGPU was lost) without touching the simulation.

Layers, each one draw call:

* neurons: an instanced camera-facing sprite per neuron; colour from per-instance
  attributes (region tint, class, spike glow, mode scalar, highlight, dimming);
* synapses: line segments for three sets of real synapses: a stratified overview
  sample (size by quality), the selected neuron's connections (focus), and every
  synapse around the camera's focus point at close range (detail);
* pulses: a compacted instance buffer of pulses in flight, each spawned by a real
  spike on a real displayed synapse;
* structure: region halos and one tube per inter-region pathway, brightness and
  flow speed from measured event rates.

Visualisation modes are blends of shader uniforms, so changing mode animates and
never recompiles shaders. Bloom is a TSL post-process (quality ≥ balanced).

**Level of detail** is a rendering decision only: synapses fade with distance from
the camera; far away the synapse sample fades out while halos and pathway
bundles fade in; close to the network the worker supplies every synapse of the
neurons around the focus point. No simulation entity is removed or merged.

**Adaptive quality** measures frame time and, after about 2.5 s of slow frames,
steps down resolution, pulses, displayed synapses and bloom, in that order; after
about 10 s of fast frames it steps back up. Software rendering (SwiftShader,
llvmpipe) is detected and starts at the Performance preset. Interface blur is
removed automatically at level ≥ 2. The HUD shows when any reduction is active.

**Pulse timing.** A pulse's travel time is the synapse's real delay at the current
speed. Real delays are 0.5–20 ms, which at 1× is shorter than a display frame, so
pulses are slowed to stay visible (≥ 260 ms) and the HUD states the factor. At
slow speeds (0.01×) pulses travel in true simulated time. The spike and its
delivery to the target are exact either way.

## Change policy

*Immediate* (no rebuild, undoable): neuron parameters, population parameters
(preserving per-neuron variation), region enable/disable, pathway gains,
individual synaptic weights, plasticity on/off and learning-rate scale, reward,
stimulation, speed.

*Structural* (rebuild from configuration, restarts at time zero): neuron counts,
excitatory share, connection probabilities and topology, delays, synaptic time
constants, plasticity configuration, layout, seed, timestep. Edits are held as a
pending draft; a banner lists them with *Snapshot & rebuild*, *Rebuild* and
*Discard*, so a running experiment is never discarded silently.

## Persistence

IndexedDB stores projects (configuration and view settings), snapshots (metadata
and payload in separate stores so listing is cheap), recordings, experiment
results and preferences. When IndexedDB is unavailable an in-memory store is used
and the interface says so. Quota errors are reported with a route to managing
data. See `FORMATS.md` for the file formats.

## Offline

The build emits `sw.js` listing every built file, plus the files copied from
`public/` (web app manifest, icons). It precaches them on first load, serves
hashed assets cache-first and the page network-first, so the application
(including the engine) starts without a network after the first visit. The cache
name is derived from the bundle's hashed file names and the contents of the
public files, so any change produces a new service worker that replaces the old
cache.

## Installable app

`public/manifest.webmanifest` (standalone display, `start_url` and `scope` of
`./`, icons in `public/icons/` rendered by `scripts/make-icons.ts`) and the service
worker make NEUROFORM installable as a desktop app in Chromium browsers and
Safari. The installed app is the same build in its own window, and it starts
offline from the precache.

The browser's install offer (`beforeinstallprompt`) is captured by the `Platform`
layer at module load. It is exposed as `state.install`
(`app` / `available` / `installed` / `unavailable`). The interface shows **Install
app** (top bar, command palette, Settings → Desktop app) only while the state is
`available`. Browsers without that event (Safari, Firefox) get written
instructions instead of a button. An end-to-end test asks Chromium for
installability errors through the DevTools protocol (`Page.getInstallabilityErrors`).

## Single-file build

`vite build --mode single` (`npm run build:single`) emits
`dist-single/NEUROFORM.html`, which runs when opened from disk (`file://`).

* **Engine and worker:** the mode swaps `src/app/workerFactory.ts` for
  `workerFactory.single.ts`. The engine is embedded as a `data:` URL that the
  worker fetches. The worker code is embedded and started from a `blob:` URL as a
  classic (IIFE) worker: Chromium refuses module workers from blob URLs on the
  opaque origin of a local file.
* **Inlining:** fonts are inlined as data URLs.
  `scripts/vite-single-file-plugin.ts` inlines the entry script and the
  stylesheet, escaping the sequences that would end a `<script>` element early.
  It fails the build if any other file would remain.
* **No website features:** there is no service worker or manifest. The `Platform`
  layer reports install state `file`.
* **Testing:** an end-to-end test opens the file from disk and checks the
  engine, worker, simulation and storage.

## Desktop packaging (future)

The web build is the product. A Tauri shell can load the same `dist/` folder.
Two seams make native improvements possible without forking the app:

* `SimulationBackend` (`src/sim/SimulationClient.ts`): a backend that talks to a
  native `neuroform-core` (multi-threaded) instead of the WASM worker;
* `Platform` (`src/platform/platform.ts`): native file dialogs and storage.

Neither is required for, or allowed to compromise, the browser build.

## Decisions

* **C ABI instead of wasm-bindgen.** The interface between worker and engine is
  ~50 functions over integers, floats and byte buffers. A hand-written C ABI
  needs no generated glue or extra tool (`cargo build --target
  wasm32-unknown-unknown` is the whole toolchain), makes every allocation explicit
  and lets the worker read engine arrays through zero-copy views. The TypeScript
  side is `src/engine/wasmEngine.ts`.
* **TSL instead of separate GLSL and WGSL.** One shader implementation for both
  backends; the WebGL2 fallback is the same scene, not a degraded copy.
* **No SIMD build.** Measured: compiling the engine with `+simd128` changed the
  step cost by less than run-to-run noise (809–847 vs 784–918 ms per simulated
  second at 25k neurons). The hot loops are branchy (thresholds, refractory
  state) and memory-bound (scattered event writes), so a single baseline module is
  shipped for maximum compatibility.
* **Unchecked indexing in exactly one loop.** Spike propagation (the scatter
  of every spike into the delay ring) indexes without bounds checks. Every index
  it uses is bounded by invariants that `Network::assemble` asserts once per
  synapse in all build profiles (target < neurons, delay < ring slots,
  projection < projections). The topology never changes after assembly, and the
  table lengths are asserted on every call. Measured gain over interleaved runs:
  +19% at 10k neurons (2.56× → 3.05× real time) and +14% at 25k (0.73× → 0.83×);
  see `PERFORMANCE.md`. All other code uses checked indexing.
* **WebGPU compute: investigated, not used for the simulation.** Per-neuron
  integration is GPU-friendly, but spike propagation is a sparse scatter with
  data-dependent fan-out and would need atomic float accumulation (fixed-point
  atomics in WGSL), and telemetry, plasticity and inspection all need results
  back on the CPU every step or frame. At the sizes a browser can render (≤ 100k
  neurons) the engine already runs at or near real time on one core (see
  `PERFORMANCE.md`), so the readback latency and the loss of a WebGL2-compatible
  single code path outweigh the gain. The simulation therefore stays in WASM on a
  worker; the GPU is used for what it is unambiguously good at here (instanced
  drawing, per-instance colouring, post-processing).
* **One worker, no threads.** Threaded WASM requires cross-origin isolation, which
  standard static hosting does not guarantee. The engine is single-threaded and
  the browser stays responsive because it runs off the main thread.
