/** Performance: engine, worker and renderer instrumentation. */

import { useEffect, useState } from 'react';
import { useApp, useAppState, useTelemetryTick } from '../../app/context.tsx';
import { formatBytes } from '../../config/adjust.ts';
import { ChartCard, Legend, TimeChart } from '../charts/charts.tsx';
import { Meter, Panel, Section, Stat, ToggleRow, fmt } from '../primitives.tsx';

export function PerformanceWorkspace() {
  const app = useApp();
  const info = useAppState((s) => s.info);
  const render = useAppState((s) => s.render);
  const telemetryHz = useAppState((s) => s.telemetryHz);
  const tick = useTelemetryTick(250);
  const [profiling, setProfiling] = useState(false);
  useEffect(() => {
    void app.client.request('setProfiling', { on: profiling });
    return () => void app.client.request('setProfiling', { on: false });
  }, [profiling, app]);
  if (!info) return null;
  const t = app.telemetry;
  const r = t.latest;
  const perf = t.perf;
  const st = render.stats;
  const secs = Math.max(1e-9, (r?.windowMs ?? 0) / 1000);
  const wall = perf ? 1000 / telemetryHz : 0;
  const prof = r?.profileMs;
  const profTotal = prof ? prof.stimulus + prof.integrate + prof.plasticity + prof.propagate + prof.record : 0;
  const heap = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  const phases: [string, number, string][] = prof
    ? [
        ['Membrane integration', prof.integrate, '#38e6ff'],
        ['Spike propagation (event scheduling)', prof.propagate, '#9b7bff'],
        ['Plasticity', prof.plasticity, '#4be3a8'],
        ['Recording (raster, probes, synchrony)', prof.record, '#ffb547'],
        ['Stimuli', prof.stimulus, '#ff4fd8'],
      ]
    : [];
  return (
    <div className="workspace ws-wide">
      <div className="slot slot-left" />
      <div className="slot slot-right">
        <Panel title="Performance" meta="measured, not estimated" className="grow" actions={<button type="button" className="btn btn--sm" onClick={() => app.openDialog('benchmark')}>Run benchmark…</button>}>
          <Section label="Simulation (worker)">
            <div className="stat-grid">
              <Stat label="Real-time factor" value={(perf?.realtimeFactor ?? 0).toFixed(3)} unit="×" note={perf?.lagging ? 'below requested speed' : `target ${fmt.speed(perf?.targetSpeed ?? 1)}`} />
              <Stat label="Steps / s" value={fmt.compact(perf?.stepsPerSecond ?? 0)} note={`Δt ${info.dt} ms`} />
              <Stat label="Time per step" value={((perf?.msPerStep ?? 0) * 1000).toFixed(1)} unit="µs" />
              <Stat label="Worker utilisation" value={((perf?.busyFraction ?? 0) * 100).toFixed(0)} unit="%" note="time spent computing" />
              <Stat label="Neurons / s" value={fmt.compact((perf?.stepsPerSecond ?? 0) * info.neurons)} note="neuron updates" />
              <Stat label="Synaptic events / s" value={fmt.compact((r?.eventsScheduled ?? 0) / secs * (perf?.realtimeFactor ?? 0))} note="wall-clock rate" />
              <Stat label="Events queued" value={fmt.compact(r?.pendingEvents ?? 0)} note={`${info.ringSlots}-slot calendar queue`} />
              <Stat label="Delivered / window" value={fmt.compact(r?.eventsDelivered ?? 0)} />
              <Stat label="Engine memory" value={formatBytes(info.memoryBytes)} note={`WASM heap ${formatBytes(perf?.wasmBytes ?? 0)}`} />
              <Stat label="Engine call size" value={fmt.int(perf?.chunkSteps ?? 0)} unit="steps" note="per ≈1 ms slice" />
              <Stat label="Telemetry" value={telemetryHz} unit="Hz" />
              <Stat label="Dropped (frame/raster)" value={`${fmt.compact(r?.frameDropped ?? 0)} / ${fmt.compact(r?.rasterDropped ?? 0)}`} note="buffer overflow" />
            </div>
          </Section>
          <Section label="Step profile" actions={<ToggleRow label="Profile phases" checked={profiling} onChange={setProfiling} />} hint="Times each phase of every step with the host clock (adds a small overhead while on).">
            {profiling && prof && profTotal > 0 ? (
              <div style={{ display: 'grid', gap: 6 }}>
                {phases.map(([label, ms, color]) => (
                  <div key={label} style={{ display: 'grid', gridTemplateColumns: '230px 1fr 90px', gap: 10, alignItems: 'center', fontSize: 11.5 }}>
                    <span>{label}</span>
                    <Meter value={ms} max={profTotal} color={color} />
                    <span className="mono" style={{ textAlign: 'right' }}>{((ms / profTotal) * 100).toFixed(1)} %</span>
                  </div>
                ))}
                <span className="dim mono" style={{ fontSize: 10.5 }}>{profTotal.toFixed(1)} ms of compute in the last {wall.toFixed(0)} ms window</span>
              </div>
            ) : (
              <p className="hint">{profiling ? 'Collecting…' : 'Off.'}</p>
            )}
          </Section>
          <Section label="Rendering (main thread)">
            <div className="stat-grid">
              <Stat label="Frame rate" value={(st?.fps ?? 0).toFixed(0)} unit="FPS" note={`${(st?.frameMs ?? 0).toFixed(1)} ms / frame`} />
              <Stat label="Backend" value={st?.backend ?? '—'} size="sm" />
              <Stat label="Quality" value={st?.quality ?? '—'} size="sm" note={st?.adaptiveActive ? `adaptive level ${st.adaptiveLevel}` : 'no reductions'} />
              <Stat label="Draw calls" value={fmt.int(st?.drawCalls ?? 0)} />
              <Stat label="Triangles" value={fmt.compact(st?.triangles ?? 0)} />
              <Stat label="Neuron instances" value={fmt.compact(st?.neurons ?? 0)} />
              <Stat label="Synapses drawn" value={fmt.compact(st?.synapsesShown ?? 0)} note={`of ${fmt.compact(info.synapses)}`} />
              <Stat label="Pulses in flight" value={fmt.int(st?.pulsesActive ?? 0)} note={st?.pulsesDropped ? `${fmt.int(st.pulsesDropped)} not shown` : undefined} />
              <Stat label="Pixel ratio" value={(st?.pixelRatio ?? 1).toFixed(2)} />
              <Stat label="JS heap" value={heap ? formatBytes(heap.usedJSHeapSize) : 'n/a'} note={heap ? undefined : 'not exposed by this browser'} />
            </div>
          </Section>
          <div className="chart-grid">
            <ChartCard title="Real-time factor" legend={<Legend items={[{ label: 'simulated / wall time', color: '#38e6ff' }]} />}>
              <TimeChart t={t.perfT} tick={tick} height={120} series={[{ label: 'RTF', color: '#38e6ff', ring: t.rtf, fill: true }]} />
            </ChartCard>
            <ChartCard title="Worker utilisation" legend={<Legend items={[{ label: 'busy fraction', color: '#9b7bff' }]} />}>
              <TimeChart t={t.perfT} tick={tick} height={120} yMin={0} yMax={1} series={[{ label: 'busy', color: '#9b7bff', ring: t.busy, fill: true }]} />
            </ChartCard>
            <ChartCard title="Frame rate" legend={<Legend items={[{ label: 'FPS', color: '#4be3a8' }]} />}>
              <TimeChart t={t.perfT} tick={tick} height={120} yMin={0} series={[{ label: 'FPS', color: '#4be3a8', ring: t.fps, fill: true }]} />
            </ChartCard>
            <ChartCard title="Time per step" legend={<Legend items={[{ label: 'ms', color: '#ffb547' }]} />}>
              <TimeChart t={t.perfT} tick={tick} height={120} yMin={0} series={[{ label: 'ms/step', color: '#ffb547', ring: t.msPerStep, fill: true }]} yFmt={(v) => v.toFixed(3)} />
            </ChartCard>
          </div>
        </Panel>
      </div>
    </div>
  );
}
