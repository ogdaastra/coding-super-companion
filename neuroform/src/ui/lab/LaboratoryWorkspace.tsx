/** Laboratory: experiments, stimulation design and global controls. */

import { Fragment, useEffect, useState } from 'react';
import { useApp, useAppState } from '../../app/context.tsx';
import { useStore } from '../../app/store.ts';
import { EXPERIMENTS } from '../../experiments/definitions.ts';
import type { ExperimentResult, ParamSpec, ParamValue } from '../../experiments/types.ts';
import type { ExperimentRecord } from '../../persistence/db.ts';
import { presetById, TIERS } from '../../config/presets.ts';
import { platform, slug, timestampName } from '../../platform/platform.ts';
import { XYChart } from '../charts/charts.tsx';
import { Icon } from '../icons.tsx';
import { NumberField, Panel, Section, Segmented, Select, Slider, Stat, ToggleRow } from '../primitives.tsx';
import { LearningControls, StimulusTool } from '../explorer/BrainPanel.tsx';
import { VisionProgressPanel, VisionSetupPanel } from './VisionLab.tsx';

function ParamInput({ spec, value, onChange }: { spec: ParamSpec; value: ParamValue; onChange: (v: ParamValue) => void }) {
  const info = useAppState((s) => s.info);
  if (!info) return null;
  if (spec.type === 'region') return <Select label={spec.label} value={Number(value)} onChange={onChange} options={info.regions.map((r, i) => ({ value: i, label: r.name }))} />;
  if (spec.type === 'projection')
    return <Select label={spec.label} value={Number(value)} onChange={onChange} options={info.projections.map((p, i) => ({ value: i, label: `${info.regions[p.from].name} → ${info.regions[p.to].name} (${p.source === 'excitatory' ? 'E' : 'I'})` }))} />;
  if (spec.type === 'select') return <Select label={spec.label} value={String(value)} onChange={onChange} options={spec.options ?? []} />;
  if (spec.type === 'boolean') return <ToggleRow label={spec.label} checked={Boolean(value)} onChange={onChange} />;
  return <NumberField label={spec.label} value={Number(value)} min={spec.min} max={spec.max} step={spec.step} unit={spec.unit} onCommit={(v) => onChange(v)} />;
}

export function ResultView({ result }: { result: ExperimentResult }) {
  const info = useAppState((s) => s.info);
  const colors = useAppState((s) => s.regionColors);
  const colorOf = (name: string, i: number) => {
    const r = info?.regions.findIndex((x) => x.name === name) ?? -1;
    return r >= 0 ? colors[r] : ['#38e6ff', '#9b7bff', '#ff4fd8', '#ffb547', '#4be3a8', '#5b8cff', '#eef6ff'][i % 7];
  };
  return (
    <div>
      <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: '4px 0 12px', color: 'var(--white)' }}>{result.headline}</p>
      <div className="stat-grid">
        {result.summary.map((s) => <Stat key={s.label} label={s.label} value={s.value} note={s.note} size="sm" />)}
      </div>
      {result.charts.map((c) => (
        <div key={c.title} className="card" style={{ marginTop: 12 }}>
          <div className="chart__head"><span className="label">{c.title}</span><span className="mono dim" style={{ fontSize: 10.5 }}>{c.yLabel} vs {c.xLabel}</span></div>
          <div className="chart__legend" style={{ marginBottom: 6 }}>
            {c.series.map((s, i) => <span key={s.name}><i className="swatch" style={{ background: s.color ?? colorOf(s.name, i) }} />{s.name}</span>)}
          </div>
          <XYChart x={c.x} series={c.series.map((s, i) => ({ ...s, color: s.color ?? colorOf(s.name, i) }))} kind={c.kind} height={170} xLabel={c.xLabel} yLabel={c.yLabel} xTicks={c.kind === 'bar' && c.x.length === (info?.regions.length ?? -1) ? info?.regions.map((r) => r.name) : undefined} />
        </div>
      ))}
      {result.tables.map((t) => (
        <div key={t.title} style={{ marginTop: 12 }}>
          <span className="label">{t.title}</span>
          <div className="table-wrap" style={{ marginTop: 6 }}>
            <table className="table">
              <thead><tr>{t.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={j === 0 ? 'text' : ''}>{String(v)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>
      ))}
      {result.notes.map((n) => <p key={n} className="hint">{n}</p>)}
    </div>
  );
}

function ExperimentPanel() {
  const app = useApp();
  const lab = useStore(app.experiments.store, (s) => s);
  const info = useAppState((s) => s.info);
  const config = useAppState((s) => s.config);
  const def = app.experiments.definition(lab.selected);
  const params = app.experiments.paramsFor(def.id);
  const running = lab.run?.status === 'running';
  const preset = def.suggestedPreset ? presetById(def.suggestedPreset) : undefined;
  return (
    <Panel title="Experiments" meta="run against the live network" className="grow">
      <div className="list">
        {EXPERIMENTS.map((e) => (
          <div key={e.id} className={`list__item ${lab.selected === e.id ? 'is-selected' : ''}`} onClick={() => app.experiments.select(e.id)}>
            <span className="chip chip--violet" style={{ width: 24, justifyContent: 'center', padding: 0 }}>{e.letter}</span>
            <div style={{ minWidth: 0 }}>
              <div className="list__name">{e.name}</div>
              <div className="dim" style={{ fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.summary}</div>
            </div>
            <span />
          </div>
        ))}
      </div>
      <Section label={`${def.letter} · ${def.name}`}>
        {def.description.map((p) => <p key={p} className="hint" style={{ color: 'var(--text-2)' }}>{p}</p>)}
        <p className="hint"><strong style={{ color: 'var(--text-2)' }}>Method.</strong> {def.method}</p>
        {preset && config?.preset !== preset.id && (
          <p className="hint">Best demonstrated with the <strong>{preset.name}</strong> preset. <button type="button" className="btn btn--sm" onClick={() => {
            const t = TIERS.find((x) => x.id === preset.defaultTier)!;
            void app.projects.newBrain(preset.create(Math.min(t.neurons, preset.maxNeurons ?? Infinity), 1));
          }}>Load it</button></p>
        )}
      </Section>
      <Section label="Parameters">
        {info && def.params.map((p) => <ParamInput key={p.key} spec={p} value={params[p.key]} onChange={(v) => app.experiments.setParam(def.id, p.key, v)} />)}
        <div className="field__row" style={{ marginTop: 6 }}>
          <span className="field__label">Pacing</span>
          <Segmented value={lab.pace} onChange={(pace) => app.experiments.store.set({ pace })} options={[{ value: 'fast', label: 'As fast as possible' }, { value: 'watch', label: 'Watch' }]} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {running ? (
            <button type="button" className="btn btn--danger btn--block" onClick={() => app.experiments.abort()}>{Icon.stop({ width: 12 })} Stop experiment</button>
          ) : (
            <button type="button" className="btn btn--primary btn--block" disabled={!info} onClick={() => void app.experiments.start(def.id)}>{Icon.flask({ width: 13 })} Run experiment {def.letter}</button>
          )}
        </div>
        <p className="hint">The simulation is paused and advanced in exact steps. Conditions start from time zero with seed {info?.seed}, so a run is reproducible. Temporary changes are undone afterwards.</p>
      </Section>
    </Panel>
  );
}

function SavedResults({ onOpen, compare, setCompare }: { onOpen: (r: ExperimentRecord) => void; compare: string[]; setCompare: (ids: string[]) => void }) {
  const app = useApp();
  const project = useAppState((s) => s.project);
  const seq = useAppState((s) => s.librarySeq);
  const [list, setList] = useState<ExperimentRecord[]>([]);
  useEffect(() => {
    if (!project) return;
    void app.db.listExperiments(project.id).then(setList).catch(() => setList([]));
  }, [app, project, seq]);
  if (!list.length) return <p className="hint">Completed experiments are saved with this project. Run one to see it here.</p>;
  return (
    <div className="list">
      {list.map((r) => (
        <div key={r.id} className={`list__item ${compare.includes(r.id) ? 'is-selected' : ''}`} onClick={() => onOpen(r)}>
          <input type="checkbox" checked={compare.includes(r.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => setCompare(e.target.checked ? [...compare, r.id].slice(-2) : compare.filter((x) => x !== r.id))} aria-label="Select for comparison" />
          <div style={{ minWidth: 0 }}>
            <div className="list__name">{r.name}</div>
            <div className="dim" style={{ fontSize: 10.5 }}>{new Date(r.createdAt).toLocaleString('en-GB')} · seed {r.seed}</div>
          </div>
          <div style={{ display: 'flex', gap: 2 }}>
            <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} aria-label="Export result" onClick={(e) => {
              e.stopPropagation();
              void platform.save(timestampName(slug(r.name), 'json'), JSON.stringify(r, null, 2), 'application/json');
            }}>{Icon.download({ width: 12 })}</button>
            <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} aria-label="Delete result" onClick={async (e) => {
              e.stopPropagation();
              await app.db.deleteExperiment(r.id);
              app.projects.bump();
            }}>{Icon.trash({ width: 12 })}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultsPanel() {
  const app = useApp();
  const lab = useStore(app.experiments.store, (s) => s);
  const [opened, setOpened] = useState<ExperimentRecord | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [compared, setCompared] = useState<ExperimentRecord[]>([]);
  const project = useAppState((s) => s.project);
  useEffect(() => {
    if (!project || compare.length < 2) {
      setCompared([]);
      return;
    }
    void app.db.listExperiments(project.id).then((l) => setCompared(l.filter((r) => compare.includes(r.id))));
  }, [compare, app, project]);
  const run = lab.run;
  const def = run ? app.experiments.definition(run.experimentId) : null;
  return (
    <Panel title="Measurements & results" className="grow">
      {run && def ? (
        <Section label={`${def.letter} · ${def.name} — ${run.status === 'running' ? run.label : run.status}`} actions={run.status !== 'running' && run.result ? <button type="button" className="btn btn--sm" onClick={() => void app.experiments.start(run.experimentId)}>{Icon.reset({ width: 12 })} Repeat</button> : undefined}>
          {run.status === 'running' && <div className="bar" style={{ marginBottom: 10 }}><i style={{ width: `${run.progress * 100}%` }} /></div>}
          {Object.keys(run.live).length > 0 && (
            <dl className="kv" style={{ marginBottom: 10 }}>
              {Object.entries(run.live).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}
            </dl>
          )}
          {run.log.map((l, i) => <p key={i} className="hint">{l}</p>)}
          {run.error && run.status !== 'running' && <p className="error-text">{run.status === 'aborted' ? `Stopped: ${run.error}` : run.error}</p>}
          {run.result && <ResultView result={run.result} />}
        </Section>
      ) : (
        <p className="hint">Choose an experiment and press Run. Live measurements appear here while it runs; the result summary, charts and tables when it finishes.</p>
      )}
      {compared.length === 2 && (
        <Section label="Comparison" actions={<button type="button" className="btn btn--sm btn--ghost" onClick={() => setCompare([])}>Clear</button>}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {compared.map((r) => (
              <div key={r.id} className="card">
                <span className="label">{r.name}</span>
                <div className="dim" style={{ fontSize: 10.5, marginBottom: 6 }}>{new Date(r.createdAt).toLocaleString('en-GB')}</div>
                <p style={{ fontSize: 12 }}>{(r.result as ExperimentResult).headline}</p>
                <dl className="kv">{(r.result as ExperimentResult).summary.map((s) => <Fragment key={s.label}><dt>{s.label}</dt><dd>{s.value}</dd></Fragment>)}</dl>
                <details style={{ marginTop: 6 }}><summary className="dim" style={{ cursor: 'pointer', fontSize: 11 }}>Parameters</summary><pre className="mono dim" style={{ fontSize: 10.5, whiteSpace: 'pre-wrap' }}>{JSON.stringify(r.params, null, 1)}</pre></details>
              </div>
            ))}
          </div>
        </Section>
      )}
      {opened && (
        <Section label={`Saved: ${opened.name}`} actions={<button type="button" className="btn btn--sm btn--ghost" onClick={() => setOpened(null)}>Close</button>}>
          <ResultView result={opened.result as ExperimentResult} />
        </Section>
      )}
      <Section label="Saved results" hint="Tick two results to compare them side by side.">
        <SavedResults onOpen={setOpened} compare={compare} setCompare={setCompare} />
      </Section>
    </Panel>
  );
}

/** Immediate whole-network controls (no rebuild). */
export function GlobalControls() {
  const app = useApp();
  const info = useAppState((s) => s.info);
  const [gain, setGain] = useState(1);
  const [bias, setBias] = useState<number | null>(null);
  const [noise, setNoise] = useState<number | null>(null);
  if (!info) return null;
  return (
    <>
      <p className="hint">Applied immediately to every region; each change can be undone. Structural settings (neuron counts, connection probability, E/I ratio, delays, seed, timestep) are in the brain designer and require a rebuild.</p>
      <Slider label="Synaptic weight scale (all pathways)" value={gain} min={0} max={3} step={0.05} onChange={setGain} onCommit={(g) => void app.edits.scaleAllGains(g)} format={(v) => `× ${v.toFixed(2)}`} />
      <NumberField label="Excitatory background current" value={bias ?? NaN} onCommit={async (v) => {
        await app.edits.setAllPopulations('excitatory', 'bias', v);
        setBias(v);
      }} unit="I" min={-100} max={100} />
      <NumberField label="Excitatory noise σ" value={noise ?? NaN} onCommit={async (v) => {
        await app.edits.setAllPopulations('excitatory', 'noiseStd', v);
        setNoise(v);
      }} min={0} max={100} />
      <NumberField label="Excitability (all neurons)" value={NaN} onCommit={(v) => app.edits.setAllPopulations('all', 'excitability', v)} min={0} max={10} unit="×" />
      <button type="button" className="btn btn--sm" onClick={() => app.openDialog('designer')}>{Icon.brain({ width: 12 })} Structural settings…</button>
    </>
  );
}

export function LaboratoryWorkspace() {
  const app = useApp();
  const tab = useAppState((s) => s.labTab);
  const setTab = (labTab: typeof tab) => app.store.set({ labTab });
  return (
    <div className="workspace ws-lab">
      <div className="slot slot-left">
        <div style={{ pointerEvents: 'auto' }}>
          <Segmented value={tab} onChange={setTab} options={[{ value: 'experiments', label: 'Experiments' }, { value: 'vision', label: 'Vision' }, { value: 'stimulus', label: 'Stimulation' }, { value: 'controls', label: 'Controls & learning' }]} />
        </div>
        {tab === 'experiments' && <ExperimentPanel />}
        {tab === 'vision' && <VisionSetupPanel />}
        {tab === 'stimulus' && (
          <Panel title="Stimulation designer" meta="patterns, repetitions, targets" className="grow">
            <StimulusTool />
            <p className="hint">Targets: the selected neuron, a sphere around it, or a fraction of the selected region. Select by clicking in the view or the region list. Active stimuli are highlighted in amber.</p>
          </Panel>
        )}
        {tab === 'controls' && (
          <Panel title="Network controls" className="grow">
            <Section label="Immediate">
              <GlobalControls />
            </Section>
            <Section label="Learning">
              <LearningControls />
            </Section>
          </Panel>
        )}
      </div>
      <div className="slot-spacer" />
      <div className="slot slot-right">
        {tab === 'vision' ? <VisionProgressPanel /> : <ResultsPanel />}
      </div>
    </div>
  );
}
