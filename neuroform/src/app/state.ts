/** Application state shape and defaults. */

import type { BrainConfig } from '../config/schema.ts';
import type { NetInfo, NeuronDetail, ProjectionStats, StimulusReport } from '../engine/types.ts';
import type { SimStatus } from '../sim/protocol.ts';
import type { BackendPreference, RenderStats } from '../render/BrainView.ts';
import type { QualityName } from '../render/quality.ts';
import type { VizMode } from '../render/vizModes.ts';
import type { InstallState } from '../platform/platform.ts';

export type AppMode = 'explorer' | 'observatory' | 'connectome' | 'laboratory' | 'study' | 'performance';

export const APP_MODES: { id: AppMode; label: string; key: string; describe: string }[] = [
  { id: 'explorer', label: 'Neural Explorer', key: '1', describe: 'Fly through the living network' },
  { id: 'observatory', label: 'Observatory', key: '2', describe: 'Global measurements and population activity' },
  { id: 'connectome', label: 'Connectome', key: '3', describe: 'Pathways, densities and communities' },
  { id: 'laboratory', label: 'Laboratory', key: '4', describe: 'Stimulation and experiments' },
  { id: 'study', label: 'Neuron Study', key: '5', describe: 'One neuron in depth' },
  { id: 'performance', label: 'Performance', key: '6', describe: 'Engine, worker and renderer instrumentation' },
];

export type DialogName = 'designer' | 'projects' | 'settings' | 'help' | 'export' | 'benchmark' | 'about';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warning' | 'error';
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
}

export interface BootStep {
  id: string;
  label: string;
  state: 'pending' | 'active' | 'done' | 'error';
  detail?: string;
}

export interface Selection {
  neuron: number | null;
  region: number | null;
  compare: number[];
  synapse: number | null;
}

export type PulseTiming = 'dilated' | 'true';

export interface AppState {
  intro: { visible: boolean; steps: BootStep[]; progress: number; error: string | null; skipped: boolean };
  ready: boolean;
  sim: { status: SimStatus; timeMs: number; step: number; speed: number; rtf: number; lagging: boolean; dt: number };
  build: { active: boolean; progress: number; detail: string };
  config: BrainConfig | null;
  draft: BrainConfig | null;
  info: NetInfo | null;
  regionColors: string[];
  project: { id: string; name: string; savedAt: number | null } | null;
  mode: AppMode;
  viz: VizMode;
  selection: Selection;
  neuron: NeuronDetail | null;
  hover: { neuron: number; x: number; y: number } | null;
  panels: { left: boolean; right: boolean; minimap: boolean; sheet: boolean };
  render: {
    backend: 'WebGPU' | 'WebGL2' | null;
    preference: BackendPreference;
    quality: QualityName;
    adaptive: boolean;
    stats: RenderStats | null;
    error: string | null;
    flying: boolean;
    touring: string | null;
    /** Interface translucency (backdrop blur) disabled for speed. */
    reducedEffects: boolean;
    /** Backends used this session, with the reason for any switch. */
    history: string[];
  };
  plasticity: { enabled: boolean; rateScale: number; available: boolean };
  isolate: number;
  palette: boolean;
  context: { x: number; y: number; neuron: number | null; region: number | null } | null;
  dialog: DialogName | null;
  toasts: Toast[];
  undo: string[];
  recording: { active: boolean; spikes: number; durationMs: number } | null;
  playback: { id: string; name: string; t: number; start: number; end: number; playing: boolean; speed: number } | null;
  storage: { persistent: boolean; reason: string | null };
  projectionStats: ProjectionStats[] | null;
  stimuli: StimulusReport[];
  telemetryHz: number;
  fatal: string | null;
  workerCrashed: boolean;
  stimulus: StimulusDefaults;
  fullscreen: boolean;
  /** Whether NEUROFORM can be installed as a desktop app (see `Platform.installState`). */
  install: InstallState;
  librarySeq: number;
  /** Synapses whose weight is sampled every telemetry window. */
  tracked: number[];
  /** Current gain of every pathway (1 = as built). */
  gains: number[];
}

export interface StimulusDefaults {
  amplitude: number;
  durationMs: number;
  pattern: 'constant' | 'pulses' | 'poisson';
  frequencyHz: number;
  rateHz: number;
  repetitions: number;
  intervalMs: number;
  fraction: number;
  radius: number;
}

export function initialState(): AppState {
  return {
    intro: {
      visible: true,
      progress: 0,
      error: null,
      skipped: false,
      steps: [
        { id: 'worker', label: 'Simulation worker', state: 'pending' },
        { id: 'engine', label: 'WebAssembly engine', state: 'pending' },
        { id: 'storage', label: 'Local storage', state: 'pending' },
        { id: 'renderer', label: 'Graphics backend', state: 'pending' },
        { id: 'network', label: 'Artificial brain', state: 'pending' },
      ],
    },
    ready: false,
    sim: { status: 'booting', timeMs: 0, step: 0, speed: 0.25, rtf: 0, lagging: false, dt: 0.5 },
    build: { active: false, progress: 0, detail: '' },
    config: null,
    draft: null,
    info: null,
    regionColors: [],
    project: null,
    mode: 'explorer',
    viz: 'normal',
    selection: { neuron: null, region: null, compare: [], synapse: null },
    neuron: null,
    hover: null,
    panels: { left: true, right: true, minimap: true, sheet: false },
    render: { backend: null, preference: 'auto', quality: 'high', adaptive: true, stats: null, error: null, flying: false, touring: null, reducedEffects: false, history: [] },
    plasticity: { enabled: false, rateScale: 1, available: false },
    isolate: -1,
    palette: false,
    context: null,
    dialog: null,
    toasts: [],
    undo: [],
    recording: null,
    playback: null,
    storage: { persistent: true, reason: null },
    projectionStats: null,
    stimuli: [],
    telemetryHz: 10,
    fatal: null,
    workerCrashed: false,
    stimulus: { amplitude: 2.5, durationMs: 40, pattern: 'constant', frequencyHz: 40, rateHz: 200, repetitions: 1, intervalMs: 500, fraction: 0.3, radius: 18 },
    fullscreen: false,
    install: 'unavailable',
    librarySeq: 0,
    tracked: [],
    gains: [],
  };
}
