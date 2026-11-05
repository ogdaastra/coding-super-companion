import { useApp, useAppState, useTelemetryTick } from '../../app/context.tsx';
import { VIZ_MODES } from '../../render/vizModes.ts';
import { Icon } from '../icons.tsx';
import { Panel, Section, Segmented, Slider, ToggleRow, fmt } from '../primitives.tsx';
import { Sparkline } from '../charts/charts.tsx';

export function RegionList({ compact }: { compact?: boolean }) {
  const app = useApp();
  const info = useAppState((s) => s.info);
  const colors = useAppState((s) => s.regionColors);
  const selected = useAppState((s) => s.selection.region);
  const isolate = useAppState((s) => s.isolate);
  const tick = useTelemetryTick(300);
  if (!info) return null;
  const latest = app.telemetry.latest;
  return (
    <div className="list">
      {info.regions.map((r, i) => {
        const rate = app.telemetry.regionRate[i]?.last() ?? 0;
        const enabled = latest?.regions[i]?.enabled ?? true;
        return (
          <div key={r.id} className={`list__item ${selected === i ? 'is-selected' : ''} ${enabled ? '' : 'is-off'}`} onClick={() => app.selectRegion(i, true)} onContextMenu={(e) => {
            e.preventDefault();
            app.store.set({ context: { x: e.clientX, y: e.clientY, neuron: null, region: i } });
          }}>
            <i className="swatch" style={{ background: colors[i], boxShadow: `0 0 8px ${colors[i]}` }} />
            <div style={{ minWidth: 0 }}>
              <div className="list__name">{r.name}</div>
              {!compact && <Sparkline ring={app.telemetry.regionRate[i]} color={colors[i]} height={16} tick={tick} points={80} />}
            </div>
            <div style={{ display: 'grid', justifyItems: 'end', gap: 2 }}>
              <span className="list__meta">{enabled ? `${fmt.num(Number.isFinite(rate) ? rate : 0, 1)} Hz` : 'disabled'}</span>
              <span className="list__meta">{fmt.compact(r.end - r.start)}{isolate === i ? ' · isolated' : ''}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function VizModes() {
  const app = useApp();
  const viz = useAppState((s) => s.viz);
  const hasSel = useAppState((s) => s.selection.neuron !== null);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
      {VIZ_MODES.map((v, i) => (
        <button
          key={v.id}
          type="button"
          className={`btn btn--sm ${viz === v.id ? 'btn--primary' : 'btn--ghost'}`}
          style={{ justifyContent: 'flex-start', height: 28 }}
          title={`${v.describe}${v.needs === 'selection' && !hasSel ? ' Select a neuron first.' : ''} (Shift ${i + 1})`}
          onClick={() => app.setViz(v.id)}
        >
          {v.short}
        </button>
      ))}
    </div>
  );
}

export function StimulusTool() {
  const app = useApp();
  const d = useAppState((s) => s.stimulus);
  const sel = useAppState((s) => s.selection);
  const info = useAppState((s) => s.info);
  const stimuli = useAppState((s) => s.stimuli);
  const set = (patch: Partial<typeof d>) => app.store.set({ stimulus: { ...d, ...patch } });
  return (
    <>
      <Segmented
        value={d.pattern}
        onChange={(pattern) => set({ pattern })}
        options={[
          { value: 'constant', label: 'Constant', title: 'DC current while on' },
          { value: 'pulses', label: 'Pulses', title: 'Square pulse train' },
          { value: 'poisson', label: 'Poisson', title: 'Random input events, like synapses' },
        ]}
      />
      <div style={{ height: 8 }} />
      <Slider label="Amplitude" value={d.amplitude} min={0.1} max={20} step={0.1} log onChange={(amplitude) => set({ amplitude })} format={(v) => `${v.toFixed(2)} I`} />
      <Slider label="Duration" value={d.durationMs} min={1} max={2000} step={1} log onChange={(durationMs) => set({ durationMs: Math.round(durationMs) })} format={(v) => `${Math.round(v)} ms`} />
      {d.pattern === 'pulses' && <Slider label="Frequency" value={d.frequencyHz} min={1} max={200} step={1} log onChange={(frequencyHz) => set({ frequencyHz: Math.round(frequencyHz) })} format={(v) => `${Math.round(v)} Hz`} />}
      {d.pattern === 'poisson' && <Slider label="Event rate" value={d.rateHz} min={5} max={2000} step={5} log onChange={(rateHz) => set({ rateHz: Math.round(rateHz) })} format={(v) => `${Math.round(v)} Hz`} />}
      <Slider label="Repetitions" value={d.repetitions} min={1} max={50} step={1} onChange={(repetitions) => set({ repetitions: Math.round(repetitions) })} format={(v) => `× ${Math.round(v)}`} />
      {d.repetitions > 1 && <Slider label="Interval" value={d.intervalMs} min={Math.max(10, d.durationMs)} max={5000} step={10} log onChange={(intervalMs) => set({ intervalMs: Math.round(intervalMs) })} format={(v) => `${Math.round(v)} ms`} />}
      <Slider label="Region fraction" value={d.fraction} min={0.01} max={1} step={0.01} onChange={(fraction) => set({ fraction })} format={(v) => `${Math.round(v * 100)} %`} />
      <Slider label="Local radius" value={d.radius} min={2} max={80} step={1} onChange={(radius) => set({ radius })} format={(v) => `${v.toFixed(0)} units`} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
        <button type="button" className="btn btn--amber btn--sm" disabled={sel.neuron === null} onClick={() => sel.neuron !== null && void app.stimulateNeuron(sel.neuron)}>{Icon.bolt({ width: 12 })} Neuron</button>
        <button type="button" className="btn btn--amber btn--sm" disabled={sel.neuron === null} onClick={() => sel.neuron !== null && void app.stimulateAround(sel.neuron)}>{Icon.target({ width: 12 })} Local</button>
        <button type="button" className="btn btn--amber btn--sm" disabled={sel.region === null} onClick={() => sel.region !== null && void app.stimulateRegion(sel.region)}>{Icon.bolt({ width: 12 })} Region</button>
        <button type="button" className="btn btn--sm" disabled={!stimuli.length} onClick={() => void app.clearStimuli()}>Cancel all</button>
      </div>
      {stimuli.length > 0 && (
        <div style={{ marginTop: 10 }} className="list">
          {stimuli.map((s) => (
            <div key={s.id} className="list__item" style={{ cursor: 'default' }}>
              <span className={`dot ${s.on ? 'dot--pulse' : ''}`} style={{ color: s.on ? 'var(--amber)' : 'var(--text-4)' }} />
              <div className="list__name">{s.label || `Stimulus ${s.id}`} <span className="dim">· {fmt.int(s.targets)} neurons</span></div>
              <button type="button" className="icon-btn" style={{ width: 22, height: 22 }} aria-label="Cancel stimulus" onClick={() => void app.cancelStimulus(s.id)}>{Icon.close({ width: 11 })}</button>
            </div>
          ))}
        </div>
      )}
      {!info && null}
    </>
  );
}

export function LearningControls() {
  const app = useApp();
  const p = useAppState((s) => s.plasticity);
  const info = useAppState((s) => s.info);
  useTelemetryTick(500);
  const mod = app.telemetry.latest?.plasticity.modulator ?? 0;
  if (!info) return null;
  if (!p.available) return <p className="hint">This network has no plastic projections. Choose the Learning Lab preset, or enable plasticity on projections in the brain designer.</p>;
  const plastic = info.projections.filter((x) => x.plastic);
  return (
    <>
      <ToggleRow label="Plasticity (STDP)" checked={p.enabled} onChange={(v) => void app.setPlasticity(v)} hint="Pair-based spike-timing-dependent plasticity on plastic pathways" />
      <Slider label="Learning-rate scale η" value={p.rateScale} min={0.1} max={20} log onChange={(v) => void app.setPlasticity(p.enabled, Number(v.toFixed(2)))} format={(v) => `× ${v.toFixed(2)}`} />
      <p className="hint">{plastic.length} plastic pathway{plastic.length === 1 ? '' : 's'} · {plastic.filter((x) => x.rule === 'reward').length} reward-modulated · {fmt.compact(plastic.reduce((a, x) => a + x.synapses, 0))} synapses</p>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button type="button" className="btn btn--sm btn--amber" onClick={() => void app.reward(1)}>{Icon.reward({ width: 12 })} Reward</button>
        <button type="button" className="btn btn--sm" onClick={() => void app.reward(-1)}>Punish</button>
        <span className="mono dim" style={{ marginLeft: 'auto', fontSize: 11 }} title="Global neuromodulator M(t)">M = {mod.toFixed(3)}</span>
      </div>
    </>
  );
}

export function CameraControls() {
  const app = useApp();
  const flying = useAppState((s) => s.render.flying);
  const touring = useAppState((s) => s.render.touring);
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <button type="button" className={`btn btn--sm ${!flying ? 'btn--primary' : ''}`} onClick={() => flying && app.toggleFly()} title="Orbit: drag to rotate, right-drag to pan, scroll to zoom">{Icon.orbit({ width: 13 })} Orbit</button>
      <button type="button" className={`btn btn--sm ${flying ? 'btn--primary' : ''}`} onClick={() => !flying && app.toggleFly()} title="Free flight: WASD, Q/E, Shift (G)">{Icon.fly({ width: 13 })} Fly</button>
      <button type="button" className={`btn btn--sm ${touring ? 'btn--violet' : ''}`} onClick={() => app.toggleTour()} title="Cinematic auto-exploration (T)">{Icon.tour({ width: 13 })} Tour</button>
      <button type="button" className="btn btn--sm btn--ghost" onClick={() => app.resetView()} title="Reset view (R)">{Icon.reset({ width: 13 })}</button>
    </div>
  );
}

export function BrainPanel() {
  const app = useApp();
  const config = useAppState((s) => s.config);
  const info = useAppState((s) => s.info);
  return (
    <Panel
      title={config?.name ?? 'Brain'}
      meta={info ? `${fmt.compact(info.neurons)} neurons` : undefined}
      className="grow"
      actions={<button type="button" className="icon-btn" aria-label="Brain designer" title="Brain designer" onClick={() => app.openDialog('designer')}>{Icon.sliders()}</button>}
    >
      <Section label="Regions">
        <RegionList />
      </Section>
      <Section label="Visualisation">
        <VizModes />
      </Section>
      <Section label="Camera">
        <CameraControls />
      </Section>
      <Section label="Stimulation" hint="Choose a pattern, then stimulate the selected neuron, its neighbourhood or its region.">
        <StimulusTool />
      </Section>
      <Section label="Learning">
        <LearningControls />
      </Section>
    </Panel>
  );
}
