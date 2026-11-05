/**
 * The 3D viewport: hosts the canvas and translates pointer, wheel and touch input
 * into camera motion, picking, hover and context menus. Listeners live on the
 * container so a renderer restart (new canvas) keeps working.
 */

import { useEffect, useRef, useState } from 'react';
import { useApp, useAppState } from '../../app/context.tsx';

export function Viewport() {
  const app = useApp();
  const host = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState('');
  const hover = useAppState((s) => s.hover);

  useEffect(() => {
    if (!canvasRef.current || !labelsRef.current) return;
    app.onCanvasReplaced = (c) => {
      canvasRef.current = c;
    };
    void app.boot(canvasRef.current, labelsRef.current);
    app.startPolling();
  }, [app]);

  useEffect(() => {
    const el = host.current!;
    const pointers = new Map<number, { x: number; y: number }>();
    let down: { x: number; y: number; button: number; shift: boolean; moved: boolean; t: number } | null = null;
    let pinch: { d: number; cx: number; cy: number } | null = null;
    let lastHover = 0;
    let lastClick = 0;

    const local = (e: PointerEvent | MouseEvent | WheelEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const isUi = (e: Event) => (e.target as HTMLElement).closest('.region-label') !== null;

    const onDown = (e: PointerEvent) => {
      if (isUi(e)) return;
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      app.store.set({ context: null });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        down = null;
        return;
      }
      down = { ...local(e), button: e.button, shift: e.shiftKey, moved: false, t: performance.now() };
    };

    const onMove = (e: PointerEvent) => {
      const view = app.view;
      if (!view) return;
      const prev = pointers.get(e.pointerId);
      if (prev) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        view.rig.zoomBy((pinch.d - d) * 4);
        view.rig.panBy(cx - pinch.cx, cy - pinch.cy, el.clientHeight);
        pinch = { d, cx, cy };
        return;
      }
      if (down && prev) {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        const p = local(e);
        if (!down.moved && Math.hypot(p.x - down.x, p.y - down.y) > 4) {
          down.moved = true;
          setCursor('is-grabbing');
          app.setHover(null);
        }
        if (down.moved) {
          const pan = down.button === 1 || down.button === 2 || down.shift;
          if (pan) view.rig.panBy(dx, dy, el.clientHeight);
          else view.rig.orbitBy(dx, dy);
        }
        return;
      }
      // Hover picking, throttled.
      const now = performance.now();
      if (now - lastHover < 50) return;
      lastHover = now;
      const p = local(e);
      const i = view.pick(p.x, p.y, 8);
      if (i === null) {
        if (app.state.hover) app.setHover(null);
        setCursor('');
      } else {
        app.setHover({ neuron: i, x: p.x, y: p.y });
        setCursor('is-pointing');
      }
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      const d = down;
      down = null;
      setCursor('');
      if (!d || d.moved || d.button !== 0) return;
      const view = app.view;
      if (!view) return;
      const p = local(e);
      const i = view.pick(p.x, p.y, 10);
      const now = performance.now();
      const dbl = now - lastClick < 320;
      lastClick = now;
      if (i !== null) {
        void app.selectNeuron(i, { focus: dbl });
      } else if (!dbl) {
        void app.selectNeuron(null);
        if (!e.shiftKey) app.selectRegion(null);
      } else {
        app.resetView();
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (isUi(e)) return;
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 30 : e.deltaMode === 2 ? 300 : 1;
      app.view?.rig.zoomBy(e.deltaY * scale);
    };

    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      const view = app.view;
      if (!view) return;
      const p = local(e);
      const i = view.pick(p.x, p.y, 10);
      const region = i !== null ? (app.built?.regionOf[i] ?? null) : app.state.selection.region;
      app.store.set({ context: { x: e.clientX, y: e.clientY, neuron: i, region }, palette: false });
    };

    const onLabel = (e: MouseEvent) => {
      const label = (e.target as HTMLElement).closest('.region-label') as HTMLElement | null;
      if (!label) return;
      const r = Number(label.dataset.region);
      if (e.type === 'contextmenu') {
        e.preventDefault();
        app.store.set({ context: { x: e.clientX, y: e.clientY, neuron: null, region: r } });
      } else {
        app.selectRegion(r, true);
      }
    };

    const onLeave = () => app.setHover(null);
    const onResize = () => app.view?.resize();
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContext);
    labelsRef.current?.addEventListener('click', onLabel);
    labelsRef.current?.addEventListener('contextmenu', onLabel);
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContext);
      window.removeEventListener('resize', onResize);
      ro.disconnect();
    };
  }, [app]);

  return (
    <div ref={host} className={`viewport ${cursor}`} aria-label="Three-dimensional view of the neural network" role="application">
      <canvas ref={canvasRef} tabIndex={-1} />
      <div className="vignette" />
      <div ref={labelsRef} className="labels" />
      {hover && <HoverCard neuron={hover.neuron} x={hover.x} y={hover.y} />}
    </div>
  );
}

function HoverCard({ neuron, x, y }: { neuron: number; x: number; y: number }) {
  const app = useApp();
  const info = useAppState((s) => s.info);
  const colors = useAppState((s) => s.regionColors);
  const built = app.built;
  if (!built || !info) return null;
  const r = built.regionOf[neuron];
  const inh = built.classOf[neuron] === 1;
  return (
    <div className="hover-card glass" style={{ left: x, top: y }}>
      <div className="hover-card__title">
        <i className="swatch" style={{ background: colors[r] }} />
        Neuron #{neuron}
      </div>
      <div className="dim">{info.regions[r]?.name} · {inh ? 'inhibitory' : 'excitatory'}</div>
      <div className="dim" style={{ marginTop: 4, fontSize: 10 }}>Click to inspect · right-click for actions</div>
    </div>
  );
}
