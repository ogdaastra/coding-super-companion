/**
 * Vision Lab, main-thread side: the user's classes and photos, and the training,
 * testing and classifying loops. Each image trial runs in the simulation worker
 * (`visionTrial`, see src/vision/trainer.ts); this service only sequences them
 * and keeps score.
 *
 * Photos are split once, by position: every fifth photo of a class is held out
 * for testing and never trained on, so test accuracy measures recognition of
 * unseen photos, not memory. Photos live only in this tab (never uploaded or
 * stored); what the network learned is in its weights and is kept with project
 * saves and snapshots.
 */
import { Store } from './store.ts';
import type { AppController } from './AppController.ts';
import { visionLab, visionRegion } from '../config/presets.ts';
import { loadPhoto, type Photo } from '../vision/image.ts';

export const MIN_PHOTOS = 5;
export const MAX_CLASSES = 4;
/** Size of the Vision Lab network the trial settings were calibrated with. */
export const VISION_NEURONS = 3000;

export interface VisionClass {
  name: string;
  photos: Photo[];
}

export interface TrialView {
  photo: Photo;
  label: number | null;
  guess: number;
  correct: boolean | null;
  scores: number[];
  delivered: number;
}

export interface VisionState {
  classes: VisionClass[];
  busy: null | 'loading' | 'training' | 'testing' | 'classifying' | 'building';
  progress: { done: number; total: number; label: string } | null;
  pace: 'fast' | 'watch';
  epochs: number;
  /** Training trials so far on this network, and the network's expected outcome (-1..1). */
  trained: number;
  expected: number;
  /** Training accuracy over the last 20 trials, sampled every 10 trials. */
  history: { trial: number; accuracy: number }[];
  /** Accuracy on the held-out photos after each training pass. */
  tests: { trial: number; accuracy: number }[];
  /** Last test: confusion[true class][answer], answer index `classes.length` = no answer. */
  confusion: number[][] | null;
  last: TrialView | null;
  tried: TrialView | null;
  message: string | null;
}

const isTest = (i: number) => i % 5 === 4;

export function splitPhotos(c: VisionClass): { train: Photo[]; test: Photo[] } {
  return { train: c.photos.filter((_, i) => !isTest(i)), test: c.photos.filter((_, i) => isTest(i)) };
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class VisionService {
  readonly store = new Store<VisionState>({
    classes: [
      { name: 'Apple', photos: [] },
      { name: 'Tomato', photos: [] },
    ],
    busy: null,
    progress: null,
    pace: 'fast',
    epochs: 5,
    trained: 0,
    expected: 0,
    history: [],
    tests: [],
    confusion: null,
    last: null,
    tried: null,
    message: null,
  });
  private stopRequested = false;
  private readonly app: AppController;

  constructor(app: AppController) {
    this.app = app;
  }

  get state(): VisionState {
    return this.store.get();
  }

  /** Whether the current network is a Vision Lab network with one answer population per class. */
  networkMatches(): boolean {
    const info = this.app.state.info;
    if (!info || this.app.state.config?.preset !== 'vision-lab') return false;
    const outputs = info.regions.filter((r) => /^out\d+$/.test(r.id)).length;
    return outputs === this.state.classes.length && visionRegion.cones.every((c) => info.regions.some((r) => r.id === c));
  }

  // ------------------------------------------------------------ classes & photos

  setClassName(k: number, name: string): void {
    this.store.set((s) => ({ classes: s.classes.map((c, i) => (i === k ? { ...c, name } : c)) }));
  }

  addClass(): void {
    const s = this.state;
    if (s.classes.length >= MAX_CLASSES) return;
    this.store.set({ classes: [...s.classes, { name: `Class ${String.fromCharCode(65 + s.classes.length)}`, photos: [] }] });
  }

  removeClass(k: number): void {
    if (this.state.classes.length <= 2) return;
    this.store.set((s) => ({ classes: s.classes.filter((_, i) => i !== k) }));
  }

  removePhoto(k: number, id: string): void {
    this.store.set((s) => ({ classes: s.classes.map((c, i) => (i === k ? { ...c, photos: c.photos.filter((p) => p.id !== id) } : c)) }));
  }

  clearPhotos(k: number): void {
    this.store.set((s) => ({ classes: s.classes.map((c, i) => (i === k ? { ...c, photos: [] } : c)) }));
  }

  async addPhotos(k: number, files: FileList | File[]): Promise<void> {
    const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name));
    if (!list.length) {
      this.store.set({ message: 'No image files found (JPEG, PNG, WebP, GIF, BMP or AVIF).' });
      return;
    }
    this.store.set({ busy: 'loading', message: null, progress: { done: 0, total: list.length, label: 'Reading photos' } });
    const failed: string[] = [];
    try {
      for (let i = 0; i < list.length; i++) {
        try {
          const photo = await loadPhoto(list[i]);
          this.store.set((s) => ({ classes: s.classes.map((c, j) => (j === k ? { ...c, photos: [...c.photos, photo] } : c)) }));
        } catch {
          failed.push(list[i].name);
        }
        if (i % 4 === 3) this.store.set({ progress: { done: i + 1, total: list.length, label: 'Reading photos' } });
      }
    } finally {
      this.store.set({
        busy: null,
        progress: null,
        message: failed.length ? `Could not read ${failed.length} file${failed.length > 1 ? 's' : ''} (for example ${failed[0]}). JPEG and PNG always work.` : null,
      });
    }
  }

  // ------------------------------------------------------------ network

  /** Builds a fresh Vision Lab network with one answer population per class. */
  async buildNetwork(): Promise<void> {
    if (this.state.busy) return;
    const names = this.state.classes.map((c, i) => c.name.trim() || `Class ${String.fromCharCode(65 + i)}`);
    this.store.set({ busy: 'building', message: null });
    try {
      await this.app.projects.newBrain(visionLab(VISION_NEURONS, Math.floor(Math.random() * 1e6), names));
      await this.app.pause();
      const setup = await this.app.client.request('visionSetup', {});
      this.store.set({ trained: setup.trained, expected: setup.expected, history: [], tests: [], confusion: null, last: null, tried: null });
    } catch (e) {
      this.store.set({ message: e instanceof Error ? e.message : String(e) });
    } finally {
      this.store.set({ busy: null });
    }
  }

  stop(): void {
    this.stopRequested = true;
  }

  /** Readiness problems that block training, in plain words; empty when ready. */
  problems(): string[] {
    const out: string[] = [];
    if (!this.networkMatches()) out.push('Build the vision network first (it needs one answer group per class).');
    for (const c of this.state.classes) {
      if (c.photos.length < MIN_PHOTOS) out.push(`Add at least ${MIN_PHOTOS} photos of ${c.name || 'each class'} (${c.photos.length} so far).`);
    }
    return out;
  }

  /** Runs `body` with the live simulation paused and plasticity set, restoring both afterwards. */
  private async session(busy: VisionState['busy'], learn: boolean, body: () => Promise<void>): Promise<void> {
    const app = this.app;
    const wasRunning = app.state.sim.status === 'running';
    const plastic = app.state.plasticity.enabled;
    this.stopRequested = false;
    this.store.set({ busy, message: null });
    try {
      if (wasRunning) await app.pause();
      await app.client.request('visionSetup', {});
      if (plastic !== learn) await app.setPlasticity(learn);
      await body();
    } catch (e) {
      this.store.set({ message: e instanceof Error ? e.message : String(e) });
    } finally {
      if (app.state.plasticity.enabled !== plastic) await app.setPlasticity(plastic);
      this.store.set({ busy: null, progress: null });
      if (wasRunning) await app.run();
    }
  }

  private async trial(photo: Photo, label: number | null, learn: boolean): Promise<TrialView & { trained: number; expected: number }> {
    const r = await this.app.client.request('visionTrial', { features: photo.features, label, learn });
    return { photo, label, guess: r.guess, correct: r.correct, scores: r.scores, delivered: r.delivered, trained: r.trained, expected: r.expected };
  }

  /** Training passes over the training photos (shuffled), each followed by a test. */
  async train(): Promise<void> {
    if (this.state.busy || this.problems().length) return;
    await this.session('training', true, async () => {
      const s = this.state;
      const items = s.classes.flatMap((c, label) => splitPhotos(c).train.map((photo) => ({ photo, label })));
      const total = items.length * s.epochs;
      const recent: boolean[] = [];
      let done = 0;
      for (let e = 0; e < s.epochs && !this.stopRequested; e++) {
        for (const { photo, label } of shuffle([...items])) {
          if (this.stopRequested) break;
          const r = await this.trial(photo, label, true);
          recent.push(!!r.correct);
          if (recent.length > 20) recent.shift();
          done++;
          this.store.set((st) => ({
            last: r,
            trained: r.trained,
            expected: r.expected,
            progress: { done, total, label: `Training pass ${e + 1} of ${s.epochs}` },
            history: r.trained % 10 === 0 ? [...st.history, { trial: r.trained, accuracy: recent.filter(Boolean).length / recent.length }] : st.history,
          }));
          if (this.state.pace === 'watch') await sleep(700);
        }
        if (!this.stopRequested) await this.runTest(false);
      }
    });
  }

  /** Tests on the held-out photos without learning. */
  async test(): Promise<void> {
    if (this.state.busy || this.problems().length) return;
    await this.session('testing', false, () => this.runTest(true));
  }

  private async runTest(standalone: boolean): Promise<void> {
    const s = this.state;
    const plastic = this.app.state.plasticity.enabled;
    if (plastic) await this.app.setPlasticity(false);
    try {
      const items = s.classes.flatMap((c, label) => splitPhotos(c).test.map((photo) => ({ photo, label })));
      const n = s.classes.length;
      const confusion = s.classes.map(() => new Array<number>(n + 1).fill(0));
      let ok = 0;
      for (let i = 0; i < items.length && !this.stopRequested; i++) {
        const r = await this.trial(items[i].photo, items[i].label, false);
        confusion[items[i].label][r.guess >= 0 ? r.guess : n]++;
        if (r.correct) ok++;
        this.store.set({ last: r, progress: { done: i + 1, total: items.length, label: 'Testing on photos it has never trained on' } });
        if (standalone && this.state.pace === 'watch') await sleep(700);
      }
      if (!this.stopRequested && items.length) {
        this.store.set((st) => ({ confusion, tests: [...st.tests, { trial: st.trained, accuracy: ok / items.length }] }));
      }
    } finally {
      if (plastic) await this.app.setPlasticity(true);
    }
  }

  /** Shows one new photo and reports the network's answer (no learning). */
  async classify(file: File): Promise<void> {
    if (this.state.busy || !this.networkMatches()) return;
    let photo: Photo;
    try {
      photo = await loadPhoto(file);
    } catch (e) {
      this.store.set({ message: e instanceof Error ? e.message : String(e) });
      return;
    }
    await this.session('classifying', false, async () => {
      const r = await this.trial(photo, null, false);
      this.store.set({ tried: r, last: r });
    });
  }
}
