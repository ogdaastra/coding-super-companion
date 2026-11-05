/** Canvas chart helpers: device-pixel sizing, axes and a shared visual language. */

import { useEffect, useRef } from 'react';

export const CHART = {
  grid: 'rgba(150, 180, 255, 0.07)',
  axis: 'rgba(150, 180, 255, 0.18)',
  text: '#66738d',
  textHi: '#9aa8c2',
  font: '10px "JetBrains Mono", ui-monospace, monospace',
  pad: { l: 40, r: 10, t: 8, b: 18 },
};

export const SERIES_COLORS = ['#38e6ff', '#9b7bff', '#ff4fd8', '#ffb547', '#4be3a8', '#5b8cff', '#eef6ff', '#c08cff'];

export interface Frame {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
}

/**
 * Sizes a canvas to its element at device resolution and calls `draw` whenever
 * `deps` change or the element resizes.
 */
export function useCanvas(draw: (f: Frame) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const sizeRef = useRef({ w: 0, h: 0 });

  const paint = () => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (w === 0 || h === 0) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    sizeRef.current = { w, h };
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawRef.current({ ctx, w, h });
  };

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ro = new ResizeObserver(() => paint());
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ref, size: sizeRef, repaint: paint };
}

export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Number(v.toPrecision(10)));
  return out;
}

export function fmtTick(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(0)}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1).replace(/\.0$/, '');
  if (a >= 1) return v.toFixed(2).replace(/\.?0+$/, '');
  return v.toPrecision(2);
}

export function drawAxes(f: Frame, x0: number, x1: number, y0: number, y1: number, opts: { xFmt?: (v: number) => string; yFmt?: (v: number) => string; pad?: typeof CHART.pad; yTicks?: number } = {}) {
  const { ctx, w, h } = f;
  const pad = opts.pad ?? CHART.pad;
  ctx.font = CHART.font;
  ctx.fillStyle = CHART.text;
  ctx.strokeStyle = CHART.grid;
  ctx.lineWidth = 1;
  const yt = niceTicks(y0, y1, opts.yTicks ?? 4);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of yt) {
    const y = Math.round(pad.t + (1 - (v - y0) / (y1 - y0 || 1)) * (h - pad.t - pad.b)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
    ctx.fillText((opts.yFmt ?? fmtTick)(v), pad.l - 6, y);
  }
  const xt = niceTicks(x0, x1, Math.max(2, Math.floor((w - pad.l - pad.r) / 80)));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const v of xt) {
    const x = Math.round(pad.l + ((v - x0) / (x1 - x0 || 1)) * (w - pad.l - pad.r)) + 0.5;
    ctx.fillText((opts.xFmt ?? fmtTick)(v), x, h - pad.b + 5);
  }
  ctx.strokeStyle = CHART.axis;
  ctx.beginPath();
  ctx.moveTo(pad.l + 0.5, pad.t);
  ctx.lineTo(pad.l + 0.5, h - pad.b + 0.5);
  ctx.lineTo(w - pad.r, h - pad.b + 0.5);
  ctx.stroke();
}

export function hexA(hex: string, a: number): string {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}
