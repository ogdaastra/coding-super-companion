/** Presets, validation, structural adjustments and the configuration file format. */

import { describe, expect, it } from 'vitest';
import { PRESETS, TIERS } from '../../src/config/presets.ts';
import { validateConfig } from '../../src/config/validate.ts';
import { estimate, scaleDensity, scaleNeurons, setExcitatoryFraction, structuralChanges } from '../../src/config/adjust.ts';
import { configToFile, ImportError, parseConfigFile } from '../../src/persistence/formats.ts';
import { loadEngine } from '../helpers/engine.ts';

describe('presets', () => {
  for (const p of PRESETS) {
    it(`${p.name} is a valid configuration for the engine at every tier`, async () => {
      const mod = await loadEngine();
      for (const t of TIERS.slice(0, 4)) {
        const cfg = p.create(Math.min(t.neurons, p.maxNeurons ?? Infinity), 3);
        expect(validateConfig(cfg)).toEqual([]);
        const v = mod.validate(cfg);
        expect(v.totals.neurons).toBe(cfg.regions.reduce((a, r) => a + r.count, 0));
        // Client-side estimate agrees with the engine.
        expect(estimate(cfg).synapses).toBeCloseTo(v.totals.expectedSynapses, -2);
      }
    });
  }

  it('the observatory has the six functional regions of the specification', () => {
    const c = PRESETS[0].create(10_000, 1);
    expect(c.regions.map((r) => r.name)).toEqual(['Visual Input', 'Sensory Processing', 'Association Cortex', 'Memory Network', 'Motor Output', 'Reward & Modulation']);
    expect(c.plasticity.modulatorRegion).toBe('reward');
  });

  it('actual synapse counts match the estimate within a few percent', async () => {
    const mod = await loadEngine();
    const cfg = PRESETS[0].create(5000, 1);
    const net = mod.build(cfg);
    const e = estimate(cfg).synapses;
    expect(Math.abs(net.info.synapses - e) / e).toBeLessThan(0.05);
    net.free();
  });
});

describe('structural adjustments', () => {
  const base = PRESETS[0].create(10_000, 1);

  it('scaling neurons keeps the expected in-degree', () => {
    const big = scaleNeurons(base, 20_000);
    expect(big.regions.reduce((a, r) => a + r.count, 0)).toBe(20_000);
    const perNeuron = (c: typeof base) => estimate(c).synapsesPerNeuron;
    expect(perNeuron(big)).toBeCloseTo(perNeuron(base), 0);
  });

  it('density and E/I ratio change the network as described', () => {
    expect(estimate(scaleDensity(base, 2)).synapses).toBeCloseTo(estimate(base).synapses * 2, -3);
    const ei = setExcitatoryFraction(base, 0.5);
    expect(ei.regions.every((r) => r.excitatoryFraction === 0.5)).toBe(true);
    expect(structuralChanges(base, ei)).toContain('Region parameters or layout');
  });
});

describe('validation', () => {
  it('explains problems with paths', () => {
    const bad = structuredClone(PRESETS[0].create(1000, 1));
    bad.regions[0].excitatory.vReset = -40;
    bad.projections[0].to = 'nowhere';
    bad.timestepMs = 3;
    const issues = validateConfig(bad);
    const paths = issues.map((i) => i.path);
    expect(paths).toContain('timestepMs');
    expect(paths).toContain('regions[0].excitatory.vReset');
    expect(paths).toContain('projections[0].to');
  });
});

describe('configuration files', () => {
  it('round-trips through export and import', () => {
    const c = PRESETS[2].create(2000, 5);
    const back = parseConfigFile(configToFile(c));
    expect(back).toEqual(c);
  });

  it('rejects malformed, foreign and invalid files with explanations', () => {
    expect(() => parseConfigFile('{nope')).toThrow(ImportError);
    expect(() => parseConfigFile(JSON.stringify({ format: 'neuroform.snapshot', version: 1 }))).toThrow(/snapshot/);
    expect(() => parseConfigFile(JSON.stringify({ format: 'neuroform.config', version: 99, config: {} }))).toThrow(/newer/);
    try {
      parseConfigFile(JSON.stringify({ format: 'neuroform.config', version: 1, config: { seed: 1, timestepMs: 0.5, regions: [] } }));
      throw new Error('should have failed');
    } catch (e) {
      expect(e).toBeInstanceOf(ImportError);
      expect((e as ImportError).details.join(' ')).toMatch(/regions/);
    }
  });
});
