/** The persistent simulation control dock. */

import type { CSSProperties } from 'react';
import { useApp, useAppState } from '../../app/context.tsx';
import { SPEEDS } from '../../sim/protocol.ts';
import { Icon } from '../icons.tsx';
import { IconButton, fmt } from '../primitives.tsx';

export function Dock() {
  const app = useApp();
  const sim = useAppState((s) => s.sim);
  const ready = useAppState((s) => s.ready);
  const recording = useAppState((s) => s.recording);
  const plasticity = useAppState((s) => s.plasticity);
  const undo = useAppState((s) => s.undo);
  const selection = useAppState((s) => s.selection);
  const experimentRunning = app.experiments.running;
  const running = sim.status === 'running';
  const idx = Math.max(0, SPEEDS.findIndex((s) => s === sim.speed));
  const disabled = !ready || sim.status === 'building';
  const stepMs = sim.dt;

  return (
    <div className="dock glass" role="toolbar" aria-label="Simulation controls">
      <div className="dock__group">
        <button type="button" className={`play ${running ? '' : 'is-paused'}`} onClick={() => void app.toggleRun()} disabled={disabled || experimentRunning} aria-label={running ? 'Pause' : 'Run'} title={running ? 'Pause (Space)' : 'Run (Space)'}>
          {running ? Icon.pause() : Icon.play()}
        </button>
        <IconButton icon={Icon.step()} label={`Single step (${stepMs} ms)`} onClick={() => void app.stepBy(1)} disabled={disabled || experimentRunning} kbd="." />
        <IconButton icon={Icon.reset()} label="Reset to time zero" onClick={() => void app.resetSimulation(true)} disabled={disabled || experimentRunning} kbd="Shift R" />
      </div>
      <div className="dock__sep" />
      <div className="clock" title="Simulation time · steps per second · real-time factor">
        <span className="clock__time">{fmt.time(sim.timeMs)}</span>
        <span className={`clock__sub ${sim.lagging ? 'is-lag' : ''}`}>
          {sim.status === 'building' ? 'building…' : running ? `${fmt.num(sim.rtf, sim.rtf < 0.1 ? 3 : 2)}× real time${sim.lagging ? ' · limited' : ''}` : sim.status === 'paused' ? `paused · step ${fmt.int(sim.step)}` : sim.status}
        </span>
      </div>
      <div className="dock__sep hide-sm" />
      <div className="speed" title="Simulation speed (simulated time per real time). [ and ] to change.">
        <span className="label">Speed</span>
        <input
          className="range"
          type="range"
          min={0}
          max={SPEEDS.length - 1}
          step={1}
          value={idx}
          aria-label="Simulation speed"
          style={{ '--fill': `${(idx / (SPEEDS.length - 1)) * 100}%` } as CSSProperties}
          onChange={(e) => void app.setSpeed(SPEEDS[Number(e.target.value)])}
        />
        <span className="speed__value">{fmt.speed(sim.speed)}</span>
      </div>
      <div className="dock__sep" />
      <div className="dock__group">
        <IconButton
          icon={recording ? Icon.stop() : Icon.record({ style: { color: '#ff6b7d' } })}
          label={recording ? `Stop recording (${fmt.int(recording.spikes)} spikes)` : 'Record activity'}
          active={!!recording}
          onClick={() => void (recording ? app.projects.stopRecording() : app.projects.startRecording())}
          disabled={disabled}
        />
        <IconButton icon={Icon.bolt()} label={selection.neuron !== null ? `Stimulate neuron #${selection.neuron}` : selection.region !== null ? 'Stimulate selected region' : 'Select a neuron or region to stimulate'} onClick={() => {
          if (selection.neuron !== null) void app.stimulateNeuron(selection.neuron);
          else if (selection.region !== null) void app.stimulateRegion(selection.region);
        }} disabled={disabled || (selection.neuron === null && selection.region === null)} kbd="S" />
        <IconButton icon={Icon.spark()} label={plasticity.available ? (plasticity.enabled ? 'Plasticity on: click to freeze weights' : 'Plasticity off: click to enable learning') : 'This network has no plastic synapses'} active={plasticity.enabled} disabled={disabled || !plasticity.available} onClick={() => void app.setPlasticity(!plasticity.enabled)} kbd="P" />
        <IconButton icon={Icon.reward()} label="Deliver reward (neuromodulator +1)" onClick={() => void app.reward(1)} disabled={disabled} />
        <IconButton icon={Icon.undo()} label={undo.length ? `Undo: ${undo[undo.length - 1]}` : 'Nothing to undo'} onClick={() => void app.edits.undo()} disabled={!undo.length} kbd="Ctrl Z" />
      </div>
    </div>
  );
}
