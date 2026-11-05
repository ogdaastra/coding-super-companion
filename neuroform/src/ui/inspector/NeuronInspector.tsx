/** Neuron inspection: live state, membrane trace, parameters and synapses. */

import { useEffect, useRef, useState } from 'react';
import { useApp, useAppState, useTelemetryTick } from '../../app/context.tsx';
import { NEURON_PARAM_KEYS, NEURON_PARAM_META, type NeuronParamKey } from '../../config/schema.ts';
import type { NeuronDetail, SynapseRecord } from '../../engine/types.ts';
import { Icon } from '../icons.tsx';
import { NumberField, Segmented, Stat, fmt } from '../primitives.tsx';
import { MembraneChart } from '../charts/charts.tsx';

const PARAM_FIELD: Record<NeuronParamKey, keyof NeuronDetail> = {
  vRest: 'vRest',
  vThreshold: 'vThreshold',
  vReset: 'vReset',
  tauMs: 'tauMs',
  refractoryMs: 'refractoryMs',
  resistance: 'resistance',
  excitability: 'excitability',
  bias: 'bias',
  externalInput: 'externalInput',
  noiseStd: 'noiseStd',
};

/** Firing rate from successive spike counts over simulated time (last ~2 s). */
export function useNeuronRate(d: NeuronDetail | null, timeMs: number): number | null {
  const hist = useRef<{ id: number; s: { t: number; c: number }[] }>({ id: -1, s: [] });
  if (!d) return null;
  const h = hist.current;
  if (h.id !== d.id) {
    h.id = d.id;
    h.s = [];
  }
  const last = h.s[h.s.length - 1];
  if (!last || timeMs > last.t) h.s.push({ t: timeMs, c: d.spikeCount });
  else if (timeMs < last.t) h.s = [{ t: timeMs, c: d.spikeCount }];
  while (h.s.length > 2 && h.s[h.s.length - 1].t - h.s[0].t > 2000) h.s.shift();
  const a = h.s[0];
  const b = h.s[h.s.length - 1];
  if (!a || b.t - a.t < 100) return null;
  return ((b.c - a.c) * 1000) / (b.t - a.t);
}

export function neuronStateLabel(d: NeuronDetail): { label: string; chip: string } {
  if (!d.regionEnabled) return { label: 'region disabled', chip: 'chip' };
  if (d.refractoryLeftMs > 0) return { label: `refractory · ${d.refractoryLeftMs.toFixed(1)} ms`, chip: 'chip chip--amber' };
  if (d.stimulusInput !== 0) return { label: 'stimulated', chip: 'chip chip--amber' };
  const gap = d.vThreshold - d.v;
  if (gap < 2) return { label: 'near threshold', chip: 'chip chip--cyan' };
  return { label: 'integrating', chip: 'chip' };
}

export function ParamEditor({ d }: { d: NeuronDetail }) {
  const app = useApp();
  return (
    <div>
      {NEURON_PARAM_KEYS.map((k) => {
        const m = NEURON_PARAM_META[k];
        return <NumberField key={k} label={m.label} unit={m.unit} hint={m.describe} min={m.min} max={m.max} step={m.step} value={d[PARAM_FIELD[k]] as number} onCommit={(v) => app.edits.setNeuronParam(d.id, k, v)} />;
      })}
      <p className="hint">Changes apply to the running simulation immediately and can be undone (Ctrl Z).</p>
    </div>
  );
}

export function SynapseTable({ neuron, incoming, limit = 120, height = 240 }: { neuron: number; incoming: boolean; limit?: number; height?: number }) {
  const app = useApp();
  const status = useAppState((s) => s.sim.status);
  const tracked = useAppState((s) => s.tracked);
  const [rows, setRows] = useState<SynapseRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState<'id' | 'weight' | 'delta'>('weight');
  const [selected, setSelected] = useState<number | null>(null);
  const tick = useTelemetryTick(1000);
  useEffect(() => {
    let live = true;
    void app.client.request('synapses', { neuron, incoming, offset: 0, limit: 2000 }).then((r) => {
      if (!live) return;
      setTotal(r.total);
      setRows(r.records);
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, [app, neuron, incoming, status === 'running' ? tick : 0]);
  const sorted = [...rows].sort((a, b) =>
    sort === 'id' ? a.id - b.id : sort === 'weight' ? Math.abs(b.weight) - Math.abs(a.weight) : Math.abs(b.weight - (b.initialWeight ?? b.weight)) - Math.abs(a.weight - (a.initialWeight ?? a.weight)),
  ).slice(0, limit);
  const info = app.state.info;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span className="dim mono" style={{ fontSize: 11 }}>{fmt.int(total)} {incoming ? 'incoming' : 'outgoing'}{total > limit ? ` · top ${limit}` : ''}</span>
        <Segmented value={sort} onChange={setSort} options={[{ value: 'weight', label: '|w|' }, { value: 'delta', label: 'Δw' }, { value: 'id', label: 'ID' }]} />
      </div>
      <div className="table-wrap" style={{ maxHeight: height }}>
        <table className="table">
          <thead>
            <tr>
              <th>Synapse</th>
              <th>{incoming ? 'From' : 'To'}</th>
              <th className="r">Weight</th>
              <th className="r">Delay</th>
              <th>Type</th>
              <th className="r">Δw</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => {
              const delta = s.initialWeight !== null ? Math.abs(s.weight) - Math.abs(s.initialWeight) : null;
              return (
                <tr key={s.id} className={`is-clickable ${selected === s.id ? 'is-selected' : ''}`} onClick={() => {
                  setSelected(s.id);
                  void app.selectNeuron(s.other, { focus: true, keepRegion: true });
                }} title={`Projection ${info?.projections[s.projection]?.id ?? s.projection} · effective ${s.effective.toFixed(4)}${s.eligibility !== null ? ` · eligibility ${s.eligibility.toExponential(2)}` : ''}`}>
                  <td>{s.id}</td>
                  <td>#{s.other}</td>
                  <td className="r" style={{ color: s.inhibitory ? 'var(--magenta)' : 'var(--cyan)' }}>{s.weight.toFixed(4)}</td>
                  <td className="r">{s.delayMs.toFixed(1)}</td>
                  <td className="text">{s.inhibitory ? 'I' : 'E'}{s.plastic ? (s.reward ? ' · R-STDP' : ' · STDP') : ''}</td>
                  <td className="r" style={{ color: delta === null ? undefined : delta > 0 ? 'var(--ok)' : delta < 0 ? 'var(--danger)' : undefined }}>{delta === null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(4)}`}</td>
                  <td>
                    <button type="button" className={`icon-btn ${tracked.includes(s.id) ? 'is-active' : ''}`} style={{ width: 22, height: 22 }} aria-label="Track weight history" title="Track this synapse's weight over time" onClick={(e) => {
                      e.stopPropagation();
                      void app.toggleTracked(s.id);
                    }}>{Icon.history({ width: 12 })}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function NeuronInspector({ compact }: { compact?: boolean }) {
  const app = useApp();
  const d = useAppState((s) => s.neuron);
  const sel = useAppState((s) => s.selection.neuron);
  const info = useAppState((s) => s.info);
  const colors = useAppState((s) => s.regionColors);
  const timeMs = useAppState((s) => s.sim.timeMs);
  const compare = useAppState((s) => s.selection.compare);
  const tick = useTelemetryTick(120);
  const [tab, setTab] = useState<'live' | 'params' | 'out' | 'in'>('live');
  const rate = useNeuronRate(d, timeMs);
  if (sel === null || !info) return null;
  if (!d || d.id !== sel) return <p className="hint">Reading neuron #{sel}…</p>;
  const st = neuronStateLabel(d);
  const trace = app.telemetry.probes.get(d.id);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <i className="swatch" style={{ background: colors[d.region] }} />
        <span style={{ fontWeight: 600 }}>{info.regions[d.region]?.name}</span>
        <span className={d.class === 'inhibitory' ? 'chip chip--magenta' : 'chip chip--cyan'}>{d.class}</span>
        <span className={st.chip}>{st.label}</span>
      </div>
      <div className="stat-grid stat-grid--3" style={{ marginBottom: 12 }}>
        <Stat label="Membrane" value={d.v.toFixed(2)} unit="mV" size={compact ? undefined : 'xl'} />
        <Stat label="Firing rate" value={rate === null ? '—' : rate.toFixed(1)} unit="Hz" note="last ≤2 s simulated" />
        <Stat label="Spikes" value={fmt.int(d.spikeCount)} note={d.lastSpikeMs === null ? 'never fired' : `last ${fmt.time(Math.max(0, timeMs - d.lastSpikeMs))} ago`} />
      </div>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'live', label: 'Live' }, { value: 'params', label: 'Parameters' }, { value: 'out', label: `Out ${d.outCount}` }, { value: 'in', label: `In ${d.inCount}` }]} />
      <div style={{ marginTop: 10 }}>
        {tab === 'live' && (
          <>
            <MembraneChart traces={trace ? [trace] : []} dt={info.dt} vRest={d.vRest} vThreshold={d.vThreshold} vReset={d.vReset} tick={tick} windowMs={compact ? 300 : 500} height={compact ? 150 : 190} />
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>Excitatory current</dt><dd>{d.iExc.toFixed(3)}</dd>
              <dt>Inhibitory current</dt><dd>{d.iInh.toFixed(3)}</dd>
              <dt>External / stimulus</dt><dd>{d.externalInput.toFixed(2)} / {d.stimulusInput.toFixed(2)}</dd>
              <dt>Threshold · rest · reset</dt><dd>{d.vThreshold.toFixed(1)} · {d.vRest.toFixed(1)} · {d.vReset.toFixed(1)}</dd>
              <dt>τ · refractory</dt><dd>{d.tauMs.toFixed(1)} · {d.refractoryMs.toFixed(1)} ms</dd>
              <dt>Excitability · noise σ</dt><dd>{d.excitability.toFixed(3)} · {d.noiseStd.toFixed(2)}</dd>
              <dt>Mean weight in · out</dt><dd>{d.inWeightMean.toFixed(3)} · {d.outWeightMean.toFixed(3)}</dd>
              <dt>STDP traces pre · post</dt><dd>{d.tracePre.toFixed(3)} · {d.tracePost.toFixed(3)}</dd>
              <dt>Position</dt><dd>{d.position.map((x) => x.toFixed(1)).join(', ')}</dd>
            </dl>
          </>
        )}
        {tab === 'params' && <ParamEditor d={d} />}
        {tab === 'out' && <SynapseTable neuron={d.id} incoming={false} />}
        {tab === 'in' && <SynapseTable neuron={d.id} incoming />}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
        <button type="button" className="btn btn--sm btn--amber" onClick={() => void app.stimulateNeuron(d.id)}>{Icon.bolt({ width: 12 })} Stimulate</button>
        <button type="button" className="btn btn--sm" onClick={() => app.view?.focusNeuron(d.id)}>{Icon.focus({ width: 12 })} Focus</button>
        <button type="button" className="btn btn--sm" onClick={() => void app.toggleCompare(d.id)}>{Icon.compare({ width: 12 })} {compare.includes(d.id) ? 'Uncompare' : 'Compare'}</button>
        <button type="button" className="btn btn--sm" onClick={() => app.setViz('local')}>{Icon.network({ width: 12 })} Local network</button>
        {compact && <button type="button" className="btn btn--sm btn--violet" onClick={() => app.setMode('study')}>Study</button>}
      </div>
    </div>
  );
}
