/**
 * Types of the documents the engine returns. They mirror the `Serialize` structs in
 * `engine/core/src/{telemetry,analysis}.rs` and `engine/wasm/src/lib.rs`.
 */

export interface RegionInfo {
  id: string;
  name: string;
  start: number;
  excEnd: number;
  end: number;
  center: [number, number, number];
  radius: [number, number, number];
}

export interface ProjectionInfo {
  id: string;
  from: number;
  to: number;
  source: 'excitatory' | 'inhibitory';
  plastic: boolean;
  rule: 'stdp' | 'reward';
  synapses: number;
  gain: number;
}

export interface NetInfo {
  neurons: number;
  synapses: number;
  dt: number;
  seed: number;
  ringSlots: number;
  topologyHash: string;
  memoryBytes: number;
  tauExcMs: number;
  tauInhMs: number;
  regions: RegionInfo[];
  projections: ProjectionInfo[];
  plastic: boolean;
  reward: boolean;
}

export interface Validation {
  totals: {
    neurons: number;
    expectedSynapses: number;
    expectedPlasticSynapses: number;
    maxDelaySteps: number;
  };
  memoryBytes: number;
}

export interface RegionReport {
  spikesExc: number;
  spikesInh: number;
  vMean: number;
  active: number;
  synchrony: number;
  enabled: boolean;
}

export interface StimulusReport {
  id: number;
  label: string;
  targets: number;
  on: boolean;
  startMs: number;
  endMs: number;
  events: number;
}

export interface TelemetryReport {
  step: number;
  timeMs: number;
  windowSteps: number;
  windowMs: number;
  regions: RegionReport[];
  projectionEvents: number[];
  eventsScheduled: number;
  eventsDelivered: number;
  pendingEvents: number;
  activeNeurons: number;
  activeExc: number;
  activeInh: number;
  /** Synapses whose presynaptic neuron fired in the window (each carried ≥ 1 event). */
  activeSynapses: number;
  firingLastStep: number;
  vMean: number;
  synchrony: number;
  groupSynchrony: number;
  plasticity: {
    enabled: boolean;
    rateScale: number;
    potentiation: number;
    depression: number;
    updates: number;
    modulator: number;
    modulatedChange: number;
  };
  profileMs: {
    stimulus: number;
    integrate: number;
    plasticity: number;
    propagate: number;
    record: number;
  };
  stimuli: StimulusReport[];
  frameDropped: number;
  rasterDropped: number;
  probeDropped: number;
}

export interface NeuronDetail {
  id: number;
  region: number;
  class: 'excitatory' | 'inhibitory';
  position: [number, number, number];
  v: number;
  vRest: number;
  vThreshold: number;
  vReset: number;
  tauMs: number;
  refractoryMs: number;
  refractoryLeftMs: number;
  resistance: number;
  excitability: number;
  bias: number;
  externalInput: number;
  stimulusInput: number;
  noiseStd: number;
  iExc: number;
  iInh: number;
  spikeCount: number;
  lastSpikeMs: number | null;
  inCount: number;
  outCount: number;
  inWeightMean: number;
  outWeightMean: number;
  tracePre: number;
  tracePost: number;
  regionEnabled: boolean;
}

export interface SynapseRecord {
  id: number;
  /** The other neuron: target for outgoing lists, source for incoming lists. */
  other: number;
  /** Present for records fetched by id. */
  pre?: number;
  post?: number;
  weight: number;
  delayMs: number;
  projection: number;
  initialWeight: number | null;
  eligibility: number | null;
  effective: number;
  plastic: boolean;
  reward: boolean;
  inhibitory: boolean;
}

export interface WeightHistogram {
  min: number;
  max: number;
  excitatory: number[];
  inhibitory: number[];
  counted: number;
  total: number;
  sampled: boolean;
  meanExcitatory: number;
  meanInhibitory: number;
}

export interface ProjectionStats {
  synapses: number;
  meanWeight: number;
  meanEffective: number;
  minWeight: number;
  maxWeight: number;
  meanInitial: number | null;
  meanDelayMs: number;
}

export interface WeightChange {
  synapse: number;
  pre: number;
  post: number;
  initial: number;
  weight: number;
  delta: number;
}

export interface CommunitySummary {
  count: number;
  modularity: number;
  sizes: number[];
  iterations: number;
}

/** Array identifiers of `nf_net_array_ptr` (engine/wasm/src/lib.rs). */
export const ArrayId = {
  positions: 0,
  regionOf: 1,
  classOf: 2,
  membrane: 3,
  spikeCount: 4,
  lastSpike: 5,
  rowPtr: 6,
  target: 7,
  weight: 8,
  delay: 9,
  synapseProjection: 10,
  inPtr: 11,
  inSynapse: 12,
  inSource: 13,
  frameSpikes: 14,
  raster: 15,
  probeSamples: 16,
  sample: 17,
  threshold: 18,
  excitability: 19,
  probes: 20,
  vReset: 21,
  vRest: 22,
} as const;
export type ArrayName = keyof typeof ArrayId;

/** Probe sample layout per probe per step (engine `PROBE_STRIDE`). */
export const PROBE_STRIDE = 3;
export const PROBE_FLAG_SPIKE = 1;
export const PROBE_FLAG_REFRACTORY = 2;
export const SYNAPSE_RECORD_WORDS = 9;
