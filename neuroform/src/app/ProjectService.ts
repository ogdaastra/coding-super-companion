/**
 * Projects, snapshots, recordings and file import/export.
 */

import type { AppController } from './AppController.ts';
import { newId, type ProjectRecord, type SnapshotRecord, type RecordingRecord, StorageError } from '../persistence/db.ts';
import { configToFile, csv, decodeSnapshotFile, encodeSnapshotFile, encodeSynapseTable, ImportError, parseConfigFile } from '../persistence/formats.ts';
import { parseRecording } from '../sim/recording.ts';
import { platform, slug, timestampName } from '../platform/platform.ts';
import type { BrainConfig } from '../config/schema.ts';
import { presetById, tierById } from '../config/presets.ts';
import { suggestedTier } from './AppController.ts';

export class ProjectService {
  private readonly app: AppController;
  private autosaveTimer = 0;

  constructor(app: AppController) {
    this.app = app;
  }

  private get db() {
    return this.app.db;
  }

  private storageFailed(e: unknown, what: string): void {
    const quota = e instanceof StorageError && e.quota;
    this.app.toast('error', `${what} could not be saved`, e instanceof Error ? e.message : String(e), quota ? { label: 'Manage data', run: () => this.app.openDialog('projects') } : undefined);
  }

  // ------------------------------------------------------------------ projects

  async openInitialProject(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const preset = params.get('preset');
    const neurons = Number(params.get('neurons') ?? 0);
    if (preset && presetById(preset)) {
      const info = presetById(preset)!;
      const tier = tierById(params.get('tier') ?? info.defaultTier) ?? tierById(suggestedTier())!;
      await this.createProject(info.create(neurons > 0 ? neurons : Math.min(tier.neurons, info.maxNeurons ?? Infinity), Number(params.get('seed') ?? 1)), { run: false });
      return;
    }
    const lastId = await this.db.getSetting<string | null>('lastProject', null);
    const last = lastId ? await this.db.getProject(lastId) : undefined;
    if (last) {
      await this.openProject(last.id, { run: false });
      return;
    }
    await this.createProject(this.app.defaultConfig(), { run: false });
  }

  async createProject(config: BrainConfig, opts: { run?: boolean; name?: string } = {}): Promise<void> {
    const now = Date.now();
    const project: ProjectRecord = { id: newId('prj'), name: opts.name ?? config.name, createdAt: now, updatedAt: now, config };
    await this.app.buildNetwork(config, { run: opts.run });
    this.app.store.set({ project: { id: project.id, name: project.name, savedAt: null } });
    try {
      await this.db.saveProject(project);
      await this.db.setSetting('lastProject', project.id);
      this.app.store.set({ project: { id: project.id, name: project.name, savedAt: now } });
    } catch (e) {
      this.storageFailed(e, 'The project');
    }
    this.bump();
  }

  async openProject(id: string, opts: { run?: boolean } = {}): Promise<void> {
    const p = await this.db.getProject(id);
    if (!p) {
      this.app.toast('error', 'Project not found');
      return;
    }
    await this.app.buildNetwork(p.config, { run: opts.run });
    this.app.store.set({ project: { id: p.id, name: p.name, savedAt: p.updatedAt } });
    if (p.view?.viz) this.app.setViz(p.view.viz as never);
    await this.db.setSetting('lastProject', p.id).catch(() => {});
  }

  /** Saves the live configuration into the current project. */
  async saveProject(): Promise<void> {
    const s = this.app.state;
    if (!s.config) return;
    const id = s.project?.id ?? newId('prj');
    const existing = s.project ? await this.db.getProject(id) : undefined;
    const now = Date.now();
    const rec: ProjectRecord = {
      id,
      name: s.project?.name ?? s.config.name,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      config: s.config,
      view: { viz: s.viz, quality: s.render.quality },
      notes: existing?.notes,
    };
    try {
      await this.db.saveProject(rec);
      await this.db.setSetting('lastProject', id);
      this.app.store.set({ project: { id, name: rec.name, savedAt: now } });
      this.app.toast('success', 'Project saved', this.db.persistent ? 'Stored in this browser.' : 'Local storage is unavailable: it will be lost when the tab closes. Export it to keep it.');
    } catch (e) {
      this.storageFailed(e, 'The project');
    }
    this.bump();
  }

  scheduleAutosave(): void {
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => void this.saveProjectQuiet(), 1500);
  }

  private async saveProjectQuiet(): Promise<void> {
    const s = this.app.state;
    if (!s.config || !s.project) return;
    try {
      const existing = await this.db.getProject(s.project.id);
      await this.db.saveProject({ ...(existing ?? { id: s.project.id, createdAt: Date.now() }), name: s.project.name, updatedAt: Date.now(), config: s.config, view: { viz: s.viz, quality: s.render.quality } } as ProjectRecord);
    } catch {
      /* autosave is best-effort; explicit saves report errors */
    }
  }

  async renameProject(name: string): Promise<void> {
    const s = this.app.state;
    if (!s.project || !name.trim()) return;
    this.app.store.set({ project: { ...s.project, name: name.trim() } });
    await this.saveProjectQuiet();
    this.bump();
  }

  async deleteProject(id: string): Promise<void> {
    await this.db.deleteProject(id);
    if (this.app.state.project?.id === id) this.app.store.set({ project: null });
    this.bump();
  }

  async duplicateProject(id: string): Promise<void> {
    const p = await this.db.getProject(id);
    if (!p) return;
    const now = Date.now();
    await this.db.saveProject({ ...p, id: newId('prj'), name: `${p.name} (copy)`, createdAt: now, updatedAt: now });
    this.bump();
  }

  /** Signals list views to refresh. */
  bump(): void {
    this.app.store.set((s) => ({ librarySeq: s.librarySeq + 1 }));
  }

  // ------------------------------------------------------------------ snapshots

  async takeSnapshot(name?: string): Promise<SnapshotRecord | null> {
    const s = this.app.state;
    if (!s.config || !s.info) return null;
    if (!s.project) await this.saveProject();
    const projectId = this.app.state.project!.id;
    try {
      const r = await this.app.client.request('snapshot', {});
      const meta: SnapshotRecord = {
        id: newId('snp'),
        projectId,
        name: name || `t = ${(r.timeMs / 1000).toFixed(2)} s`,
        createdAt: Date.now(),
        timeMs: r.timeMs,
        step: r.step,
        topologyHash: s.info.topologyHash,
        neurons: s.info.neurons,
        synapses: s.info.synapses,
        size: r.bytes.byteLength,
        config: s.config,
      };
      await this.db.saveSnapshot(meta, r.bytes);
      this.app.toast('success', 'Snapshot saved', `${meta.name} · ${(meta.size / 1048576).toFixed(1)} MiB`);
      this.bump();
      return meta;
    } catch (e) {
      this.storageFailed(e, 'The snapshot');
      return null;
    }
  }

  async restoreSnapshot(id: string): Promise<void> {
    const metas = this.app.state.project ? await this.db.listSnapshots(this.app.state.project.id) : [];
    const meta = metas.find((m) => m.id === id);
    const data = await this.db.snapshotData(id);
    if (!meta || !data) {
      this.app.toast('error', 'Snapshot not found');
      return;
    }
    await this.restoreBytes(meta.config, meta.topologyHash, data, meta.name);
  }

  private async restoreBytes(config: BrainConfig, hash: string, bytes: Uint8Array, name: string): Promise<void> {
    const app = this.app;
    const wasRunning = app.state.sim.status === 'running';
    if (wasRunning) await app.pause();
    try {
      if (app.state.info?.topologyHash !== hash) {
        // The snapshot belongs to a different network: rebuild that network first.
        await app.buildNetwork(config, { run: false });
        if (app.state.info?.topologyHash !== hash) throw new Error('Rebuilding the snapshot configuration produced a different network (engine version mismatch?).');
      }
      const r = await app.client.request('restore', { bytes });
      app.telemetry.clearHistory();
      app.store.set((s) => ({ sim: { ...s.sim, timeMs: r.timeMs, step: r.step } }));
      app.toast('success', `Restored ${name}`, `Simulation time ${(r.timeMs / 1000).toFixed(3)} s`);
      await app.refreshNeuron();
      if (wasRunning) await app.run();
    } catch (e) {
      app.toast('error', 'The snapshot could not be restored', e instanceof Error ? e.message : String(e));
    }
  }

  async deleteSnapshot(id: string): Promise<void> {
    await this.db.deleteSnapshot(id);
    this.bump();
  }

  async exportSnapshot(id: string): Promise<void> {
    const metas = this.app.state.project ? await this.db.listSnapshots(this.app.state.project.id) : [];
    const meta = metas.find((m) => m.id === id);
    const data = await this.db.snapshotData(id);
    if (!meta || !data) return;
    const file = encodeSnapshotFile(
      { format: 'neuroform.snapshot', version: 1, createdAt: new Date(meta.createdAt).toISOString(), name: meta.name, timeMs: meta.timeMs, step: meta.step, topologyHash: meta.topologyHash, config: meta.config },
      data,
    );
    await platform.save(`${slug(meta.config.name)}-${slug(meta.name)}.nfsnap`, file, 'application/octet-stream');
  }

  /** Exports the live state directly (without storing it first). */
  async exportCurrentState(): Promise<void> {
    const s = this.app.state;
    if (!s.config || !s.info) return;
    const r = await this.app.client.request('snapshot', {});
    const file = encodeSnapshotFile(
      { format: 'neuroform.snapshot', version: 1, createdAt: new Date().toISOString(), name: `t=${(r.timeMs / 1000).toFixed(2)}s`, timeMs: r.timeMs, step: r.step, topologyHash: s.info.topologyHash, config: s.config },
      r.bytes,
    );
    await platform.save(timestampName(slug(s.config.name), 'nfsnap'), file, 'application/octet-stream');
  }

  // ------------------------------------------------------------------ import / export

  async exportConfig(config = this.app.state.config): Promise<void> {
    if (!config) return;
    await platform.save(`${slug(config.name)}.neuroform.json`, configToFile(config), 'application/json');
  }

  /** Imports a configuration, snapshot or recording file (detected by content). */
  async importFile(file: File): Promise<void> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const head = new TextDecoder().decode(bytes.subarray(0, 8));
    try {
      if (head === 'NFSNAPF1') {
        const { meta, engine } = decodeSnapshotFile(bytes);
        await this.createProjectRecordOnly(meta.config, `${meta.config.name} (imported)`);
        await this.restoreBytes(meta.config, meta.topologyHash, engine, meta.name);
        return;
      }
      if (head.startsWith('NFREC')) {
        const rec = parseRecording(bytes);
        await this.storeRecording(bytes, `${rec.header.configName} (imported)`, rec.header.endMs - rec.header.startMs, rec.header.spikes, rec.header.topologyHash);
        this.app.toast('success', 'Recording imported', 'Open it from Projects → Recordings to play it back.');
        return;
      }
      const config = parseConfigFile(new TextDecoder().decode(bytes));
      await this.createProject(config, { name: config.name, run: true });
      this.app.toast('success', `Imported “${config.name}”`, `${config.regions.length} regions, ${config.projections.length} projections`);
    } catch (e) {
      const details = e instanceof ImportError ? e.details.join('\n') : undefined;
      this.app.toast('error', e instanceof Error ? e.message : 'Import failed', details);
    }
  }

  private async createProjectRecordOnly(config: BrainConfig, name: string): Promise<void> {
    const now = Date.now();
    const id = newId('prj');
    try {
      await this.db.saveProject({ id, name, createdAt: now, updatedAt: now, config });
    } catch (e) {
      this.storageFailed(e, 'The project');
    }
    this.app.store.set({ project: { id, name, savedAt: now } });
    this.bump();
  }

  async pickAndImport(): Promise<void> {
    const f = await platform.open('.json,.nfsnap,.nfrec,application/json,application/octet-stream');
    if (f) await this.importFile(f);
  }

  async exportNeurons(): Promise<void> {
    const s = this.app.state;
    if (!s.info || !s.config) return;
    const t = await this.app.client.request('neuronTable', {});
    const secs = Math.max(1e-9, t.timeMs / 1000);
    const regions = s.info.regions.map((r) => r.name);
    const rows = function* () {
      for (let i = 0; i < t.regionOf.length; i++) {
        yield [i, regions[t.regionOf[i]], t.classOf[i] ? 'inhibitory' : 'excitatory', t.positions[3 * i], t.positions[3 * i + 1], t.positions[3 * i + 2], t.threshold[i], t.excitability[i], t.membrane[i], t.inDegree[i], t.outDegree[i], t.spikeCount[i], t.spikeCount[i] / secs];
      }
    };
    const text = csv(['id', 'region', 'class', 'x', 'y', 'z', 'threshold_mV', 'excitability', 'membrane_mV', 'in_degree', 'out_degree', 'spike_count', 'mean_rate_hz'], rows());
    await platform.save(timestampName(`${slug(s.config.name)}-neurons`, 'csv'), text, 'text/csv');
  }

  async exportSynapses(): Promise<void> {
    const s = this.app.state;
    if (!s.info || !s.config) return;
    const t = await this.app.client.request('synapseTable', {});
    const n = t.rowPtr.length - 1;
    const total = t.target.length;
    const pre = new Uint32Array(total);
    for (let j = 0; j < n; j++) pre.fill(j, t.rowPtr[j], t.rowPtr[j + 1]);
    const projections = s.info.projections;
    if (total <= 1_500_000) {
      const rows = function* () {
        for (let k = 0; k < total; k++) {
          const p = projections[t.projection[k]];
          yield [k, pre[k], t.target[k], t.weight[k], t.delay[k] * t.dt, p.id, p.source, p.plastic ? p.rule : 'static'];
        }
      };
      await platform.save(timestampName(`${slug(s.config.name)}-synapses`, 'csv'), csv(['id', 'pre', 'post', 'weight', 'delay_ms', 'projection', 'class', 'plasticity'], rows()), 'text/csv');
    } else {
      const delayMs = new Float32Array(total);
      for (let k = 0; k < total; k++) delayMs[k] = t.delay[k] * t.dt;
      const header = { format: 'neuroform.synapses', version: 1, synapses: total, neurons: n, projections: projections.map((p) => ({ id: p.id, source: p.source, plastic: p.plastic })) };
      await platform.save(timestampName(`${slug(s.config.name)}-synapses`, 'nfsyn'), encodeSynapseTable(header, pre, t.target, t.weight, delayMs, t.projection), 'application/octet-stream');
      this.app.toast('info', 'Binary synapse table exported', `${total.toLocaleString('en-GB')} synapses is too many for CSV; the .nfsyn layout is documented in docs/FORMATS.md.`);
    }
  }

  async exportSpikes(): Promise<void> {
    const s = this.app.state;
    const tel = this.app.telemetry;
    if (!s.config) return;
    const r = tel.raster;
    const regions = s.info?.regions.map((x) => x.name) ?? [];
    const rows = function* () {
      for (let k = 0; k < r.length; k++) {
        const i = r.index(k);
        const row = r.a[i];
        yield [r.t[i], tel.sampleNeurons[row], regions[tel.sampleRegion[row]] ?? ''];
      }
    };
    await platform.save(timestampName(`${slug(s.config.name)}-spikes`, 'csv'), csv(['time_ms', 'neuron', 'region'], rows()), 'text/csv');
    this.app.toast('info', 'Spike history exported', 'Contains the recorded raster rows. Use a recording to capture every spike of every neuron.');
  }

  async exportTelemetry(): Promise<void> {
    const s = this.app.state;
    const tel = this.app.telemetry;
    if (!s.config || !s.info) return;
    const names = s.info.regions.map((r) => `${slug(r.name)}_hz`);
    const rows = function* () {
      for (let k = 0; k < tel.t.length; k++) {
        yield [tel.t.at(k), tel.rate.at(k), tel.excRate.at(k), tel.inhRate.at(k), tel.vMean.at(k), tel.active.at(k), tel.synchrony.at(k), tel.eventsPerSecond.at(k), ...tel.regionRate.map((r) => r.at(k))];
      }
    };
    await platform.save(timestampName(`${slug(s.config.name)}-telemetry`, 'csv'), csv(['time_ms', 'rate_hz', 'exc_rate_hz', 'inh_rate_hz', 'v_mean_mV', 'active_neurons', 'synchrony_chi', 'synaptic_events_per_s', ...names], rows()), 'text/csv');
  }

  /** Everything this project stores, as one JSON file (binary payloads base64). */
  async exportProjectBundle(): Promise<void> {
    const s = this.app.state;
    if (!s.project) return;
    const project = await this.db.getProject(s.project.id);
    const experiments = await this.db.listExperiments(s.project.id);
    const snapshots = await this.db.listSnapshots(s.project.id);
    const recordings = await this.db.listRecordings(s.project.id);
    const bundle = {
      format: 'neuroform.project',
      version: 1,
      exportedAt: new Date().toISOString(),
      project,
      experiments,
      snapshots: snapshots.map((x) => ({ ...x, config: undefined, note: 'Export individual snapshots as .nfsnap to restore them.' })),
      recordings,
    };
    await platform.save(`${slug(s.project.name)}.project.json`, JSON.stringify(bundle, null, 2), 'application/json');
  }

  // ------------------------------------------------------------------ recordings

  async startRecording(): Promise<void> {
    if (!this.app.built) return;
    await this.app.client.request('recordStart', { maxSpikes: 8_000_000 });
    this.app.store.set({ recording: { active: true, spikes: 0, durationMs: 0 } });
    this.app.toast('info', 'Recording', 'Every spike and all measurements are being recorded.');
  }

  async stopRecording(): Promise<void> {
    const r = await this.app.client.request('recordStop', {});
    this.app.store.set({ recording: null });
    if (!r) return;
    const s = this.app.state;
    await this.storeRecording(r.bytes, `${s.config?.name ?? 'Recording'} · ${(r.durationMs / 1000).toFixed(2)} s`, r.durationMs, r.spikes, s.info?.topologyHash ?? '');
    this.app.toast('success', 'Recording saved', `${r.spikes.toLocaleString('en-GB')} spikes over ${(r.durationMs / 1000).toFixed(2)} s simulated`);
  }

  private async storeRecording(bytes: Uint8Array, name: string, durationMs: number, spikes: number, hash: string): Promise<void> {
    if (!this.app.state.project) await this.saveProject();
    const meta: RecordingRecord = { id: newId('rec'), projectId: this.app.state.project!.id, name, createdAt: Date.now(), durationMs, spikes, size: bytes.byteLength, topologyHash: hash };
    try {
      await this.db.saveRecording(meta, bytes);
    } catch (e) {
      this.storageFailed(e, 'The recording');
      await platform.save(`${slug(name)}.nfrec`, bytes, 'application/octet-stream');
    }
    this.bump();
  }

  async exportRecording(id: string, name: string): Promise<void> {
    const data = await this.db.recordingData(id);
    if (data) await platform.save(`${slug(name)}.nfrec`, data, 'application/octet-stream');
  }

  async deleteRecording(id: string): Promise<void> {
    await this.db.deleteRecording(id);
    this.bump();
  }

  // ------------------------------------------------------------------ new brain

  async newBrain(config: BrainConfig): Promise<void> {
    await this.createProject(config, { run: true });
  }

  presetConfig(presetId: string, tierId: string, seed: number): BrainConfig | null {
    const p = presetById(presetId);
    const t = tierById(tierId);
    if (!p || !t) return null;
    return p.create(Math.min(t.neurons, p.maxNeurons ?? Infinity), seed);
  }
}
