/** Brain designer: create a brain from a preset, or edit the configuration (rebuild). */

import { useMemo, useState } from 'react';
import { useApp, useAppState } from '../../app/context.tsx';
import { PRESETS, TIERS } from '../../config/presets.ts';
import { estimate, formatBytes, scaleDelays, scaleDensity, scaleNeurons, scaleWeights, setExcitatoryFraction, structuralChanges } from '../../config/adjust.ts';
import { validateConfig } from '../../config/validate.ts';
import type { BrainConfig, ProjectionConfig, RegionConfig } from '../../config/schema.ts';
import { suggestedTier } from '../../app/AppController.ts';
import { Dialog, NumberField, Section, Segmented, Select, Slider, Stat, ToggleRow, fmt } from '../primitives.tsx';
import { Icon } from '../icons.tsx';

function EstimateRow({ config }: { config: BrainConfig }) {
  const e = estimate(config);
  const issues = validateConfig(config);
  const heavy = e.memoryBytes > 1.5 * 1024 ** 3;
  return (
    <>
      <div className="stat-grid">
        <Stat label="Neurons" value={fmt.int(e.neurons)} />
        <Stat label="Synapses (expected)" value={fmt.compact(e.synapses)} note={`${e.synapsesPerNeuron.toFixed(0)} per neuron`} />
        <Stat label="Plastic synapses" value={fmt.compact(e.plasticSynapses)} />
        <Stat label="Engine memory" value={formatBytes(e.memoryBytes)} color={heavy ? 'var(--amber)' : undefined} note={heavy ? 'may exceed browser limits' : undefined} />
      </div>
      {issues.length > 0 && (
        <div className="intro__error" style={{ marginTop: 10 }}>
          {issues.slice(0, 6).map((i) => <div key={i.path + i.message}>{i.path}: {i.message}</div>)}
        </div>
      )}
    </>
  );
}

function NewBrain() {
  const app = useApp();
  const [preset, setPreset] = useState(PRESETS[0].id);
  const [tier, setTier] = useState(suggestedTier());
  const [seed, setSeed] = useState(1);
  const p = PRESETS.find((x) => x.id === preset)!;
  const t = TIERS.find((x) => x.id === tier)!;
  const config = useMemo(() => p.create(Math.min(t.neurons, p.maxNeurons ?? Infinity), seed), [p, t, seed]);
  return (
    <>
      <Section label="Preset">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {PRESETS.map((x) => (
            <button key={x.id} type="button" className={`card ${preset === x.id ? '' : ''}`} style={{ textAlign: 'left', cursor: 'pointer', borderColor: preset === x.id ? 'rgba(56,230,255,0.55)' : undefined, background: preset === x.id ? 'rgba(56,230,255,0.07)' : undefined, color: 'inherit' }} onClick={() => setPreset(x.id)}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{x.name}</div>
              <div className="dim" style={{ fontSize: 11, lineHeight: 1.45 }}>{x.description}</div>
            </button>
          ))}
        </div>
      </Section>
      <Section label="Size" hint="Tiers are engineering targets. Measured performance on this machine is in Performance → Run benchmark.">
        <Segmented value={tier} onChange={setTier} wrap options={TIERS.map((x) => ({ value: x.id, label: `${x.label} · ${fmt.compact(x.neurons)}`, title: x.note }))} />
        {p.maxNeurons && t.neurons > p.maxNeurons && <p className="hint">This preset is limited to {fmt.int(p.maxNeurons)} neurons by design.</p>}
      </Section>
      <Section label="Random seed" hint="The same preset, size and seed always produce the same network.">
        <NumberField label="Seed" value={seed} min={0} max={4294967295} step={1} onCommit={(v) => setSeed(Math.round(v))} />
      </Section>
      <Section label="Estimate"><EstimateRow config={config} /></Section>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
        <button type="button" className="btn" onClick={() => void app.projects.exportConfig(config)}>{Icon.download({ width: 13 })} Export configuration</button>
        <button type="button" className="btn btn--primary" onClick={async () => {
          app.openDialog(null);
          await app.projects.newBrain(config);
        }}>{Icon.brain({ width: 13 })} Generate network</button>
      </div>
    </>
  );
}

function RegionRow({ r, onChange }: { r: RegionConfig; onChange: (r: RegionConfig) => void }) {
  return (
    <tr>
      <td className="text"><i className="swatch" style={{ background: r.color, display: 'inline-block', marginRight: 6 }} />{r.name}</td>
      <td className="r"><input className="input input--num" style={{ width: 80, height: 22 }} defaultValue={r.count} aria-label="Neurons" onBlur={(e) => {
        const v = Math.round(Number(e.target.value));
        if (Number.isFinite(v) && v >= 1 && v !== r.count) onChange({ ...r, count: v });
      }} /></td>
      <td className="r"><input className="input input--num" style={{ width: 60, height: 22 }} defaultValue={Math.round(r.excitatoryFraction * 100)} aria-label="Excitatory percent" onBlur={(e) => {
        const v = Number(e.target.value) / 100;
        if (Number.isFinite(v) && v >= 0 && v <= 1 && v !== r.excitatoryFraction) onChange({ ...r, excitatoryFraction: v });
      }} /></td>
      <td className="r"><input className="input input--num" style={{ width: 60, height: 22 }} defaultValue={r.excitatory.vThreshold} aria-label="E threshold" onBlur={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v !== r.excitatory.vThreshold) onChange({ ...r, excitatory: { ...r.excitatory, vThreshold: v } });
      }} /></td>
      <td className="r"><input className="input input--num" style={{ width: 56, height: 22 }} defaultValue={r.excitatory.bias} aria-label="E background current" onBlur={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v !== r.excitatory.bias) onChange({ ...r, excitatory: { ...r.excitatory, bias: v } });
      }} /></td>
      <td className="r"><input className="input input--num" style={{ width: 56, height: 22 }} defaultValue={r.excitatory.noiseStd} aria-label="E noise" onBlur={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v >= 0 && v !== r.excitatory.noiseStd) onChange({ ...r, excitatory: { ...r.excitatory, noiseStd: v } });
      }} /></td>
      <td className="r"><input className="input input--num" style={{ width: 56, height: 22 }} defaultValue={r.heterogeneity} aria-label="Heterogeneity" onBlur={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v >= 0 && v <= 1 && v !== r.heterogeneity) onChange({ ...r, heterogeneity: v });
      }} /></td>
    </tr>
  );
}

function ProjectionRow({ p, names, onChange }: { p: ProjectionConfig; names: Map<string, string>; onChange: (p: ProjectionConfig) => void }) {
  return (
    <tr>
      <td className="text">{names.get(p.from)} → {p.from === p.to ? 'self' : names.get(p.to)}</td>
      <td className="text" style={{ color: p.source === 'inhibitory' ? 'var(--magenta)' : 'var(--cyan)' }}>{p.source === 'inhibitory' ? 'I' : 'E'}</td>
      <td className="r"><input className="input input--num" style={{ width: 76, height: 22 }} defaultValue={p.probability} aria-label="Probability" onBlur={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v >= 0 && v <= 1 && v !== p.probability) onChange({ ...p, probability: v });
      }} /></td>
      <td className="r"><input className="input input--num" style={{ width: 60, height: 22 }} defaultValue={p.weight.mean} aria-label="Weight" onBlur={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v >= 0 && v !== p.weight.mean) onChange({ ...p, weight: { ...p.weight, mean: v } });
      }} /></td>
      <td className="r"><input className="input input--num" style={{ width: 70, height: 22 }} defaultValue={`${p.delayMs.min}-${p.delayMs.max}`} aria-label="Delay range" onBlur={(e) => {
        const m = /^\s*([\d.]+)\s*-\s*([\d.]+)\s*$/.exec(e.target.value);
        if (m) onChange({ ...p, delayMs: { min: Number(m[1]), max: Number(m[2]) } });
      }} /></td>
      <td>
        <select className="select" style={{ height: 22, width: 104 }} value={p.topology ?? 'random'} aria-label="Topology" onChange={(e) => onChange({ ...p, topology: e.target.value as ProjectionConfig['topology'] })}>
          <option value="random">random</option>
          <option value="local">local</option>
          <option value="topographic">topographic</option>
        </select>
      </td>
      <td>
        <select className="select" style={{ height: 22, width: 92 }} value={p.plasticity?.enabled ? (p.plasticity.rule ?? 'stdp') : 'none'} aria-label="Plasticity" onChange={(e) => {
          const v = e.target.value;
          onChange({ ...p, plasticity: v === 'none' ? { enabled: false } : { ...(p.plasticity ?? {}), enabled: true, rule: v as 'stdp' | 'reward' } });
        }}>
          <option value="none">static</option>
          <option value="stdp">STDP</option>
          <option value="reward">R-STDP</option>
        </select>
      </td>
    </tr>
  );
}

function EditConfig() {
  const app = useApp();
  const live = useAppState((s) => s.config);
  const stored = useAppState((s) => s.draft);
  const [draft, setDraft] = useState<BrainConfig | null>(stored ?? live);
  const [density, setDensity] = useState(1);
  const [weights, setWeights] = useState(1);
  const [delays, setDelays] = useState(1);
  if (!draft || !live) return null;
  const neurons = draft.regions.reduce((a, r) => a + r.count, 0);
  const eFrac = draft.regions.reduce((a, r) => a + r.excitatoryFraction * r.count, 0) / Math.max(1, neurons);
  const names = new Map(draft.regions.map((r) => [r.id, r.name]));
  const changes = structuralChanges(live, draft);
  const apply = (c: BrainConfig) => setDraft(c);
  return (
    <>
      <p className="hint"><strong style={{ color: 'var(--text-2)' }}>Change policy.</strong> Settings here are structural: they define how the network is generated and take effect when it is rebuilt, which restarts the simulation from time zero. Neuron parameters, pathway gains, plasticity, reward and stimulation change the running network immediately (inspectors, Connectome, Laboratory → Controls).</p>
      <Section label="Global">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 20px' }}>
          <NumberField label="Total neurons" value={neurons} min={10} max={500_000} step={100} onCommit={(v) => apply(scaleNeurons(draft, Math.round(v)))} hint="Scales every region, keeping in-degree constant" />
          <NumberField label="Excitatory share (%)" value={Math.round(eFrac * 100)} min={0} max={100} step={1} onCommit={(v) => apply(setExcitatoryFraction(draft, v / 100))} />
          <NumberField label="Random seed" value={draft.seed} min={0} max={4294967295} step={1} onCommit={(v) => apply({ ...draft, seed: Math.round(v) })} />
          <NumberField label="Timestep" unit="ms" value={draft.timestepMs} min={0.05} max={1} step={0.05} onCommit={(v) => apply({ ...draft, timestepMs: v })} />
          <NumberField label="Excitatory synaptic τ" unit="ms" value={draft.synapse.tauExcMs} min={draft.timestepMs} max={1000} onCommit={(v) => apply({ ...draft, synapse: { ...draft.synapse, tauExcMs: v } })} />
          <NumberField label="Inhibitory synaptic τ" unit="ms" value={draft.synapse.tauInhMs} min={draft.timestepMs} max={1000} onCommit={(v) => apply({ ...draft, synapse: { ...draft.synapse, tauInhMs: v } })} />
        </div>
        <Slider label="Connection density (all pathways)" value={density} min={0.1} max={4} log onChange={setDensity} onCommit={(f) => {
          apply(scaleDensity(draft, f));
          setDensity(1);
        }} format={(v) => `× ${v.toFixed(2)}`} />
        <Slider label="Synaptic weights (all pathways)" value={weights} min={0.1} max={4} log onChange={setWeights} onCommit={(f) => {
          apply(scaleWeights(draft, f));
          setWeights(1);
        }} format={(v) => `× ${v.toFixed(2)}`} />
        <Slider label="Synaptic delays (all pathways)" value={delays} min={0.25} max={4} log onChange={setDelays} onCommit={(f) => {
          apply(scaleDelays(draft, f));
          setDelays(1);
        }} format={(v) => `× ${v.toFixed(2)}`} />
      </Section>
      <Section label="Plasticity">
        <ToggleRow label="Plasticity on after building" checked={draft.plasticity.enabled} onChange={(v) => apply({ ...draft, plasticity: { ...draft.plasticity, enabled: v } })} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 20px' }}>
          <NumberField label="A₊ (potentiation)" value={draft.plasticity.aPlus} min={0} max={10} step={0.001} onCommit={(v) => apply({ ...draft, plasticity: { ...draft.plasticity, aPlus: v } })} />
          <NumberField label="A₋ (depression)" value={draft.plasticity.aMinus} min={0} max={10} step={0.001} onCommit={(v) => apply({ ...draft, plasticity: { ...draft.plasticity, aMinus: v } })} />
          <NumberField label="τ₊" unit="ms" value={draft.plasticity.tauPlusMs} min={1} max={1000} onCommit={(v) => apply({ ...draft, plasticity: { ...draft.plasticity, tauPlusMs: v } })} />
          <NumberField label="τ₋" unit="ms" value={draft.plasticity.tauMinusMs} min={1} max={1000} onCommit={(v) => apply({ ...draft, plasticity: { ...draft.plasticity, tauMinusMs: v } })} />
          <NumberField label="w min" value={draft.plasticity.wMin} min={0} max={1000} onCommit={(v) => apply({ ...draft, plasticity: { ...draft.plasticity, wMin: v } })} />
          <NumberField label="w max" value={draft.plasticity.wMax} min={0} max={1000} onCommit={(v) => apply({ ...draft, plasticity: { ...draft.plasticity, wMax: v } })} />
          <NumberField label="Eligibility τ" unit="ms" value={draft.plasticity.eligibilityTauMs} min={1} max={100000} onCommit={(v) => apply({ ...draft, plasticity: { ...draft.plasticity, eligibilityTauMs: v } })} />
          <NumberField label="Reward learning rate" value={draft.plasticity.rewardRate} min={0} max={1000} onCommit={(v) => apply({ ...draft, plasticity: { ...draft.plasticity, rewardRate: v } })} />
        </div>
        <Select label="Neuromodulator source region" value={draft.plasticity.modulatorRegion ?? ''} onChange={(v) => apply({ ...draft, plasticity: { ...draft.plasticity, modulatorRegion: v || null } })} options={[{ value: '', label: 'None (reward events only)' }, ...draft.regions.map((r) => ({ value: r.id, label: r.name }))]} />
      </Section>
      <Section label="Regions" hint="Count, excitatory %, excitatory threshold (mV), background current, noise σ, heterogeneity.">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Region</th><th className="r">Neurons</th><th className="r">E %</th><th className="r">V_th</th><th className="r">Bias</th><th className="r">σ</th><th className="r">Het.</th></tr></thead>
            <tbody>{draft.regions.map((r, i) => <RegionRow key={`${r.id}-${draft.seed}-${r.count}`} r={r} onChange={(nr) => apply({ ...draft, regions: draft.regions.map((x, k) => (k === i ? nr : x)) })} />)}</tbody>
          </table>
        </div>
      </Section>
      <Section label="Pathways" hint="Probability per (source, target) pair, weight magnitude, delay range in ms (min-max), spatial topology, plasticity rule.">
        <div className="table-wrap" style={{ maxHeight: 280 }}>
          <table className="table">
            <thead><tr><th>Pathway</th><th>Class</th><th className="r">p</th><th className="r">|w|</th><th className="r">Delay</th><th>Topology</th><th>Plasticity</th></tr></thead>
            <tbody>{draft.projections.map((p, i) => <ProjectionRow key={`${i}-${p.probability}-${p.weight.mean}`} p={p} names={names} onChange={(np) => apply({ ...draft, projections: draft.projections.map((x, k) => (k === i ? np : x)) })} />)}</tbody>
          </table>
        </div>
      </Section>
      <Section label="Result"><EstimateRow config={draft} /></Section>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <span className="hint" style={{ margin: 0 }}>{changes.length ? `${changes.length} change(s): ${changes.join(' · ')}` : 'No changes'}</span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn--ghost" onClick={() => setDraft(live)}>Revert</button>
          <button type="button" className="btn" disabled={!changes.length} onClick={() => {
            app.store.set({ draft });
            app.openDialog(null);
          }}>Keep as pending</button>
          <button type="button" className="btn btn--primary" disabled={!changes.length || validateConfig(draft).length > 0} onClick={async () => {
            app.openDialog(null);
            await app.buildNetwork(draft, {});
            app.projects.scheduleAutosave();
          }}>{Icon.reset({ width: 13 })} Rebuild now</button>
        </span>
      </div>
    </>
  );
}

export function DesignerDialog() {
  const app = useApp();
  const [tab, setTab] = useState<'new' | 'edit'>(app.state.draft ? 'edit' : 'new');
  return (
    <Dialog title="Brain designer" meta={tab === 'new' ? 'create a network' : 'configuration (rebuild)'} onClose={() => app.openDialog(null)} size="wide">
      <Segmented value={tab} onChange={setTab} options={[{ value: 'new', label: 'New brain' }, { value: 'edit', label: 'Edit current configuration' }]} />
      <div style={{ height: 6 }} />
      {tab === 'new' ? <NewBrain /> : <EditConfig />}
    </Dialog>
  );
}
