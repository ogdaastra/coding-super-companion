/**
 * Client-side configuration validation. Mirrors `BrainConfig::validate` in the
 * engine so imports and edits can be explained before a build is attempted; the
 * engine remains the authority and re-validates everything.
 */

import { LIMITS, type BrainConfig, type NeuronParams } from './schema.ts';

export interface Issue {
  path: string;
  message: string;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function range(issues: Issue[], path: string, v: unknown, lo: number, hi: number): void {
  if (!isNum(v)) issues.push({ path, message: 'must be a number' });
  else if (v < lo || v > hi) issues.push({ path, message: `must be between ${lo} and ${hi} (got ${v})` });
}

function neuron(issues: Issue[], path: string, p: unknown, dt: number): void {
  if (!p || typeof p !== 'object') {
    issues.push({ path, message: 'neuron parameters are missing' });
    return;
  }
  const n = p as NeuronParams;
  range(issues, `${path}.vRest`, n.vRest, -200, 100);
  range(issues, `${path}.vThreshold`, n.vThreshold, -200, 100);
  range(issues, `${path}.vReset`, n.vReset, -200, 100);
  if (isNum(n.vReset) && isNum(n.vThreshold) && n.vReset >= n.vThreshold) {
    issues.push({ path: `${path}.vReset`, message: 'must be below the firing threshold' });
  }
  range(issues, `${path}.tauMs`, n.tauMs, Math.max(dt, 0.5), 1000);
  range(issues, `${path}.refractoryMs`, n.refractoryMs, 0, 100);
  range(issues, `${path}.resistance`, n.resistance ?? 1, 0, 100);
  range(issues, `${path}.bias`, n.bias ?? 0, -100, 100);
  range(issues, `${path}.noiseStd`, n.noiseStd ?? 0, 0, 100);
}

export function validateConfig(raw: unknown): Issue[] {
  const issues: Issue[] = [];
  if (!raw || typeof raw !== 'object') return [{ path: '', message: 'configuration must be an object' }];
  const c = raw as BrainConfig;
  if (!isNum(c.seed) || c.seed < 0 || c.seed > 4294967295 || !Number.isInteger(c.seed)) issues.push({ path: 'seed', message: 'must be an integer between 0 and 4294967295' });
  range(issues, 'timestepMs', c.timestepMs, LIMITS.minTimestepMs, LIMITS.maxTimestepMs);
  const dt = isNum(c.timestepMs) ? c.timestepMs : 0.5;
  if (c.synapse) {
    range(issues, 'synapse.tauExcMs', c.synapse.tauExcMs, 0, 1000);
    range(issues, 'synapse.tauInhMs', c.synapse.tauInhMs, 0, 1000);
  }
  if (!Array.isArray(c.regions) || c.regions.length === 0) {
    issues.push({ path: 'regions', message: 'at least one region is required' });
    return issues;
  }
  if (c.regions.length > LIMITS.maxRegions) issues.push({ path: 'regions', message: `at most ${LIMITS.maxRegions} regions` });
  const ids = new Map<string, number>();
  let neurons = 0;
  c.regions.forEach((r, i) => {
    const p = `regions[${i}]`;
    if (typeof r.id !== 'string' || !r.id.trim()) issues.push({ path: `${p}.id`, message: 'must be a non-empty string' });
    else if (ids.has(r.id)) issues.push({ path: `${p}.id`, message: `duplicate region id "${r.id}"` });
    else ids.set(r.id, i);
    if (!isNum(r.count) || !Number.isInteger(r.count) || r.count < 1) issues.push({ path: `${p}.count`, message: 'must be a positive integer' });
    else neurons += r.count;
    range(issues, `${p}.excitatoryFraction`, r.excitatoryFraction, 0, 1);
    range(issues, `${p}.heterogeneity`, r.heterogeneity ?? 0, 0, 1);
    if (!r.shape || !Array.isArray(r.shape.center) || !Array.isArray(r.shape.radius) || r.shape.center.length !== 3 || r.shape.radius.length !== 3) {
      issues.push({ path: `${p}.shape`, message: 'needs center [x,y,z] and radius [rx,ry,rz]' });
    } else {
      r.shape.radius.forEach((v, k) => range(issues, `${p}.shape.radius[${k}]`, v, 0.01, 1e4));
      r.shape.center.forEach((v, k) => range(issues, `${p}.shape.center[${k}]`, v, -1e4, 1e4));
      range(issues, `${p}.shape.shell`, r.shape.shell ?? 0, 0, 0.95);
    }
    neuron(issues, `${p}.excitatory`, r.excitatory, dt);
    neuron(issues, `${p}.inhibitory`, r.inhibitory, dt);
  });
  if (neurons > LIMITS.maxNeurons) issues.push({ path: 'regions', message: `${neurons.toLocaleString('en-GB')} neurons exceeds the limit of ${LIMITS.maxNeurons.toLocaleString('en-GB')}` });
  if (!Array.isArray(c.projections)) {
    issues.push({ path: 'projections', message: 'must be a list' });
    return issues;
  }
  let synapses = 0;
  c.projections.forEach((pr, i) => {
    const p = `projections[${i}]`;
    const from = ids.get(pr.from);
    const to = ids.get(pr.to);
    if (from === undefined) issues.push({ path: `${p}.from`, message: `unknown region "${pr.from}"` });
    if (to === undefined) issues.push({ path: `${p}.to`, message: `unknown region "${pr.to}"` });
    if (pr.source !== 'excitatory' && pr.source !== 'inhibitory') issues.push({ path: `${p}.source`, message: 'must be "excitatory" or "inhibitory"' });
    range(issues, `${p}.probability`, pr.probability, 0, 1);
    range(issues, `${p}.weight.mean`, pr.weight?.mean, 0, 1000);
    range(issues, `${p}.delayMs.min`, pr.delayMs?.min, 0, 255);
    range(issues, `${p}.delayMs.max`, pr.delayMs?.max, 0, 255);
    if (isNum(pr.delayMs?.max) && Math.round(pr.delayMs.max / dt) > LIMITS.maxDelaySteps) {
      issues.push({ path: `${p}.delayMs.max`, message: `exceeds ${LIMITS.maxDelaySteps} steps at ${dt} ms per step` });
    }
    if (from !== undefined && to !== undefined && isNum(pr.probability)) {
      const src = c.regions[from];
      const tgt = c.regions[to];
      const nSrc = Math.round(src.count * src.excitatoryFraction);
      const sources = pr.source === 'excitatory' ? nSrc : src.count - nSrc;
      const nTgtE = Math.round(tgt.count * tgt.excitatoryFraction);
      const targets = pr.target === 'excitatory' ? nTgtE : pr.target === 'inhibitory' ? tgt.count - nTgtE : tgt.count;
      synapses += sources * targets * pr.probability;
    }
  });
  if (synapses > LIMITS.maxSynapses) issues.push({ path: 'projections', message: `about ${Math.round(synapses).toLocaleString('en-GB')} synapses exceeds the limit of ${LIMITS.maxSynapses.toLocaleString('en-GB')}` });
  return issues;
}
