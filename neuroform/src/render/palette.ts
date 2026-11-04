/**
 * Colour system shared by the renderer and the 2D charts. Mirrors the CSS tokens
 * in `src/styles/tokens.css`.
 */

export const PALETTE = {
  background: '#02040a',
  backgroundHigh: '#0a1630',
  /** Ordinary neural activity. */
  cyan: '#38e6ff',
  /** Selected structures. */
  violet: '#9b7bff',
  ultraviolet: '#c08cff',
  /** Inhibitory activity and particular states. */
  magenta: '#ff4fd8',
  /** Exceptional events (stimulation, reward, threshold edits). */
  amber: '#ffb547',
  /** Highlights. */
  white: '#eef6ff',
  /** Inactive structures. */
  slate: '#5d6b85',
  slateDim: '#2a3346',
} as const;

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
}

/** Fallback region colours for configurations without explicit ones. */
export const REGION_COLORS = ['#4fd8ff', '#5b8cff', '#8f7dff', '#c77dff', '#3ee6c1', '#ffb547', '#7fe0ff', '#a3a8ff'];

export function regionColor(color: string | undefined, index: number): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : REGION_COLORS[index % REGION_COLORS.length];
}

/** Activity heat ramp: slate → cyan → white → amber. `x` in 0..1. */
export function heat(x: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, hexToRgb('#1a2236')],
    [0.35, hexToRgb('#1f8fb3')],
    [0.6, hexToRgb(PALETTE.cyan)],
    [0.82, hexToRgb(PALETTE.white)],
    [1, hexToRgb(PALETTE.amber)],
  ];
  const t = Math.min(1, Math.max(0, x));
  for (let k = 1; k < stops.length; k++) {
    if (t <= stops[k][0]) {
      const [a, ca] = stops[k - 1];
      const [b, cb] = stops[k];
      const f = (t - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f];
    }
  }
  return stops[stops.length - 1][1];
}
