/**
 * IndexedDB persistence, with an in-memory fallback when IndexedDB is unavailable
 * (some private browsing modes) so the application still works for the session.
 *
 * Object stores: projects, snapshots, recordings, experiments, settings.
 * Large binary payloads (snapshots, recordings) are stored as ArrayBuffers in
 * their own records so listing never loads them.
 */

import type { BrainConfig } from '../config/schema.ts';

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  config: BrainConfig;
  view?: { viz?: string; quality?: string; camera?: { target: [number, number, number]; distance: number; yaw: number; pitch: number } };
  notes?: string;
}

export interface SnapshotRecord {
  id: string;
  projectId: string;
  name: string;
  createdAt: number;
  timeMs: number;
  step: number;
  topologyHash: string;
  neurons: number;
  synapses: number;
  size: number;
  /** The configuration the snapshot's network was built from. */
  config: BrainConfig;
}

export interface BlobRecord {
  id: string;
  data: ArrayBuffer;
}

export interface RecordingRecord {
  id: string;
  projectId: string;
  name: string;
  createdAt: number;
  durationMs: number;
  spikes: number;
  size: number;
  topologyHash: string;
}

export interface ExperimentRecord {
  id: string;
  projectId: string;
  experimentId: string;
  name: string;
  createdAt: number;
  seed: number;
  topologyHash: string;
  params: Record<string, unknown>;
  result: unknown;
}

type StoreName = 'projects' | 'snapshots' | 'snapshotData' | 'recordings' | 'recordingData' | 'experiments' | 'settings';
const STORES: StoreName[] = ['projects', 'snapshots', 'snapshotData', 'recordings', 'recordingData', 'experiments', 'settings'];
const INDEXED: StoreName[] = ['snapshots', 'recordings', 'experiments'];

export class StorageError extends Error {
  readonly quota: boolean;
  constructor(message: string, quota = false) {
    super(message);
    this.name = 'StorageError';
    this.quota = quota;
  }
}

function describe(e: unknown): StorageError {
  const err = e as DOMException | undefined;
  if (err && err.name === 'QuotaExceededError') {
    return new StorageError('The browser storage quota is full. Delete snapshots or recordings, or export and remove projects.', true);
  }
  return new StorageError(err?.message || 'The local database rejected the operation.');
}

interface Backend {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  getAll<T>(store: StoreName): Promise<T[]>;
  byIndex<T>(store: StoreName, projectId: string): Promise<T[]>;
  put(store: StoreName, value: object, key?: string): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
}

class MemoryBackend implements Backend {
  private data = new Map<StoreName, Map<string, unknown>>(STORES.map((s) => [s, new Map()]));
  async get<T>(store: StoreName, key: string) {
    return this.data.get(store)!.get(key) as T | undefined;
  }
  async getAll<T>(store: StoreName) {
    return [...this.data.get(store)!.values()] as T[];
  }
  async byIndex<T>(store: StoreName, projectId: string) {
    return [...this.data.get(store)!.values()].filter((v) => (v as { projectId: string }).projectId === projectId) as T[];
  }
  async put(store: StoreName, value: object, key?: string) {
    const k = key ?? (value as { id?: string; key?: string }).id ?? (value as { key: string }).key;
    this.data.get(store)!.set(k, structuredClone(value));
  }
  async delete(store: StoreName, key: string) {
    this.data.get(store)!.delete(key);
  }
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(describe(r.error));
  });
}

class IdbBackend implements Backend {
  private readonly db: IDBDatabase;
  constructor(db: IDBDatabase) {
    this.db = db;
  }
  private tx(store: StoreName, mode: IDBTransactionMode) {
    return this.db.transaction(store, mode).objectStore(store);
  }
  get<T>(store: StoreName, key: string) {
    return req(this.tx(store, 'readonly').get(key)) as Promise<T | undefined>;
  }
  getAll<T>(store: StoreName) {
    return req(this.tx(store, 'readonly').getAll()) as Promise<T[]>;
  }
  byIndex<T>(store: StoreName, projectId: string) {
    return req(this.tx(store, 'readonly').index('projectId').getAll(projectId)) as Promise<T[]>;
  }
  put(store: StoreName, value: object) {
    return new Promise<void>((resolve, reject) => {
      const t = this.db.transaction(store, 'readwrite');
      t.objectStore(store).put(value);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(describe(t.error));
      t.onabort = () => reject(describe(t.error));
    });
  }
  delete(store: StoreName, key: string) {
    return new Promise<void>((resolve, reject) => {
      const t = this.db.transaction(store, 'readwrite');
      t.objectStore(store).delete(key);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(describe(t.error));
    });
  }
}

function openIdb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new StorageError('IndexedDB is not available in this browser.'));
      return;
    }
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of STORES) {
        if (db.objectStoreNames.contains(s)) continue;
        const os = db.createObjectStore(s, { keyPath: s === 'settings' ? 'key' : 'id' });
        if (INDEXED.includes(s)) os.createIndex('projectId', 'projectId', { unique: false });
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(describe(r.error));
    r.onblocked = () => reject(new StorageError('The local database is open in another tab with an older version.'));
  });
}

export function newId(prefix: string): string {
  const rnd = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now().toString(36)}${rnd[0].toString(36)}${rnd[1].toString(36)}`.slice(0, 32);
}

/** Repository of everything NEUROFORM keeps locally. */
export class LocalStore {
  private backend: Backend;
  readonly persistent: boolean;
  readonly reason: string | null;

  private constructor(backend: Backend, persistent: boolean, reason: string | null) {
    this.backend = backend;
    this.persistent = persistent;
    this.reason = reason;
  }

  static async open(name = 'neuroform'): Promise<LocalStore> {
    try {
      const db = await openIdb(name);
      return new LocalStore(new IdbBackend(db), true, null);
    } catch (e) {
      return new LocalStore(new MemoryBackend(), false, e instanceof Error ? e.message : String(e));
    }
  }

  static memory(): LocalStore {
    return new LocalStore(new MemoryBackend(), false, 'in-memory');
  }

  // Projects
  async listProjects(): Promise<ProjectRecord[]> {
    const all = await this.backend.getAll<ProjectRecord>('projects');
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  getProject(id: string) {
    return this.backend.get<ProjectRecord>('projects', id);
  }
  saveProject(p: ProjectRecord) {
    return this.backend.put('projects', p);
  }
  async deleteProject(id: string): Promise<void> {
    for (const s of await this.listSnapshots(id)) await this.deleteSnapshot(s.id);
    for (const r of await this.listRecordings(id)) await this.deleteRecording(r.id);
    for (const e of await this.listExperiments(id)) await this.backend.delete('experiments', e.id);
    await this.backend.delete('projects', id);
  }

  // Snapshots (metadata and payload stored separately)
  async listSnapshots(projectId: string): Promise<SnapshotRecord[]> {
    const all = await this.backend.byIndex<SnapshotRecord>('snapshots', projectId);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }
  async saveSnapshot(meta: SnapshotRecord, data: Uint8Array): Promise<void> {
    await this.backend.put('snapshotData', { id: meta.id, data: data.slice().buffer } satisfies BlobRecord);
    await this.backend.put('snapshots', meta);
  }
  async snapshotData(id: string): Promise<Uint8Array | null> {
    const r = await this.backend.get<BlobRecord>('snapshotData', id);
    return r ? new Uint8Array(r.data) : null;
  }
  async deleteSnapshot(id: string): Promise<void> {
    await this.backend.delete('snapshotData', id);
    await this.backend.delete('snapshots', id);
  }

  // Recordings
  async listRecordings(projectId: string): Promise<RecordingRecord[]> {
    const all = await this.backend.byIndex<RecordingRecord>('recordings', projectId);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }
  async saveRecording(meta: RecordingRecord, data: Uint8Array): Promise<void> {
    await this.backend.put('recordingData', { id: meta.id, data: data.slice().buffer } satisfies BlobRecord);
    await this.backend.put('recordings', meta);
  }
  async recordingData(id: string): Promise<Uint8Array | null> {
    const r = await this.backend.get<BlobRecord>('recordingData', id);
    return r ? new Uint8Array(r.data) : null;
  }
  async deleteRecording(id: string): Promise<void> {
    await this.backend.delete('recordingData', id);
    await this.backend.delete('recordings', id);
  }

  // Experiment results
  async listExperiments(projectId: string): Promise<ExperimentRecord[]> {
    const all = await this.backend.byIndex<ExperimentRecord>('experiments', projectId);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }
  saveExperiment(r: ExperimentRecord) {
    return this.backend.put('experiments', r);
  }
  deleteExperiment(id: string) {
    return this.backend.delete('experiments', id);
  }

  // Settings
  async getSetting<T>(key: string, fallback: T): Promise<T> {
    const r = await this.backend.get<{ key: string; value: T }>('settings', key);
    return r ? r.value : fallback;
  }
  setSetting<T>(key: string, value: T) {
    return this.backend.put('settings', { key, value });
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number; persisted: boolean } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    return { usage: e.usage ?? 0, quota: e.quota ?? 0, persisted };
  } catch {
    return null;
  }
}
