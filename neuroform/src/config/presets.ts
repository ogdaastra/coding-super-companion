/**
 * Preset brains. Each preset is a genuine simulation configuration generated for a
 * chosen size: a function of (neurons, seed) that returns a `BrainConfig`.
 *
 * Connectivity is specified by expected *in-degree* (inputs each target neuron
 * receives from a source population) and converted to the per-pair connection
 * probability the engine uses. Holding in-degree fixed as the network grows keeps
 * the dynamics comparable across sizes while synapse count scales linearly.
 */

import type {
  BrainConfig,
  NeuronClass,
  NeuronParams,
  PlasticityConfig,
  ProjectionConfig,
  ProjectionPlasticity,
  RegionConfig,
  ShapeConfig,
  TargetFilter,
  Topology,
} from './schema.ts';

export interface Tier {
  id: string;
  label: string;
  neurons: number;
  note: string;
}

/** Engineering tiers from the specification; measured costs are in docs/PERFORMANCE.md. */
export const TIERS: readonly Tier[] = [
  { id: 'micro', label: 'Micro', neurons: 2_000, note: 'Any modern device' },
  { id: 'small', label: 'Small', neurons: 5_000, note: 'Laptops, tablets' },
  { id: 'medium', label: 'Medium', neurons: 10_000, note: 'Recommended default' },
  { id: 'large', label: 'Large', neurons: 25_000, note: 'Desktop-class CPU' },
  { id: 'experimental', label: 'Experimental', neurons: 50_000, note: 'Below real time on most machines' },
  { id: 'extreme', label: 'Extreme', neurons: 100_000, note: 'Hardware-dependent; slow' },
];

export const EXC: NeuronParams = {
  vRest: -65,
  vThreshold: -50,
  vReset: -65,
  tauMs: 20,
  refractoryMs: 2,
  resistance: 1,
  bias: 0.55,
  noiseStd: 1.0,
};

export const INH: NeuronParams = {
  vRest: -65,
  vThreshold: -50,
  vReset: -65,
  tauMs: 10,
  refractoryMs: 1,
  resistance: 1,
  bias: 0.9,
  noiseStd: 1.4,
};

export const DEFAULT_PLASTICITY: PlasticityConfig = {
  enabled: false,
  tauPlusMs: 20,
  tauMinusMs: 20,
  aPlus: 0.01,
  aMinus: 0.0105,
  wMin: 0,
  wMax: 1.5,
  eligibilityTauMs: 1000,
  modulatorTauMs: 200,
  rewardRate: 2,
  modulatorRegion: null,
  modulatorPerSpike: 0,
};

interface RegionSpec {
  id: string;
  name: string;
  color: string;
  role: string;
  share: number;
  excitatoryFraction?: number;
  shape: ShapeConfig;
  exc?: Partial<NeuronParams>;
  inh?: Partial<NeuronParams>;
  heterogeneity?: number;
}

function regions(total: number, specs: RegionSpec[]): RegionConfig[] {
  const sum = specs.reduce((a, s) => a + s.share, 0);
  const out = specs.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    role: s.role,
    count: Math.max(8, Math.round((total * s.share) / sum)),
    excitatoryFraction: s.excitatoryFraction ?? 0.8,
    shape: s.shape,
    excitatory: { ...EXC, ...s.exc },
    inhibitory: { ...INH, ...s.inh },
    heterogeneity: s.heterogeneity ?? 0.35,
  }));
  // Put any rounding difference on the largest region so the total is exact.
  const diff = total - out.reduce((a, r) => a + r.count, 0);
  const largest = out.reduce((a, r) => (r.count > a.count ? r : a), out[0]);
  largest.count = Math.max(8, largest.count + diff);
  return out;
}

function classCount(r: RegionConfig, c: NeuronClass): number {
  const e = Math.round(r.count * r.excitatoryFraction);
  return c === 'excitatory' ? e : r.count - e;
}

interface ProjSpec {
  from: string;
  source: NeuronClass;
  to: string;
  target?: TargetFilter;
  /** Expected inputs per target neuron from this source population. */
  inDegree: number;
  weight: number;
  weightStd?: number;
  delay: [number, number];
  topology?: Topology;
  spread?: number;
  plasticity?: ProjectionPlasticity;
}

function projections(rs: RegionConfig[], specs: ProjSpec[]): ProjectionConfig[] {
  const byId = new Map(rs.map((r) => [r.id, r]));
  return specs.map((s, i) => {
    const src = byId.get(s.from)!;
    const n = classCount(src, s.source);
    const probability = Math.min(1, n > 0 ? s.inDegree / n : 0);
    const p: ProjectionConfig = {
      id: `${s.from}.${s.source[0]}>${s.to}${s.target && s.target !== 'all' ? '.' + s.target[0] : ''}#${i}`,
      from: s.from,
      source: s.source,
      to: s.to,
      target: s.target ?? 'all',
      probability: Number(probability.toPrecision(6)),
      weight: { mean: s.weight, std: s.weightStd ?? s.weight * 0.25 },
      delayMs: { min: s.delay[0], max: s.delay[1] },
      topology: s.topology ?? 'random',
      spread: s.spread ?? 0.25,
    };
    if (s.plasticity) p.plasticity = s.plasticity;
    return p;
  });
}

/** Local excitatory + inhibitory recurrence for one region. */
function recurrent(id: string, kE: number, kI: number, wE: number, wI: number, spread = 0.3, plastic?: ProjectionPlasticity): ProjSpec[] {
  return [
    { from: id, source: 'excitatory', to: id, inDegree: kE, weight: wE, delay: [1, 4], topology: 'local', spread, plasticity: plastic },
    { from: id, source: 'inhibitory', to: id, inDegree: kI, weight: wI, delay: [0.5, 2], topology: 'local', spread: spread * 0.8 },
  ];
}

const STDP: ProjectionPlasticity = { enabled: true, rule: 'stdp' };
const REWARD: ProjectionPlasticity = { enabled: true, rule: 'reward' };

function base(name: string, preset: string, description: string, seed: number): Omit<BrainConfig, 'regions' | 'projections'> {
  return {
    name,
    preset,
    description,
    seed,
    timestepMs: 0.5,
    synapse: { tauExcMs: 5, tauInhMs: 10 },
    plasticity: { ...DEFAULT_PLASTICITY },
  };
}

// ---------------------------------------------------------------------- presets

/** The six-region artificial brain shown on first launch. */
export function observatory(neurons: number, seed = 1): BrainConfig {
  const rs = regions(neurons, [
    {
      id: 'visual', name: 'Visual Input', color: '#4fd8ff', share: 12,
      role: 'Receives stimulation and relays it topographically to sensory processing.',
      shape: { center: [0, 18, -98], radius: [62, 38, 14], shell: 0, warp: 0.35, clumping: 0.35 },
      exc: { bias: 0.35, noiseStd: 0.9 }, excitatoryFraction: 0.85,
    },
    {
      id: 'sensory', name: 'Sensory Processing', color: '#5b8cff', share: 16,
      role: 'Transforms input and feeds association and memory networks.',
      shape: { center: [0, 34, -58], radius: [74, 34, 26], shell: 0.45, warp: 0.4, clumping: 0.4 },
    },
    {
      id: 'association', name: 'Association Cortex', color: '#8f7dff', share: 34,
      role: 'Large recurrent mantle integrating sensory, memory and reward signals.',
      shape: { center: [0, 40, 12], radius: [104, 46, 62], shell: 0.78, warp: 0.45, clumping: 0.5 },
    },
    {
      id: 'memory', name: 'Memory Network', color: '#c77dff', share: 18,
      role: 'Recurrent, plastic network inspired by memory circuits (not a model of one).',
      shape: { center: [0, -6, -4], radius: [70, 15, 26], shell: 0.35, warp: 0.7, clumping: 0.35 },
      exc: { bias: 0.5 },
    },
    {
      id: 'motor', name: 'Motor Output', color: '#3ee6c1', share: 12,
      role: 'Read-out population driven by association cortex.',
      shape: { center: [0, 30, 86], radius: [56, 24, 18], shell: 0.15, warp: 0.35, clumping: 0.3 },
      exc: { bias: 0.45 },
    },
    {
      id: 'reward', name: 'Reward & Modulation', color: '#ffb547', share: 8,
      role: 'Deep nucleus whose spikes release the global neuromodulator.',
      excitatoryFraction: 0.75,
      shape: { center: [0, -40, 30], radius: [24, 16, 20], shell: 0, warp: 0.3, clumping: 0.55 },
      exc: { bias: 0.45 },
    },
  ]);
  const p = projections(rs, [
    ...recurrent('visual', 18, 8, 0.45, 1.6, 0.22),
    ...recurrent('sensory', 30, 10, 0.4, 1.6, 0.25),
    ...recurrent('association', 40, 12, 0.35, 1.6, 0.25),
    ...recurrent('memory', 45, 12, 0.38, 1.7, 0.3, STDP),
    ...recurrent('motor', 25, 10, 0.4, 1.6, 0.3),
    ...recurrent('reward', 20, 8, 0.4, 1.6, 0.35),
    { from: 'visual', source: 'excitatory', to: 'sensory', inDegree: 22, weight: 0.5, delay: [3, 6], topology: 'topographic', spread: 0.2 },
    { from: 'sensory', source: 'excitatory', to: 'association', inDegree: 12, weight: 0.45, delay: [4, 8], topology: 'topographic', spread: 0.3, plasticity: STDP },
    { from: 'sensory', source: 'excitatory', to: 'memory', inDegree: 6, weight: 0.4, delay: [4, 9] },
    { from: 'association', source: 'excitatory', to: 'memory', inDegree: 10, weight: 0.4, delay: [4, 10], plasticity: STDP },
    { from: 'memory', source: 'excitatory', to: 'association', inDegree: 8, weight: 0.4, delay: [4, 10] },
    { from: 'association', source: 'excitatory', to: 'motor', inDegree: 14, weight: 0.45, delay: [3, 7], topology: 'topographic', spread: 0.35, plasticity: REWARD },
    { from: 'association', source: 'excitatory', to: 'sensory', inDegree: 5, weight: 0.3, delay: [5, 10] },
    { from: 'motor', source: 'excitatory', to: 'reward', inDegree: 8, weight: 0.45, delay: [3, 6] },
    { from: 'reward', source: 'excitatory', to: 'association', inDegree: 4, weight: 0.4, delay: [5, 12] },
    { from: 'reward', source: 'excitatory', to: 'memory', inDegree: 4, weight: 0.4, delay: [5, 12] },
  ]);
  return {
    ...base('Neural Observatory', 'observatory', 'Six functional regions forming one artificial nervous system.', seed),
    plasticity: { ...DEFAULT_PLASTICITY, modulatorRegion: 'reward', modulatorPerSpike: 0.002 },
    regions: rs,
    projections: p,
  };
}

/** A few hundred neurons for inspecting individual cells and synapses. */
export function microscopic(neurons: number, seed = 1): BrainConfig {
  const n = Math.min(neurons, 800);
  const rs = regions(n, [
    {
      id: 'column', name: 'Microcolumn', color: '#4fd8ff', share: 3,
      role: 'Small recurrent excitatory–inhibitory circuit.',
      shape: { center: [0, 0, 0], radius: [26, 34, 26], warp: 0.2, clumping: 0.2 },
    },
    {
      id: 'target', name: 'Target Cluster', color: '#c77dff', share: 1,
      role: 'Receives a sparse feed-forward projection from the column.',
      shape: { center: [52, 6, 0], radius: [14, 18, 14], warp: 0.2 },
      exc: { bias: 0.4 },
    },
  ]);
  const p = projections(rs, [
    ...recurrent('column', 20, 8, 0.5, 1.8, 0.45, STDP),
    ...recurrent('target', 10, 5, 0.5, 1.6, 0.5),
    { from: 'column', source: 'excitatory', to: 'target', inDegree: 12, weight: 0.6, delay: [2, 6], plasticity: STDP },
  ]);
  return { ...base('Microscopic', 'microscopic', 'A small circuit where every neuron and synapse can be inspected.', seed), regions: rs, projections: p };
}

/** A layered cortical sheet with local connectivity (travelling waves). */
export function cortical(neurons: number, seed = 1): BrainConfig {
  const rs = regions(neurons, [
    {
      id: 'l23', name: 'Layer 2/3', color: '#8f7dff', share: 4,
      role: 'Superficial layer: dense local recurrence.',
      shape: { center: [0, 26, 0], radius: [110, 9, 110], warp: 0.25, clumping: 0.35 },
    },
    {
      id: 'l4', name: 'Layer 4', color: '#4fd8ff', share: 2,
      role: 'Input layer.',
      shape: { center: [0, 6, 0], radius: [110, 7, 110], warp: 0.25, clumping: 0.35 },
      exc: { bias: 0.45 },
    },
    {
      id: 'l5', name: 'Layer 5', color: '#3ee6c1', share: 3,
      role: 'Output layer.',
      shape: { center: [0, -16, 0], radius: [110, 10, 110], warp: 0.25, clumping: 0.35 },
    },
  ]);
  const p = projections(rs, [
    ...recurrent('l23', 50, 14, 0.36, 1.6, 0.12),
    ...recurrent('l4', 30, 10, 0.4, 1.6, 0.12),
    ...recurrent('l5', 40, 12, 0.36, 1.6, 0.12),
    { from: 'l4', source: 'excitatory', to: 'l23', inDegree: 18, weight: 0.45, delay: [1, 3], topology: 'topographic', spread: 0.08 },
    { from: 'l23', source: 'excitatory', to: 'l5', inDegree: 18, weight: 0.45, delay: [1, 3], topology: 'topographic', spread: 0.08 },
    { from: 'l5', source: 'excitatory', to: 'l4', inDegree: 6, weight: 0.3, delay: [2, 5], topology: 'topographic', spread: 0.12 },
  ]);
  return { ...base('Cortical Sheet', 'cortical', 'Three layers with local connectivity that supports travelling waves.', seed), regions: rs, projections: p };
}

/** Several modules with different internal and external densities. */
export function modular(neurons: number, seed = 1): BrainConfig {
  const k = 7;
  const colors = ['#4fd8ff', '#5b8cff', '#8f7dff', '#c77dff', '#3ee6c1', '#7fe0ff', '#a3a8ff'];
  const specs: RegionSpec[] = [];
  for (let i = 0; i < k; i++) {
    const a = (i / k) * Math.PI * 2;
    specs.push({
      id: `m${i + 1}`, name: `Module ${i + 1}`, color: colors[i], share: 1 + (i % 3) * 0.4,
      role: `Module with ${['sparse', 'medium', 'dense'][i % 3]} internal connectivity.`,
      shape: { center: [Math.cos(a) * 95, Math.sin(a * 2) * 18, Math.sin(a) * 95], radius: [26, 22, 26], warp: 0.3, clumping: 0.4 },
    });
  }
  const rs = regions(neurons, specs);
  const ps: ProjSpec[] = [];
  for (let i = 0; i < k; i++) {
    const id = `m${i + 1}`;
    ps.push(...recurrent(id, [25, 45, 70][i % 3], [8, 12, 18][i % 3], [0.42, 0.36, 0.3][i % 3], 1.6, 0.35));
    ps.push({ from: id, source: 'excitatory', to: `m${((i + 1) % k) + 1}`, inDegree: 6, weight: 0.45, delay: [4, 9] });
    ps.push({ from: id, source: 'excitatory', to: `m${((i + 3) % k) + 1}`, inDegree: 2, weight: 0.4, delay: [6, 14] });
  }
  return { ...base('Modular Network', 'modular', 'Seven modules with sparse, medium and dense internal wiring and weak links.', seed), regions: rs, projections: projections(rs, ps) };
}

/** Fewer neurons, many more synapses per neuron. */
export function highlyConnected(neurons: number, seed = 1): BrainConfig {
  const n = Math.max(1000, Math.round(neurons / 3));
  const rs = regions(n, [
    {
      id: 'core', name: 'Dense Core', color: '#8f7dff', share: 3,
      role: 'Random, high in-degree recurrent network.',
      shape: { center: [0, 0, 0], radius: [70, 60, 70], shell: 0.2, warp: 0.3, clumping: 0.3 },
      exc: { bias: 0.66, noiseStd: 1.2 },
    },
    {
      id: 'periphery', name: 'Periphery', color: '#4fd8ff', share: 1,
      role: 'Shell population exchanging dense projections with the core.',
      shape: { center: [0, 0, 0], radius: [120, 100, 120], shell: 0.85, warp: 0.25, clumping: 0.3 },
    },
  ]);
  const p = projections(rs, [
    { from: 'core', source: 'excitatory', to: 'core', inDegree: 260, weight: 0.075, delay: [1, 6] },
    { from: 'core', source: 'inhibitory', to: 'core', inDegree: 65, weight: 0.36, delay: [0.5, 2] },
    { from: 'periphery', source: 'excitatory', to: 'periphery', inDegree: 120, weight: 0.12, delay: [1, 5] },
    { from: 'periphery', source: 'inhibitory', to: 'periphery', inDegree: 30, weight: 0.55, delay: [0.5, 2] },
    { from: 'core', source: 'excitatory', to: 'periphery', inDegree: 60, weight: 0.08, delay: [3, 8] },
    { from: 'periphery', source: 'excitatory', to: 'core', inDegree: 40, weight: 0.08, delay: [3, 8] },
  ]);
  return { ...base('Highly Connected', 'highly-connected', 'Hundreds of synapses per neuron for connectivity experiments.', seed), regions: rs, projections: p };
}

/** Two populations, shared and independent drive, strong feedback inhibition. */
export function synchronisationLab(neurons: number, seed = 1): BrainConfig {
  const rs = regions(neurons, [
    {
      id: 'common', name: 'Common Drive', color: '#ffb547', share: 1,
      role: 'Shared input to both populations.',
      shape: { center: [0, 70, 0], radius: [30, 14, 30], warp: 0.2 },
      exc: { bias: 0.3, noiseStd: 0.8 }, excitatoryFraction: 1,
    },
    {
      id: 'popA', name: 'Population A', color: '#4fd8ff', share: 3,
      role: 'E/I network with fast feedback inhibition (oscillation-prone).',
      shape: { center: [-60, 0, 0], radius: [42, 42, 42], warp: 0.3, clumping: 0.3 },
      inh: { bias: 0.6 },
    },
    {
      id: 'popB', name: 'Population B', color: '#c77dff', share: 3,
      role: 'Second E/I network, identical in structure to A.',
      shape: { center: [60, 0, 0], radius: [42, 42, 42], warp: 0.3, clumping: 0.3 },
      inh: { bias: 0.6 },
    },
    {
      id: 'indA', name: 'Independent A', color: '#5b8cff', share: 0.5,
      role: 'Private input to A.', excitatoryFraction: 1,
      shape: { center: [-60, -70, 0], radius: [22, 10, 22] }, exc: { bias: 0.3, noiseStd: 0.8 },
    },
    {
      id: 'indB', name: 'Independent B', color: '#a3a8ff', share: 0.5,
      role: 'Private input to B.', excitatoryFraction: 1,
      shape: { center: [60, -70, 0], radius: [22, 10, 22] }, exc: { bias: 0.3, noiseStd: 0.8 },
    },
  ]);
  const p = projections(rs, [
    ...recurrent('popA', 40, 25, 0.4, 2.0, 0.6),
    ...recurrent('popB', 40, 25, 0.4, 2.0, 0.6),
    { from: 'common', source: 'excitatory', to: 'popA', inDegree: 15, weight: 0.5, delay: [2, 3] },
    { from: 'common', source: 'excitatory', to: 'popB', inDegree: 15, weight: 0.5, delay: [2, 3] },
    { from: 'indA', source: 'excitatory', to: 'popA', inDegree: 15, weight: 0.5, delay: [2, 3] },
    { from: 'indB', source: 'excitatory', to: 'popB', inDegree: 15, weight: 0.5, delay: [2, 3] },
    { from: 'popA', source: 'excitatory', to: 'popB', inDegree: 4, weight: 0.4, delay: [3, 6] },
    { from: 'popB', source: 'excitatory', to: 'popA', inDegree: 4, weight: 0.4, delay: [3, 6] },
  ]);
  return { ...base('Synchronisation Lab', 'sync-lab', 'Two E/I populations with shared and private inputs for synchrony experiments.', seed), regions: rs, projections: p };
}

/** Two input populations converging on a plastic association population. */
export function learningLab(neurons: number, seed = 1): BrainConfig {
  const n = Math.min(neurons, 12_000);
  const rs = regions(n, [
    {
      id: 'inputA', name: 'Input A', color: '#4fd8ff', share: 1, excitatoryFraction: 1,
      role: 'First stimulus population.', exc: { bias: 0.2, noiseStd: 0.7 },
      shape: { center: [-70, 40, -40], radius: [24, 18, 20], warp: 0.25 },
    },
    {
      id: 'inputB', name: 'Input B', color: '#5b8cff', share: 1, excitatoryFraction: 1,
      role: 'Second stimulus population.', exc: { bias: 0.2, noiseStd: 0.7 },
      shape: { center: [70, 40, -40], radius: [24, 18, 20], warp: 0.25 },
    },
    {
      id: 'assoc', name: 'Association', color: '#8f7dff', share: 4,
      role: 'Plastic recurrent population receiving both inputs.',
      shape: { center: [0, 0, 20], radius: [70, 34, 44], shell: 0.3, warp: 0.35, clumping: 0.35 },
      exc: { bias: 0.4 },
    },
    {
      id: 'output', name: 'Output', color: '#3ee6c1', share: 1,
      role: 'Read-out trained by reward-modulated STDP.', exc: { bias: 0.4 },
      shape: { center: [0, -10, 100], radius: [34, 18, 16], warp: 0.25 },
    },
    {
      id: 'reward', name: 'Reward', color: '#ffb547', share: 0.6, excitatoryFraction: 1,
      role: 'Its spikes release neuromodulator.', exc: { bias: 0.1, noiseStd: 0.5 },
      shape: { center: [0, -70, 40], radius: [20, 12, 16] },
    },
  ]);
  const plastic: ProjectionPlasticity = { enabled: true, rule: 'stdp', wMax: 1.6 };
  const p = projections(rs, [
    { from: 'inputA', source: 'excitatory', to: 'assoc', inDegree: 12, weight: 0.45, delay: [2, 5], plasticity: plastic },
    { from: 'inputB', source: 'excitatory', to: 'assoc', inDegree: 12, weight: 0.45, delay: [2, 5], plasticity: plastic },
    { from: 'inputA', source: 'excitatory', to: 'inputB', inDegree: 6, weight: 0.25, delay: [3, 6], plasticity: { enabled: true, rule: 'stdp', wMax: 1.8 } },
    { from: 'inputB', source: 'excitatory', to: 'inputA', inDegree: 6, weight: 0.25, delay: [3, 6], plasticity: { enabled: true, rule: 'stdp', wMax: 1.8 } },
    ...recurrent('assoc', 30, 10, 0.38, 1.7, 0.35, plastic),
    { from: 'assoc', source: 'excitatory', to: 'output', inDegree: 14, weight: 0.4, delay: [3, 6], plasticity: REWARD },
    ...recurrent('output', 10, 6, 0.4, 1.6, 0.5),
    { from: 'output', source: 'excitatory', to: 'reward', inDegree: 4, weight: 0.3, delay: [2, 4] },
  ]);
  return {
    ...base('Learning Lab', 'learning-lab', 'Two inputs, a plastic association population and a reward-trained read-out.', seed),
    plasticity: { ...DEFAULT_PLASTICITY, enabled: true, aPlus: 0.012, aMinus: 0.0125, wMax: 1.6, modulatorRegion: 'reward', modulatorPerSpike: 0.02 },
    regions: rs,
    projections: p,
  };
}

export interface PresetInfo {
  id: string;
  name: string;
  description: string;
  defaultTier: string;
  /** Upper bound the preset itself imposes on neurons (some are small by design). */
  maxNeurons?: number;
  create: (neurons: number, seed?: number) => BrainConfig;
}

export const PRESETS: readonly PresetInfo[] = [
  { id: 'observatory', name: 'Neural Observatory', description: 'Six functional regions: visual input, sensory processing, association cortex, memory network, motor output, reward & modulation.', defaultTier: 'medium', create: observatory },
  { id: 'microscopic', name: 'Microscopic', description: 'A few hundred neurons: inspect individual cells, synapses and spikes.', defaultTier: 'micro', maxNeurons: 800, create: microscopic },
  { id: 'cortical', name: 'Cortical', description: 'Layered sheet with local excitatory/inhibitory connectivity and travelling waves.', defaultTier: 'medium', create: cortical },
  { id: 'modular', name: 'Modular', description: 'Seven modules with different internal densities and sparse links between them.', defaultTier: 'medium', create: modular },
  { id: 'highly-connected', name: 'Highly Connected', description: 'One third of the neurons with hundreds of synapses each.', defaultTier: 'medium', create: highlyConnected },
  { id: 'sync-lab', name: 'Synchronisation Lab', description: 'Two oscillation-prone populations with shared and private inputs.', defaultTier: 'small', create: synchronisationLab },
  { id: 'learning-lab', name: 'Learning Lab', description: 'Two inputs, a plastic association population and a reward-trained read-out.', defaultTier: 'small', maxNeurons: 12_000, create: learningLab },
];

export function presetById(id: string): PresetInfo | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function tierById(id: string): Tier | undefined {
  return TIERS.find((t) => t.id === id);
}
