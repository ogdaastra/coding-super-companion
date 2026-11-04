/**
 * TypeScript side of the engine's WebAssembly ABI (`engine/wasm/src/lib.rs`).
 *
 * Runs wherever WebAssembly runs: the simulation worker, Node (benchmarks, tests).
 * It owns no simulation logic; it moves bytes across the boundary and turns
 * engine errors into exceptions.
 *
 * Memory: the engine's linear memory can grow during any call that allocates,
 * which detaches previously created views. `view()` therefore re-derives typed
 * arrays from the current `memory.buffer` on every call and callers must not keep
 * them across engine calls.
 */

import type { BrainConfig } from '../config/schema.ts';
import {
  ArrayId,
  SYNAPSE_RECORD_WORDS,
  type ArrayName,
  type CommunitySummary,
  type NetInfo,
  type NeuronDetail,
  type ProjectionStats,
  type SynapseRecord,
  type TelemetryReport,
  type Validation,
  type WeightChange,
  type WeightHistogram,
} from './types.ts';

interface Exports {
  memory: WebAssembly.Memory;
  nf_version(): number;
  nf_alloc(len: number): number;
  nf_free(ptr: number, len: number): void;
  nf_error_ptr(): number;
  nf_error_len(): number;
  nf_result_ptr(): number;
  nf_result_len(): number;
  nf_result_clear(): void;
  nf_validate(ptr: number, len: number): number;
  nf_builder_new(ptr: number, len: number): number;
  nf_builder_advance(b: number, budget: number): number;
  nf_builder_synapses(b: number): number;
  nf_builder_finish(b: number): number;
  nf_builder_free(b: number): void;
  nf_net_free(n: number): void;
  nf_net_info(n: number): number;
  nf_net_run(n: number, steps: number): number;
  nf_net_step_index(n: number): number;
  nf_net_set_profiling(n: number, on: number): void;
  nf_net_array_ptr(n: number, which: number): number;
  nf_net_array_len(n: number, which: number): number;
  nf_net_clear_buffers(n: number, mask: number): void;
  nf_net_set_probes(n: number, ptr: number, count: number): void;
  nf_net_set_sync_group(n: number, lo: number, hi: number): void;
  nf_net_telemetry(n: number): number;
  nf_net_neuron_detail(n: number, i: number): number;
  nf_net_synapses(n: number, i: number, incoming: number, offset: number, limit: number): number;
  nf_net_synapses_by_id(n: number, ptr: number, count: number): number;
  nf_net_weight_histogram(n: number, projection: number, bins: number, maxCount: number): number;
  nf_net_projection_stats(n: number): number;
  nf_net_top_changes(n: number, k: number): number;
  nf_net_communities(n: number, iterations: number): number;
  nf_net_set_neuron_param(n: number, i: number, p: number, value: number): number;
  nf_net_set_population_param(n: number, region: number, cls: number, p: number, value: number): number;
  nf_net_population_mean(n: number, region: number, cls: number, p: number): number;
  nf_net_set_region_enabled(n: number, region: number, enabled: number): number;
  nf_net_set_projection_gain(n: number, p: number, gain: number): number;
  nf_net_set_synapse_weight(n: number, s: number, w: number): number;
  nf_net_set_membrane(n: number, i: number, v: number): number;
  nf_net_set_plasticity(n: number, enabled: number, rate: number): number;
  nf_net_inject_reward(n: number, amount: number): void;
  nf_net_add_stimulus(n: number, ptr: number, len: number): number;
  nf_net_cancel_stimulus(n: number, id: number): number;
  nf_net_clear_stimuli(n: number): void;
  nf_net_reset(n: number, flags: number): void;
  nf_net_snapshot(n: number): number;
  nf_net_restore(n: number, ptr: number, len: number): number;
}

export const ENGINE_ABI_VERSION = 1;

export class EngineError extends Error {
  readonly path: string | undefined;
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
    const m = /^([a-zA-Z][\w.[\]]*): (.*)$/s.exec(message);
    this.path = m ? m[1] : undefined;
  }
}

type ArrayCtor =
  | Float32ArrayConstructor
  | Uint32ArrayConstructor
  | Uint16ArrayConstructor
  | Uint8ArrayConstructor;

const ARRAY_TYPES = {
  positions: Float32Array,
  regionOf: Uint16Array,
  classOf: Uint8Array,
  membrane: Float32Array,
  spikeCount: Uint32Array,
  lastSpike: Uint32Array,
  rowPtr: Uint32Array,
  target: Uint32Array,
  weight: Float32Array,
  delay: Uint8Array,
  synapseProjection: Uint8Array,
  inPtr: Uint32Array,
  inSynapse: Uint32Array,
  inSource: Uint32Array,
  frameSpikes: Uint32Array,
  raster: Uint32Array,
  probeSamples: Float32Array,
  sample: Uint32Array,
  threshold: Float32Array,
  excitability: Float32Array,
  probes: Uint32Array,
  vReset: Float32Array,
  vRest: Float32Array,
} satisfies Record<ArrayName, ArrayCtor>;

type ViewOf<K extends ArrayName> = InstanceType<(typeof ARRAY_TYPES)[K]>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type NeuronClassFilter = 'all' | 'excitatory' | 'inhibitory';
const CLASS_INDEX: Record<NeuronClassFilter, number> = { all: 0, excitatory: 1, inhibitory: 2 };

export class EngineModule {
  readonly exports: Exports;

  private constructor(exports: Exports) {
    this.exports = exports;
    const version = exports.nf_version();
    if (version !== ENGINE_ABI_VERSION) {
      throw new EngineError(
        `engine ABI version ${version} does not match the application (${ENGINE_ABI_VERSION})`,
      );
    }
  }

  /** Instantiates the engine from compiled bytes or a fetch response. */
  static async load(source: BufferSource | Response | Promise<Response>): Promise<EngineModule> {
    const imports = { env: { nf_now: () => performance.now() } };
    let instance: WebAssembly.Instance;
    const resolved = await source;
    if (resolved instanceof Response) {
      if (!resolved.ok) {
        throw new EngineError(`could not download the simulation engine (HTTP ${resolved.status})`);
      }
      const ct = resolved.headers.get('content-type') ?? '';
      if (ct.includes('application/wasm') && typeof WebAssembly.instantiateStreaming === 'function') {
        instance = (await WebAssembly.instantiateStreaming(resolved, imports)).instance;
      } else {
        const bytes = await resolved.arrayBuffer();
        instance = (await WebAssembly.instantiate(bytes, imports)).instance;
      }
    } else {
      instance = (await WebAssembly.instantiate(resolved, imports)).instance;
    }
    return new EngineModule(instance.exports as unknown as Exports);
  }

  get memoryBytes(): number {
    return this.exports.memory.buffer.byteLength;
  }

  error(): EngineError {
    const e = this.exports;
    const msg = decoder.decode(new Uint8Array(e.memory.buffer, e.nf_error_ptr(), e.nf_error_len()));
    return new EngineError(msg || 'unknown engine error');
  }

  /** Copies the result buffer. */
  resultBytes(): Uint8Array {
    const e = this.exports;
    return new Uint8Array(e.memory.buffer, e.nf_result_ptr(), e.nf_result_len()).slice();
  }

  resultJson<T>(): T {
    const e = this.exports;
    const bytes = new Uint8Array(e.memory.buffer, e.nf_result_ptr(), e.nf_result_len());
    return JSON.parse(decoder.decode(bytes)) as T;
  }

  /** Copies `data` into engine memory, calls `fn(ptr, len)`, then frees it. */
  withBytes<T>(data: Uint8Array, fn: (ptr: number, len: number) => T): T {
    const e = this.exports;
    const ptr = e.nf_alloc(data.length);
    new Uint8Array(e.memory.buffer, ptr, data.length).set(data);
    try {
      return fn(ptr, data.length);
    } finally {
      e.nf_free(ptr, data.length);
    }
  }

  withString<T>(s: string, fn: (ptr: number, len: number) => T): T {
    return this.withBytes(encoder.encode(s), fn);
  }

  validate(config: BrainConfig): Validation {
    const r = this.withString(JSON.stringify(config), (p, l) => this.exports.nf_validate(p, l));
    if (r < 0) throw this.error();
    return this.resultJson<Validation>();
  }

  createBuilder(config: BrainConfig): NetworkBuilder {
    const h = this.withString(JSON.stringify(config), (p, l) => this.exports.nf_builder_new(p, l));
    if (h === 0) throw this.error();
    return new NetworkBuilder(this, h);
  }

  /** Builds in one call (tests, benchmarks). */
  build(config: BrainConfig): EngineNetwork {
    const b = this.createBuilder(config);
    return b.finish();
  }
}

export class NetworkBuilder {
  private handle: number;
  private readonly mod: EngineModule;

  constructor(mod: EngineModule, handle: number) {
    this.mod = mod;
    this.handle = handle;
  }

  /** Builds about `budget` synapses. Returns progress 0..1. */
  advance(budget: number): number {
    this.alive();
    const p = this.mod.exports.nf_builder_advance(this.handle, budget);
    if (p < 0) throw this.mod.error();
    return p;
  }

  get synapses(): number {
    this.alive();
    return this.mod.exports.nf_builder_synapses(this.handle);
  }

  finish(): EngineNetwork {
    this.alive();
    const h = this.mod.exports.nf_builder_finish(this.handle);
    this.handle = 0;
    if (h === 0) throw this.mod.error();
    return new EngineNetwork(this.mod, h);
  }

  free(): void {
    if (this.handle !== 0) {
      this.mod.exports.nf_builder_free(this.handle);
      this.handle = 0;
    }
  }

  private alive(): void {
    if (this.handle === 0) throw new EngineError('builder already finished or freed');
  }
}

function nanCheck(mod: EngineModule, v: number): number {
  if (Number.isNaN(v)) throw mod.error();
  return v;
}

export class EngineNetwork {
  private handle: number;
  readonly mod: EngineModule;
  readonly info: NetInfo;

  constructor(mod: EngineModule, handle: number) {
    this.mod = mod;
    this.handle = handle;
    if (mod.exports.nf_net_info(handle) < 0) throw mod.error();
    this.info = mod.resultJson<NetInfo>();
  }

  get alive(): boolean {
    return this.handle !== 0;
  }

  private h(): number {
    if (this.handle === 0) throw new EngineError('network has been freed');
    return this.handle;
  }

  free(): void {
    if (this.handle !== 0) {
      this.mod.exports.nf_net_free(this.handle);
      this.handle = 0;
      this.mod.exports.nf_result_clear();
    }
  }

  /** Zero-copy view into engine memory; invalid after the next engine call. */
  view<K extends ArrayName>(name: K): ViewOf<K> {
    const e = this.mod.exports;
    const h = this.h();
    const id = ArrayId[name];
    const ptr = e.nf_net_array_ptr(h, id);
    const len = e.nf_net_array_len(h, id);
    const Ctor = ARRAY_TYPES[name];
    return new Ctor(e.memory.buffer, ptr, len) as ViewOf<K>;
  }

  /** Copy of an engine array that stays valid. */
  copy<K extends ArrayName>(name: K): ViewOf<K> {
    return this.view(name).slice() as ViewOf<K>;
  }

  run(steps: number): number {
    return this.mod.exports.nf_net_run(this.h(), steps);
  }

  get step(): number {
    return this.mod.exports.nf_net_step_index(this.h());
  }

  get timeMs(): number {
    return this.step * this.info.dt;
  }

  setProfiling(on: boolean): void {
    this.mod.exports.nf_net_set_profiling(this.h(), on ? 1 : 0);
  }

  /** Clears drained buffers (frame spikes, raster events, probe samples). */
  clearBuffers(frame: boolean, raster: boolean, probes: boolean): void {
    this.mod.exports.nf_net_clear_buffers(this.h(), (frame ? 1 : 0) | (raster ? 2 : 0) | (probes ? 4 : 0));
  }

  setProbes(ids: readonly number[]): void {
    const bytes = new Uint8Array(new Uint32Array(ids).buffer);
    this.mod.withBytes(bytes, (p) => this.mod.exports.nf_net_set_probes(this.h(), p, ids.length));
  }

  setSynchronyGroup(regions: readonly number[]): void {
    let lo = 0;
    let hi = 0;
    for (const r of regions) {
      if (r < 32) lo |= 1 << r;
      else hi |= 1 << (r - 32);
    }
    this.mod.exports.nf_net_set_sync_group(this.h(), lo >>> 0, hi >>> 0);
  }

  telemetry(): TelemetryReport {
    if (this.mod.exports.nf_net_telemetry(this.h()) < 0) throw this.mod.error();
    return this.mod.resultJson<TelemetryReport>();
  }

  neuron(i: number): NeuronDetail {
    if (this.mod.exports.nf_net_neuron_detail(this.h(), i) < 0) throw this.mod.error();
    return this.mod.resultJson<NeuronDetail>();
  }

  synapses(i: number, incoming: boolean, offset: number, limit: number): { total: number; records: SynapseRecord[] } {
    const total = this.mod.exports.nf_net_synapses(this.h(), i, incoming ? 1 : 0, offset, limit);
    return { total, records: decodeRecords(this.mod.resultBytes(), false) };
  }

  synapsesById(ids: readonly number[]): SynapseRecord[] {
    if (ids.length === 0) return [];
    const bytes = new Uint8Array(new Uint32Array(ids).buffer);
    this.mod.withBytes(bytes, (p) => this.mod.exports.nf_net_synapses_by_id(this.h(), p, ids.length));
    return decodeRecords(this.mod.resultBytes(), true);
  }

  weightHistogram(projection = -1, bins = 48, maxCount = 2_000_000): WeightHistogram {
    if (this.mod.exports.nf_net_weight_histogram(this.h(), projection, bins, maxCount) < 0) throw this.mod.error();
    return this.mod.resultJson<WeightHistogram>();
  }

  projectionStats(): ProjectionStats[] {
    if (this.mod.exports.nf_net_projection_stats(this.h()) < 0) throw this.mod.error();
    return this.mod.resultJson<ProjectionStats[]>();
  }

  topWeightChanges(k: number): WeightChange[] {
    if (this.mod.exports.nf_net_top_changes(this.h(), k) < 0) throw this.mod.error();
    return this.mod.resultJson<WeightChange[]>();
  }

  communities(iterations: number): { summary: CommunitySummary; labels: Uint32Array } {
    this.mod.exports.nf_net_communities(this.h(), iterations);
    const bytes = this.mod.resultBytes();
    const dv = new DataView(bytes.buffer);
    const jsonLen = dv.getUint32(0, true);
    const summary = JSON.parse(decoder.decode(bytes.subarray(4, 4 + jsonLen))) as CommunitySummary;
    let off = 4 + jsonLen;
    off += (4 - (off % 4)) % 4;
    const labels = new Uint32Array(bytes.buffer.slice(off));
    return { summary, labels };
  }

  setNeuronParam(i: number, param: number, value: number): number {
    return nanCheck(this.mod, this.mod.exports.nf_net_set_neuron_param(this.h(), i, param, value));
  }

  setPopulationParam(region: number, cls: NeuronClassFilter, param: number, value: number): number {
    return nanCheck(
      this.mod,
      this.mod.exports.nf_net_set_population_param(this.h(), region, CLASS_INDEX[cls], param, value),
    );
  }

  populationMean(region: number, cls: NeuronClassFilter, param: number): number {
    return this.mod.exports.nf_net_population_mean(this.h(), region, CLASS_INDEX[cls], param);
  }

  setRegionEnabled(region: number, enabled: boolean): boolean {
    const r = this.mod.exports.nf_net_set_region_enabled(this.h(), region, enabled ? 1 : 0);
    if (r < 0) throw this.mod.error();
    return r === 1;
  }

  setProjectionGain(p: number, gain: number): number {
    return nanCheck(this.mod, this.mod.exports.nf_net_set_projection_gain(this.h(), p, gain));
  }

  setSynapseWeight(s: number, magnitude: number): number {
    return nanCheck(this.mod, this.mod.exports.nf_net_set_synapse_weight(this.h(), s, magnitude));
  }

  setMembrane(i: number, v: number): number {
    return nanCheck(this.mod, this.mod.exports.nf_net_set_membrane(this.h(), i, v));
  }

  setPlasticity(enabled: boolean, rateScale: number): void {
    if (this.mod.exports.nf_net_set_plasticity(this.h(), enabled ? 1 : 0, rateScale) < 0) throw this.mod.error();
  }

  injectReward(amount: number): void {
    this.mod.exports.nf_net_inject_reward(this.h(), amount);
  }

  /** Adds a stimulus; returns its id and the neurons it targets. */
  addStimulus(spec: object): { id: number; targets: Uint32Array } {
    const id = this.mod.withString(JSON.stringify(spec), (p, l) => this.mod.exports.nf_net_add_stimulus(this.h(), p, l));
    if (id < 0) throw this.mod.error();
    const bytes = this.mod.resultBytes();
    return { id, targets: new Uint32Array(bytes.buffer, 0, bytes.byteLength / 4) };
  }

  cancelStimulus(id: number): boolean {
    return this.mod.exports.nf_net_cancel_stimulus(this.h(), id) === 1;
  }

  clearStimuli(): void {
    this.mod.exports.nf_net_clear_stimuli(this.h());
  }

  reset(weights: boolean): void {
    this.mod.exports.nf_net_reset(this.h(), weights ? 1 : 0);
  }

  snapshot(): Uint8Array {
    this.mod.exports.nf_net_snapshot(this.h());
    const out = this.mod.resultBytes();
    this.mod.exports.nf_result_clear();
    return out;
  }

  restore(data: Uint8Array): void {
    const r = this.mod.withBytes(data, (p, l) => this.mod.exports.nf_net_restore(this.h(), p, l));
    if (r < 0) throw this.mod.error();
  }
}

function decodeRecords(bytes: Uint8Array, withPre: boolean): SynapseRecord[] {
  const words = SYNAPSE_RECORD_WORDS + (withPre ? 1 : 0);
  const u = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const f = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const out: SynapseRecord[] = [];
  for (let k = 0; k + words <= u.length; k += words) {
    const w0 = f[k + 5];
    const e = f[k + 6];
    const flags = u[k + 8];
    const rec: SynapseRecord = {
      id: u[k],
      other: u[k + 1],
      weight: f[k + 2],
      delayMs: f[k + 3],
      projection: u[k + 4],
      initialWeight: Number.isNaN(w0) ? null : w0,
      eligibility: Number.isNaN(e) ? null : e,
      effective: f[k + 7],
      plastic: (flags & 1) !== 0,
      reward: (flags & 2) !== 0,
      inhibitory: (flags & 4) !== 0,
    };
    if (withPre) {
      rec.pre = u[k + 9];
      rec.post = u[k + 1];
    }
    out.push(rec);
  }
  return out;
}
