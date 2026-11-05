/**
 * File formats. Three different things, never confused:
 *
 * 1. Configuration (`.neuroform.json`): recreates a network. Versioned JSON.
 * 2. Snapshot (`.nfsnap`): restores the complete dynamic state of a network built
 *    from the configuration embedded in it. Binary.
 * 3. Recording (`.nfrec`, see `sim/recording.ts`): spikes and measurements captured
 *    over time, for analysis and playback. Cannot restore state.
 *
 * Plus tabular exports (CSV) and a binary synapse table for very large networks.
 */

import { CONFIG_FORMAT, CONFIG_VERSION, type BrainConfig, type ConfigFile } from '../config/schema.ts';
import { validateConfig } from '../config/validate.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

export class ImportError extends Error {
  readonly details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'ImportError';
    this.details = details;
  }
}

// ------------------------------------------------------------------ configuration

export function configToFile(config: BrainConfig): string {
  const file: ConfigFile = { format: CONFIG_FORMAT, version: CONFIG_VERSION, exportedAt: new Date().toISOString(), config };
  return JSON.stringify(file, null, 2);
}

/** Parses and validates an exported configuration (or a bare configuration object). */
export function parseConfigFile(text: string): BrainConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ImportError('The file is not valid JSON.', [String(e)]);
  }
  if (!raw || typeof raw !== 'object') throw new ImportError('The file does not contain a configuration.');
  const obj = raw as Record<string, unknown>;
  let config: unknown = obj;
  if ('format' in obj) {
    if (obj.format === 'neuroform.snapshot' || obj.format === 'neuroform.recording') {
      throw new ImportError(`This is a ${String(obj.format).split('.')[1]}, not a configuration.`);
    }
    if (obj.format !== CONFIG_FORMAT) throw new ImportError(`Unknown format "${String(obj.format)}".`);
    if (typeof obj.version !== 'number' || obj.version > CONFIG_VERSION) {
      throw new ImportError(`Configuration version ${String(obj.version)} is newer than this application supports (${CONFIG_VERSION}).`);
    }
    config = obj.config;
  }
  const issues = validateConfig(config);
  if (issues.length > 0) {
    throw new ImportError('The configuration is not valid.', issues.slice(0, 12).map((i) => `${i.path}: ${i.message}`));
  }
  return config as BrainConfig;
}

// ------------------------------------------------------------------ snapshots

const SNAP_MAGIC = 'NFSNAPF1';

export interface SnapshotFileMeta {
  format: 'neuroform.snapshot';
  version: 1;
  createdAt: string;
  name: string;
  timeMs: number;
  step: number;
  topologyHash: string;
  config: BrainConfig;
}

export function encodeSnapshotFile(meta: SnapshotFileMeta, engine: Uint8Array): Uint8Array {
  const m = enc.encode(JSON.stringify(meta));
  const out = new Uint8Array(8 + 4 + m.length + engine.length);
  out.set(enc.encode(SNAP_MAGIC), 0);
  new DataView(out.buffer).setUint32(8, m.length, true);
  out.set(m, 12);
  out.set(engine, 12 + m.length);
  return out;
}

export function decodeSnapshotFile(bytes: Uint8Array): { meta: SnapshotFileMeta; engine: Uint8Array } {
  if (bytes.length < 12 || dec.decode(bytes.subarray(0, 8)) !== SNAP_MAGIC) {
    throw new ImportError('This file is not a NEUROFORM snapshot.');
  }
  const len = new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true);
  if (12 + len > bytes.length) throw new ImportError('The snapshot file is truncated.');
  let meta: SnapshotFileMeta;
  try {
    meta = JSON.parse(dec.decode(bytes.subarray(12, 12 + len)));
  } catch {
    throw new ImportError('The snapshot header is damaged.');
  }
  if (meta.format !== 'neuroform.snapshot' || meta.version !== 1) {
    throw new ImportError(`Unsupported snapshot format (${String(meta.format)} v${String(meta.version)}).`);
  }
  const issues = validateConfig(meta.config);
  if (issues.length) throw new ImportError('The configuration inside the snapshot is not valid.', issues.slice(0, 8).map((i) => `${i.path}: ${i.message}`));
  return { meta, engine: bytes.slice(12 + len) };
}

// ------------------------------------------------------------------ tables

export function csv(header: string[], rows: Iterable<(string | number)[]>): string {
  const esc = (v: string | number) => {
    const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toPrecision(7)) : v;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const r of rows) lines.push(r.map(esc).join(','));
  return lines.join('\n') + '\n';
}

/**
 * Binary synapse table (`.nfsyn`) for networks too large for CSV:
 * "NFSYN\0\0\x01", u32 header length, header JSON, then column arrays
 * pre u32[S], post u32[S], weight f32[S], delayMs f32[S], projection u8[S].
 */
export function encodeSynapseTable(header: object, pre: Uint32Array, post: Uint32Array, weight: Float32Array, delayMs: Float32Array, projection: Uint8Array): Uint8Array {
  const h = enc.encode(JSON.stringify(header));
  const s = pre.length;
  const out = new Uint8Array(8 + 4 + h.length + s * 17 + 4);
  const dv = new DataView(out.buffer);
  out.set(enc.encode('NFSYN\0\0\x01'), 0);
  dv.setUint32(8, h.length, true);
  out.set(h, 12);
  let o = 12 + h.length;
  o += (4 - (o % 4)) % 4;
  for (const arr of [pre, post]) for (let i = 0; i < s; i++, o += 4) dv.setUint32(o, arr[i], true);
  for (const arr of [weight, delayMs]) for (let i = 0; i < s; i++, o += 4) dv.setFloat32(o, arr[i], true);
  out.set(projection, o);
  return out.subarray(0, o + s);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
