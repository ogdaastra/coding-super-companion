// Shared by the vision unit test and the calibration script: synthetic photos
// and a TrialNet over the engine running directly in Node.
import type { EngineNetwork } from '../../src/engine/wasmEngine.ts';
import { GRID } from '../../src/vision/retina.ts';
import type { VisionNet } from '../../src/vision/trainer.ts';

export function trialNet(net: EngineNetwork, dt: number): VisionNet {
  return {
    dt,
    setInput: (ids, rates, a) => net.setInput(ids, rates, a),
    clearInput: () => net.clearInput(),
    clearEligibility: () => net.clearEligibility(),
    run: (steps) => {
      if (steps > 0) net.run(steps);
      net.clearBuffers(true, true, true);
    },
    injectReward: (a) => net.injectReward(a),
    setRewardGate: (g) => net.setRewardGate(g),
    regionSpikes: () => net.telemetry().regions.map((r) => r.spikesExc),
  };
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Fruit = 'apple' | 'banana' | 'tomato';

/**
 * A GRID × GRID RGBA "photo": a fruit on a random light or dark background with
 * pixel noise, random position, size and lighting.
 *  - apple: red disc, sometimes with a brown stem;
 *  - banana: yellow, long and curved;
 *  - tomato: orange-red disc with a green star of leaves on top.
 */
export function fruitPhoto(kind: Fruit, rand: () => number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(GRID * GRID * 4);
  const bgBase = rand() < 0.5 ? 150 + rand() * 90 : 30 + rand() * 70;
  const bg = [bgBase + (rand() - 0.5) * 40, bgBase + (rand() - 0.5) * 40, bgBase + (rand() - 0.5) * 40];
  const light = 0.7 + rand() * 0.5;
  const cx = GRID / 2 + (rand() - 0.5) * 4;
  const cy = GRID / 2 + (rand() - 0.5) * 4;
  const r = 4.5 + rand() * 2.5;
  const angle = rand() * Math.PI;
  const jitter = (c: number[]) => c.map((v) => v + (rand() - 0.5) * 30);
  const apple = jitter([200, 30, 35]);
  const tomato = jitter([235, 70, 35]);
  const banana = jitter([235, 205, 60]);
  const leaf = jitter([60, 150, 50]);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      let c = bg;
      if (kind === 'banana') {
        const u = dx * Math.cos(angle) + dy * Math.sin(angle);
        const v = -dx * Math.sin(angle) + dy * Math.cos(angle) + 0.08 * u * u;
        if ((u / (r * 1.5)) ** 2 + (v / (r * 0.38)) ** 2 < 1) c = banana;
      } else if (dx * dx + dy * dy < r * r) {
        c = kind === 'apple' ? apple : tomato;
      }
      if (kind === 'tomato') {
        // A star of leaves at the top of the fruit.
        const ly = dy + r * 0.85;
        if (Math.abs(ly) < 1.1 && Math.abs(dx) < r * 0.55) c = leaf;
        if (Math.abs(dx) < 0.8 && ly > -1.8 && ly < 1.4) c = leaf;
      } else if (kind === 'apple' && rand() < 0.6) {
        if (Math.abs(dx) < 0.6 && dy < -r * 0.75 && dy > -r - 1.5) c = [90, 55, 30];
      }
      const o = 4 * (y * GRID + x);
      for (let k = 0; k < 3; k++) px[o + k] = c[k] * light + (rand() - 0.5) * 25;
      px[o + 3] = 255;
    }
  }
  return px;
}
