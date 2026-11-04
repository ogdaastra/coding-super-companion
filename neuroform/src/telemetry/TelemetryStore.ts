/**
 * Telemetry histories on the main thread.
 *
 * Every value here is derived from a worker telemetry report (engine
 * measurements) or from the renderer's own frame timing. Histories are bounded
 * rings; charts read them directly in their animation frames, and React components
 * subscribe to the coarse `version` counter only.
 */

import type { NetInfo, TelemetryReport } from '../engine/types.ts';
import { PROBE_FLAG_SPIKE, PROBE_STRIDE } from '../engine/types.ts';
import type { ProbeBlock, TelemetryEvent, WorkerPerf } from '../sim/protocol.ts';
import { EventRing, Ring } from './ring.ts';

export const HISTORY = 3000; // samples (5 min at 10 Hz)
const RASTER_EVENTS = 240_000;
const PROBE_SAMPLES = 24_000;

export interface ProbeTrace {
  neuron: number;
  /** Step of each sample. */
  step: Ring;
  v: Ring;
  syn: Ring;
  flags: Ring;
}

export class TelemetryStore {
  info: NetInfo | null = null;
  sampleNeurons: Uint32Array = new Uint32Array(0);
  /** Region of each raster row. */
  sampleRegion: Uint16Array = new Uint16Array(0);

  readonly t = new Ring(HISTORY);
  readonly rate = new Ring(HISTORY);
  readonly excRate = new Ring(HISTORY);
  readonly inhRate = new Ring(HISTORY);
  readonly vMean = new Ring(HISTORY);
  readonly active = new Ring(HISTORY);
  readonly synchrony = new Ring(HISTORY);
  readonly groupSynchrony = new Ring(HISTORY);
  readonly spikesPerSecond = new Ring(HISTORY);
  readonly eventsPerSecond = new Ring(HISTORY);
  readonly potentiation = new Ring(HISTORY);
  readonly depression = new Ring(HISTORY);
  readonly modulator = new Ring(HISTORY);
  readonly meanWeight = new Ring(HISTORY);
  readonly meanWeightT = new Ring(HISTORY);
  regionRate: Ring[] = [];
  regionV: Ring[] = [];
  regionSync: Ring[] = [];

  // Performance (wall-clock sampled).
  readonly perfT = new Ring(HISTORY);
  readonly rtf = new Ring(HISTORY);
  readonly stepsPerSecond = new Ring(HISTORY);
  readonly busy = new Ring(HISTORY);
  readonly fps = new Ring(HISTORY);
  readonly frameMs = new Ring(HISTORY);
  readonly msPerStep = new Ring(HISTORY);

  readonly raster = new EventRing(RASTER_EVENTS);
  probes = new Map<number, ProbeTrace>();
  tracked = new Map<number, { t: Ring; w: Ring }>();

  latest: TelemetryReport | null = null;
  perf: WorkerPerf | null = null;
  /** Synaptic events per projection per second (latest window). */
  projectionRate: Float64Array = new Float64Array(0);
  /** Exponentially smoothed projection rates for the connectome view. */
  projectionRateSmooth: Float64Array = new Float64Array(0);
  totalSpikes = 0;
  recording: TelemetryEvent['recording'] = null;
  version = 0;
  private listeners = new Set<() => void>();

  reset(info: NetInfo, sample: Uint32Array, regionOf: Uint16Array): void {
    this.info = info;
    this.sampleNeurons = sample;
    this.sampleRegion = new Uint16Array(sample.length);
    for (let k = 0; k < sample.length; k++) this.sampleRegion[k] = regionOf[sample[k]];
    for (const r of [
      this.t, this.rate, this.excRate, this.inhRate, this.vMean, this.active, this.synchrony,
      this.groupSynchrony, this.spikesPerSecond, this.eventsPerSecond, this.potentiation,
      this.depression, this.modulator, this.meanWeight, this.meanWeightT,
    ]) r.clear();
    this.regionRate = info.regions.map(() => new Ring(HISTORY));
    this.regionV = info.regions.map(() => new Ring(HISTORY));
    this.regionSync = info.regions.map(() => new Ring(HISTORY));
    this.raster.clear();
    this.probes.clear();
    this.tracked.clear();
    this.projectionRate = new Float64Array(info.projections.length);
    this.projectionRateSmooth = new Float64Array(info.projections.length);
    this.latest = null;
    this.totalSpikes = 0;
    this.bump();
  }

  /** Clears the time series but keeps the network description (after a reset). */
  clearHistory(): void {
    if (this.info) this.reset(this.info, this.sampleNeurons, this.regionOfSample());
  }

  private regionOfSample(): Uint16Array {
    // reset() needs regionOf indexed by neuron; rebuild a sparse lookup from rows.
    const n = this.info ? this.info.neurons : 0;
    const out = new Uint16Array(n);
    for (let k = 0; k < this.sampleNeurons.length; k++) out[this.sampleNeurons[k]] = this.sampleRegion[k];
    return out;
  }

  ingest(e: TelemetryEvent): void {
    const info = this.info;
    if (!info) return;
    const r = e.report;
    this.latest = r;
    this.perf = e.perf;
    this.recording = e.recording;
    const now = performance.now();
    this.perfT.push(now);
    this.rtf.push(e.perf.realtimeFactor);
    this.stepsPerSecond.push(e.perf.stepsPerSecond);
    this.busy.push(e.perf.busyFraction);
    this.msPerStep.push(e.perf.msPerStep);

    if (r.windowSteps > 0) {
      const secs = r.windowMs / 1000;
      let exc = 0;
      let inh = 0;
      let ne = 0;
      let ni = 0;
      r.regions.forEach((rr, i) => {
        const reg = info.regions[i];
        const e = reg.excEnd - reg.start;
        const n = reg.end - reg.start;
        exc += rr.spikesExc;
        inh += rr.spikesInh;
        ne += e;
        ni += n - e;
        this.regionRate[i]?.push((rr.spikesExc + rr.spikesInh) / Math.max(1, n) / secs);
        this.regionV[i]?.push(rr.vMean);
        this.regionSync[i]?.push(rr.synchrony);
      });
      const spikes = exc + inh;
      this.totalSpikes += spikes;
      this.t.push(r.timeMs);
      this.rate.push(spikes / Math.max(1, info.neurons) / secs);
      this.excRate.push(exc / Math.max(1, ne) / secs);
      this.inhRate.push(inh / Math.max(1, ni) / secs);
      this.vMean.push(r.vMean);
      this.active.push(r.activeNeurons);
      this.synchrony.push(r.synchrony);
      this.groupSynchrony.push(r.groupSynchrony);
      this.spikesPerSecond.push(spikes / secs);
      this.eventsPerSecond.push(r.eventsScheduled / secs);
      this.potentiation.push(r.plasticity.potentiation);
      this.depression.push(r.plasticity.depression);
      this.modulator.push(r.plasticity.modulator);
      for (let p = 0; p < r.projectionEvents.length; p++) {
        const v = r.projectionEvents[p] / secs;
        this.projectionRate[p] = v;
        this.projectionRateSmooth[p] = this.projectionRateSmooth[p] * 0.8 + v * 0.2;
      }
    }

    const dt = info.dt;
    const ras = e.raster;
    for (let k = 0; k + 1 < ras.length; k += 2) this.raster.push(ras[k] * dt, ras[k + 1]);
    if (e.probes) this.ingestProbes(e.probes);
    if (e.tracked) {
      for (let k = 0; k < e.tracked.ids.length; k++) {
        const id = e.tracked.ids[k];
        let tr = this.tracked.get(id);
        if (!tr) {
          tr = { t: new Ring(HISTORY), w: new Ring(HISTORY) };
          this.tracked.set(id, tr);
        }
        tr.t.push(r.timeMs);
        tr.w.push(e.tracked.weights[k]);
      }
    }
    this.bump();
  }

  private ingestProbes(p: ProbeBlock): void {
    const n = p.ids.length;
    if (n === 0) return;
    for (const id of p.ids) {
      if (!this.probes.has(id)) {
        this.probes.set(id, { neuron: id, step: new Ring(PROBE_SAMPLES), v: new Ring(PROBE_SAMPLES), syn: new Ring(PROBE_SAMPLES), flags: new Ring(PROBE_SAMPLES) });
      }
    }
    const steps = p.samples.length / (n * PROBE_STRIDE);
    for (let s = 0; s < steps; s++) {
      for (let k = 0; k < n; k++) {
        const tr = this.probes.get(p.ids[k])!;
        const o = (s * n + k) * PROBE_STRIDE;
        tr.step.push(p.startStep + s);
        tr.v.push(p.samples[o]);
        tr.syn.push(p.samples[o + 1]);
        tr.flags.push(p.samples[o + 2]);
      }
    }
  }

  /** Spike times (ms) of a probed neuron within its retained trace. */
  probeSpikes(neuron: number): number[] {
    const tr = this.probes.get(neuron);
    if (!tr || !this.info) return [];
    const out: number[] = [];
    for (let k = 0; k < tr.flags.length; k++) if (tr.flags.at(k) === PROBE_FLAG_SPIKE) out.push(tr.step.at(k) * this.info.dt);
    return out;
  }

  dropProbe(neuron: number): void {
    this.probes.delete(neuron);
  }

  pushFrameTiming(fps: number, frameMs: number): void {
    this.fps.push(fps);
    this.frameMs.push(frameMs);
  }

  recordMeanWeight(t: number, w: number): void {
    this.meanWeightT.push(t);
    this.meanWeight.push(w);
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  private bump(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}
