/** Command registry shared by the command palette and keyboard shortcuts. */

import type { AppController } from './AppController.ts';
import { APP_MODES } from './state.ts';
import { VIZ_MODES } from '../render/vizModes.ts';
import { PRESETS, TIERS } from '../config/presets.ts';
import { QUALITY_ORDER } from '../render/quality.ts';
import { SPEEDS } from '../sim/protocol.ts';
import { EXPERIMENTS } from '../experiments/definitions.ts';

export interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keys?: string;
  run: () => void | Promise<void>;
}

export function buildCommands(app: AppController): Command[] {
  const s = app.state;
  const info = s.info;
  const cmds: Command[] = [];
  const add = (c: Command) => cmds.push(c);

  add({ id: 'run', group: 'Simulation', label: s.sim.status === 'running' ? 'Pause simulation' : 'Run simulation', keys: 'Space', run: () => app.toggleRun() });
  add({ id: 'step', group: 'Simulation', label: 'Single step', hint: `${s.sim.dt} ms`, keys: '.', run: () => app.stepBy(1) });
  add({ id: 'step10', group: 'Simulation', label: 'Advance 10 ms', keys: 'Shift .', run: () => app.stepBy(Math.round(10 / s.sim.dt)) });
  add({ id: 'reset', group: 'Simulation', label: 'Reset to time zero', hint: 'restores initial weights', keys: 'Shift R', run: () => app.resetSimulation(true) });
  for (const sp of SPEEDS) add({ id: `speed-${sp}`, group: 'Simulation', label: `Speed ${Number.isFinite(sp) ? `${sp}×` : 'maximum'}`, run: () => app.setSpeed(sp) });
  add({ id: 'plasticity', group: 'Learning', label: s.plasticity.enabled ? 'Disable plasticity (freeze weights)' : 'Enable plasticity (STDP)', keys: 'P', run: () => app.setPlasticity(!s.plasticity.enabled) });
  add({ id: 'reward', group: 'Learning', label: 'Deliver reward (+1 neuromodulator)', run: () => app.reward(1) });
  add({ id: 'punish', group: 'Learning', label: 'Deliver punishment (−1 neuromodulator)', run: () => app.reward(-1) });
  add({ id: 'record', group: 'Simulation', label: s.recording ? 'Stop recording' : 'Start recording', run: () => (s.recording ? app.projects.stopRecording() : app.projects.startRecording()) });
  add({ id: 'snapshot', group: 'Project', label: 'Save snapshot of the current state', run: async () => void (await app.projects.takeSnapshot()) });
  add({ id: 'save', group: 'Project', label: 'Save project', keys: 'Ctrl S', run: () => app.projects.saveProject() });
  add({ id: 'projects', group: 'Project', label: 'Open projects, snapshots and recordings', run: () => app.openDialog('projects') });
  add({ id: 'designer', group: 'Project', label: 'Brain designer (new brain, configuration)', keys: 'N', run: () => app.openDialog('designer') });
  add({ id: 'import', group: 'Project', label: 'Import configuration, snapshot or recording…', run: () => app.projects.pickAndImport() });
  add({ id: 'export', group: 'Project', label: 'Export data…', run: () => app.openDialog('export') });
  add({ id: 'export-config', group: 'Project', label: 'Export configuration (JSON)', run: () => app.projects.exportConfig() });
  add({ id: 'undo', group: 'Edit', label: s.undo.length ? `Undo: ${s.undo[s.undo.length - 1]}` : 'Undo (nothing to undo)', keys: 'Ctrl Z', run: () => app.edits.undo() });

  for (const m of APP_MODES) add({ id: `mode-${m.id}`, group: 'Modes', label: m.label, hint: m.describe, keys: m.key, run: () => app.setMode(m.id) });
  VIZ_MODES.forEach((v, i) => add({ id: `viz-${v.id}`, group: 'Visualisation', label: v.label, hint: v.describe, keys: `Shift ${i + 1}`, run: () => app.setViz(v.id) }));
  add({ id: 'reset-view', group: 'Camera', label: 'Reset view', keys: 'R', run: () => app.resetView() });
  add({ id: 'focus', group: 'Camera', label: 'Focus selection', keys: 'F', run: () => app.focusSelection() });
  add({ id: 'fly', group: 'Camera', label: s.render.flying ? 'Return to orbit navigation' : 'Free flight (WASD)', keys: 'G', run: () => app.toggleFly() });
  add({ id: 'tour', group: 'Camera', label: s.render.touring ? 'Stop cinematic tour' : 'Cinematic auto-exploration', keys: 'T', run: () => app.toggleTour() });
  add({ id: 'fullscreen', group: 'View', label: 'Toggle full screen', keys: 'Shift F', run: () => app.toggleFullscreen() });
  add({ id: 'left', group: 'View', label: 'Toggle left panel', keys: '[', run: () => app.togglePanel('left') });
  add({ id: 'right', group: 'View', label: 'Toggle right panel', keys: ']', run: () => app.togglePanel('right') });
  add({ id: 'minimap', group: 'View', label: 'Toggle minimap', keys: 'M', run: () => app.togglePanel('minimap') });
  for (const q of QUALITY_ORDER) add({ id: `quality-${q}`, group: 'Display', label: `Quality: ${q}`, run: () => app.setQuality(q) });
  add({ id: 'adaptive', group: 'Display', label: s.render.adaptive ? 'Disable adaptive quality' : 'Enable adaptive quality', run: () => app.setAdaptive(!s.render.adaptive) });
  add({ id: 'settings', group: 'Display', label: 'Settings', run: () => app.openDialog('settings') });
  add({ id: 'benchmark', group: 'Performance', label: 'Run engine benchmark', run: () => app.openDialog('benchmark') });

  if (info) {
    info.regions.forEach((r, i) => {
      add({ id: `region-${i}`, group: 'Regions', label: `Select ${r.name}`, hint: `${(r.end - r.start).toLocaleString('en-GB')} neurons`, run: () => app.selectRegion(i, true) });
      add({ id: `stim-region-${i}`, group: 'Stimulation', label: `Stimulate ${r.name}`, run: () => app.stimulateRegion(i) });
      add({ id: `isolate-${i}`, group: 'Regions', label: `${s.isolate === i ? 'Stop isolating' : 'Isolate'} ${r.name}`, run: () => app.toggleIsolate(i) });
    });
  }
  if (s.selection.neuron !== null) {
    const n = s.selection.neuron;
    add({ id: 'stim-neuron', group: 'Stimulation', label: `Stimulate neuron #${n}`, keys: 'S', run: () => app.stimulateNeuron(n) });
    add({ id: 'stim-local', group: 'Stimulation', label: `Stimulate population around #${n}`, run: () => app.stimulateAround(n) });
    add({ id: 'study', group: 'Neuron', label: `Study neuron #${n}`, run: () => app.setMode('study') });
    add({ id: 'compare', group: 'Neuron', label: `Add #${n} to comparison`, run: () => app.toggleCompare(n) });
  }
  add({ id: 'clear-stim', group: 'Stimulation', label: 'Cancel all stimuli', run: () => app.clearStimuli() });

  for (const e of EXPERIMENTS) add({ id: `exp-${e.id}`, group: 'Experiments', label: `Experiment ${e.letter}: ${e.name}`, hint: e.summary, run: () => {
    app.setMode('laboratory');
    app.experiments.select(e.id);
  } });
  for (const p of PRESETS) {
    const tier = TIERS.find((t) => t.id === p.defaultTier)!;
    add({ id: `preset-${p.id}`, group: 'New brain', label: `${p.name} (${tier.label})`, hint: p.description, run: () => app.projects.newBrain(p.create(Math.min(tier.neurons, p.maxNeurons ?? Infinity), 1)) });
  }
  add({ id: 'help', group: 'Help', label: 'Keyboard shortcuts and help', keys: '?', run: () => app.openDialog('help') });
  return cmds;
}

/** Simple fuzzy score: all query words must occur; earlier matches rank higher. */
export function score(c: Command, q: string): number {
  if (!q) return 1;
  const hay = `${c.label} ${c.group} ${c.hint ?? ''}`.toLowerCase();
  let s = 0;
  for (const w of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const i = hay.indexOf(w);
    if (i < 0) return 0;
    s += 100 - Math.min(90, i) + (c.label.toLowerCase().startsWith(w) ? 50 : 0);
  }
  return s;
}
