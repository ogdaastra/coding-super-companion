/**
 * Instrument charts. All draw real recorded data from bounded buffers; none
 * invent values. Shared behaviour: hover readouts, drag to inspect a time range,
 * double-click to return to the live window.
 */

import { useRef, useState, type ReactNode } from 'react';
import type { Ring, EventRing } from '../../telemetry/ring.ts';
import type { ProbeTrace } from '../../telemetry/TelemetryStore.ts';
import type { WeightHistogram } from '../../engine/types.ts';
import { PROBE_FLAG_REFRACTORY, PROBE_FLAG_SPIKE } from '../../engine/types.ts';
import { CHART, SERIES_COLORS, drawAxes, fmtTick, hexA, useCanvas, type Frame } from './canvas.ts';
import { Icon } from '../icons.tsx';
import { Dialog } from '../primitives.tsx';

export interface TSeries {
  label: string;
  color: string;
  ring: Ring;
  fill?: boolean;
  width?: number;
}

type Range = [number, number] | null;

function useRangeSelect(pad: { l: number; r: number }, getX: () => [number, number], width: () => number) {
  const [range, setRange] = useState<Range>(null);
  const drag = useRef<{ x0: number; x1: number } | null>(null);
  const [sel, setSel] = useState<[number, number] | null>(null);
  const toT = (px: number) => {
    const [a, b] = getX();
    const w = width() - pad.l - pad.r;
    return a + ((px - pad.l) / Math.max(1, w)) * (b - a);
  };
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      const x = e.nativeEvent.offsetX;
      drag.current = { x0: x, x1: x };
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!drag.current) return;
      drag.current.x1 = e.nativeEvent.offsetX;
      setSel([Math.min(drag.current.x0, drag.current.x1), Math.max(drag.current.x0, drag.current.x1)]);
    },
    onPointerUp: () => {
      const d = drag.current;
      drag.current = null;
      setSel(null);
      if (d && Math.abs(d.x1 - d.x0) > 6) {
        const a = toT(Math.min(d.x0, d.x1));
        const b = toT(Math.max(d.x0, d.x1));
        setRange([a, b]);
      }
    },
    onDoubleClick: () => setRange(null),
  };
  return { range, setRange, sel, handlers };
}

// ---------------------------------------------------------------------- time series

export function TimeChart({ t, series, windowMs = 30_000, height = 120, unit = '', yMin, yMax, tick, yFmt, refLines = [] }: { t: Ring; series: TSeries[]; windowMs?: number; height?: number; unit?: string; yMin?: number; yMax?: number; tick: number; yFmt?: (v: number) => string; refLines?: { y: number; color: string; label?: string }[] }) {
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const xr = useRef<[number, number]>([0, 1]);
  const sizeW = useRef(300);
  const { range, sel, handlers } = useRangeSelect(CHART.pad, () => xr.current, () => sizeW.current);

  const draw = (f: Frame) => {
    const { ctx, w, h } = f;
    sizeW.current = w;
    const n = t.length;
    const pad = CHART.pad;
    const tLast = n ? t.at(n - 1) : 0;
    const [x0, x1] = range ?? [Math.max(0, tLast - windowMs), Math.max(tLast, windowMs * 0.02)];
    xr.current = [x0, x1];
    let lo = Infinity;
    let hi = -Infinity;
    let k0 = 0;
    for (let k = n - 1; k >= 0; k--) {
      if (t.at(k) < x0) {
        k0 = k;
        break;
      }
    }
    for (const s of series) {
      for (let k = k0; k < n; k++) {
        const tt = t.at(k);
        if (tt > x1) break;
        const v = s.ring.at(k);
        if (Number.isFinite(v)) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
    }
    if (!Number.isFinite(lo)) {
      lo = 0;
      hi = 1;
    }
    const y0 = yMin ?? (lo >= 0 ? 0 : lo - (hi - lo) * 0.1);
    let y1 = yMax ?? hi + (hi - y0) * 0.12;
    if (y1 <= y0) y1 = y0 + 1;
    drawAxes(f, x0 / 1000, x1 / 1000, y0, y1, { yFmt, xFmt: (v) => `${fmtTick(v)}s` });
    const X = (tt: number) => pad.l + ((tt - x0) / (x1 - x0 || 1)) * (w - pad.l - pad.r);
    const Y = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0)) * (h - pad.t - pad.b);
    for (const r of refLines) {
      ctx.strokeStyle = hexA(r.color, 0.55);
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.l, Y(r.y));
      ctx.lineTo(w - pad.r, Y(r.y));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, pad.t, w - pad.l - pad.r, h - pad.t - pad.b);
    ctx.clip();
    for (const s of series) {
      ctx.beginPath();
      let first = true;
      for (let k = k0; k < n; k++) {
        const tt = t.at(k);
        if (tt > x1) break;
        const v = s.ring.at(k);
        if (!Number.isFinite(v)) continue;
        const x = X(tt);
        const y = Y(v);
        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width ?? 1.4;
      ctx.stroke();
      if (s.fill && !first) {
        ctx.lineTo(X(Math.min(x1, t.at(n - 1))), Y(y0));
        ctx.lineTo(X(Math.max(x0, t.at(k0))), Y(y0));
        ctx.closePath();
        const g = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
        g.addColorStop(0, hexA(s.color, 0.22));
        g.addColorStop(1, hexA(s.color, 0));
        ctx.fillStyle = g;
        ctx.fill();
      }
    }
    ctx.restore();
    if (sel) {
      ctx.fillStyle = 'rgba(56,230,255,0.12)';
      ctx.fillRect(sel[0], pad.t, sel[1] - sel[0], h - pad.t - pad.b);
    }
    if (range) {
      ctx.fillStyle = CHART.textHi;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('RANGE · double-click for live', w - pad.r - 2, pad.t + 2);
    }
  };
  const { ref } = useCanvas(draw, [tick, range, sel, windowMs, series.length]);

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    handlers.onPointerMove(e);
    const n = t.length;
    if (!n) return;
    const [x0, x1] = xr.current;
    const px = e.nativeEvent.offsetX;
    const tt = x0 + ((px - CHART.pad.l) / Math.max(1, sizeW.current - CHART.pad.l - CHART.pad.r)) * (x1 - x0);
    let best = n - 1;
    let lo = 0;
    let hi = n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (t.at(mid) < tt) lo = mid + 1;
      else hi = mid - 1;
    }
    best = Math.min(n - 1, Math.max(0, lo));
    const text = [`t ${(t.at(best) / 1000).toFixed(3)} s`, ...series.map((s) => `${s.label}  ${fmtTick(s.ring.at(best))}${unit ? ` ${unit}` : ''}`)].join('\n');
    setHover({ x: px, y: e.nativeEvent.offsetY, text });
  };

  return (
    <div className="chart" style={{ height }}>
      <canvas ref={ref} {...handlers} onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ cursor: 'crosshair' }} />
      {hover && (
        <div className="chart__readout" style={{ left: Math.min(hover.x + 12, sizeW.current - 150), top: 4, whiteSpace: 'pre' }}>
          {hover.text}
        </div>
      )}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="chart__legend">
      {items.map((i) => (
        <span key={i.label}>
          <i className="swatch" style={{ background: i.color, boxShadow: `0 0 6px ${i.color}` }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------- raster

export function RasterChart({ raster, rows, rowRegion, rowClass, regionColors, regionNames, windowMs = 2000, height = 220, tick, filter, onPick, highlight }: { raster: EventRing; rows: number; rowRegion: Uint16Array; rowClass: (row: number) => number; regionColors: string[]; regionNames: string[]; windowMs?: number; height?: number; tick: number; filter?: Set<number> | null; onPick?: (row: number, tMs: number) => void; highlight?: number | null }) {
  const pad = { l: 40, r: 8, t: 6, b: 18 };
  const xr = useRef<[number, number]>([0, 1]);
  const sizeW = useRef(300);
  const rowMap = useRef<{ map: Int32Array; shown: number }>({ map: new Int32Array(0), shown: 0 });
  const { range, sel, handlers } = useRangeSelect(pad, () => xr.current, () => sizeW.current);

  const draw = (f: Frame) => {
    const { ctx, w, h } = f;
    sizeW.current = w;
    // Visible rows (region filter), keeping region order.
    const map = new Int32Array(rows).fill(-1);
    let shown = 0;
    for (let r = 0; r < rows; r++) if (!filter || filter.has(rowRegion[r])) map[r] = shown++;
    rowMap.current = { map, shown };
    const n = raster.length;
    const tLast = n ? raster.t[raster.index(n - 1)] : 0;
    const [x0, x1] = range ?? [Math.max(0, tLast - windowMs), Math.max(tLast, 1)];
    xr.current = [x0, x1];
    const plotH = h - pad.t - pad.b;
    const rowH = plotH / Math.max(1, shown);
    // Region bands.
    let prev = -1;
    let start = 0;
    const flush = (end: number) => {
      if (prev < 0) return;
      ctx.fillStyle = hexA(regionColors[prev] ?? '#5d6b85', 0.05);
      ctx.fillRect(pad.l, pad.t + start * rowH, w - pad.l - pad.r, (end - start) * rowH);
      ctx.fillStyle = hexA(regionColors[prev] ?? '#5d6b85', 0.9);
      ctx.fillRect(pad.l - 3, pad.t + start * rowH, 2, (end - start) * rowH);
      ctx.save();
      ctx.font = '9px Inter, sans-serif';
      ctx.fillStyle = CHART.text;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      if ((end - start) * rowH > 12) ctx.fillText((regionNames[prev] ?? '').slice(0, 6).toUpperCase(), pad.l - 6, pad.t + ((start + end) / 2) * rowH);
      ctx.restore();
    };
    for (let r = 0; r < rows; r++) {
      if (map[r] < 0) continue;
      if (rowRegion[r] !== prev) {
        flush(map[r]);
        prev = rowRegion[r];
        start = map[r];
      }
    }
    flush(shown);
    drawAxes(f, x0 / 1000, x1 / 1000, 0, 1, { pad, xFmt: (v) => `${fmtTick(v)}s`, yFmt: () => '', yTicks: 1 });
    const X = (t: number) => pad.l + ((t - x0) / (x1 - x0 || 1)) * (w - pad.l - pad.r);
    const dotH = Math.max(1, Math.min(3, rowH * 0.8));
    const dotW = Math.max(1, Math.min(2, (w - pad.l - pad.r) / ((x1 - x0) / 0.5) ));
    for (let k = n - 1; k >= 0; k--) {
      const i = raster.index(k);
      const t = raster.t[i];
      if (t < x0) break;
      if (t > x1) continue;
      const row = raster.a[i];
      const m = map[row];
      if (m < 0) continue;
      ctx.fillStyle = rowClass(row) ? '#ff4fd8' : '#38e6ff';
      ctx.fillRect(X(t), pad.t + m * rowH + (rowH - dotH) / 2, dotW, dotH);
    }
    if (highlight !== null && highlight !== undefined && map[highlight] >= 0) {
      ctx.fillStyle = 'rgba(155,123,255,0.18)';
      ctx.fillRect(pad.l, pad.t + map[highlight] * rowH, w - pad.l - pad.r, Math.max(1, rowH));
    }
    if (sel) {
      ctx.fillStyle = 'rgba(56,230,255,0.12)';
      ctx.fillRect(sel[0], pad.t, sel[1] - sel[0], plotH);
    }
  };
  const { ref } = useCanvas(draw, [tick, range, sel, windowMs, filter, rows, highlight]);
  return (
    <div className="chart" style={{ height }}>
      <canvas
        ref={ref}
        {...handlers}
        style={{ cursor: onPick ? 'pointer' : 'crosshair' }}
        onClick={(e) => {
          if (!onPick) return;
          const { map, shown } = rowMap.current;
          const y = e.nativeEvent.offsetY - pad.t;
          const h = (e.currentTarget.clientHeight - pad.t - pad.b) / Math.max(1, shown);
          const m = Math.floor(y / h);
          const row = map.indexOf(m);
          const [x0, x1] = xr.current;
          const t = x0 + ((e.nativeEvent.offsetX - pad.l) / Math.max(1, sizeW.current - pad.l - pad.r)) * (x1 - x0);
          if (row >= 0) onPick(row, t);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------- membrane

export function MembraneChart({ traces, dt, vRest, vThreshold, vReset, windowMs = 400, height = 180, tick, colors = SERIES_COLORS }: { traces: ProbeTrace[]; dt: number; vRest?: number; vThreshold?: number; vReset?: number; windowMs?: number; height?: number; tick: number; colors?: string[] }) {
  const [hover, setHover] = useState<{ x: number; text: string } | null>(null);
  const xr = useRef<[number, number]>([0, 1]);
  const yr = useRef<[number, number]>([0, 1]);
  const sizeW = useRef(300);
  const { range, sel, handlers } = useRangeSelect(CHART.pad, () => xr.current, () => sizeW.current);
  const draw = (f: Frame) => {
    const { ctx, w, h } = f;
    sizeW.current = w;
    const pad = CHART.pad;
    const main = traces[0];
    if (!main || main.step.length === 0) {
      ctx.fillStyle = CHART.text;
      ctx.font = CHART.font;
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for samples — run or step the simulation', w / 2, h / 2);
      return;
    }
    const n = main.step.length;
    const tEnd = main.step.at(n - 1) * dt;
    const [x0, x1] = range ?? [tEnd - windowMs, tEnd];
    xr.current = [x0, x1];
    let lo = Infinity;
    let hi = -Infinity;
    for (const tr of traces) {
      for (let k = tr.step.length - 1; k >= 0; k--) {
        const t = tr.step.at(k) * dt;
        if (t < x0) break;
        if (t > x1) continue;
        const v = tr.v.at(k);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    if (vRest !== undefined) lo = Math.min(lo, vRest);
    if (vReset !== undefined) lo = Math.min(lo, vReset);
    if (vThreshold !== undefined) hi = Math.max(hi, vThreshold);
    if (!Number.isFinite(lo)) {
      lo = -70;
      hi = -50;
    }
    const y0 = Math.floor(lo - 2);
    const y1 = Math.ceil(hi + (hi - lo) * 0.25 + 2);
    yr.current = [y0, y1];
    drawAxes(f, x0, x1, y0, y1, { xFmt: (v) => `${fmtTick(v / 1000)}s`, yFmt: (v) => `${v}` });
    const X = (t: number) => pad.l + ((t - x0) / (x1 - x0 || 1)) * (w - pad.l - pad.r);
    const Y = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0)) * (h - pad.t - pad.b);
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, pad.t, w - pad.l - pad.r, h - pad.t - pad.b);
    ctx.clip();
    // Refractory periods of the primary neuron.
    ctx.fillStyle = 'rgba(255,181,71,0.07)';
    for (let k = n - 1; k >= 0; k--) {
      const t = main.step.at(k) * dt;
      if (t < x0) break;
      if (main.flags.at(k) === PROBE_FLAG_REFRACTORY) ctx.fillRect(X(t), pad.t, Math.max(1, X(t + dt) - X(t)), h - pad.t - pad.b);
    }
    const ref = (v: number | undefined, color: string, label: string) => {
      if (v === undefined) return;
      ctx.strokeStyle = hexA(color, 0.6);
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.l, Y(v));
      ctx.lineTo(w - pad.r, Y(v));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = hexA(color, 0.85);
      ctx.font = CHART.font;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, w - pad.r - 2, Y(v) - 2);
    };
    ref(vThreshold, '#ffb547', 'V_th');
    ref(vRest, '#9aa8c2', 'V_rest');
    if (vReset !== undefined && vReset !== vRest) ref(vReset, '#5d6b85', 'V_reset');
    traces.forEach((tr, ti) => {
      const color = colors[ti % colors.length];
      ctx.beginPath();
      let first = true;
      const m = tr.step.length;
      let k0 = 0;
      for (let k = m - 1; k >= 0; k--) if (tr.step.at(k) * dt < x0) {
        k0 = k;
        break;
      }
      // Decimate to about two points per pixel column.
      const stride = Math.max(1, Math.floor((m - k0) / (w * 2)));
      for (let k = k0; k < m; k += stride) {
        const t = tr.step.at(k) * dt;
        if (t > x1) break;
        const x = X(t);
        const y = Y(tr.v.at(k));
        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = ti === 0 ? 1.4 : 1.1;
      ctx.stroke();
      // Spikes: vertical strokes above the threshold.
      ctx.strokeStyle = ti === 0 ? '#eef6ff' : color;
      ctx.lineWidth = 1.2;
      for (let k = m - 1; k >= 0; k--) {
        const t = tr.step.at(k) * dt;
        if (t < x0) break;
        if (t > x1 || tr.flags.at(k) !== PROBE_FLAG_SPIKE) continue;
        const x = X(t);
        ctx.beginPath();
        ctx.moveTo(x, Y(tr.v.at(k)));
        ctx.lineTo(x, pad.t + 2);
        ctx.stroke();
      }
    });
    ctx.restore();
    if (sel) {
      ctx.fillStyle = 'rgba(56,230,255,0.12)';
      ctx.fillRect(sel[0], pad.t, sel[1] - sel[0], h - pad.t - pad.b);
    }
  };
  const { ref } = useCanvas(draw, [tick, range, sel, windowMs, traces, vRest, vThreshold]);
  return (
    <div className="chart" style={{ height }}>
      <canvas
        ref={ref}
        {...handlers}
        style={{ cursor: 'crosshair' }}
        onPointerMove={(e) => {
          handlers.onPointerMove(e);
          const tr = traces[0];
          if (!tr || !tr.step.length) return;
          const [x0, x1] = xr.current;
          const t = x0 + ((e.nativeEvent.offsetX - CHART.pad.l) / Math.max(1, sizeW.current - CHART.pad.l - CHART.pad.r)) * (x1 - x0);
          const step = Math.round(t / dt);
          const first = tr.step.at(0);
          const k = step - first;
          if (k < 0 || k >= tr.step.length) return;
          const flag = tr.flags.at(k);
          setHover({ x: e.nativeEvent.offsetX, text: `t ${(t / 1000).toFixed(4)} s\nV ${tr.v.at(k).toFixed(2)} mV\nI_syn ${tr.syn.at(k).toFixed(3)}${flag === PROBE_FLAG_SPIKE ? '\nSPIKE' : flag === PROBE_FLAG_REFRACTORY ? '\nrefractory' : ''}` });
        }}
        onPointerLeave={() => setHover(null)}
      />
      {hover && <div className="chart__readout" style={{ left: Math.min(hover.x + 12, sizeW.current - 130), top: 4, whiteSpace: 'pre' }}>{hover.text}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------- histogram

export function HistogramChart({ h, height = 140, log }: { h: WeightHistogram | null; height?: number; log?: boolean }) {
  const draw = (f: Frame) => {
    const { ctx, w, h: H } = f;
    if (!h) return;
    const pad = CHART.pad;
    const bins = h.excitatory.length;
    const tr = (v: number) => (log ? Math.log10(1 + v) : v);
    const max = Math.max(1, ...h.excitatory.map(tr), ...h.inhibitory.map(tr));
    drawAxes(f, 0, h.max, 0, max, { yFmt: (v) => (log ? fmtTick(Math.pow(10, v) - 1) : fmtTick(v)) });
    const bw = (w - pad.l - pad.r) / bins;
    const draw1 = (arr: number[], color: string, off: number) => {
      ctx.fillStyle = hexA(color, 0.75);
      for (let b = 0; b < bins; b++) {
        const v = tr(arr[b]);
        if (v <= 0) continue;
        const y = pad.t + (1 - v / max) * (H - pad.t - pad.b);
        ctx.fillRect(pad.l + b * bw + off, y, Math.max(1, bw / 2 - 0.5), H - pad.b - y);
      }
    };
    draw1(h.excitatory, '#38e6ff', 0);
    draw1(h.inhibitory, '#ff4fd8', bw / 2);
  };
  const { ref } = useCanvas(draw, [h, log]);
  return (
    <div className="chart" style={{ height }}>
      <canvas ref={ref} />
    </div>
  );
}

// ---------------------------------------------------------------------- matrix

export function MatrixChart({ values, labels, colors, height = 260, unit = '', onPick, selected }: { values: number[][]; labels: string[]; colors: string[]; height?: number; unit?: string; onPick?: (from: number, to: number) => void; selected?: [number, number] | null }) {
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const geo = useRef({ x: 0, y: 0, cell: 1 });
  const draw = (f: Frame) => {
    const { ctx, w, h } = f;
    const n = labels.length;
    const left = 92;
    const top = 16;
    const cell = Math.max(4, Math.min((w - left - 6) / n, (h - top - 6) / n));
    geo.current = { x: left, y: top, cell };
    let max = 0;
    for (const r of values) for (const v of r) max = Math.max(max, v);
    ctx.font = '9.5px Inter, sans-serif';
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = colors[i];
      ctx.fillRect(left - 6, top + i * cell + 2, 2, cell - 4);
      ctx.fillStyle = CHART.textHi;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(labels[i].slice(0, 14), left - 10, top + (i + 0.5) * cell);
      ctx.save();
      ctx.translate(left + (i + 0.5) * cell, top - 4);
      ctx.fillStyle = colors[i];
      ctx.fillRect(-cell / 2 + 2, 2, cell - 4, 2);
      ctx.restore();
    }
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const v = values[i]?.[j] ?? 0;
        const a = max > 0 ? Math.sqrt(v / max) : 0;
        ctx.fillStyle = v > 0 ? `rgba(56,230,255,${0.06 + a * 0.85})` : 'rgba(150,180,255,0.03)';
        ctx.fillRect(left + j * cell + 1, top + i * cell + 1, cell - 2, cell - 2);
        if (selected && selected[0] === i && selected[1] === j) {
          ctx.strokeStyle = '#9b7bff';
          ctx.lineWidth = 2;
          ctx.strokeRect(left + j * cell + 1, top + i * cell + 1, cell - 2, cell - 2);
        }
      }
    ctx.fillStyle = CHART.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = CHART.font;
    ctx.fillText('FROM ↓  TO →', 4, 2);
  };
  const { ref } = useCanvas(draw, [values, labels, selected]);
  const cellAt = (e: React.PointerEvent | React.MouseEvent): [number, number] | null => {
    const { x, y, cell } = geo.current;
    const j = Math.floor((e.nativeEvent.offsetX - x) / cell);
    const i = Math.floor((e.nativeEvent.offsetY - y) / cell);
    return i >= 0 && j >= 0 && i < labels.length && j < labels.length ? [i, j] : null;
  };
  return (
    <div className="chart" style={{ height }}>
      <canvas
        ref={ref}
        style={{ cursor: onPick ? 'pointer' : 'default' }}
        onPointerMove={(e) => {
          const c = cellAt(e);
          setHover(c ? { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, text: `${labels[c[0]]} → ${labels[c[1]]}\n${fmtTick(values[c[0]][c[1]])} ${unit}` } : null);
        }}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const c = cellAt(e);
          if (c && onPick) onPick(c[0], c[1]);
        }}
      />
      {hover && <div className="chart__readout" style={{ left: hover.x + 12, top: hover.y + 8, whiteSpace: 'pre' }}>{hover.text}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------- generic xy

export function XYChart({ x, series, kind = 'line', height = 160, xLabel, yLabel, xTicks }: { x: number[]; series: { name: string; values: number[]; color?: string }[]; kind?: 'line' | 'bar'; height?: number; xLabel?: string; yLabel?: string; xTicks?: string[] }) {
  const draw = (f: Frame) => {
    const { ctx, w, h } = f;
    const pad = { ...CHART.pad, b: xTicks ? 30 : 22 };
    let lo = 0;
    let hi = -Infinity;
    for (const s of series) for (const v of s.values) if (Number.isFinite(v)) {
      hi = Math.max(hi, v);
      lo = Math.min(lo, v);
    }
    if (!Number.isFinite(hi) || hi === lo) hi = lo + 1;
    hi += (hi - lo) * 0.1;
    const x0 = kind === 'bar' ? -0.5 : Math.min(...x);
    const x1 = kind === 'bar' ? x.length - 0.5 : Math.max(...x);
    drawAxes(f, x0, x1, lo, hi, { pad, xFmt: xTicks ? () => '' : undefined });
    const X = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (w - pad.l - pad.r);
    const Y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
    series.forEach((s, si) => {
      const color = s.color ?? SERIES_COLORS[si % SERIES_COLORS.length];
      if (kind === 'bar') {
        const group = (w - pad.l - pad.r) / x.length;
        const bw = (group * 0.7) / series.length;
        ctx.fillStyle = hexA(color, 0.8);
        s.values.forEach((v, i) => {
          const xx = pad.l + i * group + group * 0.15 + si * bw;
          ctx.fillRect(xx, Math.min(Y(v), Y(0)), bw - 1, Math.abs(Y(0) - Y(v)));
        });
      } else {
        ctx.beginPath();
        s.values.forEach((v, i) => (i ? ctx.lineTo(X(x[i]), Y(v)) : ctx.moveTo(X(x[i]), Y(v))));
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = color;
        s.values.forEach((v, i) => {
          if (x.length <= 40) ctx.fillRect(X(x[i]) - 1.5, Y(v) - 1.5, 3, 3);
        });
      }
    });
    ctx.font = CHART.font;
    ctx.fillStyle = CHART.text;
    if (xTicks) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const group = (w - pad.l - pad.r) / x.length;
      xTicks.forEach((t, i) => ctx.fillText(t.slice(0, 12), pad.l + (i + 0.5) * group, h - pad.b + 5));
    }
    if (xLabel) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(xLabel, w - pad.r, h - 1);
    }
    if (yLabel) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(yLabel, pad.l + 4, pad.t);
    }
  };
  const { ref } = useCanvas(draw, [x, series, kind]);
  return (
    <div className="chart" style={{ height }}>
      <canvas ref={ref} />
    </div>
  );
}

export function Sparkline({ ring, color = '#38e6ff', height = 26, tick, points = 120 }: { ring: Ring; color?: string; height?: number; tick: number; points?: number }) {
  const draw = (f: Frame) => {
    const { ctx, w, h } = f;
    const n = ring.length;
    if (n < 2) return;
    const k0 = Math.max(0, n - points);
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = k0; k < n; k++) {
      lo = Math.min(lo, ring.at(k));
      hi = Math.max(hi, ring.at(k));
    }
    if (hi - lo < 1e-9) hi = lo + 1;
    ctx.beginPath();
    for (let k = k0; k < n; k++) {
      const x = ((k - k0) / (n - 1 - k0 || 1)) * w;
      const y = h - 2 - ((ring.at(k) - lo) / (hi - lo)) * (h - 4);
      if (k === k0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  };
  const { ref } = useCanvas(draw, [tick]);
  return (
    <div className="chart" style={{ height }}>
      <canvas ref={ref} />
    </div>
  );
}

/** A chart in a card with a title, legend and an expand-to-dialog button. */
export function ChartCard({ title, meta, legend, children, expanded }: { title: string; meta?: ReactNode; legend?: ReactNode; children: ReactNode; expanded?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card">
      <div className="chart__head">
        <span className="label">{title}</span>
        {meta && <span className="mono dim" style={{ fontSize: 10.5 }}>{meta}</span>}
      </div>
      {legend}
      {children}
      {expanded && (
        <button type="button" className="icon-btn card__expand" aria-label={`Expand ${title}`} onClick={() => setOpen(true)}>
          {Icon.expand()}
        </button>
      )}
      {open && expanded && (
        <Dialog title={title} meta={meta} onClose={() => setOpen(false)} size="wide">
          {legend}
          {expanded}
          <p className="hint">Drag across a chart to inspect a time range; double-click to return to the live window.</p>
        </Dialog>
      )}
    </div>
  );
}
