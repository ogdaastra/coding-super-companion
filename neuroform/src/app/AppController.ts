/**
 * Application controller: the only place that coordinates the simulation worker,
 * the renderer, telemetry, persistence and interface state. React components call
 * its methods and read `store`; they never talk to the worker or renderer directly.
 */

import { createWorker, wasmUrl } from './workerFactory.ts';
import { SimulationClient, RequestError } from '../sim/SimulationClient.ts';
import type { BuiltNetwork, StimulusSpec } from '../sim/protocol.ts';
import { BrainView, RendererUnavailableError, type BackendPreference } from '../render/BrainView.ts';
import type { QualityName } from '../render/quality.ts';
import type { VizMode } from '../render/vizModes.ts';
import { regionColor } from '../render/palette.ts';
import { TelemetryStore } from '../telemetry/TelemetryStore.ts';
import { LocalStore } from '../persistence/db.ts';
import { platform } from '../platform/platform.ts';
import type { BrainConfig } from '../config/schema.ts';
import { observatory, TIERS } from '../config/presets.ts';
import { Store } from './store.ts';
import { initialState, type AppMode, type AppState, type DialogName, type Toast, type BootStep } from './state.ts';
import { EditService } from './EditService.ts';
import { ProjectService } from './ProjectService.ts';
import { Playback } from './Playback.ts';
import { ExperimentRunner } from '../experiments/ExperimentRunner.ts';
import { VisionService } from './VisionService.ts';

export type { AppState };

/** Picks a starting size from coarse hardware hints. */
export function suggestedTier(): string {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  if (mobile || memory <= 2 || cores <= 2) return 'micro';
  if (memory <= 4 || cores <= 4) return 'small';
  return 'medium';
}

export class AppController {
  readonly store = new Store<AppState>(initialState());
  readonly telemetry = new TelemetryStore();
  client: SimulationClient;
  view: BrainView | null = null;
  db: LocalStore = LocalStore.memory();
  built: BuiltNetwork | null = null;
  readonly edits: EditService;
  readonly projects: ProjectService;
  readonly playback: Playback;
  readonly experiments: ExperimentRunner;
  readonly vision: VisionService;

  private canvas: HTMLCanvasElement | null = null;
  private labels: HTMLElement | null = null;
  private detailPoll = 0;
  private neuronPoll = 0;
  private weightPoll = 0;
  private statsPoll = 0;
  private toastId = 1;
  private lastStimulusSeen = 0;
  private bootPromise: Promise<void> | null = null;
  private unsubscribers: (() => void)[] = [];

  constructor() {
    this.client = new SimulationClient(createWorker);
    this.edits = new EditService(this);
    this.projects = new ProjectService(this);
    this.playback = new Playback(this);
    this.experiments = new ExperimentRunner(this);
    this.vision = new VisionService(this);
    this.wireClient();
    this.store.set({ install: platform.installState() });
    platform.onInstallStateChange((install) => {
      const was = this.state.install;
      this.store.set({ install });
      if (install === 'installed' && was !== 'installed') {
        this.toast('success', 'NEUROFORM is installed', 'Open it from your desktop, Start menu, Dock or Applications folder. It works offline.');
      }
    });
  }

  get state(): AppState {
    return this.store.get();
  }

  // ------------------------------------------------------------------ boot

  private step(id: string, state: BootStep['state'], detail?: string): void {
    this.store.set((s) => {
      const steps = s.intro.steps.map((x) => (x.id === id ? { ...x, state, detail: detail ?? x.detail } : x));
      const done = steps.filter((x) => x.state === 'done').length;
      return { intro: { ...s.intro, steps, progress: done / steps.length } };
    });
  }

  boot(canvas: HTMLCanvasElement, labels: HTMLElement): Promise<void> {
    if (this.bootPromise) return this.bootPromise;
    this.canvas = canvas;
    this.labels = labels;
    this.bootPromise = this.runBoot();
    return this.bootPromise;
  }

  private async runBoot(): Promise<void> {
    try {
      this.step('worker', 'active', 'Starting background thread');
      this.step('engine', 'active', 'Downloading and compiling');
      const init = await this.client.request('init', { wasmUrl });
      this.step('worker', 'done', init.crossOriginIsolated ? 'Cross-origin isolated' : 'Message passing');
      this.step('engine', 'done', `ABI v${init.engineVersion}`);

      this.step('storage', 'active', 'Opening IndexedDB');
      this.db = await LocalStore.open();
      this.store.set({ storage: { persistent: this.db.persistent, reason: this.db.reason } });
      this.step('storage', this.db.persistent ? 'done' : 'error', this.db.persistent ? 'Projects persist locally' : 'Unavailable: projects last for this session only');
      const prefs = await this.db.getSetting<{ quality?: QualityName; adaptive?: boolean; backend?: BackendPreference; telemetryHz?: number }>('prefs', {});
      const urlBackend = new URLSearchParams(location.search).get('renderer') as BackendPreference | null;
      const preference: BackendPreference = urlBackend ?? prefs.backend ?? 'auto';
      this.store.set((s) => ({
        render: { ...s.render, preference, quality: prefs.quality ?? s.render.quality, adaptive: prefs.adaptive ?? s.render.adaptive },
        telemetryHz: prefs.telemetryHz ?? s.telemetryHz,
      }));
      if (prefs.telemetryHz) await this.client.request('setTelemetryHz', { hz: prefs.telemetryHz });

      this.step('renderer', 'active', preference === 'webgl2' ? 'WebGL2 requested' : 'Trying WebGPU');
      await this.createView(preference);
      this.step('renderer', 'done', this.view!.backend);

      this.step('network', 'active', 'Preparing configuration');
      await this.projects.openInitialProject();
      this.step('network', 'done', `${this.built!.info.neurons.toLocaleString('en-GB')} neurons · ${this.built!.info.synapses.toLocaleString('en-GB')} synapses`);
      this.store.set({ ready: true });
      void platform.registerServiceWorker();
      await this.run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.store.set((s) => ({ intro: { ...s.intro, error: msg } }));
      const active = this.state.intro.steps.find((x) => x.state === 'active');
      if (active) this.step(active.id, 'error', msg);
    }
  }

  dismissIntro(): void {
    this.store.set((s) => ({ intro: { ...s.intro, visible: false, skipped: !s.ready } }));
  }

  private async createView(preference: BackendPreference): Promise<void> {
    if (!this.canvas || !this.labels) throw new Error('canvas not attached');
    let view: BrainView;
    try {
      view = await BrainView.create(this.canvas, this.labels, preference);
    } catch (e) {
      const msg = e instanceof RendererUnavailableError ? e.message : `The 3D renderer could not start: ${String(e)}`;
      this.store.set((s) => ({ render: { ...s.render, error: msg } }));
      throw new Error(msg);
    }
    this.view = view;
    view.setQuality(this.state.render.quality);
    view.setAdaptive(this.state.render.adaptive);
    view.onWantFrame = () => {
      if (this.playback.active) return;
      this.client.requestFrame(view.frameNeeds);
    };
    view.onStats = (s) => {
      this.telemetry.pushFrameTiming(s.fps, s.frameMs);
      this.store.set((st) => ({ render: { ...st.render, stats: s } }));
    };
    view.onCameraSettled = (target, distance) => void this.updateDetail(target, distance);
    view.onTour = (w) => this.store.set((st) => ({ render: { ...st.render, touring: w ? (w.label ?? 'Tour') : null } }));
    view.onLost = (reason) => void this.handleRendererLost(reason);
    this.store.set((s) => ({ render: { ...s.render, backend: view.backend, error: null, history: [...s.render.history, view.backend] } }));
    if (view.softwareRenderer && !this.softwareNoticeShown) {
      this.softwareNoticeShown = true;
      view.setQuality('performance');
      this.store.set((s) => ({ render: { ...s.render, quality: 'performance', reducedEffects: true } }));
      this.toast('warning', 'Software rendering detected', `The browser is drawing without GPU acceleration (${view.gpuName}). Rendering quality has been lowered; the simulation is unaffected. Enable hardware acceleration for full quality.`);
    }
  }

  private softwareNoticeShown = false;

  private async handleRendererLost(reason: string): Promise<void> {
    this.store.set((s) => ({ render: { ...s.render, history: [...s.render.history, `lost: ${reason}`] } }));
    this.toast('warning', 'Graphics device lost', `${reason} Restarting the renderer…`);
    const pref: BackendPreference = this.view?.backend === 'WebGPU' ? 'webgl2' : this.state.render.preference;
    await this.restartRenderer(pref);
  }

  /** Re-creates the renderer (backend switch or recovery). Simulation is untouched. */
  async restartRenderer(pref: BackendPreference): Promise<void> {
    const old = this.view;
    this.view = null;
    old?.dispose();
    // A canvas that hosted one context type cannot host another: replace it.
    if (this.canvas) {
      const fresh = this.canvas.cloneNode(false) as HTMLCanvasElement;
      this.canvas.replaceWith(fresh);
      this.canvas = fresh;
      this.onCanvasReplaced?.(fresh);
    }
    try {
      await this.createView(pref);
      if (this.built) await this.attachNetworkToView(this.built, this.state.regionColors);
      this.view!.running = this.state.sim.status === 'running';
      this.view!.speed = this.state.sim.speed;
      this.toast('success', `Renderer running on ${this.view!.backend}`);
    } catch (e) {
      this.toast('error', 'The renderer could not restart', String(e));
    }
  }

  onCanvasReplaced: ((c: HTMLCanvasElement) => void) | null = null;

  // ------------------------------------------------------------------ worker events

  private wireClient(): void {
    const c = this.client;
    this.unsubscribers.push(
      c.on('status', ({ status }) => {
        this.store.set((s) => ({ sim: { ...s.sim, status } }));
        if (this.view) this.view.running = status === 'running' && !this.playback.active;
      }),
      c.on('progress', (p) => {
        this.store.set({ build: { active: p.phase !== 'engine', progress: p.progress, detail: p.detail } });
      }),
      c.on('telemetry', (e) => {
        this.telemetry.ingest(e);
        const r = e.report;
        this.store.set((s) => ({
          sim: { ...s.sim, timeMs: r.timeMs, step: r.step, rtf: e.perf.realtimeFactor, lagging: e.perf.lagging },
          stimuli: r.stimuli,
          recording: e.recording,
          plasticity: { ...s.plasticity, enabled: r.plasticity.enabled || (s.plasticity.enabled && !s.plasticity.available) },
        }));
        if (this.view) {
          const n = this.telemetry.regionRate.map((ring) => ring.last() || 0);
          this.view.setRegionRates(n);
          this.view.setProjectionActivity(this.telemetry.projectionRateSmooth);
          if (r.stimuli.length === 0 && this.lastStimulusSeen > 0) {
            this.view.setStimulusTargets(null);
            this.lastStimulusSeen = 0;
          }
        }
      }),
      c.on('frame', (f) => {
        if (!this.playback.active) this.view?.ingestFrame(f);
      }),
      c.on('fatal', ({ error }) => {
        this.store.set({ fatal: error });
        this.toast('error', 'Simulation error', error);
      }),
      c.on('crash', ({ error }) => {
        this.store.set({ workerCrashed: true, fatal: error });
      }),
    );
  }

  /** Recovers from a crashed worker: new worker, rebuild, optional snapshot restore. */
  async restartEngine(snapshot?: Uint8Array): Promise<void> {
    this.client.terminate();
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
    this.client = new SimulationClient(createWorker);
    this.wireClient();
    this.store.set({ workerCrashed: false, fatal: null });
    await this.client.request('init', { wasmUrl });
    await this.client.request('setTelemetryHz', { hz: this.state.telemetryHz });
    if (this.state.config) {
      await this.buildNetwork(this.state.config, { keepSelection: false });
      if (snapshot) await this.client.request('restore', { bytes: snapshot });
    }
    this.toast('success', 'Simulation engine restarted');
  }

  // ------------------------------------------------------------------ building

  /** Builds `config` in the worker and shows it. Replaces the current network. */
  async buildNetwork(config: BrainConfig, opts: { keepSelection?: boolean; run?: boolean } = {}): Promise<BuiltNetwork> {
    const wasRunning = this.state.sim.status === 'running';
    this.experiments.abort('The network is being rebuilt.');
    this.playback.stop();
    this.store.set({ build: { active: true, progress: 0, detail: 'Validating configuration' } });
    try {
      const built = await this.client.request('build', { config });
      this.built = built;
      const colors = config.regions.map((r, i) => regionColor(r.color, i));
      this.telemetry.reset(built.info, built.sample, built.regionOf);
      this.store.set((s) => ({
        config,
        draft: null,
        info: built.info,
        regionColors: colors,
        selection: opts.keepSelection ? s.selection : { neuron: null, region: null, compare: [], synapse: null },
        neuron: null,
        isolate: -1,
        projectionStats: null,
        stimuli: [],
        plasticity: { enabled: config.plasticity.enabled && built.info.plastic, rateScale: 1, available: built.info.plastic },
        sim: { ...s.sim, dt: built.info.dt, timeMs: 0, step: 0 },
        tracked: [],
        gains: built.info.projections.map((p) => p.gain),
        build: { active: false, progress: 1, detail: '' },
      }));
      this.edits.clear();
      await this.client.request('setSpeed', { speed: this.state.sim.speed });
      await this.client.request('setPlasticity', { enabled: this.state.plasticity.enabled, rateScale: 1 });
      if (this.view) await this.attachNetworkToView(built, colors);
      await this.applyProbes();
      if (opts.run ?? wasRunning) await this.run();
      return built;
    } catch (e) {
      this.store.set({ build: { active: false, progress: 0, detail: '' } });
      throw e;
    }
  }

  private async attachNetworkToView(built: BuiltNetwork, colors: string[]): Promise<void> {
    const view = this.view!;
    view.setNetwork(built, colors);
    view.setMode(this.state.viz);
    const sample = await this.client.request('sampleSynapses', { budget: view.synapseBudget, seed: built.info.seed + 17 });
    view.setSynapseSample(sample);
    view.running = this.state.sim.status === 'running';
    view.speed = this.state.sim.speed;
  }

  /** Re-samples displayed synapses (quality change). */
  async resample(): Promise<void> {
    if (!this.view || !this.built) return;
    const sample = await this.client.request('sampleSynapses', { budget: this.view.synapseBudget, seed: this.built.info.seed + 17 });
    this.view.setSynapseSample(sample);
  }

  // ------------------------------------------------------------------ simulation control

  async run(): Promise<void> {
    if (!this.built || this.playback.active) return;
    await this.client.request('run', {});
    if (this.view) this.view.running = true;
  }

  async pause(): Promise<void> {
    if (!this.built) return;
    const r = await this.client.request('pause', {});
    this.store.set((s) => ({ sim: { ...s.sim, timeMs: r.timeMs, step: r.step } }));
    if (this.view) this.view.running = false;
    void this.refreshNeuron();
  }

  async toggleRun(): Promise<void> {
    if (this.state.sim.status === 'running') await this.pause();
    else await this.run();
  }

  /** Advances exactly `steps` timesteps while paused. */
  async stepBy(steps: number): Promise<void> {
    if (!this.built) return;
    if (this.state.sim.status === 'running') await this.pause();
    const r = await this.client.request('step', { steps });
    this.store.set((s) => ({ sim: { ...s.sim, timeMs: r.timeMs, step: r.step } }));
    // Show the spikes of the stepped interval.
    if (this.view) {
      this.view.running = true;
      this.client.requestFrame(this.view.frameNeeds);
      setTimeout(() => {
        if (this.view && this.state.sim.status !== 'running') this.view.running = false;
      }, 400);
    }
    void this.refreshNeuron();
  }

  async setSpeed(speed: number): Promise<void> {
    this.store.set((s) => ({ sim: { ...s.sim, speed } }));
    if (this.view) this.view.speed = speed;
    await this.client.request('setSpeed', { speed: Number.isFinite(speed) ? speed : 0 });
  }

  async resetSimulation(weights = true): Promise<void> {
    if (!this.built) return;
    this.experiments.abort('The simulation was reset.');
    await this.client.request('reset', { weights });
    this.telemetry.clearHistory();
    this.view?.setStimulusTargets(null);
    this.store.set((s) => ({ sim: { ...s.sim, timeMs: 0, step: 0 }, stimuli: [] }));
    await this.applyProbes();
    this.toast('info', weights ? 'Simulation reset to time zero (weights restored)' : 'Simulation reset to time zero');
  }

  // ------------------------------------------------------------------ view & modes

  setMode(mode: AppMode): void {
    this.store.set({ mode });
    if (mode === 'study' && this.state.selection.neuron === null && this.built) {
      // Neuron Study needs a neuron: pick the most active sampled one.
      const n = this.built.sample[0];
      if (n !== undefined) void this.selectNeuron(n, { focus: true });
    }
    if (mode === 'connectome' || mode === 'observatory') void this.refreshProjectionStats();
  }

  setViz(viz: VizMode): void {
    this.store.set({ viz });
    this.view?.setMode(viz);
    if (viz === 'strength') void this.refreshSampleWeights();
    if (viz === 'local' && this.state.selection.neuron !== null) void this.loadFocus(this.state.selection.neuron, 2);
  }

  async setQuality(q: QualityName): Promise<void> {
    this.store.set((s) => ({ render: { ...s.render, quality: q } }));
    this.view?.setQuality(q);
    await this.resample();
    await this.savePrefs();
  }

  async setAdaptive(on: boolean): Promise<void> {
    this.store.set((s) => ({ render: { ...s.render, adaptive: on } }));
    this.view?.setAdaptive(on);
    await this.savePrefs();
  }

  async setBackend(pref: BackendPreference): Promise<void> {
    this.store.set((s) => ({ render: { ...s.render, preference: pref } }));
    await this.savePrefs();
    await this.restartRenderer(pref);
  }

  async setTelemetryHz(hz: number): Promise<void> {
    this.store.set({ telemetryHz: hz });
    await this.client.request('setTelemetryHz', { hz });
    await this.savePrefs();
  }

  private async savePrefs(): Promise<void> {
    const s = this.state;
    try {
      await this.db.setSetting('prefs', { quality: s.render.quality, adaptive: s.render.adaptive, backend: s.render.preference, telemetryHz: s.telemetryHz });
    } catch {
      /* preferences are best-effort */
    }
  }

  togglePanel(panel: 'left' | 'right' | 'minimap' | 'sheet'): void {
    this.store.set((s) => ({ panels: { ...s.panels, [panel]: !s.panels[panel] } }));
  }

  openDialog(d: DialogName | null): void {
    this.store.set({ dialog: d, palette: false, context: null });
  }

  setPalette(open: boolean): void {
    this.store.set({ palette: open, context: null });
  }

  /** Shows the browser's install prompt (only offered when `state.install` is 'available'). */
  async installApp(): Promise<void> {
    if (this.state.install !== 'available') return;
    const accepted = await platform.install();
    if (!accepted && platform.installState() !== 'installed') this.toast('info', 'Installation cancelled', 'You can install NEUROFORM later from Settings or the command palette.');
  }

  async toggleFullscreen(): Promise<void> {
    const on = await platform.toggleFullscreen();
    this.store.set({ fullscreen: on });
    setTimeout(() => this.view?.resize(), 120);
  }

  resetView(): void {
    this.view?.resetView();
  }

  toggleFly(): void {
    const on = !this.state.render.flying;
    this.view?.setFlyMode(on);
    this.store.set((s) => ({ render: { ...s.render, flying: on } }));
    if (on) this.toast('info', 'Free flight', 'W A S D to move, Q / E down / up, drag to look, Shift to boost. G to return to orbit.');
  }

  toggleTour(): void {
    if (!this.view) return;
    if (this.view.touring) this.view.stopTour();
    else {
      if (this.state.render.flying) this.toggleFly();
      this.view.startTour();
    }
  }

  // ------------------------------------------------------------------ selection

  async selectNeuron(i: number | null, opts: { focus?: boolean; keepRegion?: boolean } = {}): Promise<void> {
    const s = this.state;
    if (i === null) {
      this.store.set({ selection: { ...s.selection, neuron: null, synapse: null }, neuron: null });
      this.view?.setSelection({ neuron: null, region: s.selection.region, compare: s.selection.compare });
      this.view?.setFocusSynapses(null);
      await this.applyProbes();
      return;
    }
    if (!this.built || i < 0 || i >= this.built.info.neurons) return;
    const region = this.built.regionOf[i];
    const selection = { ...s.selection, neuron: i, synapse: null, region: opts.keepRegion ? s.selection.region : region };
    this.store.set({ selection });
    this.view?.setSelection({ neuron: i, region: selection.region, compare: selection.compare });
    if (opts.focus) this.view?.focusNeuron(i);
    await this.applyProbes();
    await this.loadFocus(i, this.state.viz === 'local' ? 2 : 1);
    await this.refreshNeuron();
  }

  async loadFocus(i: number, hops: 1 | 2): Promise<void> {
    try {
      const g = await this.client.request('localGraph', { neuron: i, hops, cap: hops === 2 ? 6000 : 2500 });
      if (this.state.selection.neuron === i) this.view?.setFocusSynapses(g);
    } catch {
      /* selection changed or network rebuilt */
    }
  }

  selectRegion(r: number | null, focus = false): void {
    const s = this.state;
    const selection = { ...s.selection, region: r };
    this.store.set({ selection });
    this.view?.setSelection({ neuron: selection.neuron, region: r, compare: selection.compare });
    if (r !== null && focus) this.view?.focusRegion(r);
    if (this.built && this.view) this.view.setProjectionActivity(this.telemetry.projectionRateSmooth);
  }

  async toggleCompare(i: number): Promise<void> {
    const s = this.state;
    const has = s.selection.compare.includes(i);
    const compare = has ? s.selection.compare.filter((x) => x !== i) : [...s.selection.compare, i].slice(-6);
    this.store.set({ selection: { ...s.selection, compare } });
    this.view?.setSelection({ neuron: s.selection.neuron, region: s.selection.region, compare });
    await this.applyProbes();
    if (!has) this.toast('info', `Neuron #${i} added to comparison`, 'Its membrane potential is now recorded every step.');
  }

  setHover(h: { neuron: number; x: number; y: number } | null): void {
    this.store.set({ hover: h });
    this.view?.setHover(h ? h.neuron : null);
  }

  toggleIsolate(r: number): void {
    const isolate = this.state.isolate === r ? -1 : r;
    this.store.set({ isolate });
    this.view?.setIsolation(isolate);
  }

  focusSelection(): void {
    const s = this.state.selection;
    if (s.neuron !== null) this.view?.focusNeuron(s.neuron);
    else if (s.region !== null) this.view?.focusRegion(s.region);
    else this.view?.resetView();
  }

  /** Neurons recorded every step: selection first, then comparisons. */
  private async applyProbes(): Promise<void> {
    if (!this.built) return;
    const s = this.state.selection;
    const ids = [...(s.neuron !== null ? [s.neuron] : []), ...s.compare.filter((c) => c !== s.neuron)].slice(0, 8);
    for (const id of [...this.telemetry.probes.keys()]) if (!ids.includes(id)) this.telemetry.dropProbe(id);
    try {
      await this.client.request('setProbes', { ids });
    } catch {
      /* not built yet */
    }
  }

  /** Re-reads the selected neuron's state. */
  async refreshNeuron(): Promise<void> {
    const i = this.state.selection.neuron;
    if (i === null || !this.built) return;
    try {
      const d = await this.client.request('neuron', { neuron: i });
      if (this.state.selection.neuron === i) this.store.set({ neuron: d });
    } catch {
      /* ignore transient errors (rebuild in progress) */
    }
  }

  /** Adds or removes a synapse from weight-history tracking. */
  async toggleTracked(id: number): Promise<void> {
    const cur = this.state.tracked;
    const tracked = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-16);
    this.store.set({ tracked });
    await this.client.request('setTracked', { ids: tracked });
    if (!cur.includes(id)) this.toast('info', `Tracking synapse ${id}`, 'Its weight is sampled every telemetry window (see Neuron Study → Synaptic history).');
  }

  async refreshProjectionStats(): Promise<void> {
    if (!this.built) return;
    try {
      const stats = await this.client.request('projectionStats', {});
      this.store.set({ projectionStats: stats });
      if (this.built.info.plastic) {
        let sum = 0;
        let n = 0;
        stats.forEach((st, p) => {
          if (this.built!.info.projections[p].plastic) {
            sum += st.meanWeight * st.synapses;
            n += st.synapses;
          }
        });
        if (n > 0) this.telemetry.recordMeanWeight(this.state.sim.timeMs, sum / n);
      }
    } catch {
      /* ignore */
    }
  }

  async refreshSampleWeights(): Promise<void> {
    const ids = this.view?.sampleIds;
    if (!ids || ids.length === 0) return;
    const w = await this.client.request('weightsOf', { ids: ids.slice() });
    this.view?.setSampleWeights(w);
  }

  private async updateDetail(target: [number, number, number], distance: number): Promise<void> {
    if (!this.view || !this.built) return;
    const { radius } = this.view.boundsInfo;
    // Close to the network: load every synapse of the neurons around the focus.
    if (distance < radius * 0.75) {
      const r = Math.max(6, distance * 0.42);
      try {
        const near = await this.client.request('nearSynapses', { center: target, radius: r, cap: this.view.detailBudget });
        this.view.setDetailSynapses(near.ids.length ? near : null);
      } catch {
        /* ignore */
      }
    } else {
      this.view.setDetailSynapses(null);
    }
  }

  /** Background polling of inspector data. */
  startPolling(): void {
    window.clearInterval(this.neuronPoll);
    window.clearInterval(this.weightPoll);
    window.clearInterval(this.statsPoll);
    this.neuronPoll = window.setInterval(() => {
      if (this.state.sim.status === 'running') void this.refreshNeuron();
    }, 250);
    this.weightPoll = window.setInterval(() => {
      if (this.state.viz === 'strength' && this.state.sim.status === 'running') void this.refreshSampleWeights();
    }, 1000);
    this.statsPoll = window.setInterval(() => {
      const s = this.state;
      const wants = s.mode === 'connectome' || s.mode === 'observatory' || s.mode === 'laboratory' || (s.plasticity.enabled && s.sim.status === 'running');
      if (wants && s.sim.status === 'running') void this.refreshProjectionStats();
    }, 2000);
    window.clearInterval(this.detailPoll);
  }

  // ------------------------------------------------------------------ stimulation & learning

  async stimulate(spec: StimulusSpec): Promise<{ id: number; targets: Uint32Array } | null> {
    if (!this.built) return null;
    try {
      const r = await this.client.request('stimulate', { spec });
      this.view?.setStimulusTargets(r.targets);
      this.lastStimulusSeen = r.id;
      return r;
    } catch (e) {
      this.toast('error', 'Stimulation rejected', e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  /** Builds a stimulus from the current defaults for a target selection. */
  stimulusFor(target: StimulusSpec['target'], label: string): StimulusSpec {
    const d = this.state.stimulus;
    return {
      label,
      target,
      amplitude: d.amplitude,
      pattern: d.pattern,
      frequencyHz: d.frequencyHz,
      pulseMs: Math.min(5, 500 / d.frequencyHz),
      rateHz: d.rateHz,
      durationMs: d.durationMs,
      repetitions: d.repetitions,
      intervalMs: Math.max(d.intervalMs, d.durationMs),
    };
  }

  async stimulateNeuron(i: number): Promise<void> {
    const r = await this.stimulate(this.stimulusFor({ kind: 'neurons', ids: [i] }, `Neuron #${i}`));
    if (r) this.toast('info', `Stimulating neuron #${i}`, this.describeStimulus());
  }

  async stimulateRegion(region: number, fraction = this.state.stimulus.fraction): Promise<void> {
    const name = this.built?.info.regions[region]?.name ?? `Region ${region}`;
    const r = await this.stimulate(this.stimulusFor({ kind: 'regions', regions: [region], fraction }, name));
    if (r) this.toast('info', `Stimulating ${name}`, `${r.targets.length.toLocaleString('en-GB')} neurons · ${this.describeStimulus()}`);
  }

  async stimulateAround(i: number): Promise<void> {
    if (!this.built) return;
    const p = this.built.positions;
    const center: [number, number, number] = [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
    const r = await this.stimulate(this.stimulusFor({ kind: 'sphere', center, radius: this.state.stimulus.radius }, `Sphere around #${i}`));
    if (r) this.toast('info', 'Stimulating local population', `${r.targets.length.toLocaleString('en-GB')} neurons within ${this.state.stimulus.radius} units · ${this.describeStimulus()}`);
  }

  describeStimulus(): string {
    const d = this.state.stimulus;
    const pat = d.pattern === 'constant' ? 'constant' : d.pattern === 'pulses' ? `${d.frequencyHz} Hz pulses` : `Poisson ${d.rateHz} Hz`;
    return `${d.amplitude.toFixed(2)} I · ${pat} · ${d.durationMs} ms${d.repetitions > 1 ? ` × ${d.repetitions}` : ''}`;
  }

  async cancelStimulus(id: number): Promise<void> {
    await this.client.request('cancelStimulus', { id });
  }

  async clearStimuli(): Promise<void> {
    await this.client.request('clearStimuli', {});
    this.view?.setStimulusTargets(null);
  }

  async setPlasticity(enabled: boolean, rateScale = this.state.plasticity.rateScale): Promise<void> {
    if (!this.built) return;
    await this.client.request('setPlasticity', { enabled, rateScale });
    this.store.set((s) => ({ plasticity: { ...s.plasticity, enabled, rateScale } }));
  }

  async reward(amount: number): Promise<void> {
    if (!this.built) return;
    await this.client.request('reward', { amount });
    this.toast('info', amount >= 0 ? `Reward +${amount}` : `Punishment ${amount}`, this.built.info.reward ? 'Converts eligibility traces into weight changes on reward-modulated pathways.' : 'This network has no reward-modulated pathways, so the modulator has no effect on weights.');
  }

  // ------------------------------------------------------------------ notifications

  toast(kind: Toast['kind'], title: string, detail?: string, action?: Toast['action']): void {
    const id = this.toastId++;
    this.store.set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, title, detail, action }] }));
    const ms = kind === 'error' ? 9000 : kind === 'warning' ? 7000 : 4200;
    window.setTimeout(() => this.dismissToast(id), ms);
  }

  dismissToast(id: number): void {
    this.store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  }

  /** Formats engine/request errors for display. */
  static message(e: unknown): string {
    if (e instanceof RequestError) return e.path ? `${e.path}: ${e.message}` : e.message;
    return e instanceof Error ? e.message : String(e);
  }

  defaultConfig(): BrainConfig {
    const tier = TIERS.find((t) => t.id === suggestedTier()) ?? TIERS[2];
    return observatory(tier.neurons, 1);
  }

  dispose(): void {
    window.clearInterval(this.neuronPoll);
    window.clearInterval(this.weightPoll);
    window.clearInterval(this.statsPoll);
    this.view?.dispose();
    this.client.terminate();
  }
}
