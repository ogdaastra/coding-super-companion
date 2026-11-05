/**
 * Recording playback. Replays the spikes of a recording into the 3D view on a
 * playback clock. This is a *visual replay of recorded events*: the live
 * simulation is paused and left untouched, and no network state is restored.
 */

import type { AppController } from './AppController.ts';
import { parseRecording, type Recording } from '../sim/recording.ts';

export class Playback {
  private readonly app: AppController;
  private rec: Recording | null = null;
  private steps: Uint32Array = new Uint32Array(0);
  private cursor = 0;
  private clockMs = 0;
  private raf = 0;
  private last = 0;
  private resume = false;

  constructor(app: AppController) {
    this.app = app;
  }

  get active(): boolean {
    return this.rec !== null;
  }

  get recording(): Recording | null {
    return this.rec;
  }

  async open(id: string, name: string): Promise<void> {
    const app = this.app;
    const bytes = await app.db.recordingData(id);
    if (!bytes) {
      app.toast('error', 'Recording not found');
      return;
    }
    let rec: Recording;
    try {
      rec = parseRecording(bytes);
    } catch (e) {
      app.toast('error', 'The recording could not be read', String(e));
      return;
    }
    if (app.state.info?.topologyHash !== rec.header.topologyHash || app.state.info?.neurons !== rec.header.neurons) {
      app.toast('warning', 'Recording belongs to a different network', 'Open the project it was recorded in (same configuration and seed) to replay it.');
      return;
    }
    this.resume = app.state.sim.status === 'running';
    if (this.resume) await app.pause();
    this.rec = rec;
    this.steps = new Uint32Array(rec.spikes.length / 2);
    for (let k = 0; k < this.steps.length; k++) this.steps[k] = rec.spikes[2 * k];
    this.cursor = 0;
    this.clockMs = rec.header.startMs;
    app.store.set({ playback: { id, name, t: rec.header.startMs, start: rec.header.startMs, end: rec.header.endMs, playing: true, speed: 0.25 } });
    if (app.view) app.view.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (): void => {
    const app = this.app;
    const pb = app.state.playback;
    const rec = this.rec;
    if (!pb || !rec) return;
    const now = performance.now();
    const dt = Math.min(100, now - this.last);
    this.last = now;
    if (pb.playing) {
      const prev = this.clockMs;
      this.clockMs = Math.min(rec.header.endMs, this.clockMs + dt * pb.speed);
      this.emit(prev, this.clockMs);
      app.store.set({ playback: { ...pb, t: this.clockMs, playing: this.clockMs < rec.header.endMs } });
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private emit(fromMs: number, toMs: number): void {
    const rec = this.rec!;
    const dt = rec.header.dt;
    const lo = fromMs / dt;
    const hi = toMs / dt;
    let k = this.cursor;
    while (k < this.steps.length && this.steps[k] < lo) k++;
    const start = k;
    while (k < this.steps.length && this.steps[k] < hi) k++;
    this.cursor = k;
    if (k > start) {
      this.app.view?.ingestFrame({ type: 'frame', step: Math.floor(hi), timeMs: toMs, spikes: rec.spikes.slice(2 * start, 2 * k), dropped: 0, membrane: null, rates: null });
    }
  }

  setPlaying(playing: boolean): void {
    const pb = this.app.state.playback;
    if (!pb) return;
    if (playing && this.clockMs >= pb.end) this.seek(pb.start);
    this.app.store.set({ playback: { ...this.app.state.playback!, playing } });
    if (this.app.view) this.app.view.running = playing;
  }

  setSpeed(speed: number): void {
    const pb = this.app.state.playback;
    if (pb) this.app.store.set({ playback: { ...pb, speed } });
    if (this.app.view) this.app.view.speed = speed;
  }

  seek(t: number): void {
    const pb = this.app.state.playback;
    const rec = this.rec;
    if (!pb || !rec) return;
    this.clockMs = Math.max(pb.start, Math.min(pb.end, t));
    const step = this.clockMs / rec.header.dt;
    let lo = 0;
    let hi = this.steps.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.steps[mid] < step) lo = mid + 1;
      else hi = mid;
    }
    this.cursor = lo;
    this.app.store.set({ playback: { ...pb, t: this.clockMs } });
  }

  stop(): void {
    if (!this.rec) return;
    cancelAnimationFrame(this.raf);
    this.rec = null;
    this.app.store.set({ playback: null });
    if (this.app.view) {
      this.app.view.running = this.app.state.sim.status === 'running';
      this.app.view.speed = this.app.state.sim.speed;
    }
    if (this.resume) void this.app.run();
    this.resume = false;
  }
}
