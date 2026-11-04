/// <reference lib="webworker" />
/**
 * The simulation worker: owns the WebAssembly engine and runs it off the UI thread.
 *
 * Responsibilities
 * - load the engine, build networks incrementally (with progress), run them in
 *   time slices paced by `StepScheduler`;
 * - answer requests (inspection, edits, stimulation, snapshots, analysis);
 * - push throttled telemetry (default 10 Hz) and per-frame spike lists on request
 *   (the renderer pulls frames, which provides natural back-pressure).
 *
 * It contains no simulation mathematics and no rendering.
 */

import { EngineModule, EngineNetwork, EngineError, type NetworkBuilder } from '../engine/wasmEngine.ts';
import type { BrainConfig } from '../config/schema.ts';
import type { TelemetryReport } from '../engine/types.ts';
import { observatory } from '../config/presets.ts';
import { StepScheduler } from './scheduler.ts';
import { RecordingWriter } from './recording.ts';
import type {
  BenchmarkResult,
  BuiltNetwork,
  DegreeStats,
  FrameRequest,
  LocalGraph,
  RequestMessage,
  Requests,
  RequestType,
  SimStatus,
  SynapseSample,
  WorkerEvent,
  WorkerPerf,
} from './protocol.ts';

declare const self: DedicatedWorkerGlobalScope;

let mod: EngineModule | null = null;
let net: EngineNetwork | null = null;
let config: BrainConfig | null = null;
let status: SimStatus = 'booting';
const scheduler = new StepScheduler({ dtMs: 0.5 });
let running = false;
let telemetryHz = 10;
let lastTelemetry = 0;
let probeIds: number[] = [];
let probeStart = 0;
let trackedIds: number[] = [];
let profiling = false;

// Spikes drained from the engine every slice and handed to the renderer on request.
let pending = new Uint32Array(1 << 16);
let pendingLen = 0;
let pendingDropped = 0;
let lastFrameRequest = 0;
let rateBase: Uint32Array | null = null;
let rateBaseTime = 0;
let recycled: ArrayBuffer[] = [];

// Performance accounting over the current telemetry window.
let windowStart = 0;
let windowBusy = 0;
let windowSteps = 0;

/** Spike capture channels: the user's recording and an experiment's capture. */
const recorders = new Map<'user' | 'experiment', RecordingWriter>();

function post(e: WorkerEvent, transfer: Transferable[] = []): void {
  self.postMessage(e, transfer);
}

function setStatus(s: SimStatus, detail?: string): void {
  status = s;
  post({ type: 'status', status: s, detail });
}

function requireNet(): EngineNetwork {
  if (!net || !net.alive) throw new EngineError('no network has been built');
  return net;
}

// ------------------------------------------------------------------ run loop

const channel = new MessageChannel();
let tickQueued = false;
channel.port1.onmessage = () => {
  tickQueued = false;
  tick();
};

function queueTick(immediate: boolean): void {
  if (tickQueued) return;
  tickQueued = true;
  if (immediate) channel.port2.postMessage(null);
  else
    setTimeout(() => {
      tickQueued = false;
      tick();
    }, 4);
}

function drainSpikes(n: EngineNetwork): void {
  const spikes = n.view('frameSpikes');
  if (spikes.length > 0) {
    for (const r of recorders.values()) r.addSpikes(spikes);
    const need = pendingLen + spikes.length;
    // Without a renderer pulling frames (tab hidden), keep only recent spikes.
    if (performance.now() - lastFrameRequest > 1000) {
      pendingDropped += pendingLen / 2;
      pendingLen = 0;
    }
    if (need > pending.length) {
      if (need <= 1 << 22) {
        const grown = new Uint32Array(Math.max(need, pending.length * 2));
        grown.set(pending.subarray(0, pendingLen));
        pending = grown;
      }
    }
    const room = Math.min(spikes.length, pending.length - pendingLen);
    pending.set(spikes.subarray(0, room), pendingLen);
    pendingLen += room;
    pendingDropped += (spikes.length - room) / 2;
  }
  n.clearBuffers(true, false, false);
}

function tick(): void {
  if (!running || !net) return;
  const n = net;
  const now = performance.now();
  let owed = scheduler.credit(now);
  const deadline = now + scheduler.sliceMs;
  try {
    while (owed >= 1) {
      const chunk = scheduler.chunk(owed);
      const t0 = performance.now();
      n.run(chunk);
      const el = performance.now() - t0;
      scheduler.ran(chunk, el);
      windowBusy += el;
      windowSteps += chunk;
      owed -= chunk;
      if (performance.now() >= deadline) break;
    }
    scheduler.endSlice();
    drainSpikes(n);
    maybeTelemetry(performance.now());
  } catch (err) {
    fail(err);
    return;
  }
  queueTick(!Number.isFinite(scheduler.speed) || scheduler.pending >= 1);
}

function fail(err: unknown): void {
  running = false;
  const msg = err instanceof Error ? err.message : String(err);
  // A WebAssembly trap leaves the engine in an unknown state: discard it.
  if (err instanceof WebAssembly.RuntimeError) {
    net = null;
    post({ type: 'fatal', error: `The simulation engine stopped unexpectedly (${msg}). Rebuild or restore a snapshot to continue.` });
    setStatus('error', msg);
  } else {
    post({ type: 'fatal', error: msg });
    setStatus(net ? 'paused' : 'empty');
  }
}

function perf(now: number): WorkerPerf {
  const wall = Math.max(1, now - windowStart);
  const sps = (windowSteps * 1000) / wall;
  return {
    stepsPerSecond: sps,
    realtimeFactor: (sps * scheduler.dtMs) / 1000,
    busyFraction: Math.min(1, windowBusy / wall),
    msPerStep: scheduler.msPerStep,
    targetSpeed: scheduler.speed,
    lagging: running && scheduler.lagging,
    wasmBytes: mod?.memoryBytes ?? 0,
    chunkSteps: scheduler.chunk(1e9),
  };
}

function maybeTelemetry(now: number, force = false): TelemetryReport | null {
  if (!net) return null;
  if (!force && now - lastTelemetry < 1000 / telemetryHz) return null;
  lastTelemetry = now;
  const n = net;
  const report = n.telemetry();
  const raster = n.copy('raster');
  let probes = null;
  if (probeIds.length > 0) {
    const samples = n.copy('probeSamples');
    probes = { ids: probeIds.slice(), startStep: probeStart, samples };
    probeStart += samples.length / (probeIds.length * 3);
  }
  n.clearBuffers(false, true, true);
  let tracked = null;
  if (trackedIds.length > 0) {
    const recs = n.synapsesById(trackedIds);
    tracked = { ids: recs.map((r) => r.id), weights: new Float32Array(recs.map((r) => r.weight)) };
  }
  for (const r of recorders.values()) r.addTelemetry(report);
  const transfer: Transferable[] = [raster.buffer];
  if (probes) transfer.push(probes.samples.buffer);
  if (tracked) transfer.push(tracked.weights.buffer);
  post(
    {
      type: 'telemetry',
      report,
      perf: perf(now),
      raster,
      probes,
      tracked,
      recording: recorders.has('user') ? { active: true, spikes: recorders.get('user')!.spikeCount, durationMs: report.timeMs - recorders.get('user')!.startMs } : null,
    },
    transfer,
  );
  windowStart = now;
  windowBusy = 0;
  windowSteps = 0;
  return report;
}

function onFrame(req: FrameRequest): void {
  lastFrameRequest = performance.now();
  if (req.recycle.length) recycled = req.recycle.concat(recycled).slice(0, 4);
  if (!net) return;
  const n = net;
  if (!running) drainSpikes(n);
  const spikes = pending.slice(0, pendingLen);
  const dropped = pendingDropped;
  pendingLen = 0;
  pendingDropped = 0;
  let membrane: Float32Array | null = null;
  const transfer: Transferable[] = [spikes.buffer];
  if (req.membrane) {
    const len = n.info.neurons;
    const buf = recycled.find((b) => b.byteLength === len * 4);
    if (buf) recycled = recycled.filter((b) => b !== buf);
    membrane = buf ? new Float32Array(buf) : new Float32Array(len);
    // Normalised between reset (0) and threshold (1) so every neuron is comparable.
    const v = n.view('membrane');
    const th = n.view('threshold');
    const vr = n.view('vReset');
    for (let i = 0; i < len; i++) {
      const x = (v[i] - vr[i]) / Math.max(1e-3, th[i] - vr[i]);
      membrane[i] = x < 0 ? 0 : x > 1 ? 1 : x;
    }
    transfer.push(membrane.buffer);
  }
  let rates = null;
  if (req.rates) {
    const now = n.timeMs;
    const counts = n.view('spikeCount');
    if (!rateBase || rateBase.length !== counts.length || now <= rateBaseTime) {
      rateBase = counts.slice();
      rateBaseTime = now;
    } else if (now - rateBaseTime >= 250) {
      const out = new Float32Array(counts.length);
      for (let i = 0; i < counts.length; i++) out[i] = (counts[i] - rateBase[i]) >>> 0;
      rates = { counts: out, windowMs: now - rateBaseTime };
      rateBase.set(counts);
      rateBaseTime = now;
      transfer.push(out.buffer);
    }
  }
  post({ type: 'frame', step: n.step, timeMs: n.timeMs, spikes, dropped, membrane, rates }, transfer);
}

// ------------------------------------------------------------------ build

async function build(cfg: BrainConfig): Promise<BuiltNetwork> {
  if (!mod) throw new EngineError('engine not loaded');
  running = false;
  setStatus('building');
  post({ type: 'progress', phase: 'validate', progress: 0, detail: 'Validating configuration' });
  const validation = mod.validate(cfg);
  if (net) {
    net.free();
    net = null;
  }
  recorders.clear();
  const t0 = performance.now();
  let builder: NetworkBuilder | null = mod.createBuilder(cfg);
  try {
    const expected = Math.max(1, validation.totals.expectedSynapses);
    const budget = Math.max(20_000, Math.round(expected / 60));
    let progress = 0;
    while (progress < 1) {
      progress = builder.advance(budget);
      const syn = builder.synapses;
      post({
        type: 'progress',
        phase: 'build',
        progress,
        detail: `Generating synapses · ${syn.toLocaleString('en-GB')} of ~${Math.round(expected).toLocaleString('en-GB')}`,
      });
      // Yield so progress reaches the UI and queued messages are handled.
      await new Promise((r) => setTimeout(r, 0));
    }
    post({ type: 'progress', phase: 'index', progress: 1, detail: 'Indexing connectivity' });
    await new Promise((r) => setTimeout(r, 0));
    const b = builder;
    builder = null;
    net = b.finish();
  } finally {
    builder?.free();
  }
  const buildMs = performance.now() - t0;
  config = cfg;
  scheduler.dtMs = net.info.dt;
  probeIds = [];
  trackedIds = [];
  pendingLen = 0;
  rateBase = null;
  windowStart = performance.now();
  windowBusy = 0;
  windowSteps = 0;
  net.setProfiling(profiling);
  setStatus('paused');
  return {
    info: net.info,
    validation,
    buildMs,
    positions: net.copy('positions'),
    regionOf: net.copy('regionOf'),
    classOf: net.copy('classOf'),
    sample: net.copy('sample'),
  };
}

// ------------------------------------------------------------------ analysis helpers

function sampleSynapses(budget: number, seed: number): SynapseSample {
  const n = requireNet();
  const info = n.info;
  const total = info.synapses;
  const take = Math.min(budget, total);
  // Quota per projection ∝ √count (small pathways stay visible), at least 48.
  const weightsP = info.projections.map((p) => Math.sqrt(p.synapses));
  const wsum = weightsP.reduce((a, b) => a + b, 0) || 1;
  const quota = info.projections.map((p, i) => Math.min(p.synapses, Math.max(48, Math.round((take * weightsP[i]) / wsum))));
  const ids: number[] = [];
  const pres: number[] = [];
  let s = seed >>> 0 || 1;
  const rand = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  const rowPtr = n.copy('rowPtr');
  const proj = n.view('synapseProjection');
  const seen = new Set<number>();
  info.projections.forEach((p, pi) => {
    const r = info.regions[p.from];
    const [a, b] = p.source === 'excitatory' ? [r.start, r.excEnd] : [r.excEnd, r.end];
    if (b <= a) return;
    let got = 0;
    let tries = 0;
    while (got < quota[pi] && tries < quota[pi] * 8) {
      tries++;
      const j = a + Math.floor(rand() * (b - a));
      const lo = rowPtr[j];
      const hi = rowPtr[j + 1];
      if (hi <= lo) continue;
      // Random synapse of this projection in the row (rows hold contiguous blocks).
      const start = lo + Math.floor(rand() * (hi - lo));
      let k = start;
      let found = -1;
      for (let c = 0; c < hi - lo; c++) {
        if (proj[k] === pi) {
          found = k;
          break;
        }
        k = k + 1 < hi ? k + 1 : lo;
      }
      if (found < 0 || seen.has(found)) continue;
      seen.add(found);
      ids.push(found);
      pres.push(j);
      got++;
    }
  });
  const target = n.view('target');
  const weight = n.view('weight');
  const delay = n.view('delay');
  const dt = info.dt;
  const out: SynapseSample = {
    ids: new Uint32Array(ids),
    pre: new Uint32Array(pres),
    post: new Uint32Array(ids.length),
    weight: new Float32Array(ids.length),
    delayMs: new Float32Array(ids.length),
    projection: new Uint8Array(ids.length),
  };
  const projV = n.view('synapseProjection');
  for (let k = 0; k < ids.length; k++) {
    const sid = ids[k];
    out.post[k] = target[sid];
    out.weight[k] = weight[sid];
    out.delayMs[k] = delay[sid] * dt;
    out.projection[k] = projV[sid];
  }
  return out;
}

function localGraph(center: number, hops: 1 | 2, cap: number): LocalGraph {
  const n = requireNet();
  const rowPtr = n.view('rowPtr');
  const target = n.view('target');
  const inPtr = n.view('inPtr');
  const inSyn = n.view('inSynapse');
  const inSrc = n.view('inSource');
  const weight = n.view('weight');
  const delay = n.view('delay');
  const syn: number[] = [];
  const pre: number[] = [];
  const post: number[] = [];
  const hop: number[] = [];
  const seen = new Set<number>();
  let truncated = false;
  const add = (s: number, a: number, b: number, h: number) => {
    if (seen.has(s)) return;
    if (syn.length >= cap) {
      truncated = true;
      return;
    }
    seen.add(s);
    syn.push(s);
    pre.push(a);
    post.push(b);
    hop.push(h);
  };
  const neighbours: number[] = [];
  for (let s = rowPtr[center]; s < rowPtr[center + 1]; s++) {
    add(s, center, target[s], 1);
    neighbours.push(target[s]);
  }
  for (let k = inPtr[center]; k < inPtr[center + 1]; k++) {
    add(inSyn[k], inSrc[k], center, 1);
    neighbours.push(inSrc[k]);
  }
  if (hops === 2) {
    const perNeighbour = Math.max(2, Math.floor((cap - syn.length) / Math.max(1, neighbours.length)));
    for (const m of neighbours) {
      let c = 0;
      for (let s = rowPtr[m]; s < rowPtr[m + 1] && c < perNeighbour; s++, c++) add(s, m, target[s], 2);
      if (rowPtr[m + 1] - rowPtr[m] > perNeighbour) truncated = true;
    }
  }
  return {
    center,
    synapses: new Uint32Array(syn),
    pre: new Uint32Array(pre),
    post: new Uint32Array(post),
    weight: new Float32Array(syn.map((s) => weight[s])),
    delayMs: new Float32Array(syn.map((s) => delay[s] * n.info.dt)),
    hop: new Uint8Array(hop),
    truncated,
  };
}

function neuronsInSphere(center: [number, number, number], radius: number, cap: number): Uint32Array {
  const n = requireNet();
  const pos = n.view('positions');
  const r2 = radius * radius;
  const out: number[] = [];
  for (let i = 0; i < n.info.neurons && out.length < cap; i++) {
    const dx = pos[3 * i] - center[0];
    const dy = pos[3 * i + 1] - center[1];
    const dz = pos[3 * i + 2] - center[2];
    if (dx * dx + dy * dy + dz * dz <= r2) out.push(i);
  }
  return new Uint32Array(out);
}

/** Every synapse whose presynaptic neuron lies within the sphere (close-range LOD). */
function nearSynapses(center: [number, number, number], radius: number, cap: number): SynapseSample & { neurons: number } {
  const n = requireNet();
  const inside = neuronsInSphere(center, radius, 1 << 30);
  const rowPtr = n.view('rowPtr');
  const target = n.view('target');
  const weight = n.view('weight');
  const delay = n.view('delay');
  const proj = n.view('synapseProjection');
  const ids: number[] = [];
  const pre: number[] = [];
  // Visit neurons nearest the centre first so a capped patch stays centred.
  const pos = n.view('positions');
  const order = Array.from(inside).sort((a, b) => {
    const da = (pos[3 * a] - center[0]) ** 2 + (pos[3 * a + 1] - center[1]) ** 2 + (pos[3 * a + 2] - center[2]) ** 2;
    const db = (pos[3 * b] - center[0]) ** 2 + (pos[3 * b + 1] - center[1]) ** 2 + (pos[3 * b + 2] - center[2]) ** 2;
    return da - db;
  });
  for (const j of order) {
    for (let s = rowPtr[j]; s < rowPtr[j + 1]; s++) {
      if (ids.length >= cap) break;
      ids.push(s);
      pre.push(j);
    }
    if (ids.length >= cap) break;
  }
  const m = ids.length;
  const out = {
    ids: new Uint32Array(ids),
    pre: new Uint32Array(pre),
    post: new Uint32Array(m),
    weight: new Float32Array(m),
    delayMs: new Float32Array(m),
    projection: new Uint8Array(m),
    neurons: inside.length,
  };
  for (let k = 0; k < m; k++) {
    out.post[k] = target[ids[k]];
    out.weight[k] = weight[ids[k]];
    out.delayMs[k] = delay[ids[k]] * n.info.dt;
    out.projection[k] = proj[ids[k]];
  }
  return out;
}

function degrees(bins: number): DegreeStats {
  const n = requireNet();
  const rowPtr = n.view('rowPtr');
  const inPtr = n.view('inPtr');
  let maxDegree = 1;
  for (let i = 0; i < n.info.neurons; i++) {
    maxDegree = Math.max(maxDegree, rowPtr[i + 1] - rowPtr[i], inPtr[i + 1] - inPtr[i]);
  }
  const regions = n.info.regions.map((r) => {
    const inHist = new Array(bins).fill(0);
    const outHist = new Array(bins).fill(0);
    let inSum = 0;
    let outSum = 0;
    for (let i = r.start; i < r.end; i++) {
      const o = rowPtr[i + 1] - rowPtr[i];
      const d = inPtr[i + 1] - inPtr[i];
      outSum += o;
      inSum += d;
      outHist[Math.min(bins - 1, Math.floor((o / (maxDegree + 1)) * bins))]++;
      inHist[Math.min(bins - 1, Math.floor((d / (maxDegree + 1)) * bins))]++;
    }
    const c = Math.max(1, r.end - r.start);
    return { inMean: inSum / c, outMean: outSum / c, inHist, outHist, maxDegree };
  });
  return { regions, bins };
}

async function benchmark(sizes: number[], seconds: number): Promise<BenchmarkResult[]> {
  if (!mod) throw new EngineError('engine not loaded');
  const wasRunning = running;
  running = false;
  const results: BenchmarkResult[] = [];
  for (const neurons of sizes) {
    const cfg = observatory(neurons, 1);
    const t0 = performance.now();
    const b = mod.createBuilder(cfg);
    let p = 0;
    while (p < 1) {
      p = b.advance(200_000);
      await new Promise((r) => setTimeout(r, 0));
    }
    const bench = b.finish();
    const buildMs = performance.now() - t0;
    bench.run(Math.round(200 / cfg.timestepMs));
    bench.telemetry();
    const start = performance.now();
    let steps = 0;
    while (performance.now() - start < seconds * 1000) {
      bench.run(50);
      steps += 50;
      bench.clearBuffers(true, true, true);
    }
    const wall = performance.now() - start;
    const t = bench.telemetry();
    const simSec = (steps * cfg.timestepMs) / 1000;
    const spikes = t.regions.reduce((a, r) => a + r.spikesExc + r.spikesInh, 0);
    const result: BenchmarkResult = {
      neurons: bench.info.neurons,
      synapses: bench.info.synapses,
      buildMs,
      msPerSimSecond: wall / simSec,
      realtimeFactor: simSec / (wall / 1000),
      eventsPerSecond: t.eventsScheduled / (wall / 1000),
      spikesPerSecond: spikes / (wall / 1000),
      memoryBytes: bench.info.memoryBytes,
      meanRateHz: spikes / bench.info.neurons / simSec,
    };
    bench.free();
    results.push(result);
    post({ type: 'benchmark', result });
  }
  if (wasRunning && net) {
    running = true;
    scheduler.start(performance.now());
    queueTick(true);
  }
  return results;
}

// ------------------------------------------------------------------ requests

type Handler<K extends RequestType> = (msg: RequestMessage<K>) => Requests[K]['res'] | Promise<Requests[K]['res']>;
type Handlers = { [K in RequestType]: Handler<K> };

const handlers: Handlers = {
  async init({ wasmUrl }) {
    mod = await EngineModule.load(fetch(wasmUrl));
    setStatus('empty');
    return { engineVersion: mod.exports.nf_version(), crossOriginIsolated: self.crossOriginIsolated === true };
  },
  validate({ config: cfg }) {
    if (!mod) throw new EngineError('engine not loaded');
    return mod.validate(cfg);
  },
  build({ config: cfg }) {
    return build(cfg);
  },
  run() {
    requireNet();
    running = true;
    scheduler.start(performance.now());
    windowStart = performance.now();
    windowBusy = 0;
    windowSteps = 0;
    setStatus('running');
    queueTick(true);
  },
  pause() {
    const n = requireNet();
    running = false;
    drainSpikes(n);
    maybeTelemetry(performance.now(), true);
    setStatus('paused');
    return { step: n.step, timeMs: n.timeMs };
  },
  step({ steps, quiet }) {
    const n = requireNet();
    const k = Math.max(1, Math.min(100_000, Math.floor(steps)));
    const t0 = performance.now();
    n.run(k);
    windowBusy += performance.now() - t0;
    windowSteps += k;
    drainSpikes(n);
    // Quiet steps leave the telemetry window open (exact experiment measurements).
    if (!quiet) maybeTelemetry(performance.now(), true);
    return { step: n.step, timeMs: n.timeMs };
  },
  measure() {
    requireNet();
    return maybeTelemetry(performance.now(), true)!;
  },
  setSpeed({ speed }) {
    scheduler.speed = speed > 0 ? speed : Infinity;
    scheduler.start(performance.now());
  },
  reset({ weights }) {
    const n = requireNet();
    n.reset(weights);
    pendingLen = 0;
    rateBase = null;
    probeStart = 0;
    n.setProbes(probeIds);
    maybeTelemetry(performance.now(), true);
  },
  stimulate({ spec }) {
    return requireNet().addStimulus(spec);
  },
  cancelStimulus({ id }) {
    return requireNet().cancelStimulus(id);
  },
  clearStimuli() {
    requireNet().clearStimuli();
  },
  setNeuronParam({ neuron, param, value }) {
    return requireNet().setNeuronParam(neuron, param, value);
  },
  setPopulationParam({ region, cls, param, value }) {
    return requireNet().setPopulationParam(region, cls, param, value);
  },
  populationMean({ region, cls, param }) {
    return requireNet().populationMean(region, cls, param);
  },
  setRegionEnabled({ region, enabled }) {
    return requireNet().setRegionEnabled(region, enabled);
  },
  setProjectionGain({ projection, gain }) {
    return requireNet().setProjectionGain(projection, gain);
  },
  setSynapseWeight({ synapse, weight }) {
    return requireNet().setSynapseWeight(synapse, weight);
  },
  setMembrane({ neuron, value }) {
    return requireNet().setMembrane(neuron, value);
  },
  setPlasticity({ enabled, rateScale }) {
    requireNet().setPlasticity(enabled, rateScale);
  },
  reward({ amount }) {
    requireNet().injectReward(amount);
  },
  setProbes({ ids }) {
    const n = requireNet();
    probeIds = ids.filter((i) => i >= 0 && i < n.info.neurons).slice(0, 8);
    n.setProbes(probeIds);
    probeStart = n.step;
  },
  setSyncGroup({ regions }) {
    requireNet().setSynchronyGroup(regions);
  },
  setTracked({ ids }) {
    trackedIds = ids.slice(0, 32);
  },
  setTelemetryHz({ hz }) {
    telemetryHz = Math.max(1, Math.min(30, hz));
  },
  setProfiling({ on }) {
    profiling = on;
    net?.setProfiling(on);
  },
  neuron({ neuron }) {
    return requireNet().neuron(neuron);
  },
  synapses({ neuron, incoming, offset, limit }) {
    return requireNet().synapses(neuron, incoming, offset, Math.min(limit, 5000));
  },
  synapsesById({ ids }) {
    return requireNet().synapsesById(ids.slice(0, 5000));
  },
  histogram({ projection, bins }) {
    return requireNet().weightHistogram(projection, bins);
  },
  projectionStats() {
    return requireNet().projectionStats();
  },
  topChanges({ k }) {
    return requireNet().topWeightChanges(k);
  },
  communities({ iterations }) {
    return requireNet().communities(iterations);
  },
  sampleSynapses({ budget, seed }) {
    return sampleSynapses(budget, seed);
  },
  localGraph({ neuron, hops, cap }) {
    return localGraph(neuron, hops, cap);
  },
  degrees({ bins }) {
    return degrees(bins);
  },
  weightsOf({ ids }) {
    const w = requireNet().view('weight');
    const out = new Float32Array(ids.length);
    for (let k = 0; k < ids.length; k++) out[k] = w[ids[k]];
    return out;
  },
  nearSynapses({ center, radius, cap }) {
    return nearSynapses(center, radius, cap);
  },
  neuronsInSphere({ center, radius, cap }) {
    return neuronsInSphere(center, radius, cap);
  },
  neuronTable() {
    const n = requireNet();
    const rowPtr = n.view('rowPtr');
    const inPtr = n.view('inPtr');
    const outDegree = new Uint32Array(n.info.neurons);
    const inDegree = new Uint32Array(n.info.neurons);
    for (let i = 0; i < n.info.neurons; i++) {
      outDegree[i] = rowPtr[i + 1] - rowPtr[i];
      inDegree[i] = inPtr[i + 1] - inPtr[i];
    }
    return {
      regionOf: n.copy('regionOf'),
      classOf: n.copy('classOf'),
      positions: n.copy('positions'),
      spikeCount: n.copy('spikeCount'),
      threshold: n.copy('threshold'),
      excitability: n.copy('excitability'),
      membrane: n.copy('membrane'),
      inDegree,
      outDegree,
      timeMs: n.timeMs,
    };
  },
  synapseTable() {
    const n = requireNet();
    return {
      rowPtr: n.copy('rowPtr'),
      target: n.copy('target'),
      weight: n.copy('weight'),
      delay: n.copy('delay'),
      projection: n.copy('synapseProjection'),
      dt: n.info.dt,
    };
  },
  snapshot() {
    const n = requireNet();
    return { bytes: n.snapshot(), step: n.step, timeMs: n.timeMs };
  },
  restore({ bytes }) {
    const n = requireNet();
    try {
      n.restore(bytes);
    } catch (e) {
      // A failed restore may leave partial state; reset to a clean start.
      n.reset(true);
      throw e;
    }
    pendingLen = 0;
    rateBase = null;
    n.setProbes(probeIds);
    probeStart = n.step;
    maybeTelemetry(performance.now(), true);
    return { step: n.step, timeMs: n.timeMs };
  },
  recordStart({ maxSpikes, channel }) {
    const n = requireNet();
    drainSpikes(n);
    recorders.set(channel ?? 'user', new RecordingWriter(n.info, config, n.timeMs, n.step, maxSpikes));
  },
  recordStop({ channel }) {
    const key = channel ?? 'user';
    const r = recorders.get(key);
    if (!r || !net) return null;
    drainSpikes(net);
    recorders.delete(key);
    const bytes = r.finish(net.timeMs, net.step);
    return { bytes, spikes: r.spikeCount, durationMs: net.timeMs - r.startMs };
  },
  benchmark({ sizes, seconds }) {
    return benchmark(sizes, seconds);
  },
};

function transferablesOf(value: unknown): Transferable[] {
  const out: Transferable[] = [];
  const visit = (v: unknown, depth: number) => {
    if (!v || depth > 2) return;
    if (ArrayBuffer.isView(v)) {
      if (v.buffer instanceof ArrayBuffer && !out.includes(v.buffer)) out.push(v.buffer);
    } else if (typeof v === 'object' && !Array.isArray(v)) {
      for (const x of Object.values(v as Record<string, unknown>)) visit(x, depth + 1);
    }
  };
  visit(value, 0);
  return out;
}

self.onmessage = async (ev: MessageEvent<RequestMessage | FrameRequest>) => {
  const msg = ev.data;
  if (msg.type === 'frame') {
    try {
      onFrame(msg as FrameRequest);
    } catch (err) {
      fail(err);
    }
    return;
  }
  const req = msg as RequestMessage;
  const handler = handlers[req.type] as Handler<RequestType> | undefined;
  if (!handler) {
    post({ type: 'reply', id: req.id, ok: false, error: `unknown request ${req.type}` });
    return;
  }
  try {
    const value = await handler(req as never);
    // Only transfer buffers created for this reply (never views of engine memory).
    post({ type: 'reply', id: req.id, ok: true, value }, transferablesOf(value));
  } catch (err) {
    const e = err instanceof EngineError ? err : null;
    post({ type: 'reply', id: req.id, ok: false, error: err instanceof Error ? err.message : String(err), path: e?.path });
    if (err instanceof WebAssembly.RuntimeError) fail(err);
    else if (status === 'building') setStatus(net ? 'paused' : 'empty');
  }
};

self.addEventListener('unhandledrejection', (e) => fail(e.reason));
