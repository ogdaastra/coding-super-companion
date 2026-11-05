/** Scheduler, adaptive quality, picking, file formats and local persistence. */

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { StepScheduler } from '../../src/sim/scheduler.ts';
import { AdaptiveQuality } from '../../src/render/quality.ts';
import { pickNeuron } from '../../src/render/picking.ts';
import { csv, decodeSnapshotFile, encodeSnapshotFile } from '../../src/persistence/formats.ts';
import { RecordingWriter, parseRecording } from '../../src/sim/recording.ts';
import { LocalStore, newId } from '../../src/persistence/db.ts';
import { PRESETS } from '../../src/config/presets.ts';
import { loadEngine, smallConfig } from '../helpers/engine.ts';

describe('StepScheduler', () => {
  it('credits steps from wall time and speed', () => {
    const s = new StepScheduler({ dtMs: 0.5 });
    s.speed = 1;
    s.start(0);
    expect(s.credit(10)).toBe(20); // 10 ms wall at 1x = 20 steps of 0.5 ms
    s.ran(20, 5);
    expect(s.pending).toBe(0);
    s.speed = 0.1;
    expect(s.credit(110)).toBe(20); // 100 ms at 0.1x = 10 ms simulated
  });

  it('caps the backlog and reports lagging instead of bursting', () => {
    const s = new StepScheduler({ dtMs: 0.5, maxBacklogMs: 100 });
    s.speed = 1;
    s.start(0);
    const owed = s.credit(240);
    expect(owed).toBeLessThanOrEqual(200); // capped at 100 ms of work
    s.ran(10, 8);
    s.endSlice();
    expect(s.lagging).toBe(true);
  });

  it('runs as fast as possible at infinite speed', () => {
    const s = new StepScheduler({ dtMs: 0.5 });
    s.speed = Infinity;
    s.start(0);
    s.msPerStep = 0.01;
    expect(s.credit(5)).toBe(800); // 8 ms slice / 0.01 ms per step
  });
});

describe('AdaptiveQuality', () => {
  it('steps down after sustained slow frames and back up after sustained fast frames', () => {
    const q = new AdaptiveQuality(20);
    for (let i = 0; i < 40; i++) q.sample(100); // 4 s of 10 FPS
    expect(q.level).toBeGreaterThan(0);
    const reduced = q.level;
    for (let i = 0; i < 1500; i++) q.sample(8); // 12 s at 125 FPS
    expect(q.level).toBeLessThan(reduced);
    q.enabled = false;
    expect(q.reductions.resolution).toBe(1);
  });
});

describe('pickNeuron', () => {
  it('finds the neuron nearest the pointer in screen space', () => {
    // Identity view-projection: clip space = world space.
    const vp = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const pos = new Float32Array([0, 0, 0, 0.5, 0.5, 0, -0.5, -0.5, 0]);
    // (0.5, 0.5) clip → (75, 25) px on a 100×100 viewport.
    expect(pickNeuron(pos, vp, 75, 25, 100, 100, 5)?.neuron).toBe(1);
    expect(pickNeuron(pos, vp, 50, 50, 100, 100, 5)?.neuron).toBe(0);
    expect(pickNeuron(pos, vp, 10, 90, 100, 100, 3)).toBeNull();
  });
});

describe('file formats', () => {
  it('snapshot files carry their configuration and engine state', async () => {
    const mod = await loadEngine();
    const cfg = smallConfig();
    const net = mod.build(cfg);
    net.run(100);
    const engine = net.snapshot();
    const file = encodeSnapshotFile({ format: 'neuroform.snapshot', version: 1, createdAt: 'x', name: 't', timeMs: 50, step: 100, topologyHash: net.info.topologyHash, config: cfg }, engine);
    const back = decodeSnapshotFile(file);
    expect(back.meta.config).toEqual(cfg);
    expect(back.engine).toEqual(engine);
    expect(() => decodeSnapshotFile(file.subarray(0, 10))).toThrow();
    net.free();
  });

  it('recordings round-trip spikes and measurements', async () => {
    const mod = await loadEngine();
    const net = mod.build(smallConfig());
    const w = new RecordingWriter(net.info, smallConfig(), 0, 0, 1_000_000);
    net.run(400);
    w.addSpikes(net.view('frameSpikes'));
    w.addTelemetry(net.telemetry());
    const n = net.view('frameSpikes').length / 2;
    const rec = parseRecording(w.finish(net.timeMs, net.step));
    expect(rec.header.spikes).toBe(n);
    expect(rec.spikes.length).toBe(2 * n);
    expect(rec.samples.length).toBe(1);
    expect(rec.header.topologyHash).toBe(net.info.topologyHash);
    expect(() => parseRecording(new Uint8Array(20))).toThrow(/not a NEUROFORM recording/);
    net.free();
  });

  it('CSV escapes fields', () => {
    expect(csv(['a', 'b'], [['x,y', 1.5], ['q"', 2]])).toBe('a,b\n"x,y",1.500000\n"q""",2\n');
  });
});

describe('LocalStore (IndexedDB)', () => {
  it('persists projects, snapshots and settings', async () => {
    const db = await LocalStore.open(`test-${Math.random()}`);
    expect(db.persistent).toBe(true);
    const id = newId('prj');
    const config = PRESETS[1].create(400, 1);
    await db.saveProject({ id, name: 'Test', createdAt: 1, updatedAt: 2, config });
    expect((await db.listProjects()).map((p) => p.name)).toEqual(['Test']);
    const sid = newId('snp');
    await db.saveSnapshot({ id: sid, projectId: id, name: 's', createdAt: 3, timeMs: 1, step: 2, topologyHash: 'h', neurons: 400, synapses: 1, size: 4, config }, new Uint8Array([1, 2, 3, 4]));
    expect((await db.listSnapshots(id)).length).toBe(1);
    expect(Array.from((await db.snapshotData(sid))!)).toEqual([1, 2, 3, 4]);
    await db.setSetting('prefs', { quality: 'high' });
    expect(await db.getSetting('prefs', {})).toEqual({ quality: 'high' });
    await db.deleteProject(id);
    expect(await db.listProjects()).toEqual([]);
    expect(await db.snapshotData(sid)).toBeNull();
  });

  it('falls back to memory when IndexedDB is unavailable', async () => {
    const mem = LocalStore.memory();
    expect(mem.persistent).toBe(false);
    await mem.setSetting('k', 1);
    expect(await mem.getSetting('k', 0)).toBe(1);
  });
});
