/**
 * Brain configuration schema (format `neuroform.config`, version 1).
 *
 * A configuration *recreates* a network: identical configuration and seed always
 * build identical neurons, positions and synapses. The engine
 * (`engine/core/src/config.rs`) is the authority on validity; `validate.ts` mirrors
 * its rules so the interface can explain problems before building.
 *
 * Fields marked "presentation" are ignored by the engine.
 */

export type NeuronClass = 'excitatory' | 'inhibitory';
export type TargetFilter = 'all' | 'excitatory' | 'inhibitory';
export type Topology = 'random' | 'local' | 'topographic';
export type PlasticityRule = 'stdp' | 'reward';

/** Leaky integrate-and-fire parameters: dV/dt = (V_rest − V)/τ + R·ε·I. */
export interface NeuronParams {
  vRest: number;
  vThreshold: number;
  vReset: number;
  tauMs: number;
  refractoryMs: number;
  /** Membrane resistance R_m (mV per ms per current unit). */
  resistance: number;
  /** Constant background current. */
  bias: number;
  /** White-noise background current intensity (current units·√ms). */
  noiseStd: number;
}

export interface ShapeConfig {
  center: [number, number, number];
  radius: [number, number, number];
  /** Inner radius as a fraction of the outer one: 0 solid, towards 1 a thin shell. */
  shell?: number;
  /** Smooth organic displacement, fraction of the radius. */
  warp?: number;
  /** Density variation, 0 uniform .. 1 clustered. */
  clumping?: number;
}

export interface RegionConfig {
  id: string;
  name: string;
  /** Presentation: hex colour used for the region's identity cues. */
  color?: string;
  /** Presentation: one-line description of the region's role. */
  role?: string;
  count: number;
  excitatoryFraction: number;
  shape: ShapeConfig;
  excitatory: NeuronParams;
  inhibitory: NeuronParams;
  /** Per-neuron jitter of threshold and excitability, 0..1. */
  heterogeneity: number;
}

export interface ProjectionPlasticity {
  enabled: boolean;
  rule?: PlasticityRule;
  aPlus?: number;
  aMinus?: number;
  wMin?: number;
  wMax?: number;
}

export interface ProjectionConfig {
  id?: string;
  from: string;
  source: NeuronClass;
  to: string;
  target?: TargetFilter;
  /** Probability that a given source neuron contacts a given target neuron. */
  probability: number;
  /** Weight magnitude; the sign follows the source class. */
  weight: { mean: number; std: number };
  delayMs: { min: number; max: number };
  topology?: Topology;
  /** σ of local/topographic targeting as a fraction of the target radius. */
  spread?: number;
  allowAutapses?: boolean;
  plasticity?: ProjectionPlasticity;
}

export interface PlasticityConfig {
  enabled: boolean;
  tauPlusMs: number;
  tauMinusMs: number;
  aPlus: number;
  aMinus: number;
  wMin: number;
  wMax: number;
  eligibilityTauMs: number;
  modulatorTauMs: number;
  rewardRate: number;
  modulatorRegion?: string | null;
  modulatorPerSpike: number;
}

export interface BrainConfig {
  name: string;
  /** Presentation: longer description. */
  description?: string;
  /** Presentation: preset this configuration was generated from. */
  preset?: string;
  seed: number;
  timestepMs: number;
  synapse: { tauExcMs: number; tauInhMs: number };
  plasticity: PlasticityConfig;
  regions: RegionConfig[];
  projections: ProjectionConfig[];
}

export const CONFIG_FORMAT = 'neuroform.config';
export const CONFIG_VERSION = 1;

/** File envelope for exported configurations. */
export interface ConfigFile {
  format: typeof CONFIG_FORMAT;
  version: number;
  exportedAt: string;
  config: BrainConfig;
}

/** Engine hard limits (mirror `engine/core/src/config.rs`). */
export const LIMITS = {
  maxNeurons: 500_000,
  maxSynapses: 40_000_000,
  maxRegions: 32,
  maxProjections: 250,
  maxExpectedFanOut: 5_000,
  maxDelaySteps: 255,
  minTimestepMs: 0.05,
  maxTimestepMs: 1.0,
} as const;

export const NEURON_PARAM_KEYS = [
  'vRest',
  'vThreshold',
  'vReset',
  'tauMs',
  'refractoryMs',
  'resistance',
  'excitability',
  'bias',
  'externalInput',
  'noiseStd',
] as const;
export type NeuronParamKey = (typeof NEURON_PARAM_KEYS)[number];

/** Index of each run-time neuron parameter in the engine ABI. */
export function neuronParamIndex(key: NeuronParamKey): number {
  return NEURON_PARAM_KEYS.indexOf(key);
}

export const NEURON_PARAM_META: Record<
  NeuronParamKey,
  { label: string; unit: string; min: number; max: number; step: number; describe: string }
> = {
  vRest: { label: 'Resting potential', unit: 'mV', min: -200, max: 100, step: 0.5, describe: 'V_rest: the potential the membrane leaks towards.' },
  vThreshold: { label: 'Firing threshold', unit: 'mV', min: -200, max: 100, step: 0.5, describe: 'A spike is emitted when V reaches this value.' },
  vReset: { label: 'Reset potential', unit: 'mV', min: -200, max: 100, step: 0.5, describe: 'V is set here after a spike, for the refractory period.' },
  tauMs: { label: 'Membrane τ', unit: 'ms', min: 0.5, max: 1000, step: 0.5, describe: 'Membrane time constant τ_m.' },
  refractoryMs: { label: 'Refractory period', unit: 'ms', min: 0, max: 100, step: 0.1, describe: 'Time held at reset after a spike.' },
  resistance: { label: 'Membrane resistance', unit: 'R_m', min: 0, max: 100, step: 0.05, describe: 'Scales how strongly current moves the membrane.' },
  excitability: { label: 'Excitability', unit: '×', min: 0, max: 10, step: 0.05, describe: 'Individual gain ε on all input current.' },
  bias: { label: 'Background current', unit: 'I', min: -100, max: 100, step: 0.05, describe: 'Constant input current.' },
  externalInput: { label: 'External input', unit: 'I', min: -100, max: 100, step: 0.05, describe: 'User-applied constant current.' },
  noiseStd: { label: 'Noise intensity', unit: 'σ', min: 0, max: 100, step: 0.05, describe: 'White-noise background current σ.' },
};
