import { useApp, useAppState, useTelemetryTick } from '../../app/context.tsx';
import { Icon } from '../icons.tsx';
import { Panel, Section, Stat, fmt } from '../primitives.tsx';
import { NeuronInspector } from '../inspector/NeuronInspector.tsx';
import { RegionInspector } from '../inspector/RegionInspector.tsx';
import { BrainPanel } from './BrainPanel.tsx';
import { TimeChart } from '../charts/charts.tsx';
import { formatBytes } from '../../config/adjust.ts';

export function NetworkSummary() {
  const app = useApp();
  const info = useAppState((s) => s.info);
  const config = useAppState((s) => s.config);
  const tick = useTelemetryTick(300);
  if (!info || !config) return null;
  const t = app.telemetry;
  const r = t.latest;
  const secs = (r?.windowMs ?? 0) / 1000;
  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>{config.description ?? ''}</p>
      <div className="stat-grid stat-grid--2">
        <Stat label="Neurons" value={fmt.int(info.neurons)} note={`${info.regions.length} regions`} />
        <Stat label="Synapses" value={fmt.compact(info.synapses)} note={`${(info.synapses / info.neurons).toFixed(0)} per neuron`} />
        <Stat label="Network rate" value={(t.rate.last() || 0).toFixed(2)} unit="Hz" />
        <Stat label="Synchrony χ" value={(r?.synchrony ?? 0).toFixed(3)} />
        <Stat label="Spikes / s" value={fmt.compact(t.spikesPerSecond.last() || 0)} note="simulated time" />
        <Stat label="Events / s" value={fmt.compact(secs > 0 ? (r?.eventsScheduled ?? 0) / secs : 0)} note="synaptic transmissions" />
      </div>
      <Section label="Network firing rate">
        <TimeChart t={t.t} tick={tick} height={110} unit="Hz" windowMs={15_000} series={[{ label: 'E', color: '#38e6ff', ring: t.excRate, fill: true }, { label: 'I', color: '#ff4fd8', ring: t.inhRate }]} />
      </Section>
      <Section label="Engine">
        <dl className="kv">
          <dt>Model</dt><dd>LIF · exponential integration</dd>
          <dt>Timestep</dt><dd>{info.dt} ms</dd>
          <dt>Synaptic τ (E / I)</dt><dd>{info.tauExcMs} / {info.tauInhMs} ms</dd>
          <dt>Seed</dt><dd>{info.seed}</dd>
          <dt>Event queue</dt><dd>{info.ringSlots} slots</dd>
          <dt>Engine memory</dt><dd>{formatBytes(info.memoryBytes)}</dd>
          <dt>Topology</dt><dd title="Fingerprint of the generated network">{info.topologyHash.slice(0, 10)}</dd>
        </dl>
      </Section>
      <p className="hint">Click a neuron to inspect it; right-click for actions. Drag to orbit, right-drag to pan, scroll to zoom. <span className="kbd">⌘K</span> for every command.</p>
    </div>
  );
}

export function Inspector() {
  const app = useApp();
  const sel = useAppState((s) => s.selection);
  const info = useAppState((s) => s.info);
  if (!info) return <Panel title="Inspector"><p className="hint">Waiting for the network…</p></Panel>;
  if (sel.neuron !== null) {
    return (
      <Panel title={`Neuron #${sel.neuron}`} meta="inspector" className="grow" actions={<button type="button" className="icon-btn" aria-label="Clear selection" onClick={() => void app.selectNeuron(null)}>{Icon.close()}</button>}>
        <NeuronInspector compact />
      </Panel>
    );
  }
  if (sel.region !== null) {
    return (
      <Panel title={info.regions[sel.region]?.name ?? 'Region'} meta="region" className="grow" actions={<button type="button" className="icon-btn" aria-label="Clear selection" onClick={() => app.selectRegion(null)}>{Icon.close()}</button>}>
        <RegionInspector region={sel.region} />
      </Panel>
    );
  }
  return (
    <Panel title="Network" meta="overview" className="grow">
      <NetworkSummary />
    </Panel>
  );
}

export function ExplorerWorkspace() {
  const panels = useAppState((s) => s.panels);
  return (
    <div className="workspace ws-explorer">
      <div className="slot slot-left">{panels.left && <BrainPanel />}</div>
      <div className="slot-spacer" />
      <div className="slot slot-right">{panels.right && <Inspector />}</div>
    </div>
  );
}
