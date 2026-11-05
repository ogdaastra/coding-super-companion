/**
 * Measurements over captured spikes. Inputs are (step, neuron) pairs exactly as
 * emitted by the engine; nothing is estimated from configuration.
 */

import type { NetInfo } from '../engine/types.ts';

export function regionLookup(info: NetInfo): Uint16Array {
  const out = new Uint16Array(info.neurons);
  info.regions.forEach((r, i) => out.fill(i, r.start, r.end));
  return out;
}

/** Spikes per region within [fromStep, toStep). */
export function countByRegion(spikes: Uint32Array, regionOf: Uint16Array, regions: number, fromStep = 0, toStep = Infinity): number[] {
  const out = new Array(regions).fill(0);
  for (let k = 0; k + 1 < spikes.length; k += 2) {
    const s = spikes[k];
    if (s >= fromStep && s < toStep) out[regionOf[spikes[k + 1]]]++;
  }
  return out;
}

export function distinctNeurons(spikes: Uint32Array, fromStep = 0, toStep = Infinity, filter?: (i: number) => boolean): number {
  const seen = new Set<number>();
  for (let k = 0; k + 1 < spikes.length; k += 2) {
    const s = spikes[k];
    const j = spikes[k + 1];
    if (s >= fromStep && s < toStep && (!filter || filter(j))) seen.add(j);
  }
  return seen.size;
}

/** Spike counts per region in consecutive bins starting at `fromStep`. */
export function binned(spikes: Uint32Array, regionOf: Uint16Array, regions: number, fromStep: number, binSteps: number, bins: number): number[][] {
  const out = Array.from({ length: regions }, () => new Array(bins).fill(0));
  for (let k = 0; k + 1 < spikes.length; k += 2) {
    const b = Math.floor((spikes[k] - fromStep) / binSteps);
    if (b >= 0 && b < bins) out[regionOf[spikes[k + 1]]][b]++;
  }
  return out;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function std(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/** Pearson correlation; 0 when either series is constant. */
export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    sab += x * y;
    saa += x * x;
    sbb += y * y;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

/**
 * First time a binned response exceeds baseline mean + k·σ (per bin) for two
 * consecutive bins. Returns the bin index or -1.
 */
export function onsetBin(series: number[], baselineMean: number, baselineStd: number, k = 4): number {
  const thr = baselineMean + k * Math.max(baselineStd, 0.5);
  for (let i = 0; i + 1 < series.length; i++) if (series[i] > thr && series[i + 1] > thr) return i;
  return -1;
}

export function fmt(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1000) return Math.round(v).toLocaleString('en-GB');
  if (a >= 100) return v.toFixed(Math.max(0, digits - 2));
  if (a >= 10) return v.toFixed(Math.max(0, digits - 1));
  return v.toFixed(digits);
}

export function pct(before: number, after: number): string {
  if (!Number.isFinite(before) || Math.abs(before) < 1e-12) return '—';
  const d = ((after - before) / Math.abs(before)) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)} %`;
}
