/** HUD chips, banners, build overlay, toasts, fatal error and intro. */

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../app/store.ts';
import { useApp, useAppState } from '../../app/context.tsx';
import { Icon } from '../icons.tsx';
import { fmt } from '../primitives.tsx';
import { structuralChanges } from '../../config/adjust.ts';
import { BrandMark } from './TopBar.tsx';
import { VIZ_MODES } from '../../render/vizModes.ts';

export function Hud() {
  const render = useAppState((s) => s.render);
  const sim = useAppState((s) => s.sim);
  const isolate = useAppState((s) => s.isolate);
  const info = useAppState((s) => s.info);
  const viz = useAppState((s) => s.viz);
  const mode = useAppState((s) => s.mode);
  const st = render.stats;
  const dil = st?.pulseDilation ?? 1;
  return (
    <div className="hud" aria-live="polite" data-mode={mode}>
      {render.backend && <span className="chip" title="Graphics backend">{render.backend}</span>}
      {st && <span className="chip mono" title="Rendered frames per second">{st.fps.toFixed(0)} FPS</span>}
      {viz !== 'normal' && <span className="chip chip--cyan">{VIZ_MODES.find((v) => v.id === viz)?.label}</span>}
      {st?.adaptiveActive && <span className="chip chip--amber" title="Rendering detail reduced to keep the frame rate up; the simulation is unaffected">Adaptive quality · level {st.adaptiveLevel}</span>}
      {sim.status === 'running' && Number.isFinite(dil) && dil > 1.5 && <span className="chip" title="Spikes are real; their travel along synapses is slowed down to be visible">Pulses shown ≈{dil > 100 ? '100+' : dil.toFixed(0)}× slower than real</span>}
      {sim.status === 'running' && !Number.isFinite(dil) && <span className="chip" title="At maximum speed pulses are shown with a fixed visible duration">Pulse travel slowed for visibility</span>}
      {sim.lagging && <span className="chip chip--amber">Simulation below requested speed</span>}
      {render.flying && <span className="chip chip--violet">Free flight · WASD QE</span>}
      {render.touring && <span className="chip chip--violet">Tour · {render.touring}</span>}
      {isolate >= 0 && info && <span className="chip chip--violet">Isolated · {info.regions[isolate]?.name}</span>}
    </div>
  );
}

export function Banners() {
  const app = useApp();
  const draft = useAppState((s) => s.draft);
  const config = useAppState((s) => s.config);
  const playback = useAppState((s) => s.playback);
  const lab = useLab();
  if (playback) {
    return (
      <div className="banner glass banner--violet" role="status">
        <span className="chip chip--violet"><span className="dot" />PLAYBACK</span>
        <span className="banner__text"><strong>{playback.name}</strong> · replaying recorded spikes · {fmt.time(playback.t - playback.start)} / {fmt.time(playback.end - playback.start)}</span>
        <input className="range playback-track" type="range" min={playback.start} max={playback.end} step={0.5} value={playback.t} onChange={(e) => app.playback.seek(Number(e.target.value))} aria-label="Playback position" />
        <button type="button" className="btn btn--sm" onClick={() => app.playback.setPlaying(!playback.playing)}>{playback.playing ? 'Pause' : 'Play'}</button>
        <select className="select" style={{ width: 78, height: 24 }} value={playback.speed} onChange={(e) => app.playback.setSpeed(Number(e.target.value))} aria-label="Playback speed">
          {[0.05, 0.1, 0.25, 0.5, 1, 2].map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
        <button type="button" className="btn btn--sm btn--primary" onClick={() => app.playback.stop()}>Back to live</button>
      </div>
    );
  }
  if (lab.run?.status === 'running') {
    const def = app.experiments.definition(lab.run.experimentId);
    return (
      <div className="banner glass banner--amber" role="status">
        <span className="chip chip--amber"><span className="dot dot--pulse" />EXPERIMENT {def.letter}</span>
        <span className="banner__text"><strong>{def.name}</strong> · {lab.run.label}</span>
        <div className="bar" style={{ width: 120 }}><i style={{ width: `${lab.run.progress * 100}%` }} /></div>
        <button type="button" className="btn btn--sm btn--danger" onClick={() => app.experiments.abort()}>Stop</button>
      </div>
    );
  }
  if (draft && config) {
    const changes = structuralChanges(config, draft);
    return (
      <div className="banner glass banner--amber" role="status">
        <span className="chip chip--amber">REBUILD REQUIRED</span>
        <span className="banner__text" title={changes.join('\n')}><strong>{changes.length} structural change{changes.length === 1 ? '' : 's'}</strong> · {changes.slice(0, 2).join(' · ')}{changes.length > 2 ? '…' : ''}</span>
        <button type="button" className="btn btn--sm" onClick={() => app.openDialog('designer')}>Review</button>
        <button type="button" className="btn btn--sm" onClick={async () => {
          await app.projects.takeSnapshot('Before rebuild');
          await app.buildNetwork(draft, {});
          app.projects.scheduleAutosave();
        }}>Snapshot & rebuild</button>
        <button type="button" className="btn btn--sm btn--primary" onClick={async () => {
          await app.buildNetwork(draft, {});
          app.projects.scheduleAutosave();
        }}>Rebuild</button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => app.store.set({ draft: null })}>Discard</button>
      </div>
    );
  }
  return null;
}

export function useLab() {
  const app = useApp();
  return useStore(app.experiments.store, (s) => s);
}

export function BuildOverlay() {
  const build = useAppState((s) => s.build);
  const intro = useAppState((s) => s.intro.visible);
  if (!build.active || intro) return null;
  return (
    <div className="build-overlay glass" role="status">
      <span className="label">Generating network</span>
      <div className="intro__progress"><i style={{ width: `${Math.max(3, build.progress * 100)}%` }} /></div>
      <span className="mono dim" style={{ fontSize: 11 }}>{build.detail}</span>
    </div>
  );
}

export function Toasts() {
  const app = useApp();
  const toasts = useAppState((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast glass toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span className="dot" />
          <div>
            <div className="toast__title">{t.title}</div>
            {t.detail && <div className="toast__detail">{t.detail}</div>}
            {t.action && <button type="button" className="btn btn--sm" style={{ marginTop: 6 }} onClick={() => { t.action!.run(); app.dismissToast(t.id); }}>{t.action.label}</button>}
          </div>
          <button type="button" className="icon-btn" style={{ width: 22, height: 22 }} aria-label="Dismiss" onClick={() => app.dismissToast(t.id)}>{Icon.close({ width: 12, height: 12 })}</button>
        </div>
      ))}
    </div>
  );
}

export function FatalOverlay() {
  const app = useApp();
  const crashed = useAppState((s) => s.workerCrashed);
  const fatal = useAppState((s) => s.fatal);
  const renderError = useAppState((s) => s.render.error);
  const ready = useAppState((s) => s.ready);
  const [busy, setBusy] = useState(false);
  if (renderError && ready) {
    return (
      <div className="fatal">
        <section className="panel glass">
          <header className="panel__head"><h2>Graphics unavailable</h2></header>
          <div className="panel__body">
            <p className="hint" style={{ color: 'var(--text-2)' }}>{renderError}</p>
            <p className="hint">The simulation is still running in the background. You can retry with the WebGL2 backend.</p>
            <button type="button" className="btn btn--primary" onClick={() => void app.restartRenderer('webgl2')}>Retry with WebGL2</button>
          </div>
        </section>
      </div>
    );
  }
  if (!crashed) return null;
  return (
    <div className="fatal">
      <section className="panel glass">
        <header className="panel__head"><h2>The simulation engine stopped</h2></header>
        <div className="panel__body">
          <p className="hint" style={{ color: 'var(--text-2)' }}>{fatal ?? 'The background worker failed.'}</p>
          <p className="hint">Restarting creates a fresh engine and rebuilds the current configuration. Saved snapshots can then be restored from Projects.</p>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              await app.restartEngine();
            } finally {
              setBusy(false);
            }
          }}>{busy ? 'Restarting…' : 'Restart engine'}</button>
        </div>
      </section>
    </div>
  );
}

/** Introductory loading sequence: real boot steps with a brand animation. */
export function Intro() {
  const app = useApp();
  const intro = useAppState((s) => s.intro);
  const ready = useAppState((s) => s.ready);
  const build = useAppState((s) => s.build);
  const [leaving, setLeaving] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (ready && intro.visible) {
      const t = window.setTimeout(() => setLeaving(true), 650);
      const t2 = window.setTimeout(() => app.dismissIntro(), 1550);
      return () => {
        window.clearTimeout(t);
        window.clearTimeout(t2);
      };
    }
  }, [ready, intro.visible, app]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    // Brand motif: slowly rotating orbital rings with a breathing core.
    const nodes = Array.from({ length: 90 }, (_, i) => ({ a: (i / 90) * Math.PI * 2 * 7.3, r: 80 + ((i * 37) % 170), s: 0.05 + ((i * 13) % 7) / 90, z: ((i * 29) % 100) / 100 }));
    const tick = (t: number) => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== w * dpr) {
        c.width = w * dpr;
        c.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2 - 40;
      const time = t / 1000;
      ctx.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        ctx.strokeStyle = `rgba(56,230,255,${0.05 + k * 0.02})`;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 120 + k * 70, 34 + k * 20, time * 0.05 * (k % 2 ? -1 : 1), 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const n of nodes) {
        const a = n.a + time * n.s;
        const x = cx + Math.cos(a) * n.r * 1.6;
        const y = cy + Math.sin(a) * n.r * 0.42;
        const pulse = 0.5 + 0.5 * Math.sin(time * 2 + n.a * 3);
        ctx.fillStyle = n.z > 0.8 ? `rgba(155,123,255,${0.35 + 0.4 * pulse})` : `rgba(56,230,255,${0.18 + 0.5 * pulse * n.z})`;
        ctx.beginPath();
        ctx.arc(x, y, 1 + n.z * 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 90);
      g.addColorStop(0, `rgba(56,230,255,${0.16 + 0.05 * Math.sin(time * 1.4)})`);
      g.addColorStop(1, 'rgba(56,230,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - 100, cy - 100, 200, 200);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!intro.visible) return null;
  const buildPct = build.active ? build.progress : 0;
  const progress = Math.min(1, intro.progress + (build.active ? buildPct / intro.steps.length : 0));
  return (
    <div className={`intro ${leaving ? 'is-leaving' : ''}`} role="dialog" aria-label="Loading NEUROFORM">
      <canvas ref={canvas} className="intro__canvas" aria-hidden="true" />
      <div className="intro__content">
        <BrandMark />
        <div>
          <div className="intro__wordmark">NEUROFORM</div>
          <div className="intro__tagline">The Neural Observatory</div>
        </div>
        <div className="intro__progress"><i style={{ width: `${Math.max(4, progress * 100)}%` }} /></div>
        <div className="intro__steps">
          {intro.steps.map((s) => (
            <div key={s.id} className={`intro__step is-${s.state}`}>
              <span className="intro__glyph" />
              <span>{s.label}</span>
              <span className="detail">{s.id === 'network' && build.active ? build.detail : s.detail ?? ''}</span>
            </div>
          ))}
        </div>
        {intro.error && (
          <div className="intro__error" role="alert">
            <strong>NEUROFORM could not start.</strong>
            <div style={{ marginTop: 6 }}>{intro.error}</div>
            <div style={{ marginTop: 8, color: 'var(--text-2)' }}>NEUROFORM needs WebAssembly, Web Workers and WebGL2 or WebGPU. Try an up-to-date Chrome, Edge, Firefox or Safari, and check that hardware acceleration is enabled.</div>
            <button type="button" className="btn btn--sm" style={{ marginTop: 10 }} onClick={() => location.reload()}>Reload</button>
          </div>
        )}
      </div>
      {!intro.error && (
        <button type="button" className="btn btn--ghost intro__skip" onClick={() => app.dismissIntro()}>
          Skip intro {Icon.chevron({ width: 12, height: 12 })}
        </button>
      )}
    </div>
  );
}
