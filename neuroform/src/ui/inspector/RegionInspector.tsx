/** Region inspection: population, live activity, pathways and population edits. */

import { useEffect, useState } from 'react';
import { useApp, useAppState, useTelemetryTick } from '../../app/context.tsx';
import { NEURON_PARAM_KEYS, NEURON_PARAM_META, type NeuronParamKey } from '../../config/schema.ts';
import type { NeuronClassFilter } from '../../engine/wasmEngine.ts';
import { Icon } from '../icons.tsx';
import { NumberField, Section, Segmented, Select, Stat, ToggleRow, fmt, Meter } from '../primitives.tsx';
import { TimeChart } from '../charts/charts.tsx';

export function RegionInspector({ region }: { region: number }) {
  const app = useApp();
  const info = useAppState((s) => s.info);
  const config = useAppState((s) => s.config);
  const colors = useAppState((s) => s.regionColors);
  const stats = useAppState((s) => s.projectionStats);
  const isolate = useAppState((s) => s.isolate);
  const tick = useTelemetryTick(250);
  const [cls, setCls] = useState<NeuronClassFilter>('excitatory');
  const [param, setParam] = useState<NeuronParamKey>('vThreshold');
  const [mean, setMean] = useState<number>(NaN);
  useEffect(() => {
    if (!stats) void app.refreshProjectionStats();
  }, [app, stats]);
  useEffect(() => {
    void app.client.request('populationMean', { region, cls, param: NEURON_PARAM_KEYS.indexOf(param) }).then(setMean).catch(() => setMean(NaN));
  }, [app, region, cls, param, app.state.undo.length]);
  if (!info) return null;
  const r = info.regions[region];
  if (!r) return null;
  const rc = config?.regions[region];
  const latest = app.telemetry.latest;
  const rr = latest?.regions[region];
  const secs = Math.max(1e-9, (latest?.windowMs ?? 0) / 1000);
  const ne = r.excEnd - r.start;
  const ni = r.end - r.excEnd;
  const rateE = rr ? rr.spikesExc / Math.max(1, ne) / secs : 0;
  const rateI = rr ? rr.spikesInh / Math.max(1, ni) / secs : 0;
  const tel = app.telemetry;
  const inflow = info.projections.map((p, i) => ({ p, i })).filter(({ p }) => p.to === region);
  const outflow = info.projections.map((p, i) => ({ p, i })).filter(({ p }) => p.from === region);
  const evIn = inflow.reduce((a, { i }) => a + (tel.projectionRate[i] ?? 0), 0);
  const evOut = outflow.reduce((a, { i }) => a + (tel.projectionRate[i] ?? 0), 0);
  const inWeight = stats ? (() => {
    let s = 0;
    let n = 0;
    for (const { i } of inflow) {
      s += stats[i].meanWeight * stats[i].synapses;
      n += stats[i].synapses;
    }
    return n ? s / n : NaN;
  })() : NaN;
  const pathRow = (p: (typeof info.projections)[number], i: number, dir: 'in' | 'out') => {
    const st = stats?.[i];
    const other = dir === 'in' ? p.from : p.to;
    return (
      <tr key={i} className="is-clickable" onClick={() => app.selectRegion(other, true)}>
        <td className="text"><i className="swatch" style={{ background: colors[other], display: 'inline-block', marginRight: 6 }} />{p.from === p.to ? 'recurrent' : info.regions[other].name}</td>
        <td className="text" style={{ color: p.source === 'inhibitory' ? 'var(--magenta)' : 'var(--cyan)' }}>{p.source[0].toUpperCase()}</td>
        <td className="r">{fmt.compact(p.synapses)}</td>
        <td className="r">{st ? st.meanWeight.toFixed(3) : '…'}</td>
        <td className="r">{fmt.compact(tel.projectionRate[i] ?? 0)}</td>
      </tr>
    );
  };
  const byStrength = (list: typeof inflow) => [...list].sort((a, b) => (stats ? stats[b.i].meanWeight * stats[b.i].synapses - stats[a.i].meanWeight * stats[a.i].synapses : b.p.synapses - a.p.synapses));
  const enabled = rr?.enabled ?? true;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <i className="swatch" style={{ background: colors[region], boxShadow: `0 0 8px ${colors[region]}` }} />
        <span style={{ fontWeight: 600 }}>{r.name}</span>
        {!enabled && <span className="chip chip--danger">disabled</span>}
      </div>
      {rc?.role && <p className="hint" style={{ marginTop: 0 }}>{rc.role}</p>}
      <div className="stat-grid stat-grid--3">
        <Stat label="Neurons" value={fmt.compact(r.end - r.start)} note={`${fmt.int(ne)} E · ${fmt.int(ni)} I`} />
        <Stat label="E rate" value={rateE.toFixed(1)} unit="Hz" color="var(--cyan)" />
        <Stat label="I rate" value={rateI.toFixed(1)} unit="Hz" color="var(--magenta)" />
        <Stat label="Synchrony χ" value={(rr?.synchrony ?? 0).toFixed(3)} />
        <Stat label="Mean V" value={(rr?.vMean ?? NaN).toFixed(1)} unit="mV" />
        <Stat label="Active" value={rr ? `${Math.round((rr.active / (r.end - r.start)) * 100)}` : '—'} unit="%" note="fired in last window" />
        <Stat label="Events in" value={fmt.compact(evIn)} unit="/s" />
        <Stat label="Events out" value={fmt.compact(evOut)} unit="/s" />
        <Stat label="Mean in-weight" value={Number.isFinite(inWeight) ? inWeight.toFixed(3) : '…'} />
      </div>
      <Section label="Activity compared with other regions">
        <TimeChart t={tel.t} tick={tick} height={110} unit="Hz" windowMs={20_000} series={info.regions.map((x, i) => ({ label: x.name, color: i === region ? colors[i] : `${colors[i]}`, ring: tel.regionRate[i], width: i === region ? 2.2 : 0.8 }))} />
        <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
          {info.regions.map((x, i) => {
            const v = tel.regionRate[i]?.last() || 0;
            const max = Math.max(1, ...tel.regionRate.map((q) => q.last() || 0));
            return (
              <div key={x.id} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 54px', gap: 8, alignItems: 'center', fontSize: 11, opacity: i === region ? 1 : 0.65 }}>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.name}</span>
                <Meter value={v} max={max} color={colors[i]} />
                <span className="mono" style={{ textAlign: 'right' }}>{v.toFixed(1)} Hz</span>
              </div>
            );
          })}
        </div>
      </Section>
      <Section label="Strongest inputs">
        <div className="table-wrap" style={{ maxHeight: 170 }}>
          <table className="table"><thead><tr><th>From</th><th>Type</th><th className="r">Syn.</th><th className="r">|w|</th><th className="r">Ev/s</th></tr></thead>
            <tbody>{byStrength(inflow).map(({ p, i }) => pathRow(p, i, 'in'))}</tbody></table>
        </div>
      </Section>
      <Section label="Strongest outputs">
        <div className="table-wrap" style={{ maxHeight: 170 }}>
          <table className="table"><thead><tr><th>To</th><th>Type</th><th className="r">Syn.</th><th className="r">|w|</th><th className="r">Ev/s</th></tr></thead>
            <tbody>{byStrength(outflow).map(({ p, i }) => pathRow(p, i, 'out'))}</tbody></table>
        </div>
      </Section>
      <Section label="Control">
        <ToggleRow label="Region enabled" checked={enabled} onChange={(v) => void app.edits.setRegionEnabled(region, v)} hint="Disabled regions are silenced: they do not integrate, fire or transmit" />
        <ToggleRow label="Isolate connectivity" checked={isolate === region} onChange={() => app.toggleIsolate(region)} />
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button type="button" className="btn btn--sm btn--amber" onClick={() => void app.stimulateRegion(region)}>{Icon.bolt({ width: 12 })} Stimulate region</button>
          <button type="button" className="btn btn--sm" onClick={() => app.view?.focusRegion(region)}>{Icon.focus({ width: 12 })} Focus</button>
        </div>
      </Section>
      <Section label="Population parameters" hint="Sets the population mean. Each neuron keeps its individual variation: potentials shift, time constants and gains scale.">
        <Segmented value={cls} onChange={setCls} options={[{ value: 'excitatory', label: 'Excitatory' }, { value: 'inhibitory', label: 'Inhibitory' }, { value: 'all', label: 'All' }]} />
        <div style={{ height: 8 }} />
        <Select value={param} onChange={setParam} options={NEURON_PARAM_KEYS.map((k) => ({ value: k, label: NEURON_PARAM_META[k].label }))} />
        <div style={{ height: 8 }} />
        <NumberField label="Population mean" unit={NEURON_PARAM_META[param].unit} value={mean} min={NEURON_PARAM_META[param].min} max={NEURON_PARAM_META[param].max} onCommit={(v) => app.edits.setPopulationParam(region, cls, param, v)} />
      </Section>
    </div>
  );
}
