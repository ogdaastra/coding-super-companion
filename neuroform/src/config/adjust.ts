/**
 * Whole-brain adjustments used by the brain designer, plus estimates of the
 * resulting network. All functions return new configurations (no mutation).
 *
 * These are *structural* changes: they take effect when the network is rebuilt.
 * Run-time changes (excitability, noise, pathway gains, plasticity) are applied
 * to the live network instead; see `docs/ARCHITECTURE.md#change-policy`.
 */

import type { BrainConfig, RegionConfig } from './schema.ts';

export interface Estimate {
  neurons: number;
  synapses: number;
  plasticSynapses: number;
  synapsesPerNeuron: number;
  memoryBytes: number;
  maxDelaySteps: number;
}

const BYTES_PER_NEURON = 113;
const BYTES_PER_SYNAPSE = 18;

function classCounts(r: RegionConfig): [number, number] {
  const e = Math.round(r.count * r.excitatoryFraction);
  return [e, r.count - e];
}

/** Mirrors `estimate_memory_bytes` in the engine. */
export function estimate(c: BrainConfig): Estimate {
  const byId = new Map(c.regions.map((r) => [r.id, r]));
  let neurons = 0;
  for (const r of c.regions) neurons += r.count;
  let synapses = 0;
  let plastic = 0;
  let maxDelay = 1;
  for (const p of c.projections) {
    const s = byId.get(p.from);
    const t = byId.get(p.to);
    if (!s || !t) continue;
    const [se, si] = classCounts(s);
    const [te, ti] = classCounts(t);
    const sources = p.source === 'excitatory' ? se : si;
    const targets = p.target === 'excitatory' ? te : p.target === 'inhibitory' ? ti : te + ti;
    const n = sources * targets * p.probability;
    synapses += n;
    if (p.plasticity?.enabled) plastic += n;
    maxDelay = Math.max(maxDelay, Math.max(1, Math.round(p.delayMs.max / c.timestepMs)));
  }
  let memory = neurons * BYTES_PER_NEURON + synapses * BYTES_PER_SYNAPSE + (maxDelay + 1) * neurons * 8 + 2 * (neurons + 1) * 4;
  if (plastic > 0) memory += synapses * 4 + plastic * 4;
  return {
    neurons,
    synapses: Math.round(synapses),
    plasticSynapses: Math.round(plastic),
    synapsesPerNeuron: neurons ? synapses / neurons : 0,
    memoryBytes: memory,
    maxDelaySteps: maxDelay,
  };
}

/** Rescales every region to reach `total` neurons, keeping in-degrees constant. */
export function scaleNeurons(c: BrainConfig, total: number): BrainConfig {
  const current = c.regions.reduce((a, r) => a + r.count, 0) || 1;
  const f = total / current;
  const regions = c.regions.map((r) => ({ ...r, count: Math.max(8, Math.round(r.count * f)) }));
  // Holding in-degree constant: probability scales inversely with source size.
  const before = new Map(c.regions.map((r) => [r.id, r]));
  const after = new Map(regions.map((r) => [r.id, r]));
  const projections = c.projections.map((p) => {
    const b = before.get(p.from)!;
    const a = after.get(p.from)!;
    const [be, bi] = classCounts(b);
    const [ae, ai] = classCounts(a);
    const nb = p.source === 'excitatory' ? be : bi;
    const na = p.source === 'excitatory' ? ae : ai;
    const probability = na > 0 ? Math.min(1, (p.probability * nb) / na) : p.probability;
    return { ...p, probability: Number(probability.toPrecision(6)) };
  });
  return { ...c, regions, projections };
}

/** Multiplies every connection probability (synapse count) by `f`. */
export function scaleDensity(c: BrainConfig, f: number): BrainConfig {
  return { ...c, projections: c.projections.map((p) => ({ ...p, probability: Number(Math.min(1, p.probability * f).toPrecision(6)) })) };
}

/** Sets every region's excitatory fraction. */
export function setExcitatoryFraction(c: BrainConfig, fraction: number): BrainConfig {
  return { ...c, regions: c.regions.map((r) => ({ ...r, excitatoryFraction: fraction })) };
}

/** Multiplies every synaptic weight mean and spread by `f`. */
export function scaleWeights(c: BrainConfig, f: number): BrainConfig {
  return { ...c, projections: c.projections.map((p) => ({ ...p, weight: { mean: p.weight.mean * f, std: p.weight.std * f } })) };
}

/** Multiplies every delay by `f`. */
export function scaleDelays(c: BrainConfig, f: number): BrainConfig {
  return {
    ...c,
    projections: c.projections.map((p) => ({ ...p, delayMs: { min: Math.max(0, p.delayMs.min * f), max: Math.max(0, p.delayMs.max * f) } })),
  };
}

/** Adds `delta` to every population's background current. */
export function shiftExcitability(c: BrainConfig, delta: number): BrainConfig {
  return {
    ...c,
    regions: c.regions.map((r) => ({
      ...r,
      excitatory: { ...r.excitatory, bias: r.excitatory.bias + delta },
      inhibitory: { ...r.inhibitory, bias: r.inhibitory.bias + delta },
    })),
  };
}

export function scaleNoise(c: BrainConfig, f: number): BrainConfig {
  return {
    ...c,
    regions: c.regions.map((r) => ({
      ...r,
      excitatory: { ...r.excitatory, noiseStd: r.excitatory.noiseStd * f },
      inhibitory: { ...r.inhibitory, noiseStd: r.inhibitory.noiseStd * f },
    })),
  };
}

/** Human-readable list of structural differences between two configurations. */
export function structuralChanges(a: BrainConfig, b: BrainConfig): string[] {
  const out: string[] = [];
  if (a.seed !== b.seed) out.push(`Seed ${a.seed} → ${b.seed}`);
  if (a.timestepMs !== b.timestepMs) out.push(`Timestep ${a.timestepMs} → ${b.timestepMs} ms`);
  const na = a.regions.reduce((s, r) => s + r.count, 0);
  const nb = b.regions.reduce((s, r) => s + r.count, 0);
  if (na !== nb) out.push(`Neurons ${na.toLocaleString('en-GB')} → ${nb.toLocaleString('en-GB')}`);
  if (a.regions.length !== b.regions.length) out.push(`Regions ${a.regions.length} → ${b.regions.length}`);
  if (JSON.stringify(a.regions) !== JSON.stringify(b.regions) && na === nb && a.regions.length === b.regions.length) out.push('Region parameters or layout');
  if (JSON.stringify(a.projections) !== JSON.stringify(b.projections)) out.push('Connectivity');
  if (JSON.stringify(a.synapse) !== JSON.stringify(b.synapse)) out.push('Synaptic time constants');
  if (JSON.stringify(a.plasticity) !== JSON.stringify(b.plasticity)) out.push('Plasticity settings');
  if (a.name !== b.name && out.length === 0) out.push('Name');
  return out;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n.toFixed(0)} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KiB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MiB`;
  return `${(n / 1024 ** 3).toFixed(2)} GiB`;
}
