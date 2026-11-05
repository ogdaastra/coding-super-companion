/** The engine through its WebAssembly ABI, exactly as the worker uses it. */

import { describe, expect, it } from 'vitest';
import { EngineError } from '../../src/engine/wasmEngine.ts';
import { neuronParamIndex } from '../../src/config/schema.ts';
import { loadEngine, smallConfig } from '../helpers/engine.ts';

describe('WebAssembly engine', () => {
  it('builds incrementally and describes the network', async () => {
    const mod = await loadEngine();
    const b = mod.createBuilder(smallConfig());
    let p = 0;
    let calls = 0;
    while (p < 1) {
      p = b.advance(2000);
      calls++;
    }
    expect(calls).toBeGreaterThan(2);
    const net = b.finish();
    expect(net.info.neurons).toBe(600);
    expect(net.info.regions.map((r) => r.id)).toEqual(['a', 'b']);
    expect(net.info.synapses).toBeGreaterThan(5000);
    expect(net.view('positions').length).toBe(1800);
    expect(net.view('rowPtr').length).toBe(601);
    expect(net.view('target').length).toBe(net.info.synapses);
    net.free();
  });

  it('is deterministic for a seed and different across seeds', async () => {
    const mod = await loadEngine();
    const a = mod.build(smallConfig(7));
    const b = mod.build(smallConfig(7));
    const c = mod.build(smallConfig(8));
    expect(a.info.topologyHash).toBe(b.info.topologyHash);
    expect(a.info.topologyHash).not.toBe(c.info.topologyHash);
    a.run(1000);
    b.run(1000);
    expect(Array.from(a.view('spikeCount'))).toEqual(Array.from(b.view('spikeCount')));
    [a, b, c].forEach((n) => n.free());
  });

  it('reports real activity in telemetry', async () => {
    const mod = await loadEngine();
    const net = mod.build(smallConfig());
    net.run(2000); // 1 s
    const t = net.telemetry();
    expect(t.windowSteps).toBe(2000);
    const spikes = t.regions.reduce((s, r) => s + r.spikesExc + r.spikesInh, 0);
    const counted = net.view('spikeCount').reduce((s, x) => s + x, 0);
    expect(spikes).toBe(counted);
    expect(spikes / 600).toBeGreaterThan(1); // more than 1 Hz on average
    expect(t.eventsScheduled).toBeGreaterThan(0);
    expect(t.activeSynapses).toBeGreaterThan(0);
    net.free();
  });

  it('round-trips snapshots exactly', async () => {
    const mod = await loadEngine();
    const net = mod.build(smallConfig());
    net.run(600);
    const snap = net.snapshot();
    net.run(400);
    const expected = Array.from(net.view('membrane'));
    const fresh = mod.build(smallConfig());
    fresh.restore(snap);
    expect(fresh.step).toBe(600);
    fresh.run(400);
    expect(Array.from(fresh.view('membrane'))).toEqual(expected);
    expect(() => mod.build(smallConfig(99)).restore(snap)).toThrow(EngineError);
    net.free();
    fresh.free();
  });

  it('validates edits and reports the previous value', async () => {
    const mod = await loadEngine();
    const net = mod.build(smallConfig());
    const th = neuronParamIndex('vThreshold');
    const reset = neuronParamIndex('vReset');
    const old = net.setNeuronParam(3, th, -52);
    expect(old).toBeLessThan(-40);
    expect(net.neuron(3).vThreshold).toBeCloseTo(-52);
    expect(() => net.setNeuronParam(3, reset, -40)).toThrow(/reset/);
    expect(() => net.setNeuronParam(999999, th, -52)).toThrow(/does not exist/);
    net.free();
  });

  it('stimulates real neurons and reports their ids', async () => {
    const mod = await loadEngine();
    const net = mod.build(smallConfig());
    const { id, targets } = net.addStimulus({ target: { kind: 'regions', regions: [1], fraction: 0.5 }, amplitude: 5, pattern: 'constant', durationMs: 20 });
    expect(id).toBeGreaterThan(0);
    expect(targets.length).toBe(150);
    expect(Math.min(...targets)).toBeGreaterThanOrEqual(300);
    net.telemetry();
    net.run(40);
    const t = net.telemetry();
    expect(t.regions[1].spikesExc + t.regions[1].spikesInh).toBeGreaterThan(t.regions[0].spikesExc + t.regions[0].spikesInh);
    expect(() => net.addStimulus({ target: { kind: 'neurons', ids: [123456] }, amplitude: 1, pattern: 'constant', durationMs: 5 })).toThrow();
    net.free();
  });

  it('exposes synapses with identity, weight, delay and plasticity', async () => {
    const mod = await loadEngine();
    const net = mod.build(smallConfig());
    const { total, records } = net.synapses(0, false, 0, 1000);
    expect(records.length).toBe(total);
    const r = records[0];
    expect(r.id).toBeGreaterThanOrEqual(0);
    expect(r.delayMs).toBeGreaterThan(0);
    const byId = net.synapsesById([r.id]);
    expect(byId[0].pre).toBe(0);
    expect(byId[0].post).toBe(r.other);
    const plastic = net.synapses(10, false, 0, 1000).records.filter((x) => x.plastic);
    if (plastic.length) expect(plastic[0].initialWeight).not.toBeNull();
    const h = net.weightHistogram(-1, 16);
    expect(h.counted).toBe(net.info.synapses);
    net.free();
  });

  it('finds communities that match the two regions', async () => {
    const mod = await loadEngine();
    const net = mod.build(smallConfig());
    const { summary, labels } = net.communities(10);
    expect(labels.length).toBe(600);
    expect(summary.modularity).toBeGreaterThan(0.2);
    net.free();
  });
});
