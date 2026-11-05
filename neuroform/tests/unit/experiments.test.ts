/** Experiments run against the real engine (no worker, same contract). */

import { describe, expect, it } from 'vitest';
import { EXPERIMENTS } from '../../src/experiments/definitions.ts';
import type { ParamValue } from '../../src/experiments/types.ts';
import { learningLab, synchronisationLab } from '../../src/config/presets.ts';
import { loadEngine, nodeContext, smallConfig } from '../helpers/engine.ts';

function defaults(id: string, info: Parameters<(typeof EXPERIMENTS)[number]['params'][number]['default']>[0]) {
  const def = EXPERIMENTS.find((e) => e.id === id)!;
  const out: Record<string, ParamValue> = {};
  for (const p of def.params) out[p.key] = p.default(info);
  return { def, params: out };
}

describe('experiments', () => {
  it('A: signal propagation detects the stimulated region and its target', async () => {
    const mod = await loadEngine();
    const net = mod.build(smallConfig());
    const ctx = nodeContext(net);
    const { def, params } = defaults('propagation', net.info);
    params.source = 0;
    const r = await def.run(ctx, params);
    const table = r.tables[0].rows;
    expect(table[0][4]).not.toBe('no response'); // region A responds
    expect(Number(table[1][2])).toBeGreaterThan(Number(table[1][1])); // B fires more than baseline
    expect(Number(String(r.summary[0].value).replace(/,/g, ''))).toBeGreaterThan(0);
    net.free();
  });

  it('A is reproducible: identical results for identical seed and parameters', async () => {
    const mod = await loadEngine();
    const run = async () => {
      const net = mod.build(smallConfig());
      const { def, params } = defaults('propagation', net.info);
      const r = await def.run(nodeContext(net), params);
      net.free();
      return JSON.stringify(r);
    };
    expect(await run()).toEqual(await run());
  });

  it('B: shared input synchronises two populations more than independent input', async () => {
    const mod = await loadEngine();
    const net = mod.build(synchronisationLab(2000, 1));
    const ctx = nodeContext(net);
    const { def, params } = defaults('synchrony', net.info);
    params.duration = 600;
    const r = await def.run(ctx, params);
    const rows = r.tables[0].rows;
    const rInd = Number(rows[1][4]);
    const rShared = Number(rows[2][4]);
    expect(rShared).toBeGreaterThan(rInd);
    net.free();
  }, 60_000);

  it('C: pairing A before B strengthens the real A→B synapses', async () => {
    const mod = await loadEngine();
    const net = mod.build(learningLab(1500, 1));
    const ctx = nodeContext(net);
    const { def, params } = defaults('association', net.info);
    params.reps = 40;
    const r = await def.run(ctx, params);
    const row = r.tables[0].rows[0];
    expect(Number(row[1])).toBeGreaterThan(0); // the pathway exists
    expect(Number(row[3])).toBeGreaterThan(Number(row[2])); // mean weight increased
    expect(r.tables[1].rows.length).toBeGreaterThan(0); // individual synapses changed
    net.free();
  }, 60_000);

  it('E: silencing the target region removes its response and is undone afterwards', async () => {
    const mod = await loadEngine();
    const net = mod.build(smallConfig());
    const ctx = nodeContext(net);
    const { def, params } = defaults('disruption', net.info);
    params.source = 0;
    params.kind = 'region';
    params.region = 1;
    const r = await def.run(ctx, params);
    const row = r.tables[0].rows[1];
    expect(Number(row[2])).toBeLessThan(Number(row[1]));
    expect(Number(row[2])).toBe(0);
    expect(net.telemetry().regions[1].enabled).toBe(true);
    net.free();
  });

  it('F and G run and restore every temporary change', async () => {
    const mod = await loadEngine();
    const net = mod.build(smallConfig());
    const before = net.populationMean(0, 'inhibitory', 6);
    for (const id of ['inhibition', 'weights']) {
      const { def, params } = defaults(id, net.info);
      if (id === 'inhibition') params.window = 200;
      if (id === 'weights') {
        params.window = 200;
        params.projection = 4;
      }
      const r = await def.run(nodeContext(net), params);
      expect(r.charts.length).toBeGreaterThan(0);
    }
    expect(net.populationMean(0, 'inhibitory', 6)).toBeCloseTo(before, 5);
    expect(net.projectionStats()[4].meanEffective).toBeCloseTo(net.projectionStats()[4].meanWeight, 5);
    net.free();
  }, 60_000);
});
