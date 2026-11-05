/**
 * Test helpers: load the real WebAssembly engine in Node and drive experiments
 * against it without a worker, using the same `ExperimentContext` contract the
 * browser runner implements.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EngineModule, type EngineNetwork } from '../../src/engine/wasmEngine.ts';
import type { BrainConfig } from '../../src/config/schema.ts';
import type { ExperimentContext } from '../../src/experiments/types.ts';
import { regionLookup } from '../../src/experiments/analysis.ts';
import { neuronParamIndex } from '../../src/config/schema.ts';

let cached: Promise<EngineModule> | null = null;

export function loadEngine(): Promise<EngineModule> {
  if (!cached) {
    const path = fileURLToPath(new URL('../../src/engine/generated/neuroform_engine.wasm', import.meta.url));
    cached = EngineModule.load(readFileSync(path));
  }
  return cached;
}

/** A small, fast configuration: two connected regions. */
export function smallConfig(seed = 7): BrainConfig {
  const neuron = { vRest: -65, vThreshold: -50, vReset: -65, tauMs: 20, refractoryMs: 2, resistance: 1, bias: 0.55, noiseStd: 1 };
  const inh = { ...neuron, tauMs: 10, refractoryMs: 1, bias: 0.9, noiseStd: 1.4 };
  return {
    name: 'Test pair',
    seed,
    timestepMs: 0.5,
    synapse: { tauExcMs: 5, tauInhMs: 10 },
    plasticity: { enabled: false, tauPlusMs: 20, tauMinusMs: 20, aPlus: 0.01, aMinus: 0.0105, wMin: 0, wMax: 1.5, eligibilityTauMs: 1000, modulatorTauMs: 200, rewardRate: 2, modulatorRegion: null, modulatorPerSpike: 0 },
    regions: [
      { id: 'a', name: 'Region A', count: 300, excitatoryFraction: 0.8, heterogeneity: 0.3, shape: { center: [0, 0, 0], radius: [20, 20, 20] }, excitatory: neuron, inhibitory: inh },
      { id: 'b', name: 'Region B', count: 300, excitatoryFraction: 0.8, heterogeneity: 0.3, shape: { center: [60, 0, 0], radius: [20, 20, 20] }, excitatory: neuron, inhibitory: inh },
    ],
    projections: [
      { from: 'a', source: 'excitatory', to: 'a', probability: 0.1, weight: { mean: 0.4, std: 0.1 }, delayMs: { min: 1, max: 4 } },
      { from: 'a', source: 'inhibitory', to: 'a', probability: 0.15, weight: { mean: 1.6, std: 0.4 }, delayMs: { min: 0.5, max: 2 } },
      { from: 'b', source: 'excitatory', to: 'b', probability: 0.1, weight: { mean: 0.4, std: 0.1 }, delayMs: { min: 1, max: 4 } },
      { from: 'b', source: 'inhibitory', to: 'b', probability: 0.15, weight: { mean: 1.6, std: 0.4 }, delayMs: { min: 0.5, max: 2 } },
      { from: 'a', source: 'excitatory', to: 'b', probability: 0.06, weight: { mean: 0.6, std: 0.1 }, delayMs: { min: 3, max: 6 }, plasticity: { enabled: true, rule: 'stdp' } },
    ],
  };
}

/** Implements the experiment contract directly on an engine network (no worker). */
export function nodeContext(net: EngineNetwork): ExperimentContext & { logs: string[] } {
  const info = net.info;
  const undo: (() => void)[] = [];
  const logs: string[] = [];
  const captures: { spikes: number[] }[] = [];
  const drain = () => {
    const v = net.view('frameSpikes');
    for (const c of captures) for (let i = 0; i < v.length; i++) c.spikes.push(v[i]);
    net.clearBuffers(true, true, true);
  };
  return {
    info,
    dt: info.dt,
    regionOf: regionLookup(info),
    signal: new AbortController().signal,
    logs,
    step: () => net.step,
    async advance(ms) {
      let remaining = Math.round(ms / info.dt);
      while (remaining > 0) {
        const k = Math.min(remaining, 50);
        net.run(k);
        drain();
        remaining -= k;
      }
    },
    async measure() {
      return net.telemetry();
    },
    async capture(fn) {
      const c = { spikes: [] as number[] };
      const start = net.step;
      drain();
      captures.push(c);
      try {
        await fn();
        drain();
      } finally {
        captures.splice(captures.indexOf(c), 1);
      }
      return { spikes: new Uint32Array(c.spikes), startStep: start, endStep: net.step };
    },
    async stimulate(spec) {
      return net.addStimulus(spec).targets;
    },
    async reset() {
      net.reset(true);
    },
    async projectionStats() {
      return net.projectionStats();
    },
    async topChanges(k) {
      return net.topWeightChanges(k);
    },
    async setRegionEnabled(region, enabled) {
      const old = net.setRegionEnabled(region, enabled);
      undo.push(() => net.setRegionEnabled(region, old));
    },
    async setProjectionGain(p, gain) {
      const old = net.setProjectionGain(p, gain);
      undo.push(() => net.setProjectionGain(p, old));
    },
    async setPopulationParam(region, cls, key, value) {
      const old = net.setPopulationParam(region, cls, neuronParamIndex(key), value);
      undo.push(() => net.setPopulationParam(region, cls, neuronParamIndex(key), old));
    },
    async populationMean(region, cls, key) {
      return net.populationMean(region, cls, neuronParamIndex(key));
    },
    async setPlasticity(enabled, rate = 1) {
      net.setPlasticity(enabled, rate);
    },
    async setSyncGroup(regions) {
      net.setSynchronyGroup(regions);
    },
    async restoreChanges() {
      while (undo.length) undo.pop()!();
    },
    progress() {},
    live() {},
    log(m) {
      logs.push(m);
    },
  };
}
