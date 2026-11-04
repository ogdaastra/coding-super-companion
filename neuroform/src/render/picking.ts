/**
 * Screen-space neuron picking. Projects every neuron with the camera's
 * view-projection matrix and returns the one nearest the pointer within a pixel
 * radius, preferring neurons closer to the camera. O(N) per pick, no allocation;
 * about a millisecond for 100k neurons.
 */

export interface PickResult {
  neuron: number;
  distancePx: number;
  depth: number;
}

export function pickNeuron(
  positions: Float32Array,
  viewProj: ArrayLike<number>,
  x: number,
  y: number,
  width: number,
  height: number,
  radiusPx: number,
  visible?: (i: number) => boolean,
): PickResult | null {
  const m = viewProj;
  const n = positions.length / 3;
  let best = -1;
  let bestScore = Infinity;
  let bestD = 0;
  let bestDepth = 0;
  const r2 = radiusPx * radiusPx;
  for (let i = 0; i < n; i++) {
    const px = positions[3 * i];
    const py = positions[3 * i + 1];
    const pz = positions[3 * i + 2];
    const w = m[3] * px + m[7] * py + m[11] * pz + m[15];
    if (w <= 0.01) continue;
    const sx = ((m[0] * px + m[4] * py + m[8] * pz + m[12]) / w * 0.5 + 0.5) * width;
    const sy = (1 - ((m[1] * px + m[5] * py + m[9] * pz + m[13]) / w * 0.5 + 0.5)) * height;
    const dx = sx - x;
    const dy = sy - y;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;
    if (visible && !visible(i)) continue;
    // Pixel distance dominates; depth breaks near-ties in favour of the front.
    const score = d2 + w * 0.02;
    if (score < bestScore) {
      bestScore = score;
      best = i;
      bestD = Math.sqrt(d2);
      bestDepth = w;
    }
  }
  return best < 0 ? null : { neuron: best, distancePx: bestD, depth: bestDepth };
}

/** Projects a world point to CSS pixels; null when behind the camera. */
export function project(viewProj: ArrayLike<number>, p: [number, number, number], width: number, height: number): [number, number, number] | null {
  const m = viewProj;
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  if (w <= 0.01) return null;
  const x = ((m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w * 0.5 + 0.5) * width;
  const y = (1 - ((m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w * 0.5 + 0.5)) * height;
  return [x, y, w];
}
