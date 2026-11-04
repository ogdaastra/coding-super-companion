/** Neuron Study: one neuron in depth, with comparison and synaptic history. */

import { useEffect, useState } from 'react';
import { useApp, useAppState, useTelemetryTick } from '../../app/context.tsx';
import type { NeuronDetail } from '../../engine/types.ts';
import { PROBE_FLAG_SPIKE } from '../../engine/types.ts';
import { MembraneChart, TimeChart } from '../charts/charts.tsx';
import { SERIES_COLORS } from '../charts/canvas.ts';
import { Icon } from '../icons.tsx';
import { Panel, Section, Segmented, Stat, fmt } from '../primitives.tsx';
import { ParamEditor, SynapseTable, neuronStateLabel, useNeuronRate } from '../inspector/NeuronInspector.tsx';

function NeuronPicker() {
  const app = useApp();
  const sel = useAppState((s) => s.selection.neuron);
  const info = useAppState((s) => s.info);
  const [text, setText] = useState(String(sel ?? ''));
  useEffect(() => setText(String(sel ?? '')), [sel]);
  if (!info) return null;
  const go = (i: number) => void app.selectNeuron(Math.max(0, Math.min(info.neurons - 1, i)), { focus: true });
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <button type="button" className="icon-btn" aria-label="Previous neuron" onClick={() => go((sel ?? 1) - 1)} style={{ transform: 'scaleX(-1)' }}>{Icon.chevron()}</button>
      <input className="input input--num" style={{ width: 84 }} value={text} aria-label="Neuron number" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') go(Number(text));
      }} />
      <button type="button" className="icon-btn" aria-label="Next neuron" onClick={() => go((sel ?? -1) + 1)}>{Icon.chevron()}</button>
      <button type="button" className="btn btn--sm btn--ghost" onClick={() => go(Math.floor(Math.random() * info.neurons))}>Random</button>
    </div>
  );
}

function SpikeHistory({ neuron }: { neuron: number }) {
  const app = useApp();
  useTelemetryTick(500);
  const tr = app.telemetry.probes.get(neuron);
  const info = app.state.info;
  if (!tr || !info) return <p className="hint">Recording…</p>;
  const spikes: number[] = [];
  for (let k = 0; k < tr.flags.length; k++) if (tr.flags.at(k) === PROBE_FLAG_SPIKE) spikes.push(tr.step.at(k) * info.dt);
  const isi = spikes.slice(1).map((t, i) => t - spikes[i]);
  const mean = isi.length ? isi.reduce((a, b) => a + b, 0) / isi.length : NaN;
  const cv = isi.length > 1 ? Math.sqrt(isi.reduce((a, b) => a + (b - mean) ** 2, 0) / isi.length) / mean : NaN;
  const span = tr.step.length ? (tr.step.at(tr.step.length - 1) - tr.step.at(0)) * info.dt : 0;
  return (
    <div>
      <div className="stat-grid stat-grid--3">
        <Stat label="Spikes recorded" value={spikes.length} note={`over ${fmt.time(span)}`} size="sm" />
        <Stat label="Mean ISI" value={Number.isFinite(mean) ? mean.toFixed(1) : '—'} unit="ms" size="sm" />
        <Stat label="ISI CV" value={Number.isFinite(cv) ? cv.toFixed(2) : '—'} note="1 ≈ Poisson-like" size="sm" />
      </div>
      <div className="mono dim" style={{ fontSize: 10.5, marginTop: 8, maxHeight: 60, overflow: 'auto' }}>
        {spikes.slice(-40).map((t) => `${(t / 1000).toFixed(4)} s`).join(' · ') || 'No spikes in the recorded window.'}
      </div>
    </div>
  );
}

function Comparison() {
  const app = useApp();
  const compare = useAppState((s) => s.selection.compare);
  const sel = useAppState((s) => s.selection.neuron);
  const info = useAppState((s) => s.info);
  const tick = useTelemetryTick(150);
  const [details, setDetails] = useState<NeuronDetail[]>([]);
  const ids = [...(sel !== null ? [sel] : []), ...compare.filter((c) => c !== sel)];
  useEffect(() => {
    let live = true;
    const load = () => Promise.all(ids.map((i) => app.client.request('neuron', { neuron: i }))).then((d) => live && setDetails(d)).catch(() => {});
    void load();
    const id = window.setInterval(load, 500);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [app, ids.join(',')]);
  if (!info) return null;
  if (compare.length === 0) return <p className="hint">Add neurons with “Compare” (inspector, context menu or the button above) to overlay their membrane potentials and compare their parameters and connectivity.</p>;
  const traces = ids.map((i) => app.telemetry.probes.get(i)).filter((t): t is NonNullable<typeof t> => !!t);
  const rows: [string, (d: NeuronDetail) => string][] = [
    ['Region', (d) => info.regions[d.region]?.name ?? ''],
    ['Class', (d) => d.class],
    ['V (mV)', (d) => d.v.toFixed(2)],
    ['Threshold (mV)', (d) => d.vThreshold.toFixed(2)],
    ['Excitability', (d) => d.excitability.toFixed(3)],
    ['Synaptic input', (d) => (d.iExc + d.iInh).toFixed(3)],
    ['Spikes', (d) => String(d.spikeCount)],
    ['In-degree', (d) => String(d.inCount)],
    ['Out-degree', (d) => String(d.outCount)],
    ['Mean in-weight', (d) => d.inWeightMean.toFixed(3)],
  ];
  return (
    <div>
      <MembraneChart traces={traces} dt={info.dt} tick={tick} height={170} windowMs={600} />
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table className="table">
          <thead><tr><th>Property</th>{details.map((d, i) => <th key={d.id} className="r" style={{ color: SERIES_COLORS[i % SERIES_COLORS.length] }}>#{d.id}</th>)}</tr></thead>
          <tbody>{rows.map(([label, f]) => <tr key={label}><td className="text">{label}</td>{details.map((d) => <td key={d.id} className="r">{f(d)}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
        {compare.map((c) => <button type="button" key={c} className="chip chip--violet" onClick={() => void app.toggleCompare(c)}>#{c} ✕</button>)}
      </div>
    </div>
  );
}

function SynapticHistory() {
  const app = useApp();
  const tracked = useAppState((s) => s.tracked);
  const tick = useTelemetryTick(300);
  if (!tracked.length) return <p className="hint">Use the history button in a synapse table to track a synapse's weight over time. Tracking several lets you compare them; with plasticity on you can watch them strengthen and weaken.</p>;
  const series = tracked.map((id, i) => ({ id, tr: app.telemetry.tracked.get(id), color: SERIES_COLORS[i % SERIES_COLORS.length] })).filter((x) => x.tr);
  if (!series.length) return <p className="hint">Waiting for samples…</p>;
  return (
    <div>
      <TimeChart t={series[0].tr!.t} tick={tick} height={150} windowMs={300_000} yMin={undefined} series={series.map((s) => ({ label: `syn ${s.id}`, color: s.color, ring: s.tr!.w }))} yFmt={(v) => v.toFixed(3)} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
        {series.map((s) => <button type="button" key={s.id} className="chip" style={{ borderColor: s.color }} onClick={() => void app.toggleTracked(s.id)}><i className="swatch" style={{ background: s.color }} />{s.id} · {s.tr!.w.last().toFixed(4)} ✕</button>)}
      </div>
    </div>
  );
}

export function StudyWorkspace() {
  const app = useApp();
  const d = useAppState((s) => s.neuron);
  const sel = useAppState((s) => s.selection.neuron);
  const info = useAppState((s) => s.info);
  const colors = useAppState((s) => s.regionColors);
  const timeMs = useAppState((s) => s.sim.timeMs);
  const compare = useAppState((s) => s.selection.compare);
  const tick = useTelemetryTick(100);
  const [win, setWin] = useState(1000);
  const rate = useNeuronRate(d, timeMs);
  const ready = d && sel !== null && d.id === sel && info;
  return (
    <div className="workspace ws-wide">
      <div className="slot slot-left" />
      <div className="slot slot-right">
        <Panel title={sel !== null ? `Neuron #${sel}` : 'Neuron Study'} meta={ready ? `${info!.regions[d!.region]?.name} · ${d!.class}` : undefined} actions={<NeuronPicker />} className="grow">
          {!ready ? (
            <p className="hint">Select a neuron in the view, the raster or with the number field above.</p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <i className="swatch" style={{ background: colors[d!.region] }} />
                <span className={neuronStateLabel(d!).chip}>{neuronStateLabel(d!).label}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button type="button" className="btn btn--sm btn--amber" onClick={() => void app.stimulateNeuron(d!.id)}>{Icon.bolt({ width: 12 })} Stimulate</button>
                  <button type="button" className="btn btn--sm" onClick={() => app.view?.focusNeuron(d!.id)}>{Icon.focus({ width: 12 })} Focus</button>
                  <button type="button" className="btn btn--sm" onClick={() => void app.toggleCompare(d!.id)}>{Icon.compare({ width: 12 })} {compare.includes(d!.id) ? 'Uncompare' : 'Compare'}</button>
                  <button type="button" className="btn btn--sm" onClick={() => app.setViz('local')}>{Icon.network({ width: 12 })} Local network</button>
                </span>
              </div>
              <div className="stat-grid" style={{ marginTop: 12 }}>
                <Stat label="Membrane potential" value={d!.v.toFixed(2)} unit="mV" size="xl" wide />
                <Stat label="Firing rate" value={rate === null ? '—' : rate.toFixed(1)} unit="Hz" />
                <Stat label="Total spikes" value={fmt.int(d!.spikeCount)} note={d!.lastSpikeMs === null ? 'never fired' : `last at ${fmt.time(d!.lastSpikeMs)}`} />
                <Stat label="Refractory left" value={d!.refractoryLeftMs.toFixed(1)} unit="ms" />
                <Stat label="Synaptic input" value={(d!.iExc + d!.iInh).toFixed(3)} note={`E ${d!.iExc.toFixed(3)} · I ${d!.iInh.toFixed(3)}`} />
                <Stat label="External input" value={(d!.externalInput + d!.stimulusInput).toFixed(2)} note={d!.stimulusInput ? 'stimulus active' : 'constant'} />
                <Stat label="Incoming" value={fmt.int(d!.inCount)} note={`mean |w| ${Math.abs(d!.inWeightMean).toFixed(3)}`} />
                <Stat label="Outgoing" value={fmt.int(d!.outCount)} note={`mean |w| ${Math.abs(d!.outWeightMean).toFixed(3)}`} />
              </div>
              <Section label="Membrane potential" actions={<Segmented value={win} onChange={setWin} options={[{ value: 200, label: '200 ms' }, { value: 1000, label: '1 s' }, { value: 5000, label: '5 s' }]} />} hint="Sampled every step from the engine. Dashed: threshold (amber) and resting potential. White strokes: spikes. Amber bands: refractory periods. Drag to inspect a range.">
                <MembraneChart traces={app.telemetry.probes.get(d!.id) ? [app.telemetry.probes.get(d!.id)!] : []} dt={info!.dt} vRest={d!.vRest} vThreshold={d!.vThreshold} vReset={d!.vReset} windowMs={win} height={240} tick={tick} />
              </Section>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr)', gap: 16 }}>
                <Section label="Parameters">
                  <ParamEditor d={d!} />
                </Section>
                <div>
                  <Section label="Spike history"><SpikeHistory neuron={d!.id} /></Section>
                  <Section label="Outgoing synapses"><SynapseTable neuron={d!.id} incoming={false} height={200} /></Section>
                  <Section label="Incoming synapses"><SynapseTable neuron={d!.id} incoming height={200} /></Section>
                </div>
              </div>
              <Section label="Comparison"><Comparison /></Section>
              <Section label="Synaptic history"><SynapticHistory /></Section>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
