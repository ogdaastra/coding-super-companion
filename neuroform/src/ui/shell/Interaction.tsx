/** Command palette, context menu, keyboard shortcuts and minimap. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useAppState, useTelemetryTick } from '../../app/context.tsx';
import { buildCommands, score, type Command } from '../../app/commands.ts';
import { APP_MODES } from '../../app/state.ts';
import { VIZ_MODES } from '../../render/vizModes.ts';
import { SPEEDS } from '../../sim/protocol.ts';
import { Icon } from '../icons.tsx';
import { Kbd } from '../primitives.tsx';

export function CommandPalette() {
  const app = useApp();
  const open = useAppState((s) => s.palette);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => input.current?.focus(), 10);
    }
  }, [open]);

  const results = useMemo(() => {
    if (!open) return [];
    const cmds = buildCommands(app);
    // "#1234" or a bare number selects a neuron.
    const m = /^#?(\d+)$/.exec(q.trim());
    const extra: Command[] = [];
    if (m && app.built && Number(m[1]) < app.built.info.neurons) {
      const n = Number(m[1]);
      extra.push({ id: 'goto', group: 'Neuron', label: `Select and focus neuron #${n}`, run: () => app.selectNeuron(n, { focus: true }) });
    }
    return [...extra, ...cmds.map((c) => ({ c, s: score(c, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.c)].slice(0, 60);
  }, [open, q, app]);

  if (!open) return null;
  const run = (c: Command) => {
    app.setPalette(false);
    void Promise.resolve(c.run()).catch((e) => app.toast('error', c.label, String(e)));
  };
  let lastGroup = '';
  return (
    <div className="scrim" style={{ background: 'rgba(1,3,8,0.35)', placeItems: 'start center' }} onPointerDown={(e) => e.target === e.currentTarget && app.setPalette(false)}>
      <div className="palette glass" role="dialog" aria-label="Command palette">
        <input
          ref={input}
          value={q}
          placeholder="Search commands, regions, experiments, or type a neuron number…"
          aria-label="Search commands"
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') app.setPalette(false);
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            }
            if (e.key === 'Enter' && results[active]) run(results[active]);
          }}
        />
        <div className="palette__list" ref={list}>
          {results.length === 0 && <p className="hint" style={{ padding: 12 }}>No matching commands.</p>}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? <div className="palette__group label" key={`g-${c.group}-${i}`}>{c.group}</div> : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header}
                <div className={`palette__item ${i === active ? 'is-active' : ''}`} onPointerEnter={() => setActive(i)} onClick={() => run(c)} ref={(el) => {
                  if (el && i === active) el.scrollIntoView({ block: 'nearest' });
                }}>
                  <span>{c.label}{c.hint && <small>{c.hint}</small>}</span>
                  {c.keys && <Kbd>{c.keys}</Kbd>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ContextMenu() {
  const app = useApp();
  const ctx = useAppState((s) => s.context);
  const info = useAppState((s) => s.info);
  const isolate = useAppState((s) => s.isolate);
  const compare = useAppState((s) => s.selection.compare);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!ctx) return;
    const el = ref.current;
    const w = el?.offsetWidth ?? 220;
    const h = el?.offsetHeight ?? 300;
    setPos({ x: Math.min(ctx.x, innerWidth - w - 8), y: Math.min(ctx.y, innerHeight - h - 8) });
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) app.store.set({ context: null });
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && app.store.set({ context: null });
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', esc);
    };
  }, [ctx, app]);
  if (!ctx || !info) return null;
  const n = ctx.neuron;
  const r = ctx.region;
  const close = () => app.store.set({ context: null });
  const act = (f: () => unknown) => () => {
    close();
    void Promise.resolve(f());
  };
  return (
    <div ref={ref} className="menu glass" style={{ left: pos.x, top: pos.y }} role="menu">
      {n !== null && (
        <>
          <div className="menu__title label">Neuron #{n}</div>
          <button type="button" onClick={act(() => app.selectNeuron(n))}>{Icon.info()} Inspect</button>
          <button type="button" onClick={act(() => app.selectNeuron(n, { focus: true }))}>{Icon.focus()} Focus camera</button>
          <button type="button" onClick={act(() => app.stimulateNeuron(n))}>{Icon.bolt()} Stimulate neuron</button>
          <button type="button" onClick={act(() => app.stimulateAround(n))}>{Icon.target()} Stimulate local population</button>
          <button type="button" onClick={act(() => app.toggleCompare(n))}>{Icon.compare()} {compare.includes(n) ? 'Remove from comparison' : 'Compare'}</button>
          <button type="button" onClick={act(async () => {
            await app.selectNeuron(n);
            app.setViz('local');
          })}>{Icon.network()} Local network</button>
          <button type="button" onClick={act(async () => {
            await app.selectNeuron(n);
            app.setMode('study');
          })}>{Icon.sliders()} Modify parameters</button>
          <hr />
        </>
      )}
      {r !== null && (
        <>
          <div className="menu__title label">{info.regions[r]?.name}</div>
          <button type="button" onClick={act(() => app.selectRegion(r))}>{Icon.info()} Inspect region</button>
          <button type="button" onClick={act(() => app.selectRegion(r, true))}>{Icon.focus()} Focus region</button>
          <button type="button" onClick={act(() => app.stimulateRegion(r))}>{Icon.bolt()} Stimulate region</button>
          <button type="button" onClick={act(() => app.toggleIsolate(r))}>{Icon.eye()} {isolate === r ? 'Stop isolating' : 'Isolate connectivity'}</button>
          <RegionEnable region={r} onDone={close} />
        </>
      )}
      {n === null && r === null && (
        <>
          <button type="button" onClick={act(() => app.resetView())}>{Icon.orbit()} Reset view</button>
          <button type="button" onClick={act(() => app.toggleTour())}>{Icon.tour()} Cinematic tour</button>
        </>
      )}
    </div>
  );
}

function RegionEnable({ region, onDone }: { region: number; onDone: () => void }) {
  const app = useApp();
  useTelemetryTick(500);
  const enabled = app.telemetry.latest?.regions[region]?.enabled ?? true;
  return (
    <button type="button" onClick={() => {
      onDone();
      void app.edits.setRegionEnabled(region, !enabled);
    }}>{enabled ? Icon.eyeOff() : Icon.eye()} {enabled ? 'Disable region' : 'Enable region'}</button>
  );
}

/** Global keyboard shortcuts. */
export function Shortcuts() {
  const app = useApp();
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
    };
    const down = (e: KeyboardEvent) => {
      const s = app.state;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        app.setPalette(!s.palette);
        return;
      }
      if (isTyping(e) || s.palette || s.dialog) return;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void app.projects.saveProject();
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void app.edits.undo();
        return;
      }
      if (mod || e.altKey) return;
      if (s.render.flying && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        app.view?.rig.keyDown(e.code);
        e.preventDefault();
        return;
      }
      const shiftDigit = e.shiftKey && /^Digit[1-9]$/.test(e.code);
      if (shiftDigit) {
        const v = VIZ_MODES[Number(e.code.slice(5)) - 1];
        if (v) app.setViz(v.id);
        return;
      }
      const mode = APP_MODES.find((m) => m.key === e.key);
      if (mode && !e.shiftKey) {
        app.setMode(mode.id);
        return;
      }
      switch (e.key) {
        case ' ':
          e.preventDefault();
          void app.toggleRun();
          break;
        case '.':
          void app.stepBy(1);
          break;
        case '>':
          void app.stepBy(Math.round(10 / s.sim.dt));
          break;
        case 'r':
          app.resetView();
          break;
        case 'R':
          void app.resetSimulation(true);
          break;
        case 'f':
          app.focusSelection();
          break;
        case 'F':
          void app.toggleFullscreen();
          break;
        case 'g':
          app.toggleFly();
          break;
        case 't':
          app.toggleTour();
          break;
        case 's':
          if (s.selection.neuron !== null) void app.stimulateNeuron(s.selection.neuron);
          else if (s.selection.region !== null) void app.stimulateRegion(s.selection.region);
          break;
        case 'p':
          if (s.plasticity.available) void app.setPlasticity(!s.plasticity.enabled);
          break;
        case 'n':
          app.openDialog('designer');
          break;
        case 'm':
          app.togglePanel('minimap');
          break;
        case '[':
          app.togglePanel('left');
          break;
        case ']':
          app.togglePanel('right');
          break;
        case '-':
        case '_': {
          const i = SPEEDS.findIndex((x) => x === s.sim.speed);
          if (i > 0) void app.setSpeed(SPEEDS[i - 1]);
          break;
        }
        case '=':
        case '+': {
          const i = SPEEDS.findIndex((x) => x === s.sim.speed);
          if (i >= 0 && i < SPEEDS.length - 1) void app.setSpeed(SPEEDS[i + 1]);
          break;
        }
        case '?':
          app.openDialog('help');
          break;
        case 'Escape':
          if (s.context) app.store.set({ context: null });
          else if (app.view?.touring) app.view.stopTour();
          else if (s.selection.neuron !== null) void app.selectNeuron(null);
          else if (s.selection.region !== null) app.selectRegion(null);
          else if (s.isolate >= 0) app.toggleIsolate(s.isolate);
          break;
      }
    };
    const up = (e: KeyboardEvent) => app.view?.rig.keyUp(e.code);
    const blur = () => app.view?.rig.clearKeys();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    const fs = () => app.store.set({ fullscreen: !!document.fullscreenElement });
    document.addEventListener('fullscreenchange', fs);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      document.removeEventListener('fullscreenchange', fs);
    };
  }, [app]);
  return null;
}

/** Top-down overview of the brain: regions by activity, pathways, camera and selection. */
export function Minimap() {
  const app = useApp();
  const info = useAppState((s) => s.info);
  const colors = useAppState((s) => s.regionColors);
  const visible = useAppState((s) => s.panels.minimap && s.mode === 'explorer');
  const leftOpen = useAppState((s) => s.panels.left);
  const canvas = useRef<HTMLCanvasElement>(null);
  const geo = useRef({ cx: 0, cz: 0, scale: 1, w: 0, h: 0 });

  useEffect(() => {
    if (!visible || !info) return;
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 66) return;
      last = t;
      const c = canvas.current;
      const view = app.view;
      if (!c || !view) return;
      const dpr = Math.min(2, devicePixelRatio || 1);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== w * dpr) {
        c.width = w * dpr;
        c.height = h * dpr;
      }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const b = view.boundsInfo;
      const scale = (Math.min(w, h - 18) * 0.42) / b.radius;
      const cx = w / 2;
      const cz = h / 2 + 8;
      geo.current = { cx, cz, scale, w, h };
      const X = (x: number) => cx + (x - b.center[0]) * scale;
      const Z = (z: number) => cz + (z - b.center[2]) * scale;
      const rates = app.telemetry.regionRate.map((r) => r.last() || 0);
      const maxRate = Math.max(5, ...rates);
      // Pathways (inter-region), width by measured event rate.
      const pr = app.telemetry.projectionRateSmooth;
      let maxP = 1;
      for (const v of pr) maxP = Math.max(maxP, v);
      info.projections.forEach((p, i) => {
        if (p.from === p.to) return;
        const a = info.regions[p.from].center;
        const bb = info.regions[p.to].center;
        const k = Math.sqrt((pr[i] ?? 0) / maxP);
        ctx.strokeStyle = p.source === 'inhibitory' ? `rgba(255,79,216,${0.1 + 0.5 * k})` : `rgba(56,230,255,${0.08 + 0.55 * k})`;
        ctx.lineWidth = 0.6 + 2.2 * k;
        ctx.beginPath();
        ctx.moveTo(X(a[0]), Z(a[2]));
        ctx.lineTo(X(bb[0]), Z(bb[2]));
        ctx.stroke();
      });
      info.regions.forEach((r, i) => {
        const a = Math.min(1, rates[i] / maxRate);
        ctx.fillStyle = `${colors[i]}${Math.round(30 + a * 140).toString(16).padStart(2, '0')}`;
        ctx.strokeStyle = colors[i];
        ctx.lineWidth = app.state.selection.region === i ? 1.6 : 0.8;
        ctx.beginPath();
        ctx.ellipse(X(r.center[0]), Z(r.center[2]), Math.max(2, r.radius[0] * scale), Math.max(2, r.radius[2] * scale), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
      const sel = app.state.selection.neuron;
      if (sel !== null && app.built) {
        const p = app.built.positions;
        ctx.fillStyle = '#9b7bff';
        ctx.beginPath();
        ctx.arc(X(p[3 * sel]), Z(p[3 * sel + 2]), 3, 0, Math.PI * 2);
        ctx.fill();
      }
      const pose = view.rig.pose();
      const px = X(pose.position[0]);
      const pz = Z(pose.position[2]);
      const ang = Math.atan2(pose.forward[2], pose.forward[0]);
      const inside = px > 0 && px < w && pz > 0 && pz < h;
      const ex = Math.max(6, Math.min(w - 6, px));
      const ez = Math.max(16, Math.min(h - 6, pz));
      ctx.save();
      ctx.translate(ex, ez);
      ctx.rotate(ang);
      ctx.fillStyle = 'rgba(238,246,255,0.18)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 26, -0.42, 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = inside ? '#eef6ff' : '#9aa8c2';
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(-4, 4);
      ctx.lineTo(-4, -4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [visible, info, colors, app]);

  if (!visible || !info) return null;
  return (
    <div className={`minimap glass ${leftOpen ? '' : 'minimap--edge'}`} title="Top-down map: click a region to fly there">
      <span className="label">Map</span>
      <canvas
        ref={canvas}
        onClick={(e) => {
          const g = geo.current;
          const b = app.view?.boundsInfo;
          if (!b) return;
          const x = b.center[0] + (e.nativeEvent.offsetX - g.cx) / g.scale;
          const z = b.center[2] + (e.nativeEvent.offsetY - g.cz) / g.scale;
          let best = -1;
          let bd = Infinity;
          info.regions.forEach((r, i) => {
            const d = ((x - r.center[0]) / r.radius[0]) ** 2 + ((z - r.center[2]) / r.radius[2]) ** 2;
            if (d < bd) {
              bd = d;
              best = i;
            }
          });
          if (best >= 0) app.selectRegion(best, true);
        }}
      />
    </div>
  );
}
