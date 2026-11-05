/**
 * Runs an experiment against the live network and keeps its state observable.
 *
 * The simulation is paused and advanced in exact step counts, so an experiment
 * with the same configuration, seed and parameters always produces the same
 * result. Temporary changes are undone when it finishes, fails or is stopped.
 */

import type { AppController } from '../app/AppController.ts';
import { newId } from '../persistence/db.ts';
import { neuronParamIndex } from '../config/schema.ts';
import { parseRecording } from '../sim/recording.ts';
import { regionLookup } from './analysis.ts';
import { EXPERIMENTS } from './definitions.ts';
import type { ExperimentContext, ExperimentDefinition, ExperimentResult, ParamValue } from './types.ts';
import { Store } from '../app/store.ts';

export interface RunState {
  runId: string;
  experimentId: string;
  status: 'running' | 'done' | 'error' | 'aborted';
  progress: number;
  label: string;
  live: Record<string, string>;
  log: string[];
  params: Record<string, ParamValue>;
  result: ExperimentResult | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  seed: number;
  topologyHash: string;
}

export interface LabState {
  selected: string;
  params: Record<string, Record<string, ParamValue>>;
  run: RunState | null;
  /** Visual pacing: simulated ms advanced per animation frame. */
  pace: 'fast' | 'watch';
}

class Aborted extends Error {}

export class ExperimentRunner {
  private readonly app: AppController;
  readonly store = new Store<LabState>({ selected: EXPERIMENTS[0].id, params: {}, run: null, pace: 'fast' });
  private controller: AbortController | null = null;

  constructor(app: AppController) {
    this.app = app;
  }

  get running(): boolean {
    return this.store.get().run?.status === 'running';
  }

  definition(id: string): ExperimentDefinition {
    return EXPERIMENTS.find((e) => e.id === id) ?? EXPERIMENTS[0];
  }

  paramsFor(id: string): Record<string, ParamValue> {
    const info = this.app.state.info;
    const def = this.definition(id);
    const saved = this.store.get().params[id] ?? {};
    const out: Record<string, ParamValue> = {};
    for (const p of def.params) out[p.key] = saved[p.key] ?? (info ? p.default(info) : 0);
    return out;
  }

  setParam(id: string, key: string, value: ParamValue): void {
    const s = this.store.get();
    this.store.set({ params: { ...s.params, [id]: { ...this.paramsFor(id), [key]: value } } });
  }

  select(id: string): void {
    this.store.set({ selected: id });
  }

  abort(reason = 'Stopped'): void {
    if (this.controller && this.running) {
      this.controller.abort(new Aborted(reason));
    }
  }

  private update(patch: Partial<RunState>): void {
    const run = this.store.get().run;
    if (run) this.store.set({ run: { ...run, ...patch } });
  }

  async start(id: string): Promise<void> {
    const app = this.app;
    const info = app.state.info;
    if (!info || !app.built || this.running) return;
    const def = this.definition(id);
    const params = this.paramsFor(id);
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const run: RunState = {
      runId: newId('exp'),
      experimentId: id,
      status: 'running',
      progress: 0,
      label: 'Preparing',
      live: {},
      log: [],
      params,
      result: null,
      error: null,
      startedAt: Date.now(),
      finishedAt: null,
      seed: info.seed,
      topologyHash: info.topologyHash,
    };
    this.store.set({ run });
    const c = app.client;
    const dt = info.dt;
    const regionOf = regionLookup(info);
    const wasRunning = app.state.sim.status === 'running';
    const plasticBefore = app.state.plasticity;
    if (wasRunning) await app.pause();
    const undo: (() => Promise<unknown>)[] = [];
    let step = (await c.request('pause', {})).step;
    const check = () => {
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Aborted('Stopped');
    };

    const ctx: ExperimentContext = {
      info,
      dt,
      regionOf,
      signal,
      step: () => step,
      advance: async (ms) => {
        let remaining = Math.round(ms / dt);
        const pace = this.store.get().pace;
        // Chunks small enough to keep the interface live and the spike buffers bounded.
        const chunk = Math.max(1, Math.round((pace === 'watch' ? 2 : 25) / dt));
        while (remaining > 0) {
          check();
          const k = Math.min(chunk, remaining);
          const r = await c.request('step', { steps: k, quiet: true });
          step = r.step;
          remaining -= k;
          app.store.set((s) => ({ sim: { ...s.sim, timeMs: r.timeMs, step: r.step } }));
          if (app.view) {
            app.view.running = true;
            c.requestFrame(app.view.frameNeeds);
          }
          if (pace === 'watch') await new Promise((res) => requestAnimationFrame(() => res(null)));
        }
      },
      measure: async () => {
        check();
        return c.request('measure', {});
      },
      capture: async (fn) => {
        await c.request('recordStart', { maxSpikes: 20_000_000, channel: 'experiment' });
        const start = step;
        try {
          await fn();
        } finally {
          const r = await c.request('recordStop', { channel: 'experiment' });
          if (r && !signal.aborted) {
            const rec = parseRecording(r.bytes);
            if (rec.header.truncated) ctx.log('Spike capture reached its limit; later spikes were not counted.');
            this.captured = { spikes: rec.spikes, startStep: start, endStep: step };
          }
        }
        check();
        return this.captured!;
      },
      stimulate: async (spec) => {
        check();
        const r = await c.request('stimulate', { spec });
        app.view?.setStimulusTargets(r.targets);
        return r.targets;
      },
      reset: async () => {
        check();
        await c.request('reset', { weights: true });
        step = 0;
        app.telemetry.clearHistory();
      },
      projectionStats: () => c.request('projectionStats', {}),
      topChanges: (k) => c.request('topChanges', { k }),
      setRegionEnabled: async (region, enabled) => {
        const old = await c.request('setRegionEnabled', { region, enabled });
        undo.push(() => c.request('setRegionEnabled', { region, enabled: old }));
      },
      setProjectionGain: async (projection, gain) => {
        const old = await c.request('setProjectionGain', { projection, gain });
        undo.push(() => c.request('setProjectionGain', { projection, gain: old }));
      },
      setPopulationParam: async (region, cls, key, value) => {
        const param = neuronParamIndex(key);
        const old = await c.request('setPopulationParam', { region, cls, param, value });
        undo.push(() => c.request('setPopulationParam', { region, cls, param, value: old }));
      },
      populationMean: (region, cls, key) => c.request('populationMean', { region, cls, param: neuronParamIndex(key) }),
      setPlasticity: async (enabled, rate = 1) => {
        await c.request('setPlasticity', { enabled, rateScale: rate });
      },
      setSyncGroup: async (regions) => {
        await c.request('setSyncGroup', { regions });
      },
      restoreChanges: async () => {
        while (undo.length) await undo.pop()!();
      },
      progress: (fraction, label) => this.update({ progress: Math.max(0, Math.min(1, fraction)), label }),
      live: (values) => this.update({ live: { ...(this.store.get().run?.live ?? {}), ...values } }),
      log: (message) => this.update({ log: [...(this.store.get().run?.log ?? []), message] }),
    };

    try {
      const result = await def.run(ctx, params);
      this.update({ status: 'done', progress: 1, label: 'Complete', result, finishedAt: Date.now() });
      await this.save();
    } catch (e) {
      const aborted = e instanceof Aborted || signal.aborted;
      this.update({ status: aborted ? 'aborted' : 'error', error: e instanceof Error ? e.message : String(e), finishedAt: Date.now(), label: aborted ? 'Stopped' : 'Failed' });
      if (!aborted) app.toast('error', `Experiment ${def.letter} failed`, e instanceof Error ? e.message : String(e));
    } finally {
      try {
        await c.request('recordStop', { channel: 'experiment' });
        while (undo.length) await undo.pop()!();
        await c.request('setPlasticity', { enabled: plasticBefore.enabled, rateScale: plasticBefore.rateScale });
      } catch {
        /* the network may have been rebuilt */
      }
      if (app.view) app.view.running = app.state.sim.status === 'running';
      this.controller = null;
    }
  }

  private captured: { spikes: Uint32Array; startStep: number; endStep: number } | null = null;

  private async save(): Promise<void> {
    const run = this.store.get().run;
    const app = this.app;
    if (!run || !run.result) return;
    if (!app.state.project) await app.projects.saveProject();
    const project = app.state.project;
    if (!project) return;
    const def = this.definition(run.experimentId);
    try {
      await app.db.saveExperiment({
        id: run.runId,
        projectId: project.id,
        experimentId: run.experimentId,
        name: `${def.letter} · ${def.name}`,
        createdAt: run.startedAt,
        seed: run.seed,
        topologyHash: run.topologyHash,
        params: run.params as Record<string, unknown>,
        result: run.result,
      });
      app.projects.bump();
    } catch (e) {
      app.toast('warning', 'The experiment result was not saved', e instanceof Error ? e.message : String(e));
    }
  }
}
