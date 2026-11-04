/**
 * Experiment recordings (`.nfrec`): every spike emitted during the recording plus
 * the telemetry measured, for analysis and visual playback.
 *
 * A recording is *not* a snapshot: replaying it shows what happened, but it does
 * not contain (and cannot restore) membrane potentials, weights or queued events.
 *
 * Layout (little-endian):
 *   "NFREC\0\0\x01"            magic
 *   u32  header length, header JSON (RecordingHeader)
 *   u32  spike pair count, then (step u32, neuron u32) pairs
 *   u32  telemetry JSON length, telemetry JSON (RecordingSample[])
 */

import type { NetInfo, TelemetryReport } from '../engine/types.ts';
import type { BrainConfig } from '../config/schema.ts';

export const RECORDING_MAGIC = 'NFREC\0\0\x01';

export interface RecordingHeader {
  format: 'neuroform.recording';
  version: 1;
  createdAt: string;
  configName: string;
  topologyHash: string;
  dt: number;
  neurons: number;
  regions: { name: string; start: number; excEnd: number; end: number }[];
  startStep: number;
  endStep: number;
  startMs: number;
  endMs: number;
  spikes: number;
  truncated: boolean;
}

/** Compact per-window measurements stored with a recording. */
export interface RecordingSample {
  t: number;
  windowMs: number;
  /** Spikes per region (exc + inh) in the window. */
  spikes: number[];
  vMean: number;
  synchrony: number;
  active: number;
}

export interface Recording {
  header: RecordingHeader;
  /** (step, neuron) pairs. */
  spikes: Uint32Array;
  samples: RecordingSample[];
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export class RecordingWriter {
  readonly startMs: number;
  private readonly startStep: number;
  private readonly info: NetInfo;
  private readonly configName: string;
  private readonly maxSpikes: number;
  private chunks: Uint32Array[] = [];
  private current = new Uint32Array(1 << 16);
  private len = 0;
  spikeCount = 0;
  truncated = false;
  private samples: RecordingSample[] = [];

  constructor(info: NetInfo, config: BrainConfig | null, startMs: number, startStep: number, maxSpikes: number) {
    this.info = info;
    this.configName = config?.name ?? 'network';
    this.startMs = startMs;
    this.startStep = startStep;
    this.maxSpikes = maxSpikes;
  }

  addSpikes(pairs: Uint32Array): void {
    let k = 0;
    while (k < pairs.length) {
      if (this.spikeCount >= this.maxSpikes) {
        this.truncated = true;
        return;
      }
      if (this.len === this.current.length) {
        this.chunks.push(this.current);
        this.current = new Uint32Array(1 << 16);
        this.len = 0;
      }
      const n = Math.min(pairs.length - k, this.current.length - this.len, (this.maxSpikes - this.spikeCount) * 2);
      this.current.set(pairs.subarray(k, k + n), this.len);
      this.len += n;
      k += n;
      this.spikeCount += n / 2;
    }
  }

  addTelemetry(r: TelemetryReport): void {
    if (this.samples.length > 100_000) return;
    this.samples.push({
      t: r.timeMs,
      windowMs: r.windowMs,
      spikes: r.regions.map((x) => x.spikesExc + x.spikesInh),
      vMean: r.vMean,
      synchrony: r.synchrony,
      active: r.activeNeurons,
    });
  }

  finish(endMs: number, endStep: number): Uint8Array {
    const header: RecordingHeader = {
      format: 'neuroform.recording',
      version: 1,
      createdAt: new Date().toISOString(),
      configName: this.configName,
      topologyHash: this.info.topologyHash,
      dt: this.info.dt,
      neurons: this.info.neurons,
      regions: this.info.regions.map((r) => ({ name: r.name, start: r.start, excEnd: r.excEnd, end: r.end })),
      startStep: this.startStep,
      endStep,
      startMs: this.startMs,
      endMs,
      spikes: this.spikeCount,
      truncated: this.truncated,
    };
    const h = enc.encode(JSON.stringify(header));
    const t = enc.encode(JSON.stringify(this.samples));
    const words = this.chunks.reduce((a, c) => a + c.length, 0) + this.len;
    const out = new Uint8Array(8 + 4 + h.length + 4 + words * 4 + 4 + t.length);
    const dv = new DataView(out.buffer);
    out.set(enc.encode(RECORDING_MAGIC), 0);
    let o = 8;
    dv.setUint32(o, h.length, true);
    o += 4;
    out.set(h, o);
    o += h.length;
    dv.setUint32(o, words / 2, true);
    o += 4;
    for (const c of [...this.chunks, this.current.subarray(0, this.len)]) {
      for (let i = 0; i < c.length; i++, o += 4) dv.setUint32(o, c[i], true);
    }
    dv.setUint32(o, t.length, true);
    o += 4;
    out.set(t, o);
    return out;
  }
}

export function parseRecording(bytes: Uint8Array): Recording {
  if (bytes.length < 16 || dec.decode(bytes.subarray(0, 8)) !== RECORDING_MAGIC) {
    throw new Error('This file is not a NEUROFORM recording.');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 8;
  const need = (n: number) => {
    if (o + n > bytes.length) throw new Error('The recording is truncated.');
  };
  need(4);
  const hl = dv.getUint32(o, true);
  o += 4;
  need(hl);
  const header = JSON.parse(dec.decode(bytes.subarray(o, o + hl))) as RecordingHeader;
  if (header.format !== 'neuroform.recording' || header.version !== 1) {
    throw new Error(`Unsupported recording format (${header.format} v${header.version}).`);
  }
  o += hl;
  need(4);
  const pairs = dv.getUint32(o, true);
  o += 4;
  need(pairs * 8);
  const spikes = new Uint32Array(pairs * 2);
  for (let i = 0; i < spikes.length; i++, o += 4) spikes[i] = dv.getUint32(o, true);
  need(4);
  const tl = dv.getUint32(o, true);
  o += 4;
  need(tl);
  const samples = JSON.parse(dec.decode(bytes.subarray(o, o + tl))) as RecordingSample[];
  return { header, spikes, samples };
}
