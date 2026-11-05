# Performance

Everything on this page was measured. Where something was *not* measured (frame
rates on real GPUs), the page says so rather than estimating it.

* [Summary](#summary)
* [Test machine](#test-machine)
* [Simulation engine](#simulation-engine)
* [Targets per tier](#targets-per-tier)
* [Memory](#memory)
* [Rendering](#rendering)
* [Download size](#download-size)
* [Interface responsiveness](#interface-responsiveness)
* [Optimisations and what they bought](#optimisations-and-what-they-bought)
* [Reproducing the measurements](#reproducing-the-measurements)

## Summary

* On one 2.8 GHz server core the WebAssembly engine runs the Neural Observatory
  brain **faster than real time up to 10,000 neurons** (≈ 3× at 10k) and **just
  below real time at 25,000** (0.7–1.0×, mean 0.83×). 50,000 and 100,000 neurons
  run at about 0.4× and 0.2× real time.
* The engine sustains **11–14 million synaptic events per second** at every size.
  Its cost is set by spikes × fan-out rather than by neuron count alone.
* Browser figures (engine inside the application's own Web Worker in Chromium)
  agree with Node within run-to-run noise. Native Rust is 1.2–1.5× faster than
  WebAssembly.
* Memory is about 1.9 KiB per neuron at 62 synapses per neuron (≈ 31 bytes per
  synapse once neuron state and the delay ring are included). 100k neurons use
  184 MiB.
* Rendering cost is bounded by the quality preset and not by network size, and is
  stepped down automatically when frames are slow. Frame rates on real GPUs have
  **not** been measured here. The only browser available to this project's test
  runs renders in software (see [Rendering](#rendering)).

## Test machine

| | |
|---|---|
| CPU | Intel Xeon Processor @ 2.80 GHz, 4 logical cores (cloud VM) |
| OS | Linux x64 |
| Node | 22.23 (V8, the same engine family as Chrome) |
| Browser | HeadlessChrome 153 (Playwright) |
| Rust | stable, `--release`, `wasm32-unknown-unknown`, no SIMD |
| Network | Neural Observatory preset, seed 1, Δt = 0.5 ms, plasticity off |

This is a virtual machine that was migrated to different hardware once during the
measurements. Repeated runs of the same build differ by **up to ±20%**: twelve
consecutive runs at 10k neurons ranged from 2.2× to 3.4×. Single runs are
therefore only indicative. Comparisons between builds on this page use
interleaved repeated runs (see
[Optimisations](#optimisations-and-what-they-bought)). A recent desktop CPU is typically faster per core than this
server part; a phone or low-power laptop will be slower.

## Simulation engine

The engine is single-threaded. Every row below runs the network as fast as
possible for a fixed wall-clock time per size (3–4 s), after 300 ms of simulated
warm-up, with no rendering. The **real-time factor** is simulated seconds per wall-clock second:
above 1 is faster than biology, below 1 is slower.

### WebAssembly in Node

`npm run bench:engine`, 4 s per size. Raw results are in
[`bench/results/engine-2026-11-05.json`](../bench/results/engine-2026-11-05.json).

| Neurons | Synapses | Build | ms per simulated s | Real-time factor | Synaptic events / s | Mean rate | Engine memory |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2,000 | 0.12 M | 108 ms | 54 | 18.61× | 11.6 M | 4.9 Hz | 3.6 MiB |
| 5,000 | 0.31 M | 148 ms | 138 | 7.25× | 13.6 M | 5.8 Hz | 9.2 MiB |
| 10,000 | 0.62 M | 270 ms | 322 | 3.10× | 14.1 M | 7.1 Hz | 18.4 MiB |
| 25,000 | 1.56 M | 896 ms | 1,034 | 0.97× | 13.9 M | 8.9 Hz | 46.1 MiB |
| 50,000 | 3.12 M | 1,578 ms | 2,542 | 0.39× | 10.7 M | 8.4 Hz | 92.2 MiB |
| 100,000 | 6.23 M | 3,617 ms | 5,157 | 0.19× | 12.0 M | 9.6 Hz | 184.4 MiB |

These are single runs. Over six further runs of the same build, interleaved with
other builds, 10k averaged **3.05×** (2.74–3.44×) and 25k averaged **0.83×**
(0.72–0.91×).

Larger networks fire slightly faster (4.9 → 9.6 Hz) because each neuron receives
more recurrent input. Cost therefore grows a little faster than linearly with
size.

### Native Rust (for comparison)

`npm run bench:native`: the same core crate compiled for x86-64 and run on the
same configurations.

| Neurons | Native | WebAssembly | WebAssembly / native |
|---:|---:|---:|---:|
| 2,000 | 26.26× | 18.61× | 0.71 |
| 5,000 | 11.20× | 7.25× | 0.65 |
| 10,000 | 4.08× | 3.10× | 0.76 |
| 25,000 | 1.39× | 0.97× | 0.70 |
| 50,000 | 0.53× | 0.39× | 0.74 |
| 100,000 | 0.23× | 0.19× | 0.83 |

WebAssembly reaches 65–83% of native speed. A future desktop build (for example
with Tauri) could run the same core crate natively for that margin, and could
also use threads.

### In the browser, through the worker

`npm run bench:browser`: the production build in headless Chromium, using the
same request as **Performance → Run benchmark**. The live simulation is paused
so the benchmark has the worker to itself. Times are 3 s per size.

| Neurons | Real-time factor (worker, Chromium) | Node, same build |
|---:|---:|---:|
| 2,000 | 17.5–19.9× | 18.61× |
| 5,000 | 7.72× | 7.25× |
| 10,000 | 2.61–3.42× | 3.10× |
| 25,000 | 0.79× | 0.97× |
| 50,000 | 0.44× | 0.39× |

Where two runs were taken, both are shown, and the spread is VM noise. Running in
a worker inside a page costs nothing measurable compared with Node.

### Where the time goes

Profiled at 25,000 neurons:

| Phase | Share |
|---|---:|
| Integrate (membrane update, threshold, refractory, noise) | 54.6% |
| Propagate (scatter spikes into the delay ring) | 43.8% |
| Everything else (stimuli, telemetry counters, buffers) | 1.6% |

* **Integration** is a linear pass over structure-of-arrays state. Its cost is
  proportional to neurons × steps.
* **Propagation** writes to scattered addresses in the event ring, so it is
  limited by memory rather than arithmetic. Its cost is proportional to
  spikes × synapses per neuron.
* **Plasticity** adds cost proportional to the spikes of plastic projections, and
  reward-modulated rules add a batched sweep every ≈ 10 ms. It is off in all of
  the tables above.

## Targets per tier

These targets are derived from the measurements. Treat them as expectations for
a machine like the test machine, not promises for every device. To measure your
own machine, open Performance → Run benchmark.

| Tier | Neurons | Target | Basis |
|---|---:|---|---|
| Micro | 2,000 | Real time with large headroom on any device that runs WebGPU or WebGL2 | 18.6× here |
| Small | 5,000 | Real time on laptops and recent tablets | 7.3× here |
| Medium | 10,000 | Real time on desktop and laptop CPUs (the default for the presets) | 3.1× here |
| Large | 25,000 | About real time on a fast desktop core; below real time elsewhere | 0.7–1.0× here (mean 0.83×) |
| Experimental | 50,000 | Below real time: 0.4× here | Measured |
| Extreme | 100,000 | Well below real time: 0.2× here, 3.6 s to build, 184 MiB | Measured |

On first launch, the tier comes from the device: Micro for mobile devices or ≤ 2
cores / ≤ 2 GB, Small for ≤ 4 cores / ≤ 4 GB, and Medium otherwise.

**Below real time:**

* The simulation never cuts corners to keep up. The worker runs as many steps as
  fit in its time slices and reports the achieved real-time factor.
* If the requested speed cannot be reached, the HUD shows *Simulation below
  requested speed*.
* The default speed is 0.25× (slowed down so pulses are visible), which the
  Large tier sustains here with headroom.

The engine's hard limits are 500,000 neurons and 40 million synapses. These limits
are set by memory, not speed.

## Memory

| Neurons | Synapses | Engine | Whole WebAssembly heap |
|---:|---:|---:|---:|
| 2,000 | 0.12 M | 3.6 MiB | 5.0 MiB |
| 10,000 | 0.62 M | 18.4 MiB | 20.6 MiB |
| 25,000 | 1.56 M | 46.1 MiB | 49.4 MiB |
| 100,000 | 6.23 M | 184.4 MiB | 192.4 MiB |

The engine's own accounting (`estimate_memory_bytes` in `engine/core/src/config.rs`):

* each synapse uses 18 bytes: target `u32`, weight `f32`, delay `u8` and
  projection `u8`, plus two `u32` entries in the incoming-synapse index;
* when a network has plastic projections, each synapse also stores its initial
  weight (4 bytes), and each plastic synapse also stores an eligibility trace
  (4 bytes);
* each neuron uses 113 bytes of state and parameters, plus 8 bytes per delay-ring
  slot (excitatory and inhibitory channels).

The Performance view shows both the engine figure and the whole WebAssembly heap.
A WebAssembly heap can grow but never shrinks. Building a smaller network after
a large one therefore keeps the larger heap until the page is reloaded.

## Rendering

**Real GPUs have not been measured.** The only browser available to this
project's automated runs is headless Chromium in a container with no GPU. It
renders with SwiftShader, a CPU rasteriser:

* WebGPU initialises but cannot present reliably, and the device is sometimes
  lost; the renderer then falls back to WebGL2, as designed.
* Under WebGL2 the scene draws at about 32 FPS when paused and about 10 FPS while
  a network runs.
* CPU profiles of those runs attribute the frame time to native `(program)`
  rasterisation, not to JavaScript or React.

These figures describe a software rasteriser, not NEUROFORM on a GPU, and are not
quoted as targets. When NEUROFORM detects a software renderer (through
`WEBGL_debug_renderer_info`), it warns the user and lowers rendering quality. The
simulation is not affected.

What *is* bounded by design:

* **Drawing cost does not grow with network size.** Neurons are one instanced
  draw. Displayed synapses and travelling pulses are capped by the quality preset,
  and the sample is spread across the network:

  | Preset | Pixel ratio | Synapses shown | Pulses | Close-range detail | Bloom |
  |---|---:|---:|---:|---:|---|
  | Performance | 0.75 | 6,000 | 2,500 | 4,000 | off |
  | Balanced | 1.25 | 16,000 | 8,000 | 10,000 | on |
  | High | 1.75 | 32,000 | 16,000 | 20,000 | on |
  | Ultra | 2.0 | 64,000 | 32,000 | 40,000 | on |

* **Adaptive quality.**
  * When frames average slower than the 50 FPS target for about 2.5 s, the
    renderer steps down through five levels: resolution, then pulses, then
    synapses, then bloom.
  * It steps back up after about 10 s of fast frames.
  * The thresholds count accumulated milliseconds rather than frames, so it
    reacts equally fast at 10 and at 120 FPS.
  * The HUD shows when it is active.
* **Per-frame data.**
  * The renderer pulls one frame at a time. A new frame is requested only after
    the previous one arrives, so a slow renderer never queues work in the worker.
  * A frame carries only the spikes since the previous one, plus membrane or
    rate arrays when the active visualisation needs them.
  * Buffers are transferred, not copied, and are recycled.
* **Translucency.** *Reduce interface effects* in Settings removes the backdrop
  blur behind panels, which costs fill rate on weak GPUs.

## Download size

Production build (`npm run build`), before and after gzip:

| File | Size | gzip |
|---|---:|---:|
| Application JavaScript (React, Three.js, interface) | 1.38 MB | 388 KB |
| Simulation engine (`.wasm`, LTO, stripped) | 477 KB | 172 KB |
| Simulation worker (JavaScript) | 29 KB | 9 KB |
| Styles | 28 KB | 7 KB |
| Fonts (six `woff2` files: Inter, JetBrains Mono) | 219 KB | already compressed |

Source maps are emitted alongside the build but are only fetched when developer
tools are open. The service worker caches everything after the first visit, so
later launches, including offline launches, load from the device.

## Interface responsiveness

The simulation never runs on the main thread:

* The worker runs the engine in slices of about 8 ms and handles messages between
  slices. A request (pause, stimulate, inspect a neuron) waits about one slice,
  even at 100k neurons.
* Telemetry is aggregated in the worker and sent at 10 Hz. Charts redraw from
  ring buffers at their own throttled rate, not on every message.
* Building a network reports progress, and the interface stays usable while it
  runs.
* Experiments step the engine in the worker and read exact measurement windows
  (`measure`). The Laboratory shows their progress, and the page is not blocked.

## Optimisations and what they bought

Each change was measured before and after on the same machine. Engine changes
were compared with builds alternated run by run, so that drift in the VM affects
both builds equally.

| Change | Effect |
|---|---|
| Unchecked inner loop in spike propagation, with per-delay event counting | Six interleaved runs each: 10k 2.56× → **3.05×** (+19%); 25k 0.73× → **0.83×** (+14%) |
| Release-mode structural checks for that loop (once per synapse at build, table lengths per call) | No measurable cost: twelve interleaved runs at 10k averaged 2.83× without and 2.99× with |
| Nearest-neighbour search for local connectivity stops at the first occupied grid shell | 10k build: ≈ 1.5 s → ≈ 0.3 s |
| WebAssembly SIMD (`+simd128`) | **No gain** (within noise at 25k), so it is not shipped |
| WebGPU compute for the simulation | Investigated, not used; see [ARCHITECTURE.md](ARCHITECTURE.md#decisions) |

The engine tests (`cargo test`) cover determinism, analytic firing rates, delays,
decay and plasticity, and they pass after each optimisation. The propagation change
keeps the order of floating-point additions, so its spike trains are bit-identical
to the checked version.

## Reproducing the measurements

```bash
npm run bench:engine            # WebAssembly in Node; writes bench/results/engine-<date>.json
npm run bench:native            # the same core compiled natively (needs a Rust toolchain)
npm run build && npm run bench:browser   # the shipped build in headless Chromium
```

All three accept a time per size as the first argument, and `bench:engine` and
`bench:browser` also accept a list of sizes, for example
`node scripts/bench-engine.ts 4 10000 25000`. In the application,
**Performance → Run benchmark** runs the same measurement in your browser.
**Save results** downloads the measurement as JSON, including the user agent and
core count.
