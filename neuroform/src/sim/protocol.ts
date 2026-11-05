/**
 * Messages between the application (main thread) and the simulation worker.
 *
 * Requests carry an `id` and receive exactly one `reply`. Events (`progress`,
 * `telemetry`, `frame`, `status`, `fatal`) are pushed by the worker. Large arrays
 * travel as transferable buffers (moved, not copied).
 */

import type { BrainConfig } from '../config/schema.ts';
import type {
  CommunitySummary,
  NetInfo,
  NeuronDetail,
  ProjectionStats,
  SynapseRecord,
  TelemetryReport,
  Validation,
  WeightChange,
  WeightHistogram,
} from '../engine/types.ts';
import type { NeuronClassFilter } from '../engine/wasmEngine.ts';
import type { VisionTrialResult } from '../vision/trainer.ts';

export type SimStatus = 'booting' | 'empty' | 'building' | 'paused' | 'running' | 'error';

/** Stimulus specification (engine `StimulusSpec`). */
export interface StimulusSpec {
  label?: string;
  target:
    | { kind: 'neurons'; ids: number[] }
    | { kind: 'regions'; regions: number[]; class?: NeuronClassFilter; fraction?: number }
    | { kind: 'sphere'; center: [number, number, number]; radius: number; class?: NeuronClassFilter };
  amplitude: number;
  pattern: 'constant' | 'pulses' | 'poisson';
  frequencyHz?: number;
  pulseMs?: number;
  rateHz?: number;
  startMs?: number;
  durationMs: number;
  repetitions?: number;
  intervalMs?: number;
}

export interface BuiltNetwork {
  info: NetInfo;
  validation: Validation;
  buildMs: number;
  positions: Float32Array;
  regionOf: Uint16Array;
  classOf: Uint8Array;
  /** Raster/synchrony sample rows → neuron id. */
  sample: Uint32Array;
}

/** Synapses chosen for display: [synapse, pre, post] triplets plus attributes. */
export interface SynapseSample {
  ids: Uint32Array;
  pre: Uint32Array;
  post: Uint32Array;
  weight: Float32Array;
  delayMs: Float32Array;
  projection: Uint8Array;
}

export interface LocalGraph {
  center: number;
  /** Edges as synapse / pre / post triplets, with weights and hop (1 or 2). */
  synapses: Uint32Array;
  pre: Uint32Array;
  post: Uint32Array;
  weight: Float32Array;
  delayMs: Float32Array;
  hop: Uint8Array;
  truncated: boolean;
}

export interface DegreeStats {
  /** Per region: histogram of in- and out-degree, and means. */
  regions: { inMean: number; outMean: number; inHist: number[]; outHist: number[]; maxDegree: number }[];
  bins: number;
}

export interface NeuronTable {
  regionOf: Uint16Array;
  classOf: Uint8Array;
  positions: Float32Array;
  spikeCount: Uint32Array;
  threshold: Float32Array;
  excitability: Float32Array;
  membrane: Float32Array;
  inDegree: Uint32Array;
  outDegree: Uint32Array;
  timeMs: number;
}

export interface SynapseTable {
  rowPtr: Uint32Array;
  target: Uint32Array;
  weight: Float32Array;
  delay: Uint8Array;
  projection: Uint8Array;
  dt: number;
}

export interface WorkerPerf {
  /** Simulated steps per wall-clock second over the last window. */
  stepsPerSecond: number;
  /** Simulated time per wall-clock time (1 = real time). */
  realtimeFactor: number;
  /** Fraction of wall time the worker spent computing. */
  busyFraction: number;
  /** Wall milliseconds per simulated step (moving average). */
  msPerStep: number;
  targetSpeed: number;
  /** True when the requested speed could not be sustained. */
  lagging: boolean;
  wasmBytes: number;
  chunkSteps: number;
}

export interface ProbeBlock {
  ids: number[];
  /** First step of the block. */
  startStep: number;
  /** Interleaved [V, I_syn, flags] per probe per step. */
  samples: Float32Array;
}

export interface TelemetryEvent {
  type: 'telemetry';
  report: TelemetryReport;
  perf: WorkerPerf;
  /** (step, row) pairs for sampled rows. */
  raster: Uint32Array;
  probes: ProbeBlock | null;
  tracked: { ids: number[]; weights: Float32Array } | null;
  recording: { active: boolean; spikes: number; durationMs: number } | null;
}

export interface FrameEvent {
  type: 'frame';
  step: number;
  timeMs: number;
  /** (step, neuron) pairs for every spike since the previous frame. */
  spikes: Uint32Array;
  dropped: number;
  /** Membrane potential normalised to (V − V_reset)/(V_th − V_reset) when requested. */
  membrane: Float32Array | null;
  /** Spikes per neuron since the previous rate sample, and that window in ms. */
  rates: { counts: Float32Array; windowMs: number } | null;
}

export type WorkerEvent =
  | { type: 'reply'; id: number; ok: true; value: unknown }
  | { type: 'reply'; id: number; ok: false; error: string; path?: string }
  | { type: 'status'; status: SimStatus; detail?: string }
  | { type: 'progress'; phase: 'engine' | 'validate' | 'build' | 'index'; progress: number; detail: string }
  | { type: 'fatal'; error: string }
  | { type: 'benchmark'; result: BenchmarkResult }
  | TelemetryEvent
  | FrameEvent;

export interface BenchmarkResult {
  neurons: number;
  synapses: number;
  buildMs: number;
  msPerSimSecond: number;
  realtimeFactor: number;
  eventsPerSecond: number;
  spikesPerSecond: number;
  memoryBytes: number;
  meanRateHz: number;
}

/** Request payloads by type, and what each replies with. */
export interface Requests {
  init: { req: { wasmUrl: string }; res: { engineVersion: number; crossOriginIsolated: boolean } };
  validate: { req: { config: BrainConfig }; res: Validation };
  build: { req: { config: BrainConfig }; res: BuiltNetwork };
  run: { req: Record<string, never>; res: void };
  pause: { req: Record<string, never>; res: { step: number; timeMs: number } };
  step: { req: { steps: number; quiet?: boolean }; res: { step: number; timeMs: number } };
  /** Reads (and restarts) the telemetry window: an exact measurement interval. */
  measure: { req: Record<string, never>; res: TelemetryReport };
  setSpeed: { req: { speed: number }; res: void };
  reset: { req: { weights: boolean }; res: void };
  stimulate: { req: { spec: StimulusSpec }; res: { id: number; targets: Uint32Array } };
  cancelStimulus: { req: { id: number }; res: boolean };
  clearStimuli: { req: Record<string, never>; res: void };
  setNeuronParam: { req: { neuron: number; param: number; value: number }; res: number };
  setPopulationParam: { req: { region: number; cls: NeuronClassFilter; param: number; value: number }; res: number };
  populationMean: { req: { region: number; cls: NeuronClassFilter; param: number }; res: number };
  setRegionEnabled: { req: { region: number; enabled: boolean }; res: boolean };
  setProjectionGain: { req: { projection: number; gain: number }; res: number };
  setSynapseWeight: { req: { synapse: number; weight: number }; res: number };
  setMembrane: { req: { neuron: number; value: number }; res: number };
  setPlasticity: { req: { enabled: boolean; rateScale: number }; res: void };
  reward: { req: { amount: number }; res: void };
  setProbes: { req: { ids: number[] }; res: void };
  setSyncGroup: { req: { regions: number[] }; res: void };
  setTracked: { req: { ids: number[] }; res: void };
  setTelemetryHz: { req: { hz: number }; res: void };
  setProfiling: { req: { on: boolean }; res: void };
  neuron: { req: { neuron: number }; res: NeuronDetail };
  synapses: { req: { neuron: number; incoming: boolean; offset: number; limit: number }; res: { total: number; records: SynapseRecord[] } };
  synapsesById: { req: { ids: number[] }; res: SynapseRecord[] };
  histogram: { req: { projection: number; bins: number }; res: WeightHistogram };
  projectionStats: { req: Record<string, never>; res: ProjectionStats[] };
  topChanges: { req: { k: number }; res: WeightChange[] };
  communities: { req: { iterations: number }; res: { summary: CommunitySummary; labels: Uint32Array } };
  sampleSynapses: { req: { budget: number; seed: number }; res: SynapseSample };
  localGraph: { req: { neuron: number; hops: 1 | 2; cap: number }; res: LocalGraph };
  weightsOf: { req: { ids: Uint32Array }; res: Float32Array };
  nearSynapses: { req: { center: [number, number, number]; radius: number; cap: number }; res: SynapseSample & { neurons: number } };
  neuronsInSphere: { req: { center: [number, number, number]; radius: number; cap: number }; res: Uint32Array };
  degrees: { req: { bins: number }; res: DegreeStats };
  neuronTable: { req: Record<string, never>; res: NeuronTable };
  synapseTable: { req: Record<string, never>; res: SynapseTable };
  snapshot: { req: Record<string, never>; res: { bytes: Uint8Array; step: number; timeMs: number } };
  restore: { req: { bytes: Uint8Array }; res: { step: number; timeMs: number } };
  recordStart: { req: { maxSpikes: number; channel?: 'user' | 'experiment' }; res: void };
  recordStop: { req: { channel?: 'user' | 'experiment' }; res: { bytes: Uint8Array; spikes: number; durationMs: number } | null };
  benchmark: { req: { sizes: number[]; seconds: number }; res: BenchmarkResult[] };
  /** Prepares image training on the current (Vision Lab) network; idempotent. */
  visionSetup: { req: Record<string, never>; res: { classes: string[]; retinaNeurons: number; trained: number; expected: number } };
  /** One image trial: show it, read the answer, and (with `learn`) reward or punish. */
  visionTrial: { req: { features: Float32Array; label: number | null; learn: boolean }; res: VisionTrialResult & { trained: number; expected: number } };
}

export type RequestType = keyof Requests;
export type RequestMessage<K extends RequestType = RequestType> = { id: number; type: K } & Requests[K]['req'];

/** Main → worker messages that are not requests (no reply). */
export type FrameRequest = {
  type: 'frame';
  membrane: boolean;
  rates: boolean;
  recycle: ArrayBuffer[];
};

export const SPEEDS = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, Infinity] as const;
