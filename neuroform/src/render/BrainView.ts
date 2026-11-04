/**
 * The 3D neural universe. Owns the WebGPU/WebGL2 renderer, the scene and its
 * layers, and turns simulation frames (real spike events) into light.
 *
 * Independent of the simulation: it receives positions, displayed synapses and
 * per-frame spike lists, and never computes neural behaviour. Rendering runs at
 * display rate, decoupled from the simulation timestep.
 */

import { Color, RenderPipeline, Scene, Sprite, SpriteNodeMaterial, InstancedBufferAttribute, DynamicDrawUsage, AdditiveBlending, WebGPURenderer, ACESFilmicToneMapping } from 'three/webgpu';
import { color, exp, instancedDynamicBufferAttribute, length, mix, pass, screenUV, smoothstep, uv, vec2, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { NetInfo } from '../engine/types.ts';
import type { BuiltNetwork, FrameEvent, LocalGraph, SynapseSample } from '../sim/protocol.ts';
import { CameraRig, type Waypoint } from './CameraRig.ts';
import { NeuronLayer } from './NeuronLayer.ts';
import { SynapseLayer, type SegmentData } from './SynapseLayer.ts';
import { PulseLayer } from './PulseLayer.ts';
import { StructureLayer } from './StructureLayer.ts';
import { AdaptiveQuality, QUALITY, type QualityName, type QualitySettings } from './quality.ts';
import { MODE_WEIGHTS, type ModeWeights, type VizMode } from './vizModes.ts';
import { pickNeuron, project } from './picking.ts';
import { hexToRgb, PALETTE } from './palette.ts';

export type BackendPreference = 'auto' | 'webgpu' | 'webgl2';

export interface RenderStats {
  fps: number;
  frameMs: number;
  backend: 'WebGPU' | 'WebGL2';
  drawCalls: number;
  triangles: number;
  neurons: number;
  synapsesShown: number;
  pulsesActive: number;
  pulsesDropped: number;
  pulseDilation: number;
  adaptiveLevel: number;
  adaptiveActive: boolean;
  quality: QualityName;
  lodFar: number;
  pixelRatio: number;
}

export interface Selection {
  neuron: number | null;
  region: number | null;
  compare: number[];
}

type SegLayerName = 'sample' | 'focus' | 'detail';

const MAX_SPAWN_PER_FRAME = 6000;

export class RendererUnavailableError extends Error {}

export class BrainView {
  readonly renderer: WebGPURenderer;
  readonly backend: 'WebGPU' | 'WebGL2';
  readonly scene = new Scene();
  readonly rig: CameraRig;
  private readonly canvas: HTMLCanvasElement;
  private readonly labelLayer: HTMLElement;
  private pipelineBloom: RenderPipeline;
  private pipelinePlain: RenderPipeline;
  private bloomNode: ReturnType<typeof bloom>;

  private info: NetInfo | null = null;
  private positions = new Float32Array(0);
  private regionOf = new Uint16Array(0);
  private classOf = new Uint8Array(0);
  private colors: string[] = [];
  private neurons: NeuronLayer | null = null;
  private seg: Record<SegLayerName, SynapseLayer | null> = { sample: null, focus: null, detail: null };
  private pulses: PulseLayer;
  private structure: StructureLayer | null = null;
  private markers: { sprite: Sprite; pos: Float32Array; col: Float32Array; posAttr: InstancedBufferAttribute; colAttr: InstancedBufferAttribute };
  private labels: { el: HTMLDivElement; rate: HTMLSpanElement }[] = [];

  // Pulses in flight.
  private pLayer: Uint8Array;
  private pSeg: Int32Array;
  private pStart: Float64Array;
  private pDur: Float32Array;
  private pActive = 0;
  private pDropped = 0;
  private pulseClock = 0;
  private dilation = 1;

  // State.
  mode: VizMode = 'normal';
  private weights: ModeWeights = { ...MODE_WEIGHTS.normal };
  private selection: Selection = { neuron: null, region: null, compare: [] };
  private hover: number | null = null;
  private stimTargets: Uint32Array | null = null;
  private related: Set<number> | null = null;
  private isolate = -1;
  private regionActivity: number[] = [];
  private regionRates: number[] = [];
  private projectionActivity = new Float64Array(0);
  private auxSource: 'none' | 'rates' | 'membrane' | 'regional' = 'none';
  running = false;
  speed = 1;

  private quality: QualitySettings = QUALITY.high;
  readonly adaptive = new AdaptiveQuality();
  private last = performance.now();
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fps = 60;
  private frameMs = 16;
  private statsTimer = 0;
  private glowActive = false;
  private dirty = true;
  private disposed = false;
  private bounds = { center: [0, 0, 0] as [number, number, number], radius: 150 };
  private lodFar = 0;
  private settleTimer = 0;
  private moving = false;

  onStats: ((s: RenderStats) => void) | null = null;
  onWantFrame: (() => void) | null = null;
  onCameraSettled: ((target: [number, number, number], distance: number) => void) | null = null;
  onLost: ((reason: string) => void) | null = null;
  onTour: ((w: Waypoint | null) => void) | null = null;

  /** Creates a renderer: WebGPU when available and allowed, otherwise WebGL2. */
  static async create(canvas: HTMLCanvasElement, labelLayer: HTMLElement, pref: BackendPreference): Promise<BrainView> {
    const attempt = async (forceWebGL: boolean) => {
      const r = new WebGPURenderer({ canvas, antialias: true, forceWebGL, powerPreference: 'high-performance', alpha: false });
      await r.init();
      return r;
    };
    let renderer: WebGPURenderer | null = null;
    let firstError: unknown = null;
    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
    if (pref !== 'webgl2' && hasWebGPU) {
      try {
        renderer = await attempt(false);
      } catch (e) {
        firstError = e;
        renderer = null;
      }
    }
    if (!renderer) {
      try {
        renderer = await attempt(true);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new RendererUnavailableError(
          `Neither WebGPU nor WebGL2 could be initialised (${detail}${firstError ? `; WebGPU: ${String(firstError)}` : ''}).`,
        );
      }
    }
    const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    return new BrainView(canvas, labelLayer, renderer, backend);
  }

  private constructor(canvas: HTMLCanvasElement, labelLayer: HTMLElement, renderer: WebGPURenderer, backend: 'WebGPU' | 'WebGL2') {
    this.canvas = canvas;
    this.labelLayer = labelLayer;
    this.renderer = renderer;
    this.backend = backend;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(new Color(PALETTE.background), 1);
    this.rig = new CameraRig(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.rig.onTourWaypoint = (w) => this.onTour?.(w);

    // Deep blue-black gradient with a faint horizon glow.
    const sceneWithBg = this.scene as Scene & { backgroundNode: unknown };
    const glow = exp(length(screenUV.sub(0.5).mul(vec2(1.4, 1))).mul(-2.2)).mul(0.55);
    sceneWithBg.backgroundNode = mix(color(PALETTE.background), color(PALETTE.backgroundHigh), glow);

    const scenePass = pass(this.scene, this.rig.camera);
    const sceneColor = scenePass.getTextureNode('output');
    this.bloomNode = bloom(sceneColor, 0.8, 0.42, 0.55);
    this.pipelineBloom = new RenderPipeline(renderer);
    this.pipelineBloom.outputNode = sceneColor.add(this.bloomNode);
    this.pipelinePlain = new RenderPipeline(renderer);
    this.pipelinePlain.outputNode = sceneColor;

    this.pulses = new PulseLayer(QUALITY.ultra.pulses);
    this.scene.add(this.pulses.sprite);
    const cap = QUALITY.ultra.pulses;
    this.pLayer = new Uint8Array(cap);
    this.pSeg = new Int32Array(cap);
    this.pStart = new Float64Array(cap);
    this.pDur = new Float32Array(cap);
    this.markers = this.createMarkers();
    this.scene.add(this.markers.sprite);

    // Lost devices / contexts are reported, never silently ignored.
    const r = renderer as WebGPURenderer & { onDeviceLost?: (info: { message?: string }) => void };
    r.onDeviceLost = (info) => {
      this.onLost?.(`The GPU device was lost${info?.message ? `: ${info.message}` : ''}.`);
    };
    canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    this.resize();
    renderer.setAnimationLoop(this.loop);
  }

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    this.onLost?.('The WebGL context was lost (the GPU was reset or ran out of memory).');
  };

  private createMarkers() {
    const cap = 12;
    const pos = new Float32Array(cap * 3);
    const col = new Float32Array(cap * 4);
    const posAttr = new InstancedBufferAttribute(pos, 3);
    posAttr.setUsage(DynamicDrawUsage);
    const colAttr = new InstancedBufferAttribute(col, 4);
    colAttr.setUsage(DynamicDrawUsage);
    const p = instancedDynamicBufferAttribute(posAttr);
    const c = instancedDynamicBufferAttribute(colAttr);
    const d = length(uv().sub(0.5)).mul(2);
    const ring = smoothstep(0.62, 0.7, d).mul(smoothstep(0.86, 0.78, d));
    const inner = exp(d.mul(d).mul(-30)).mul(0.6);
    const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending });
    mat.positionNode = p;
    mat.colorNode = vec4(c.xyz.mul(ring.add(inner)).mul(1.6), 1);
    mat.scaleNode = c.w;
    const sprite = new Sprite(mat);
    sprite.count = 0;
    sprite.frustumCulled = false;
    sprite.renderOrder = 10;
    return { sprite, pos, col, posAttr, colAttr };
  }

  // ------------------------------------------------------------------ network

  setNetwork(built: BuiltNetwork, colors: string[]): void {
    this.clearNetwork();
    this.info = built.info;
    this.positions = built.positions;
    this.regionOf = built.regionOf;
    this.classOf = built.classOf;
    this.colors = colors;
    this.neurons = new NeuronLayer(built.positions, built.regionOf, built.classOf, colors);
    this.scene.add(this.neurons.sprite);
    this.structure = new StructureLayer(built.info, colors);
    this.scene.add(this.structure.group);
    this.regionActivity = built.info.regions.map(() => 0);
    this.regionRates = built.info.regions.map(() => 0);
    this.projectionActivity = new Float64Array(built.info.projections.length);
    this.selection = { neuron: null, region: null, compare: [] };
    this.related = null;
    this.stimTargets = null;
    this.isolate = -1;

    // Bounds from neuron positions.
    const n = built.positions.length / 3;
    const c: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k] += built.positions[3 * i + k] / n;
    let r = 1;
    for (let i = 0; i < n; i++) {
      const dx = built.positions[3 * i] - c[0];
      const dy = built.positions[3 * i + 1] - c[1];
      const dz = built.positions[3 * i + 2] - c[2];
      r = Math.max(r, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    this.bounds = { center: c, radius: r };
    const neuronSize = Math.max(0.6, Math.min(3.2, r * 0.0105 * Math.cbrt(8000 / Math.max(500, n))));
    this.neurons.uniforms.size.value = neuronSize * this.quality.neuronScale;
    this.pulses.uniforms.size.value = neuronSize * 1.35;
    const fog = 0.55 / (r * 3.2);
    this.neurons.uniforms.fog.value = fog;
    this.pulses.uniforms.fog.value = fog;
    this.rig.minDistance = Math.max(1.5, neuronSize * 3);
    this.rig.maxDistance = r * 9;
    this.createLabels();
    this.applyNeuronState();
    this.resetView(true);
    this.dirty = true;
  }

  private clearNetwork(): void {
    if (this.neurons) {
      this.scene.remove(this.neurons.sprite);
      this.neurons.dispose();
      this.neurons = null;
    }
    for (const k of ['sample', 'focus', 'detail'] as SegLayerName[]) this.setSegments(k, null);
    if (this.structure) {
      this.scene.remove(this.structure.group);
      this.structure.dispose();
      this.structure = null;
    }
    this.pActive = 0;
    this.pulses.commit(0);
    for (const l of this.labels) l.el.remove();
    this.labels = [];
  }

  private createLabels(): void {
    if (!this.info) return;
    this.labels = this.info.regions.map((r, i) => {
      const el = document.createElement('div');
      el.className = 'region-label';
      el.style.setProperty('--region', this.colors[i]);
      const name = document.createElement('span');
      name.className = 'region-label__name';
      name.textContent = r.name;
      const rate = document.createElement('span');
      rate.className = 'region-label__rate';
      el.append(name, rate);
      el.dataset.region = String(i);
      this.labelLayer.appendChild(el);
      return { el, rate };
    });
  }

  private setSegments(name: SegLayerName, data: SegmentData | null): void {
    const old = this.seg[name];
    if (old) {
      this.scene.remove(old.lines);
      old.dispose();
      this.seg[name] = null;
      // Pulses on the removed layer are dropped.
      const id = ['sample', 'focus', 'detail'].indexOf(name);
      let w = 0;
      for (let k = 0; k < this.pActive; k++) {
        if (this.pLayer[k] === id) continue;
        this.pLayer[w] = this.pLayer[k];
        this.pSeg[w] = this.pSeg[k];
        this.pStart[w] = this.pStart[k];
        this.pDur[w] = this.pDur[k];
        w++;
      }
      this.pActive = w;
    }
    if (!data || !this.info || data.ids.length === 0) return;
    const alpha = name === 'sample' ? 0.16 : name === 'focus' ? 0.6 : 0.32;
    const layer = new SynapseLayer(data, this.positions, this.regionOf, this.classOf, this.colors, this.info.neurons, { alpha });
    this.seg[name] = layer;
    this.scene.add(layer.lines);
    this.applySynapseVis();
    this.dirty = true;
  }

  setSynapseSample(sample: SynapseSample | null): void {
    this.setSegments('sample', sample);
  }

  setFocusSynapses(graph: LocalGraph | null): void {
    this.setSegments('focus', graph);
    if (graph) {
      const rel = new Set<number>();
      for (let k = 0; k < graph.pre.length; k++) {
        rel.add(graph.pre[k]);
        rel.add(graph.post[k]);
      }
      this.related = rel;
    } else {
      this.related = null;
    }
    this.applyNeuronState();
  }

  setDetailSynapses(data: SegmentData | null): void {
    this.setSegments('detail', data);
  }

  /** Current weights for the displayed overview synapses (strength mode). */
  setSampleWeights(weights: Float32Array): void {
    this.seg.sample?.setWeights(weights);
    this.dirty = true;
  }

  get sampleIds(): Uint32Array | null {
    return this.seg.sample?.data.ids ?? null;
  }

  // ------------------------------------------------------------------ frames

  ingestFrame(f: FrameEvent): void {
    const nl = this.neurons;
    if (!nl) return;
    const sp = f.spikes;
    const glow = nl.glow;
    let spawned = 0;
    const capacity = Math.floor(this.quality.pulses * this.adaptive.reductions.pulses);
    const now = this.pulseClock;
    const dt = this.info?.dt ?? 0.5;
    const realFactor = Number.isFinite(this.speed) && this.speed > 0 ? 1 / this.speed : 0;
    // Pulse travel time: the real delay at the current speed, dilated to stay
    // visible (≥ 240 ms) when the simulation runs fast. The HUD reports the factor.
    const minVisible = this.mode === 'spikes' ? 380 : 260;
    let maxDil = 1;
    const layers: (SynapseLayer | null)[] = [this.seg.sample, this.seg.focus, this.seg.detail];
    for (let k = 0; k + 1 < sp.length; k += 2) {
      const j = sp[k + 1];
      glow[j] = 1;
      if (spawned >= MAX_SPAWN_PER_FRAME) continue;
      for (let li = 0; li < 3; li++) {
        const layer = layers[li];
        if (!layer) continue;
        const a = layer.preStart[j];
        const b = layer.preStart[j + 1];
        for (let q = a; q < b; q++) {
          const s = layer.preList[q];
          if (layer.vis[2 * s] < 0.05) continue;
          if (this.pActive >= capacity) {
            this.pDropped++;
            continue;
          }
          const real = layer.data.delayMs[s] * realFactor;
          const dur = Math.min(1800, Math.max(real, minVisible));
          if (real > 0) maxDil = Math.max(maxDil, dur / real);
          else maxDil = Infinity;
          const p = this.pActive++;
          this.pLayer[p] = li;
          this.pSeg[p] = s;
          // Later spikes in the same frame start slightly later.
          this.pStart[p] = now - Math.max(0, (f.step - sp[k]) * dt * realFactor);
          this.pDur[p] = dur;
          layer.act[2 * s] = 1;
          layer.act[2 * s + 1] = 1;
          spawned++;
        }
      }
    }
    if (sp.length > 0) {
      this.glowActive = true;
      this.dilation = maxDil;
    }
    if (f.membrane && this.auxSource === 'membrane') {
      const st = nl.state;
      const v = f.membrane;
      for (let i = 0; i < v.length; i++) st[3 * i] = v[i];
      nl.markStateDirty();
    }
    if (f.rates && this.auxSource === 'rates') {
      const st = nl.state;
      const secs = f.rates.windowMs / 1000;
      const norm = 1 / Math.log(1 + 60);
      for (let i = 0; i < f.rates.counts.length; i++) st[3 * i] = Math.log(1 + f.rates.counts[i] / secs) * norm;
      nl.markStateDirty();
    }
    this.dirty = true;
  }

  /** What the renderer needs in frames for the current mode. */
  get frameNeeds(): { membrane: boolean; rates: boolean } {
    return { membrane: this.auxSource === 'membrane', rates: this.auxSource === 'rates' };
  }

  // ------------------------------------------------------------------ state

  setMode(mode: VizMode): void {
    this.mode = mode;
    this.auxSource = mode === 'density' ? 'rates' : mode === 'membrane' ? 'membrane' : mode === 'regional' ? 'regional' : 'none';
    if (this.auxSource === 'regional') this.applyRegionalAux();
    if (this.auxSource === 'none' && this.neurons) {
      const st = this.neurons.state;
      for (let i = 0; i < st.length; i += 3) st[i] = 0;
      this.neurons.markStateDirty();
    }
    this.applyNeuronState();
    this.applySynapseVis();
    this.dirty = true;
  }

  setSelection(sel: Selection): void {
    this.selection = sel;
    this.applyNeuronState();
    this.applySynapseVis();
    this.updateMarkers();
  }

  setHover(neuron: number | null): void {
    if (neuron === this.hover) return;
    this.hover = neuron;
    this.updateMarkers();
  }

  setStimulusTargets(targets: Uint32Array | null): void {
    this.stimTargets = targets;
    this.applyNeuronState();
  }

  setIsolation(region: number): void {
    this.isolate = region;
    this.applyNeuronState();
    this.applySynapseVis();
  }

  /** Measured firing rate per region (Hz). */
  setRegionRates(rates: number[]): void {
    this.regionRates = rates;
    const max = Math.max(5, ...rates);
    this.regionActivity = rates.map((r) => Math.min(1, r / max));
    this.structure?.setRegions(this.regionActivity, this.selection.region ?? -1);
    if (this.auxSource === 'regional') this.applyRegionalAux();
    this.labels.forEach((l, i) => {
      l.rate.textContent = `${(rates[i] ?? 0).toFixed(1)} Hz`;
    });
    this.dirty = true;
  }

  setProjectionActivity(rates: Float64Array): void {
    this.projectionActivity = rates;
    if (this.structure && this.info) this.structure.setBundles(rates, this.selection.region ?? this.isolate, this.info);
  }

  private applyRegionalAux(): void {
    const nl = this.neurons;
    if (!nl) return;
    const st = nl.state;
    for (let i = 0; i < this.regionOf.length; i++) st[3 * i] = this.regionActivity[this.regionOf[i]] ?? 0;
    nl.markStateDirty();
  }

  private applyNeuronState(): void {
    const nl = this.neurons;
    if (!nl) return;
    const st = nl.state;
    const n = nl.count;
    const local = this.mode === 'local' && this.related !== null;
    for (let i = 0; i < n; i++) {
      st[3 * i + 1] = 0;
      let dim = 0;
      if (this.isolate >= 0 && this.regionOf[i] !== this.isolate) dim = 0.85;
      if (local && !this.related!.has(i)) dim = 0.93;
      st[3 * i + 2] = dim;
    }
    if (this.stimTargets) for (const t of this.stimTargets) if (t < n) st[3 * t + 1] = 1;
    if (this.related && (this.mode === 'local' || this.mode === 'connectivity')) {
      for (const t of this.related) st[3 * t + 1] = Math.max(st[3 * t + 1], 2);
    }
    for (const c of this.selection.compare) if (c < n) st[3 * c + 1] = 2;
    if (this.selection.neuron !== null && this.selection.neuron < n) {
      st[3 * this.selection.neuron + 1] = 3;
      st[3 * this.selection.neuron + 2] = 0;
    }
    nl.markStateDirty();
    this.dirty = true;
  }

  private applySynapseVis(): void {
    for (const name of ['sample', 'focus', 'detail'] as SegLayerName[]) {
      const layer = this.seg[name];
      if (!layer) continue;
      const vis = layer.vis;
      const local = this.mode === 'local' && name !== 'focus';
      for (let s = 0; s < layer.count; s++) {
        let v = 1;
        if (this.isolate >= 0) {
          const a = this.regionOf[layer.data.pre[s]];
          const b = this.regionOf[layer.data.post[s]];
          v = a === this.isolate || b === this.isolate ? 1 : 0.04;
        }
        if (local) v *= 0.15;
        vis[2 * s] = v;
        vis[2 * s + 1] = v;
      }
      layer.markVisDirty();
    }
    this.dirty = true;
  }

  private updateMarkers(): void {
    const m = this.markers;
    let k = 0;
    const size = (this.neurons?.uniforms.size.value as number) ?? 1.4;
    const put = (i: number, hex: string, scale: number) => {
      if (k >= 12 || i * 3 + 2 >= this.positions.length) return;
      m.pos.set(this.positions.subarray(3 * i, 3 * i + 3), 3 * k);
      m.col.set([...hexToRgb(hex), size * scale], 4 * k);
      k++;
    };
    if (this.selection.neuron !== null) put(this.selection.neuron, PALETTE.violet, 6);
    for (const c of this.selection.compare) put(c, PALETTE.ultraviolet, 4.5);
    if (this.hover !== null && this.hover !== this.selection.neuron) put(this.hover, PALETTE.white, 4);
    m.sprite.count = k;
    m.sprite.visible = k > 0;
    m.posAttr.needsUpdate = true;
    m.colAttr.needsUpdate = true;
    this.dirty = true;
  }

  // ------------------------------------------------------------------ camera

  resetView(instant = false): void {
    const { center, radius } = this.bounds;
    this.rig.frame(center, radius * 1.02, 0.75, 0.3);
    if (instant) {
      this.rig.target.copy(this.rig.goalTarget);
      this.rig.distance = this.rig.goalDistance * 1.8;
      this.rig.yaw = this.rig.goalYaw - 0.9;
      this.rig.pitch = 0.55;
      this.rig.stiffness = 1.6;
    }
    this.dirty = true;
  }

  focusNeuron(i: number): void {
    if (i * 3 + 2 >= this.positions.length) return;
    const p: [number, number, number] = [this.positions[3 * i], this.positions[3 * i + 1], this.positions[3 * i + 2]];
    this.rig.focus(p, Math.max(this.rig.minDistance * 4, this.bounds.radius * 0.16));
  }

  focusRegion(r: number): void {
    const reg = this.info?.regions[r];
    if (!reg) return;
    this.rig.frame(reg.center, Math.max(...reg.radius) * 1.25, this.rig.goalYaw, Math.max(0.15, Math.min(0.7, this.rig.goalPitch)));
  }

  focusPoint(p: [number, number, number], distance?: number): void {
    this.rig.focus(p, distance);
  }

  setFlyMode(on: boolean): void {
    this.rig.setMode(on ? 'fly' : 'orbit');
  }

  startTour(): void {
    if (!this.info) return;
    const { center, radius } = this.bounds;
    const regions = this.info.regions;
    const pts: Waypoint[] = [{ target: center, distance: radius * 2.4, yaw: 0.7, pitch: 0.3, hold: 7, label: 'Overview' }];
    regions.forEach((r, i) => {
      pts.push({ target: r.center, distance: Math.max(...r.radius) * 1.9, yaw: 0.7 + i * 1.1, pitch: 0.18 + (i % 3) * 0.12, hold: 6.5, label: r.name });
    });
    pts.push({ target: center, distance: radius * 0.55, yaw: 2.4, pitch: -0.05, hold: 8, label: 'Inside the network' });
    this.rig.startTour(pts);
  }

  stopTour(): void {
    this.rig.stopTour();
  }

  get touring(): boolean {
    return this.rig.touring;
  }

  // ------------------------------------------------------------------ picking

  pick(x: number, y: number, radiusPx = 9): number | null {
    if (!this.neurons) return null;
    const cam = this.rig.camera;
    cam.updateMatrixWorld();
    const vp = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse).elements;
    const rect = this.canvas.getBoundingClientRect();
    const st = this.neurons.state;
    const res = pickNeuron(this.positions, vp, x, y, rect.width, rect.height, radiusPx, (i) => st[3 * i + 2] < 0.8);
    return res ? res.neuron : null;
  }

  /** Screen position (CSS px) of a neuron, for anchoring overlays. */
  screenOf(i: number): [number, number] | null {
    const cam = this.rig.camera;
    const vp = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse).elements;
    const rect = this.canvas.getBoundingClientRect();
    const p = project(vp, [this.positions[3 * i], this.positions[3 * i + 1], this.positions[3 * i + 2]], rect.width, rect.height);
    return p ? [p[0], p[1]] : null;
  }

  get boundsInfo(): { center: [number, number, number]; radius: number } {
    return this.bounds;
  }

  // ------------------------------------------------------------------ quality

  setQuality(name: QualityName): void {
    this.quality = QUALITY[name];
    this.adaptive.reset();
    if (this.neurons && this.info) {
      this.resize();
    }
    this.dirty = true;
  }

  get qualityName(): QualityName {
    return this.quality.name;
  }

  setAdaptive(on: boolean): void {
    this.adaptive.enabled = on;
    if (!on) this.adaptive.reset();
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio) * this.adaptive.reductions.resolution;
    this.renderer.setPixelRatio(Math.max(0.5, pr));
    this.renderer.setSize(w, h, false);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  // ------------------------------------------------------------------ loop

  private loop = (): void => {
    if (this.disposed) return;
    const now = performance.now();
    const dtMs = Math.min(100, now - this.last);
    this.last = now;
    const dt = dtMs / 1000;
    this.fpsAcc += dtMs;
    this.fpsFrames++;
    if (this.fpsAcc >= 500) {
      this.fps = (this.fpsFrames * 1000) / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    this.frameMs = this.frameMs * 0.9 + dtMs * 0.1;
    if (this.adaptive.sample(dtMs)) this.resize();

    if (this.running) {
      this.pulseClock += dtMs;
      this.onWantFrame?.();
    }
    const moved = this.rig.update(dt);
    if (moved) {
      this.dirty = true;
      this.moving = true;
      this.settleTimer = 0;
    } else if (this.moving) {
      this.settleTimer += dtMs;
      if (this.settleTimer > 350) {
        this.moving = false;
        const t = this.rig.target;
        this.onCameraSettled?.([t.x, t.y, t.z], this.rig.distance);
      }
    }

    this.animateWeights(dt);
    this.decay(dt);
    this.updatePulses();
    this.updateLod();
    this.updateLabels();

    if (this.dirty || this.glowActive || this.pActive > 0 || this.running || this.rig.touring) {
      const useBloom = this.quality.bloom && this.adaptive.reductions.bloom;
      this.bloomNode.strength.value = this.quality.bloomStrength;
      (useBloom ? this.pipelineBloom : this.pipelinePlain).render();
      this.dirty = false;
    }

    this.statsTimer += dtMs;
    if (this.statsTimer > 250) {
      this.statsTimer = 0;
      this.onStats?.(this.stats());
    }
  };

  private animateWeights(dt: number): void {
    const target = MODE_WEIGHTS[this.mode];
    const k = 1 - Math.exp(-dt * 5);
    let changed = false;
    const w = this.weights as unknown as Record<string, number>;
    const t = target as unknown as Record<string, number>;
    for (const key of Object.keys(t)) {
      const d = t[key] - w[key];
      if (Math.abs(d) > 1e-3) {
        w[key] += d * k;
        changed = true;
      } else w[key] = t[key];
    }
    if (!changed && !this.dirty) return;
    const W = this.weights;
    this.neurons?.setWeights({ base: W.nBase, spike: W.nSpike, heat: W.nHeat, cls: W.nClass, size: 1 });
    const farFade = 1 - this.lodFar;
    const sample = this.seg.sample;
    if (sample) {
      // Many overlapping additive lines saturate: normalise by how many are drawn.
      // Overlapping additive lines saturate: scale by how many are drawn so the
      // overview stays a faint web however large the displayed sample is.
      const norm = Math.min(1, Math.sqrt(2000 / Math.max(1, sample.count)));
      sample.uniforms.alpha.value = W.sAlpha * 0.12 * norm;
      sample.uniforms.active.value = W.sActive * 0.22 * norm;
      sample.uniforms.strength.value = W.sStrength;
      sample.uniforms.ei.value = W.sEI;
      sample.uniforms.fade.value = farFade;
    }
    for (const name of ['focus', 'detail'] as SegLayerName[]) {
      const l = this.seg[name];
      if (!l) continue;
      l.uniforms.alpha.value = (name === 'focus' ? 0.35 * Math.min(1, Math.sqrt(300 / Math.max(1, l.count))) : 0.05 * Math.min(1, Math.sqrt(2000 / Math.max(1, l.count)))) * W.focus;
      l.uniforms.active.value = W.sActive * (name === 'focus' ? 0.6 : 0.2 * Math.min(1, Math.sqrt(2000 / Math.max(1, l.count))));
      l.uniforms.strength.value = W.sStrength;
      l.uniforms.ei.value = Math.max(W.sEI, name === 'focus' ? 0.5 : 0);
      l.uniforms.fade.value = 1;
    }
    this.pulses.uniforms.opacity.value = W.pulses;
    if (this.structure) {
      this.structure.uniforms.halo.value = W.halo + this.lodFar * 0.6;
      this.structure.uniforms.bundles.value = W.bundles * (0.35 + this.lodFar * 1.3);
    }
    if (changed) this.dirty = true;
  }

  private decay(dt: number): void {
    const nl = this.neurons;
    if (nl && this.glowActive) {
      const tau = this.mode === 'spikes' ? 0.34 : 0.22;
      const f = Math.exp(-dt / tau);
      const g = nl.glow;
      let any = false;
      for (let i = 0; i < g.length; i++) {
        const v = g[i];
        if (v > 0.004) {
          g[i] = v * f;
          any = true;
        } else if (v !== 0) g[i] = 0;
      }
      nl.markGlowDirty();
      this.glowActive = any;
    }
    const f = Math.exp(-dt / 0.15);
    for (const name of ['sample', 'focus', 'detail'] as SegLayerName[]) {
      const l = this.seg[name];
      if (!l) continue;
      const a = l.act;
      let any = false;
      for (let i = 0; i < a.length; i++) {
        if (a[i] > 0.003) {
          a[i] *= f;
          any = true;
        } else a[i] = 0;
      }
      if (any) l.markActDirty();
    }
  }

  private updatePulses(): void {
    const n = this.pActive;
    if (n === 0) {
      this.pulses.commit(0);
      return;
    }
    const now = this.pulseClock;
    const layers: (SynapseLayer | null)[] = [this.seg.sample, this.seg.focus, this.seg.detail];
    const pos = this.positions;
    const out = this.pulses.pos;
    const col = this.pulses.col;
    const cyan = hexToRgb(PALETTE.cyan);
    const mag = hexToRgb(PALETTE.magenta);
    let w = 0;
    for (let k = 0; k < n; k++) {
      const t = (now - this.pStart[k]) / this.pDur[k];
      const layer = layers[this.pLayer[k]];
      if (t >= 1 || !layer) continue;
      // Keep this pulse (compact in place).
      if (w !== k) {
        this.pLayer[w] = this.pLayer[k];
        this.pSeg[w] = this.pSeg[k];
        this.pStart[w] = this.pStart[k];
        this.pDur[w] = this.pDur[k];
      }
      const s = this.pSeg[w];
      const a = layer.data.pre[s];
      const b = layer.data.post[s];
      const tt = Math.max(0, t);
      // Ease so the pulse leaves crisply and settles into the target.
      const e = tt * tt * (3 - 2 * tt);
      out[3 * w] = pos[3 * a] + (pos[3 * b] - pos[3 * a]) * e;
      out[3 * w + 1] = pos[3 * a + 1] + (pos[3 * b + 1] - pos[3 * a + 1]) * e;
      out[3 * w + 2] = pos[3 * a + 2] + (pos[3 * b + 2] - pos[3 * a + 2]) * e;
      const c = this.classOf[a] ? mag : cyan;
      const intensity = (0.55 + 0.45 * Math.min(1, Math.abs(layer.data.weight[s]) / layer.maxWeight)) * Math.min(1, (1 - tt) * 4) * Math.min(1, tt * 12 + 0.2);
      col[4 * w] = c[0];
      col[4 * w + 1] = c[1];
      col[4 * w + 2] = c[2];
      col[4 * w + 3] = intensity;
      w++;
    }
    this.pActive = w;
    this.pulses.commit(w);
  }

  private updateLod(): void {
    const { center, radius } = this.bounds;
    const cam = this.rig.camera.position;
    const d = Math.hypot(cam.x - center[0], cam.y - center[1], cam.z - center[2]);
    // Far views blend individual synapses into region halos and pathway bundles.
    const x = (d - radius * 2.6) / (radius * 2.4);
    const far = Math.min(1, Math.max(0, x));
    if (Math.abs(far - this.lodFar) > 0.002) {
      this.lodFar = far;
      this.dirty = true;
      const fade = 1 - far;
      if (this.seg.sample) this.seg.sample.uniforms.fade.value = fade;
      if (this.structure) {
        this.structure.uniforms.halo.value = this.weights.halo + far * 0.6;
        this.structure.uniforms.bundles.value = this.weights.bundles * (0.35 + far * 1.3);
      }
    }
    // Synapses further than this from the camera fade out.
    const fadeDist = radius * (1.4 + this.quality.synapses / 20000) + d * 0.6;
    for (const name of ['sample', 'detail'] as SegLayerName[]) {
      const l = this.seg[name];
      if (l) l.uniforms.nearFade.value = fadeDist;
    }
  }

  private updateLabels(): void {
    if (!this.info || this.labels.length === 0) return;
    const cam = this.rig.camera;
    const vp = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse).elements;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.info.regions.forEach((r, i) => {
      const l = this.labels[i];
      const top: [number, number, number] = [r.center[0], r.center[1] + r.radius[1] * 1.08, r.center[2]];
      const p = project(vp, top, w, h);
      if (!p || p[0] < -200 || p[0] > w + 200 || p[1] < -50 || p[1] > h + 50) {
        l.el.style.opacity = '0';
        return;
      }
      const dist = p[2];
      const op = Math.max(0, Math.min(1, (this.bounds.radius * 5 - dist) / (this.bounds.radius * 2))) * (this.isolate >= 0 && this.isolate !== i ? 0.35 : 1);
      l.el.style.opacity = String(op);
      l.el.style.transform = `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px) translate(-50%, -100%)`;
      l.el.classList.toggle('is-selected', this.selection.region === i);
    });
  }

  stats(): RenderStats {
    const info = (this.renderer as unknown as { info: { render: { drawCalls?: number; calls?: number; triangles?: number } } }).info;
    const shown = (this.seg.sample?.count ?? 0) + (this.seg.focus?.count ?? 0) + (this.seg.detail?.count ?? 0);
    const s: RenderStats = {
      fps: this.fps,
      frameMs: this.frameMs,
      backend: this.backend,
      drawCalls: info?.render?.drawCalls ?? info?.render?.calls ?? 0,
      triangles: info?.render?.triangles ?? 0,
      neurons: this.neurons?.count ?? 0,
      synapsesShown: shown,
      pulsesActive: this.pActive,
      pulsesDropped: this.pDropped,
      pulseDilation: this.dilation,
      adaptiveLevel: this.adaptive.level,
      adaptiveActive: this.adaptive.active,
      quality: this.quality.name,
      lodFar: this.lodFar,
      pixelRatio: this.renderer.getPixelRatio(),
    };
    this.pDropped = 0;
    return s;
  }

  /** Synapses the current quality allows in the overview set. */
  get synapseBudget(): number {
    return Math.floor(this.quality.synapses * this.adaptive.reductions.synapses);
  }

  get detailBudget(): number {
    return this.quality.detailSynapses;
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.clearNetwork();
    this.pulses.dispose();
    this.renderer.dispose();
  }
}
