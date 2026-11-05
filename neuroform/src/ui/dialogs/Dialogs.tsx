/** Projects, settings, help, export and benchmark dialogs. */

import { Fragment, useEffect, useState } from 'react';
import { useApp, useAppState } from '../../app/context.tsx';
import { storageEstimate, type ProjectRecord, type RecordingRecord, type SnapshotRecord } from '../../persistence/db.ts';
import { formatBytes } from '../../config/adjust.ts';
import { QUALITY_ORDER } from '../../render/quality.ts';
import { TIERS } from '../../config/presets.ts';
import type { BenchmarkResult } from '../../sim/protocol.ts';
import { platform, timestampName } from '../../platform/platform.ts';
import { Dialog, Empty, Section, Segmented, Select, ToggleRow, fmt } from '../primitives.tsx';
import { Icon } from '../icons.tsx';
import { DesignerDialog } from './DesignerDialog.tsx';

function ProjectsDialog() {
  const app = useApp();
  const project = useAppState((s) => s.project);
  const seq = useAppState((s) => s.librarySeq);
  const storage = useAppState((s) => s.storage);
  const [tab, setTab] = useState<'projects' | 'snapshots' | 'recordings'>('projects');
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [snaps, setSnaps] = useState<SnapshotRecord[]>([]);
  const [recs, setRecs] = useState<RecordingRecord[]>([]);
  const [est, setEst] = useState<Awaited<ReturnType<typeof storageEstimate>>>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [name, setName] = useState(project?.name ?? '');
  useEffect(() => {
    void app.db.listProjects().then(setProjects).catch(() => {});
    if (project) {
      void app.db.listSnapshots(project.id).then(setSnaps).catch(() => {});
      void app.db.listRecordings(project.id).then(setRecs).catch(() => {});
    }
    void storageEstimate().then(setEst);
  }, [app, project, seq]);
  return (
    <Dialog title="Projects" meta={storage.persistent ? 'stored in this browser' : 'storage unavailable: session only'} onClose={() => app.openDialog(null)} size="wide">
      {!storage.persistent && <div className="intro__error">IndexedDB is not available ({storage.reason}). Work will be lost when the tab closes; export what you want to keep.</div>}
      {project && (
        <Section label="Current project">
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label="Project name" />
            <button type="button" className="btn" onClick={() => void app.projects.renameProject(name)}>Rename</button>
            <button type="button" className="btn btn--primary" onClick={() => void app.projects.saveProject()}>{Icon.save({ width: 13 })} Save</button>
            <button type="button" className="btn" onClick={() => void app.projects.takeSnapshot()}>{Icon.camera({ width: 13 })} Snapshot</button>
          </div>
        </Section>
      )}
      <Segmented value={tab} onChange={setTab} options={[{ value: 'projects', label: `Projects ${projects.length}` }, { value: 'snapshots', label: `Snapshots ${snaps.length}` }, { value: 'recordings', label: `Recordings ${recs.length}` }]} />
      <div style={{ height: 10 }} />
      {tab === 'projects' && (projects.length === 0 ? <Empty>No saved projects yet.</Empty> : (
        <div className="list">
          {projects.map((p) => (
            <div key={p.id} className={`list__item ${p.id === project?.id ? 'is-selected' : ''}`} onClick={async () => {
              app.openDialog(null);
              await app.projects.openProject(p.id, { run: true });
            }}>
              {Icon.brain({ width: 16 })}
              <div style={{ minWidth: 0 }}>
                <div className="list__name">{p.name}</div>
                <div className="dim" style={{ fontSize: 10.5 }}>{fmt.int(p.config.regions.reduce((a, r) => a + r.count, 0))} neurons · seed {p.config.seed} · {new Date(p.updatedAt).toLocaleString('en-GB')}</div>
              </div>
              <div style={{ display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                <button type="button" className="icon-btn" aria-label="Duplicate" title="Duplicate" onClick={() => void app.projects.duplicateProject(p.id)}>{Icon.plus({ width: 13 })}</button>
                <button type="button" className="icon-btn" aria-label="Export configuration" title="Export configuration" onClick={() => void app.projects.exportConfig(p.config)}>{Icon.download({ width: 13 })}</button>
                {confirm === p.id ? (
                  <button type="button" className="btn btn--sm btn--danger" onClick={() => {
                    setConfirm(null);
                    void app.projects.deleteProject(p.id);
                  }}>Delete with its snapshots?</button>
                ) : (
                  <button type="button" className="icon-btn" aria-label="Delete" title="Delete" onClick={() => setConfirm(p.id)}>{Icon.trash({ width: 13 })}</button>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
      {tab === 'snapshots' && (snaps.length === 0 ? <Empty>No snapshots for this project. A snapshot stores the complete simulation state (membrane potentials, currents, queued events, every weight) so you can return to this exact moment.</Empty> : (
        <div className="list">
          {snaps.map((s) => (
            <div key={s.id} className="list__item" onClick={async () => {
              app.openDialog(null);
              await app.projects.restoreSnapshot(s.id);
            }}>
              {Icon.camera({ width: 16 })}
              <div style={{ minWidth: 0 }}>
                <div className="list__name">{s.name}</div>
                <div className="dim" style={{ fontSize: 10.5 }}>t = {fmt.time(s.timeMs)} · {formatBytes(s.size)} · {new Date(s.createdAt).toLocaleString('en-GB')}</div>
              </div>
              <div style={{ display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                <button type="button" className="icon-btn" aria-label="Export snapshot" title="Export .nfsnap" onClick={() => void app.projects.exportSnapshot(s.id)}>{Icon.download({ width: 13 })}</button>
                <button type="button" className="icon-btn" aria-label="Delete snapshot" onClick={() => void app.projects.deleteSnapshot(s.id)}>{Icon.trash({ width: 13 })}</button>
              </div>
            </div>
          ))}
        </div>
      ))}
      {tab === 'recordings' && (recs.length === 0 ? <Empty>No recordings. Press the record button in the dock to capture every spike and measurement; recordings can be replayed and exported. A recording shows what happened — it does not restore the network state.</Empty> : (
        <div className="list">
          {recs.map((r) => (
            <div key={r.id} className="list__item" onClick={async () => {
              app.openDialog(null);
              await app.playback.open(r.id, r.name);
            }}>
              {Icon.history({ width: 16 })}
              <div style={{ minWidth: 0 }}>
                <div className="list__name">{r.name}</div>
                <div className="dim" style={{ fontSize: 10.5 }}>{fmt.time(r.durationMs)} simulated · {fmt.compact(r.spikes)} spikes · {formatBytes(r.size)}</div>
              </div>
              <div style={{ display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                <button type="button" className="icon-btn" aria-label="Export recording" onClick={() => void app.projects.exportRecording(r.id, r.name)}>{Icon.download({ width: 13 })}</button>
                <button type="button" className="icon-btn" aria-label="Delete recording" onClick={() => void app.projects.deleteRecording(r.id)}>{Icon.trash({ width: 13 })}</button>
              </div>
            </div>
          ))}
        </div>
      ))}
      <Section label="Storage">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="mono dim" style={{ fontSize: 11 }}>{est ? `${formatBytes(est.usage)} used of ${formatBytes(est.quota)}${est.persisted ? ' · persistent' : ''}` : 'Usage not reported by this browser'}</span>
          {est && !est.persisted && navigator.storage?.persist && <button type="button" className="btn btn--sm" onClick={async () => {
            const ok = await navigator.storage.persist();
            app.toast(ok ? 'success' : 'info', ok ? 'Storage marked persistent' : 'The browser declined persistent storage', ok ? 'The browser will not evict NEUROFORM data under storage pressure.' : 'Data may be evicted if the device runs low on space; export important work.');
            setEst(await storageEstimate());
          }}>Request persistent storage</button>}
          <button type="button" className="btn btn--sm" onClick={() => void app.projects.exportProjectBundle()}>{Icon.download({ width: 12 })} Download project data</button>
          <button type="button" className="btn btn--sm" onClick={() => void app.projects.pickAndImport()}>{Icon.upload({ width: 12 })} Import file</button>
        </div>
      </Section>
    </Dialog>
  );
}

function SettingsDialog() {
  const app = useApp();
  const render = useAppState((s) => s.render);
  const hz = useAppState((s) => s.telemetryHz);
  const [caps, setCaps] = useState<{ webgpu: boolean; sab: boolean; isolated: boolean; sw: boolean }>({ webgpu: false, sab: false, isolated: false, sw: false });
  useEffect(() => {
    setCaps({ webgpu: 'gpu' in navigator, sab: typeof SharedArrayBuffer !== 'undefined', isolated: self.crossOriginIsolated === true, sw: !!navigator.serviceWorker?.controller });
  }, []);
  return (
    <Dialog title="Settings" onClose={() => app.openDialog(null)} size="narrow">
      <Section label="Graphics backend" hint={`Running on ${render.backend ?? '—'}. WebGPU is preferred when available; WebGL2 is the compatibility path. Switching restarts the renderer only — the simulation keeps running.`}>
        <Segmented value={render.preference} onChange={(v) => void app.setBackend(v)} options={[{ value: 'auto', label: 'Automatic' }, { value: 'webgpu', label: 'WebGPU' }, { value: 'webgl2', label: 'WebGL2' }]} />
      </Section>
      <Section label="Rendering quality" hint="Affects only what is drawn (resolution, displayed synapses and pulses, bloom), never the simulation.">
        <Segmented value={render.quality} onChange={(q) => void app.setQuality(q)} options={QUALITY_ORDER.map((q) => ({ value: q, label: q[0].toUpperCase() + q.slice(1) }))} />
        <ToggleRow label="Adaptive quality (reduce detail when frames are slow)" checked={render.adaptive} onChange={(v) => void app.setAdaptive(v)} />
        <ToggleRow label="Reduce interface effects (no translucent blur)" checked={render.reducedEffects} onChange={(v) => app.store.set((s) => ({ render: { ...s.render, reducedEffects: v } }))} />
      </Section>
      <Section label="Telemetry" hint="How often the worker sends measurements to the interface. Lower values reduce main-thread work on slow devices; values are always exact for each window.">
        <Select value={hz} onChange={(v) => void app.setTelemetryHz(v)} options={[2, 5, 10, 15, 20, 30].map((v) => ({ value: v, label: `${v} Hz` }))} />
      </Section>
      <DesktopAppSection />
      <Section label="This browser">
        <dl className="kv">
          <dt>WebGPU API</dt><dd>{caps.webgpu ? 'available' : 'not available'}</dd>
          <dt>Cross-origin isolated</dt><dd>{caps.isolated ? 'yes' : 'no (not required)'}</dd>
          <dt>SharedArrayBuffer</dt><dd>{caps.sab ? 'available' : 'not available (not required)'}</dd>
          <dt>Offline cache</dt><dd>{caps.sw ? 'active' : import.meta.env.DEV ? 'disabled in development' : 'installs after first load'}</dd>
          <dt>Logical cores</dt><dd>{navigator.hardwareConcurrency ?? '—'}</dd>
        </dl>
      </Section>
    </Dialog>
  );
}

function DesktopAppSection() {
  const app = useApp();
  const install = useAppState((s) => s.install);
  const text: Record<typeof install, string> = {
    app: 'Running as an installed app in its own window. Everything works offline; when you are online, updates are picked up automatically.',
    installed: 'Installed. Open NEUROFORM from your desktop, Start menu, Dock or Applications folder. It works offline.',
    available: 'Install NEUROFORM as an app: it gets its own window and a desktop or Start-menu icon, and works offline. Your projects stay in this browser profile.',
    unavailable: 'Your browser is not offering installation right now. If NEUROFORM is already installed, open it from your desktop or Start menu. Otherwise: in Chrome or Edge, use the install icon at the right of the address bar or the browser menu; in Safari on macOS, choose File → Add to Dock. Firefox does not install web apps on most platforms.',
  };
  return (
    <Section label="Desktop app" hint={text[install]}>
      {install === 'available' && (
        <button type="button" className="btn btn--primary" onClick={() => void app.installApp()}>
          {Icon.install({ width: 15, height: 15 })} Install app
        </button>
      )}
    </Section>
  );
}

function HelpDialog() {
  const app = useApp();
  const keys: [string, string][] = [
    ['Space', 'Run / pause'], ['.', 'Single step'], ['Shift .', 'Advance 10 ms'], ['Shift R', 'Reset simulation'], ['− / +', 'Slower / faster'],
    ['1 – 6', 'Application modes'], ['Shift 1 – 9', 'Visualisation modes'], ['⌘K / Ctrl K', 'Command palette'],
    ['R', 'Reset view'], ['F', 'Focus selection'], ['G', 'Free flight (WASD, Q/E, Shift)'], ['T', 'Cinematic tour'], ['Shift F', 'Full screen'],
    ['S', 'Stimulate selection'], ['P', 'Toggle plasticity'], ['N', 'Brain designer'], ['M', 'Minimap'], ['[ / ]', 'Left / right panel'],
    ['Ctrl Z', 'Undo parameter change'], ['Ctrl S', 'Save project'], ['Esc', 'Clear selection / close'],
  ];
  return (
    <Dialog title="NEUROFORM" meta="help" onClose={() => app.openDialog(null)} size="wide">
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 24 }}>
        <div>
          <Section label="Navigation">
            <p className="hint" style={{ color: 'var(--text-2)' }}>Drag to orbit · right-drag or Shift-drag to pan · scroll or pinch to zoom · click a neuron to inspect it · double-click to fly to it · right-click for actions. Click a region label or the minimap to frame a region.</p>
          </Section>
          <Section label="Keyboard">
            <dl className="kv">{keys.map(([k, v]) => <Fragment key={k}><dt><span className="kbd">{k}</span></dt><dd style={{ textAlign: 'left', fontFamily: 'var(--font-ui)' }}>{v}</dd></Fragment>)}</dl>
          </Section>
        </div>
        <div>
          <Section label="What you are looking at">
            <p className="hint" style={{ color: 'var(--text-2)' }}>Every point is a simulated neuron and every line a synapse stored in the engine. A flash is a real spike: the neuron's membrane potential crossed its threshold in the WebAssembly engine. A travelling pulse follows a real displayed synapse of a neuron that fired; its target receives the event after the synapse's delay. Pulses are slowed down when the simulation runs fast so they stay visible — the HUD reports by how much. Only a sample of synapses is drawn at a time; the rest still exist and still transmit.</p>
          </Section>
          <Section label="The model">
            <p className="hint" style={{ color: 'var(--text-2)' }}>Leaky integrate-and-fire neurons: dV/dt = (V_rest − V)/τ_m + R_m·ε·I, integrated exactly for input held constant over each step. Spikes at V ≥ V_th reset V to V_reset for the refractory period. Synaptic events arrive after per-synapse delays and add to exponentially decaying excitatory or inhibitory currents. STDP uses pre- and postsynaptic traces; reward-modulated STDP accumulates eligibility that a global neuromodulator converts into weight changes. Full equations: docs/SIMULATION.md.</p>
          </Section>
          <Section label="Formats">
            <p className="hint" style={{ color: 'var(--text-2)' }}>A configuration (.neuroform.json) recreates a network. A snapshot (.nfsnap) restores a network's exact state. A recording (.nfrec) stores spikes and measurements for playback and analysis but cannot restore state.</p>
          </Section>
        </div>
      </div>
    </Dialog>
  );
}

function ExportDialog() {
  const app = useApp();
  const info = useAppState((s) => s.info);
  const items: [string, string, () => Promise<void>][] = [
    ['Configuration', 'JSON · recreates this network', () => app.projects.exportConfig()],
    ['Current state snapshot', 'Binary .nfsnap · restores this exact moment', () => app.projects.exportCurrentState()],
    ['Neuron statistics', 'CSV · position, class, threshold, degrees, spike counts', () => app.projects.exportNeurons()],
    ['Synapse data', `${info && info.synapses > 1_500_000 ? 'Binary .nfsyn' : 'CSV'} · every synapse: pre, post, weight, delay, pathway`, () => app.projects.exportSynapses()],
    ['Spike history', 'CSV · recorded raster rows', () => app.projects.exportSpikes()],
    ['Telemetry', 'CSV · rates, membrane, synchrony, per-region rates over time', () => app.projects.exportTelemetry()],
    ['Project data', 'JSON · project, experiment results, snapshot and recording index', () => app.projects.exportProjectBundle()],
  ];
  return (
    <Dialog title="Import & export" onClose={() => app.openDialog(null)} size="narrow">
      <div className="list">
        {items.map(([title, note, run]) => (
          <div key={title} className="list__item" onClick={() => void run().catch((e) => app.toast('error', `${title} export failed`, String(e)))}>
            {Icon.download({ width: 16 })}
            <div><div className="list__name">{title}</div><div className="dim" style={{ fontSize: 10.5 }}>{note}</div></div>
            <span />
          </div>
        ))}
      </div>
      <Section label="Import" hint="Configurations open as a new project; snapshots rebuild their network and restore its state; recordings are added to the current project.">
        <button type="button" className="btn btn--primary" onClick={() => {
          app.openDialog(null);
          void app.projects.pickAndImport();
        }}>{Icon.upload({ width: 13 })} Choose file…</button>
      </Section>
    </Dialog>
  );
}

function BenchmarkDialog() {
  const app = useApp();
  const [sizes, setSizes] = useState<number[]>([2000, 5000, 10000, 25000]);
  const [seconds, setSeconds] = useState(2);
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => app.client.on('benchmark', (r) => setResults((x) => [...x, r])), [app]);
  return (
    <Dialog title="Engine benchmark" meta="this device, this browser" onClose={() => !busy && app.openDialog(null)} size="wide">
      <p className="hint">Builds the Neural Observatory brain at each size in the simulation worker, runs it as fast as possible and measures. The live network is paused (not modified) while this runs. Rendering is not included; see Performance for frame rates.</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {TIERS.map((t) => (
          <button key={t.id} type="button" className={`chip ${sizes.includes(t.neurons) ? 'chip--cyan' : ''}`} onClick={() => setSizes(sizes.includes(t.neurons) ? sizes.filter((s) => s !== t.neurons) : [...sizes, t.neurons].sort((a, b) => a - b))}>{t.label} · {fmt.compact(t.neurons)}</button>
        ))}
        <span style={{ marginLeft: 'auto' }}><Segmented value={seconds} onChange={setSeconds} options={[{ value: 1, label: '1 s' }, { value: 2, label: '2 s' }, { value: 5, label: '5 s' }]} /></span>
      </div>
      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <button type="button" className="btn btn--primary" disabled={busy || !sizes.length} onClick={async () => {
          setBusy(true);
          setResults([]);
          try {
            await app.client.request('benchmark', { sizes, seconds });
          } catch (e) {
            app.toast('error', 'Benchmark failed', String(e));
          } finally {
            setBusy(false);
          }
        }}>{busy ? 'Running…' : 'Run benchmark'}</button>
        <button type="button" className="btn" disabled={!results.length} onClick={() => void platform.save(timestampName('neuroform-benchmark', 'json'), JSON.stringify({ userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency, results }, null, 2), 'application/json')}>{Icon.download({ width: 13 })} Save results</button>
      </div>
      <div className="table-wrap" style={{ maxHeight: 360 }}>
        <table className="table">
          <thead><tr><th className="r">Neurons</th><th className="r">Synapses</th><th className="r">Build</th><th className="r">ms per sim-s</th><th className="r">Real-time ×</th><th className="r">Events/s</th><th className="r">Mean rate</th><th className="r">Memory</th></tr></thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.neurons}><td className="r">{fmt.int(r.neurons)}</td><td className="r">{fmt.compact(r.synapses)}</td><td className="r">{r.buildMs.toFixed(0)} ms</td><td className="r">{r.msPerSimSecond.toFixed(0)}</td><td className="r" style={{ color: r.realtimeFactor >= 1 ? 'var(--ok)' : 'var(--amber)' }}>{r.realtimeFactor.toFixed(2)}</td><td className="r">{fmt.compact(r.eventsPerSecond)}</td><td className="r">{r.meanRateHz.toFixed(1)} Hz</td><td className="r">{formatBytes(r.memoryBytes)}</td></tr>
            ))}
            {busy && <tr><td colSpan={8} className="text dim">Measuring…</td></tr>}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

export function Dialogs() {
  const dialog = useAppState((s) => s.dialog);
  switch (dialog) {
    case 'designer':
      return <DesignerDialog />;
    case 'projects':
      return <ProjectsDialog />;
    case 'settings':
      return <SettingsDialog />;
    case 'help':
      return <HelpDialog />;
    case 'export':
      return <ExportDialog />;
    case 'benchmark':
      return <BenchmarkDialog />;
    default:
      return null;
  }
}
