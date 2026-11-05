/**
 * The retina: how an image becomes input to the network.
 *
 * An image is reduced to a GRID × GRID picture with three colour channels. The
 * retina has three interleaved mosaics of neurons, like the three kinds of cone
 * cell, each responding to one channel (red, green or blue). Every neuron is
 * assigned a pixel *by its position*: the retina is a flat disc, mapped onto
 * the square image. So the retina in the 3D view lights up in the shape of the
 * picture, and the topographic projections to the visual cortex keep
 * neighbouring pixels neighbours.
 *
 * Each retina neuron then receives Poisson input at a rate proportional to its
 * pixel's channel intensity (rate coding).
 */

export const GRID = 16;
export const CHANNELS = 3;
export const FEATURES = GRID * GRID * CHANNELS;

export interface RetinaLayout {
  /** Retina neuron indices (global). */
  ids: Uint32Array;
  /** For each entry of `ids`: the feature (pixel·3 + channel) it reports. */
  feature: Uint32Array;
  /** Neurons per feature, for display and coverage checks. */
  coverage: Uint16Array;
}

/**
 * Assigns the neurons of the three cone mosaics (red, green, blue regions, as
 * [start, end) ranges) to pixels from their 3D positions (x, y, z interleaved
 * for all neurons). Every neuron of mosaic c reports channel c of its pixel.
 */
export function retinaLayout(positions: ArrayLike<number>, cones: readonly { start: number; end: number }[]): RetinaLayout {
  const parts = cones.map((r, c) => mosaic(positions, r.start, r.end, c));
  const total = parts.reduce((a, p) => a + p.ids.length, 0);
  const ids = new Uint32Array(total);
  const feature = new Uint32Array(total);
  const coverage = new Uint16Array(FEATURES);
  let o = 0;
  for (const p of parts) {
    ids.set(p.ids, o);
    feature.set(p.feature, o);
    o += p.ids.length;
  }
  for (const f of feature) coverage[f]++;
  return { ids, feature, coverage };
}

function mosaic(positions: ArrayLike<number>, start: number, end: number, channel: number): { ids: Uint32Array; feature: Uint32Array } {
  const n = end - start;
  // The two axes with the largest extent span the image plane.
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = start; i < end; i++) {
    for (let k = 0; k < 3; k++) {
      const v = positions[3 * i + k];
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  }
  const axes = [0, 1, 2].sort((a, b) => hi[b] - lo[b] - (hi[a] - lo[a]));
  const [ax, ay] = [axes[0], axes[1]];
  // Position on the square image plane: disc coordinates in [-1, 1]², mapped
  // onto the square.
  const xy = new Float32Array(2 * n);
  for (let k = 0; k < n; k++) {
    const i = start + k;
    const u = (2 * (positions[3 * i + ax] - lo[ax])) / Math.max(1e-6, hi[ax] - lo[ax]) - 1;
    const v = (2 * (positions[3 * i + ay] - lo[ay])) / Math.max(1e-6, hi[ay] - lo[ay]) - 1;
    [xy[2 * k], xy[2 * k + 1]] = discToSquare(u, v);
  }
  // Quantile binning: GRID columns with equal numbers of neurons, each split
  // into GRID rows with equal numbers. Neurons seen face-on are denser in the
  // middle of a disc than at its rim; binning by count gives every pixel the
  // same number of neurons while keeping neighbours neighbours.
  const cell = new Uint32Array(n);
  const byX = Array.from({ length: n }, (_, k) => k).sort((a, b) => xy[2 * a] - xy[2 * b]);
  for (let c = 0; c < GRID; c++) {
    const col = byX.slice(Math.round((c * n) / GRID), Math.round(((c + 1) * n) / GRID));
    // Image rows run top to bottom; the second axis points up in the scene.
    col.sort((a, b) => xy[2 * b + 1] - xy[2 * a + 1]);
    for (let r = 0; r < GRID; r++) {
      for (let j = Math.round((r * col.length) / GRID); j < Math.round(((r + 1) * col.length) / GRID); j++) cell[col[j]] = r * GRID + c;
    }
  }
  const ids = new Uint32Array(n);
  const feature = new Uint32Array(n);
  for (let k = 0; k < n; k++) {
    ids[k] = start + k;
    feature[k] = cell[k] * CHANNELS + channel;
  }
  return { ids, feature };
}

/**
 * Maps the unit disc onto the square [-1, 1]² (elliptical grid mapping), so the
 * disc-shaped retina covers the corners of the image too.
 */
export function discToSquare(u: number, v: number): [number, number] {
  const r = Math.hypot(u, v);
  if (r > 1) {
    u /= r;
    v /= r;
  }
  const s2 = 2 * Math.SQRT2;
  const a = 2 + u * u - v * v;
  const b = 2 - u * u + v * v;
  const x = 0.5 * Math.sqrt(Math.max(0, a + s2 * u)) - 0.5 * Math.sqrt(Math.max(0, a - s2 * u));
  const y = 0.5 * Math.sqrt(Math.max(0, b + s2 * v)) - 0.5 * Math.sqrt(Math.max(0, b - s2 * v));
  return [Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))];
}

/**
 * Turns a GRID × GRID RGBA picture into features in [0, 1]: each channel is
 * divided by the image's brightest channel value, so dim photos drive the retina
 * as strongly as bright ones.
 */
export function encodePixels(rgba: ArrayLike<number>): Float32Array {
  const out = new Float32Array(FEATURES);
  let max = 1;
  for (let p = 0; p < GRID * GRID; p++) for (let c = 0; c < 3; c++) max = Math.max(max, rgba[4 * p + c]);
  for (let p = 0; p < GRID * GRID; p++) {
    for (let c = 0; c < 3; c++) out[p * CHANNELS + c] = rgba[4 * p + c] / max;
  }
  return out;
}

/**
 * Input rate for every retina neuron from image features. Rates are scaled so
 * the retina's mean rate is the same for every image (`meanRateHz`, capped at
 * `maxRateHz` per neuron): the network sees the pattern of colours, not how much
 * colour or light there is overall. Otherwise a yellow fruit (red and green
 * channels both bright) would drive it harder than a red one, and learning
 * would favour whichever class produces more activity.
 */
export function retinaRates(layout: RetinaLayout, features: Float32Array, meanRateHz: number, maxRateHz = 4 * meanRateHz): Float32Array {
  const rates = new Float32Array(layout.ids.length);
  let sum = 0;
  for (let k = 0; k < rates.length; k++) sum += features[layout.feature[k]];
  const scale = sum > 0 ? (meanRateHz * rates.length) / sum : 0;
  for (let k = 0; k < rates.length; k++) rates[k] = Math.min(maxRateHz, scale * features[layout.feature[k]]);
  return rates;
}
