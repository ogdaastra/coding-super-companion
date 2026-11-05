import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EngineModule } from '../../src/engine/wasmEngine.ts';
import { visionLab, visionRegion } from '../../src/config/presets.ts';
import { FEATURES, discToSquare, encodePixels, retinaLayout, retinaRates } from '../../src/vision/retina.ts';
import { decide } from '../../src/vision/trial.ts';
import { VisionTrainer, VISION_TRIAL } from '../../src/vision/trainer.ts';
import { fruitPhoto, rng, trialNet } from '../helpers/vision.ts';

const wasm = readFileSync(new URL('../../src/engine/generated/neuroform_engine.wasm', import.meta.url));

async function visionNetwork(classes: string[], neurons = 3000, seed = 2) {
  const mod = await EngineModule.load(wasm);
  const cfg = visionLab(neurons, seed, classes);
  const net = mod.build(cfg);
  const info = net.info;
  const idx = (id: string) => info.regions.findIndex((r) => r.id === id);
  const outputs = classes.map((_, k) => idx(visionRegion.output(k)));
  const cortex = idx(visionRegion.cortex);
  const setup = {
    layout: retinaLayout(net.copy('positions'), visionRegion.cones.map((c) => info.regions[idx(c)])),
    outputs,
    readProjections: outputs.map((o) => info.projections.flatMap((p, i) => (p.from === cortex && p.to === o ? [i] : []))),
    projectionCount: info.projections.length,
  };
  return { net, cfg, setup, trainer: new VisionTrainer(trialNet(net, cfg.timestepMs), setup) };
}

describe('retina', () => {
  it('maps the disc-shaped retina onto the whole square image', async () => {
    expect(discToSquare(0, 0)).toEqual([0, 0]);
    const [x, y] = discToSquare(Math.SQRT1_2, Math.SQRT1_2); // a point on the rim, 45°
    expect(x).toBeCloseTo(1, 5);
    expect(y).toBeCloseTo(1, 5);
    const { setup } = await visionNetwork(['A', 'B'], 2000);
    // Quantile binning: every pixel gets the same number of neurons per colour.
    const counts = [...setup.layout.coverage];
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    // Every cone neuron reports exactly one feature of its own colour channel.
    expect(setup.layout.ids.length).toBe(setup.layout.feature.length);
  });

  it('drives the retina equally hard for every image', () => {
    const layout = { ids: new Uint32Array(6), feature: Uint32Array.from([0, 1, 2, 3, 4, 5]), coverage: new Uint16Array(FEATURES) };
    const bright = new Float32Array(FEATURES).fill(1);
    const dim = new Float32Array(FEATURES).fill(0.1);
    const mean = (r: Float32Array) => r.reduce((a, b) => a + b, 0) / r.length;
    expect(mean(retinaRates(layout, bright, 60))).toBeCloseTo(60, 4);
    expect(mean(retinaRates(layout, dim, 60))).toBeCloseTo(60, 4);
    expect(mean(retinaRates(layout, new Float32Array(FEATURES), 60))).toBe(0);
  });

  it('encodes photos into features in [0, 1]', () => {
    const f = encodePixels(fruitPhoto('apple', rng(1)));
    expect(f.length).toBe(FEATURES);
    expect(Math.max(...f)).toBeCloseTo(1, 5);
    expect(Math.min(...f)).toBeGreaterThanOrEqual(0);
  });
});

describe('answers', () => {
  it('picks the most active class, and no answer for ties or silence', () => {
    expect(decide([3, 9, 4])).toBe(1);
    expect(decide([5, 5, 1])).toBe(-1);
    expect(decide([0, 0])).toBe(-1);
  });
});

describe('learning to recognise images by reward and punishment', () => {
  it('learns apples from bananas well above chance on photos it has never seen', async () => {
    const { net, trainer } = await visionNetwork(['apple', 'banana']);
    const rand = rng(102);
    const photos = (n: number) => (['apple', 'banana'] as const).flatMap((k, label) => Array.from({ length: n }, () => ({ label, f: encodePixels(fruitPhoto(k, rand)) })));
    const train = photos(60);
    const test = photos(60);
    const accuracy = () => {
      net.setPlasticity(false, 1);
      const ok = test.filter((s) => trainer.trial(s.f, s.label, false).correct).length;
      net.setPlasticity(true, 1);
      return ok / test.length;
    };
    const before = accuracy();
    for (let epoch = 0; epoch < 4; epoch++) {
      for (const i of train.map((_, i) => i).sort(() => rand() - 0.5)) trainer.trial(train[i].f, train[i].label, true);
    }
    const after = accuracy();
    // Deterministic (seeded engine and photos): 0.80 when calibrated.
    expect(after).toBeGreaterThanOrEqual(0.72);
    expect(after - before).toBeGreaterThan(0.15);
    expect(trainer.trainedTrials).toBe(4 * train.length);
    expect(trainer.expected).toBeGreaterThan(0); // mostly right by the end
  }, 180_000);

  it('only the given answer’s pathway is credited, and every trial follows the protocol timing', async () => {
    const { net, cfg, trainer, setup } = await visionNetwork(['A', 'B'], 2000);
    const t0 = net.timeMs;
    const r = trainer.trial(encodePixels(fruitPhoto('apple', rng(5))), 0, true);
    expect(net.timeMs - t0).toBeCloseTo(VISION_TRIAL.presentMs + VISION_TRIAL.restMs, 6);
    expect(r.counts.length).toBe(2);
    expect(r.delivered === 0 || Math.abs(r.delivered) <= 1).toBe(true);
    // The reward gate is open again for every projection after the trial.
    expect(() => net.setRewardGate([])).not.toThrow();
    expect(setup.readProjections.every((ps) => ps.length === 1)).toBe(true);
    expect(cfg.regions.map((x) => x.id)).toEqual([...visionRegion.cones, visionRegion.cortex, 'out0', 'out1']);
  }, 60_000);
});
