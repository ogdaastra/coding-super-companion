/** Connectome: pathways, densities, distributions, communities. */

import { useEffect, useState } from 'react';
import { useApp, useAppState, useTelemetryTick } from '../../app/context.tsx';
import type { CommunitySummary, WeightChange } from '../../engine/types.ts';
import type { DegreeStats } from '../../sim/protocol.ts';
import { MatrixChart, XYChart } from '../charts/charts.tsx';
import { Panel, Section, Segmented, Stat, fmt } from '../primitives.tsx';
import { regionMatrix } from '../observatory/ObservatoryWorkspace.tsx';
import { Icon } from '../icons.tsx';

function GainCell({ projection, gain }: { projection: number; gain: number }) {
  const app = useApp();
  const [v, setV] = useState(String(gain));
  useEffect(() => setV(String(gain)), [gain]);
  return (
    <input
      className="input input--num"
      style={{ width: 58, height: 22 }}
      value={v}
      aria-label="Pathway gain"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      onBlur={() => {
        const g = Number(v);
        if (Number.isFinite(g) && g >= 0 && g <= 100 && g !== gain) void app.edits.setProjectionGain(projection, g);
        else setV(String(gain));
      }}
    />
  );
}

export function ConnectomeWorkspace() {
  const app = useApp();
  const info = useAppState((s) => s.info);
  const colors = useAppState((s) => s.regionColors);
  const stats = useAppState((s) => s.projectionStats);
  const config = useAppState((s) => s.config);
  const gains = useAppState((s) => s.gains);
  const selectedRegion = useAppState((s) => s.selection.region);
  useTelemetryTick(500);
  const [kind, setKind] = useState<'events' | 'synapses' | 'weight'>('synapses');
  const [cell, setCell] = useState<[number, number] | null>(null);
  const [deg, setDeg] = useState<DegreeStats | null>(null);
  const [degRegion, setDegRegion] = useState(0);
  const [comm, setComm] = useState<{ summary: CommunitySummary; composition: number[][] } | null>(null);
  const [commBusy, setCommBusy] = useState(false);
  const [changes, setChanges] = useState<WeightChange[]>([]);

  useEffect(() => {
    if (!info) return;
    void app.refreshProjectionStats();
    void app.client.request('degrees', { bins: 24 }).then(setDeg).catch(() => {});
    if (info.plastic) void app.client.request('topChanges', { k: 12 }).then(setChanges).catch(() => {});
  }, [app, info]);
  if (!info || !config) return null;
  const names = info.regions.map((r) => r.name);
  const rows = info.projections.map((p, i) => ({ p, i, st: stats?.[i], cfg: config.projections[i] }));
  const filtered = cell ? rows.filter((r) => r.p.from === cell[0] && r.p.to === cell[1]) : selectedRegion !== null ? rows.filter((r) => r.p.from === selectedRegion || r.p.to === selectedRegion) : rows;
  const totalSyn = info.synapses;
  const reciprocal = (() => {
    let pairs = 0;
    let recip = 0;
    for (let a = 0; a < info.regions.length; a++)
      for (let b = a + 1; b < info.regions.length; b++) {
        const ab = info.projections.some((p) => p.from === a && p.to === b);
        const ba = info.projections.some((p) => p.from === b && p.to === a);
        if (ab || ba) pairs++;
        if (ab && ba) recip++;
      }
    return pairs ? recip / pairs : 0;
  })();
  const d = deg?.regions[degRegion];
  return (
    <div className="workspace ws-wide">
      <div className="slot slot-left" />
      <div className="slot slot-right">
        <Panel title="Connectome" meta={`${fmt.compact(totalSyn)} synapses · ${info.projections.length} pathways`} className="grow">
          <div className="stat-grid">
            <Stat label="Synapses" value={fmt.compact(totalSyn)} />
            <Stat label="Per neuron" value={(totalSyn / info.neurons).toFixed(1)} note="mean out-degree" />
            <Stat label="Inter-region" value={`${Math.round((rows.filter((r) => r.p.from !== r.p.to).reduce((a, r) => a + r.p.synapses, 0) / totalSyn) * 100)}`} unit="%" />
            <Stat label="Inhibitory" value={`${Math.round((rows.filter((r) => r.p.source === 'inhibitory').reduce((a, r) => a + r.p.synapses, 0) / totalSyn) * 100)}`} unit="%" />
            <Stat label="Reciprocal pairs" value={`${Math.round(reciprocal * 100)}`} unit="%" note="of connected region pairs" />
            <Stat label="Plastic" value={fmt.compact(rows.filter((r) => r.p.plastic).reduce((a, r) => a + r.p.synapses, 0))} />
          </div>
          <Section label="Region-to-region pathways" actions={<Segmented value={kind} onChange={setKind} options={[{ value: 'synapses', label: 'Synapses' }, { value: 'weight', label: 'Mean |w|' }, { value: 'events', label: 'Events / s' }]} />} hint="Rows are sources, columns targets (directional). Click a cell to list its pathways.">
            <MatrixChart values={regionMatrix(app, kind)} labels={names} colors={colors} height={Math.min(320, 70 + names.length * 30)} unit={kind === 'events' ? 'events/s' : kind === 'synapses' ? 'synapses' : '|w|'} selected={cell} onPick={(a, b) => setCell(cell && cell[0] === a && cell[1] === b ? null : [a, b])} />
          </Section>
          <Section label={cell ? `Pathways ${names[cell[0]]} → ${names[cell[1]]}` : selectedRegion !== null ? `Pathways of ${names[selectedRegion]}` : 'All pathways'} actions={cell || selectedRegion !== null ? <button type="button" className="btn btn--sm btn--ghost" onClick={() => {
            setCell(null);
            app.selectRegion(null);
          }}>Show all</button> : undefined} hint="Gain scales every synapse of a pathway immediately (0 cuts it); stored weights are unchanged. Edits can be undone.">
            <div className="table-wrap" style={{ maxHeight: 300 }}>
              <table className="table">
                <thead><tr><th>From</th><th>To</th><th>Class</th><th className="r">Synapses</th><th className="r">p</th><th className="r">|w|</th><th className="r">Delay</th><th className="r">Ev/s</th><th>Plasticity</th><th className="r">Gain</th></tr></thead>
                <tbody>
                  {filtered.map(({ p, i, st, cfg }) => (
                    <tr key={i} className="is-clickable" onClick={() => app.selectRegion(p.from, true)}>
                      <td className="text"><i className="swatch" style={{ background: colors[p.from], display: 'inline-block', marginRight: 6 }} />{names[p.from]}</td>
                      <td className="text">{p.to === p.from ? 'recurrent' : names[p.to]}</td>
                      <td className="text" style={{ color: p.source === 'inhibitory' ? 'var(--magenta)' : 'var(--cyan)' }}>{p.source === 'inhibitory' ? 'Inh' : 'Exc'}{cfg?.topology && cfg.topology !== 'random' ? ` · ${cfg.topology}` : ''}</td>
                      <td className="r">{fmt.compact(p.synapses)}</td>
                      <td className="r">{cfg ? cfg.probability.toPrecision(2) : '—'}</td>
                      <td className="r">{st ? st.meanWeight.toFixed(3) : '…'}</td>
                      <td className="r">{st ? st.meanDelayMs.toFixed(1) : '…'}</td>
                      <td className="r">{fmt.compact(app.telemetry.projectionRateSmooth[i] ?? 0)}</td>
                      <td className="text">{p.plastic ? (p.rule === 'reward' ? 'R-STDP' : 'STDP') : '—'}{st?.meanInitial !== null && st?.meanInitial !== undefined && st.meanInitial > 0 ? ` ${((st.meanWeight / st.meanInitial - 1) * 100).toFixed(1)}%` : ''}</td>
                      <td className="r"><GainCell projection={i} gain={gains[i] ?? 1} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <Section label="Degree distributions" actions={<select className="select" style={{ width: 170, height: 24 }} value={degRegion} onChange={(e) => setDegRegion(Number(e.target.value))} aria-label="Region">{names.map((n, i) => <option key={n} value={i}>{n}</option>)}</select>}>
            {d && deg ? (
              <>
                <XYChart kind="bar" height={140} x={d.inHist.map((_, b) => b)} xTicks={d.inHist.map((_, b) => `${Math.round((b / deg.bins) * (d.maxDegree + 1))}`)} series={[{ name: 'in-degree', values: d.inHist, color: '#9b7bff' }, { name: 'out-degree', values: d.outHist, color: '#38e6ff' }]} yLabel="neurons" />
                <p className="hint">Mean in-degree {d.inMean.toFixed(1)} (violet) · mean out-degree {d.outMean.toFixed(1)} (cyan). Bins span 0–{d.maxDegree} synapses.</p>
              </>
            ) : (
              <p className="hint">Computing…</p>
            )}
          </Section>
          <Section label="Network communities" hint="Weighted label propagation on the actual synapse graph (|w| as edge weight, both directions), with Newman modularity Q. Communities are found without using region labels; the table shows how they relate to regions.">
            <button type="button" className="btn btn--sm btn--primary" disabled={commBusy} onClick={async () => {
              setCommBusy(true);
              try {
                const r = await app.client.request('communities', { iterations: 15 });
                const built = app.built!;
                const top = r.summary.sizes.slice(0, 8).length;
                const comp = Array.from({ length: top }, () => new Array(info.regions.length).fill(0));
                for (let i = 0; i < r.labels.length; i++) if (r.labels[i] < top) comp[r.labels[i]][built.regionOf[i]]++;
                setComm({ summary: r.summary, composition: comp });
              } finally {
                setCommBusy(false);
              }
            }}>{commBusy ? 'Detecting…' : comm ? 'Run again' : 'Detect communities'}</button>
            {comm && (
              <>
                <div className="stat-grid stat-grid--3" style={{ marginTop: 10 }}>
                  <Stat label="Communities" value={fmt.int(comm.summary.count)} />
                  <Stat label="Modularity Q" value={comm.summary.modularity.toFixed(3)} />
                  <Stat label="Iterations" value={comm.summary.iterations} />
                </div>
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table className="table">
                    <thead><tr><th>Community</th><th className="r">Size</th>{names.map((n, i) => <th key={n} className="r" style={{ color: colors[i] }}>{n.split(' ')[0]}</th>)}</tr></thead>
                    <tbody>{comm.composition.map((row, c) => (
                      <tr key={c}><td>#{c + 1}</td><td className="r">{fmt.int(comm.summary.sizes[c])}</td>{row.map((v, i) => <td key={i} className="r">{v ? `${Math.round((v / comm.summary.sizes[c]) * 100)}%` : '·'}</td>)}</tr>
                    ))}</tbody>
                  </table>
                </div>
              </>
            )}
          </Section>
          {info.plastic && (
            <Section label="Most-changed synapses" actions={<button type="button" className="btn btn--sm btn--ghost" onClick={() => void app.client.request('topChanges', { k: 12 }).then(setChanges)}>{Icon.reset({ width: 12 })} Refresh</button>}>
              {changes.length === 0 ? <p className="hint">No plastic weight has changed yet. Enable plasticity and let the network run.</p> : (
                <div className="table-wrap"><table className="table"><thead><tr><th>Synapse</th><th>Pre → post</th><th className="r">Initial</th><th className="r">Now</th><th className="r">Δ</th></tr></thead>
                  <tbody>{changes.map((c) => (
                    <tr key={c.synapse} className="is-clickable" onClick={() => void app.selectNeuron(c.pre, { focus: true })}><td>{c.synapse}</td><td>#{c.pre} → #{c.post}</td><td className="r">{Math.abs(c.initial).toFixed(4)}</td><td className="r">{Math.abs(c.weight).toFixed(4)}</td><td className="r" style={{ color: c.delta > 0 ? 'var(--ok)' : 'var(--danger)' }}>{c.delta > 0 ? '+' : ''}{c.delta.toFixed(4)}</td></tr>
                  ))}</tbody></table></div>
              )}
            </Section>
          )}
        </Panel>
      </div>
    </div>
  );
}
