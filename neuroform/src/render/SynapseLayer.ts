/**
 * A batch of real synapses drawn as line segments in one draw call. Each segment
 * is one synapse of the network (identified by its engine synapse id), with
 * per-vertex attributes:
 *
 * - `tint`   (static)  source-region colour
 * - `kind`   (static)  x: inhibitory (0/1), y: |w| normalised to 0..1
 * - `act`    (dynamic) transmission glow (a pulse is travelling on this synapse)
 * - `vis`    (dynamic) visibility (isolation / local-network filtering)
 *
 * Used three times: the sampled overview set, the focus set (selected neuron's
 * connections) and the close-range detail patch.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  LineBasicNodeMaterial,
  LineSegments,
} from 'three/webgpu';
import { attribute, exp, float, mix, positionView, smoothstep, uniform, vec3, vec4, clamp } from 'three/tsl';
import { hexToRgb, PALETTE } from './palette.ts';

export interface SegmentData {
  ids: Uint32Array;
  pre: Uint32Array;
  post: Uint32Array;
  weight: Float32Array;
  delayMs: Float32Array;
}

export class SynapseLayer {
  readonly lines: LineSegments;
  readonly count: number;
  readonly data: SegmentData;
  readonly act: Float32Array;
  readonly vis: Float32Array;
  private readonly kind: Float32Array;
  private readonly actAttr: BufferAttribute;
  private readonly visAttr: BufferAttribute;
  private readonly kindAttr: BufferAttribute;
  /** Segments grouped by presynaptic neuron (CSR) for spawning pulses. */
  readonly preStart: Int32Array;
  readonly preList: Int32Array;
  maxWeight = 1;
  readonly uniforms = {
    alpha: uniform(0.22),
    active: uniform(1),
    strength: uniform(0),
    ei: uniform(0),
    fog: uniform(0.0016),
    fade: uniform(1),
    nearFade: uniform(4000),
  };

  constructor(
    data: SegmentData,
    positions: Float32Array,
    regionOf: Uint16Array,
    classOf: Uint8Array,
    regionColors: string[],
    neuronCount: number,
    style: { alpha: number; widthBoost?: number },
  ) {
    const m = data.ids.length;
    this.count = m;
    this.data = data;
    const pos = new Float32Array(m * 6);
    const tint = new Float32Array(m * 6);
    this.kind = new Float32Array(m * 4);
    this.act = new Float32Array(m * 2);
    this.vis = new Float32Array(m * 2).fill(1);
    const rgb = regionColors.map(hexToRgb);
    let wmax = 1e-6;
    for (let k = 0; k < m; k++) wmax = Math.max(wmax, Math.abs(data.weight[k]));
    this.maxWeight = wmax;
    for (let k = 0; k < m; k++) {
      const a = data.pre[k];
      const b = data.post[k];
      pos.set(positions.subarray(3 * a, 3 * a + 3), 6 * k);
      pos.set(positions.subarray(3 * b, 3 * b + 3), 6 * k + 3);
      const c = rgb[regionOf[a]] ?? [0.5, 0.5, 0.6];
      tint.set(c, 6 * k);
      tint.set(c, 6 * k + 3);
      const inh = classOf[a];
      const wn = Math.abs(data.weight[k]) / wmax;
      this.kind[4 * k] = inh;
      this.kind[4 * k + 1] = wn;
      this.kind[4 * k + 2] = inh;
      this.kind[4 * k + 3] = wn;
    }
    // Group segments by presynaptic neuron.
    this.preStart = new Int32Array(neuronCount + 1);
    for (let k = 0; k < m; k++) this.preStart[data.pre[k] + 1]++;
    for (let i = 0; i < neuronCount; i++) this.preStart[i + 1] += this.preStart[i];
    const fill = this.preStart.slice(0, neuronCount);
    this.preList = new Int32Array(m);
    for (let k = 0; k < m; k++) this.preList[fill[data.pre[k]]++] = k;

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('tint', new BufferAttribute(tint, 3));
    this.kindAttr = new BufferAttribute(this.kind, 2);
    this.kindAttr.setUsage(DynamicDrawUsage);
    geo.setAttribute('kind', this.kindAttr);
    this.actAttr = new BufferAttribute(this.act, 1);
    this.actAttr.setUsage(DynamicDrawUsage);
    geo.setAttribute('act', this.actAttr);
    this.visAttr = new BufferAttribute(this.vis, 1);
    this.visAttr.setUsage(DynamicDrawUsage);
    geo.setAttribute('vis', this.visAttr);

    const u = this.uniforms;
    u.alpha.value = style.alpha;
    const tintN = attribute('tint', 'vec3');
    const kindN = attribute('kind', 'vec2');
    const actN = attribute('act', 'float');
    const visN = attribute('vis', 'float');
    const inh = kindN.x;
    const wn = kindN.y;
    const eiColor = mix(vec3(...hexToRgb(PALETTE.cyan)), vec3(...hexToRgb(PALETTE.magenta)), inh);
    const strengthColor = mix(vec3(...hexToRgb('#24406e')), mix(vec3(...hexToRgb(PALETTE.cyan)), vec3(...hexToRgb(PALETTE.white)), smoothstep(0.6, 1.0, wn)), smoothstep(0.0, 0.6, wn));
    let col = mix(tintN.mul(0.55), eiColor.mul(0.8), u.ei);
    col = mix(col, strengthColor, u.strength);
    const baseI = u.alpha.mul(mix(float(1), wn.mul(1.4).add(0.08), u.strength));
    const pulse = mix(vec3(...hexToRgb(PALETTE.cyan)), vec3(...hexToRgb(PALETTE.magenta)), inh).mul(actN.mul(u.active));
    const depth = positionView.z.negate();
    const fog = exp(depth.mul(u.fog).negate());
    // Fade synapses far from the camera (distance level of detail).
    const lod = clamp(float(1).sub(smoothstep(u.nearFade.mul(0.6), u.nearFade, depth)), 0, 1);
    const intensity = fog.mul(visN).mul(u.fade).mul(lod);
    const mat = new LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    mat.colorNode = vec4(col.mul(baseI).add(pulse).mul(intensity), 1);
    this.lines = new LineSegments(geo, mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 1;
  }

  markActDirty(): void {
    this.actAttr.needsUpdate = true;
  }

  markVisDirty(): void {
    this.visAttr.needsUpdate = true;
  }

  /** Updates displayed weights (strength mode) from current engine values. */
  setWeights(weights: Float32Array): void {
    let wmax = 1e-6;
    for (let k = 0; k < weights.length; k++) wmax = Math.max(wmax, Math.abs(weights[k]));
    this.maxWeight = wmax;
    for (let k = 0; k < Math.min(weights.length, this.count); k++) {
      this.data.weight[k] = weights[k];
      const wn = Math.abs(weights[k]) / wmax;
      this.kind[4 * k + 1] = wn;
      this.kind[4 * k + 3] = wn;
    }
    this.kindAttr.needsUpdate = true;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as LineBasicNodeMaterial).dispose();
  }
}
