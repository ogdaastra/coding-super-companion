/**
 * Neurons: one GPU instance per neuron (a camera-facing sprite), drawn in a single
 * call. Colour is computed in the shader from per-instance attributes:
 *
 * - `base`  (static)  region tint and class (E/I)
 * - `glow`  (dynamic) spike flash, set to 1 when the neuron fires and decayed per frame
 * - `state` (dynamic) x: mode scalar (rate, membrane, region activity) 0..1
 *                     y: highlight (1 stimulated/amber, 2 related/violet, 3 selected/white)
 *                     z: dimming 0..1 (isolation, local network)
 *
 * Visualisation modes are blends of uniform weights, so switching modes animates
 * smoothly and never recompiles shaders.
 */

import {
  AdditiveBlending,
  InstancedBufferAttribute,
  DynamicDrawUsage,
  Sprite,
  SpriteNodeMaterial,
} from 'three/webgpu';
import {
  float,
  instancedBufferAttribute,
  instancedDynamicBufferAttribute,
  mix,
  positionView,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
  exp,
  length,
  clamp,
  select,
} from 'three/tsl';
import { hexToRgb, PALETTE } from './palette.ts';

export interface NeuronModeWeights {
  base: number;
  spike: number;
  heat: number;
  cls: number;
  size: number;
}

/** A float-typed shader node. */
type FloatNode = ReturnType<typeof uv>['x'];

function heatRamp(x: FloatNode) {
  const c0 = vec3(...hexToRgb('#141c2e'));
  const c1 = vec3(...hexToRgb('#1f8fb3'));
  const c2 = vec3(...hexToRgb(PALETTE.cyan));
  const c3 = vec3(...hexToRgb(PALETTE.white));
  const c4 = vec3(...hexToRgb(PALETTE.amber));
  const a = mix(c0, c1, smoothstep(0.0, 0.35, x));
  const b = mix(a, c2, smoothstep(0.35, 0.6, x));
  const c = mix(b, c3, smoothstep(0.6, 0.82, x));
  return mix(c, c4, smoothstep(0.82, 1.0, x));
}

export class NeuronLayer {
  readonly sprite: Sprite;
  readonly count: number;
  readonly glow: Float32Array;
  readonly state: Float32Array;
  private readonly glowAttr: InstancedBufferAttribute;
  private readonly stateAttr: InstancedBufferAttribute;
  readonly uniforms = {
    base: uniform(1),
    spike: uniform(1),
    heat: uniform(0),
    cls: uniform(0),
    size: uniform(1.4),
    fog: uniform(0.0016),
    opacity: uniform(1),
  };

  constructor(positions: Float32Array, regionOf: Uint16Array, classOf: Uint8Array, regionColors: string[]) {
    const n = positions.length / 3;
    this.count = n;
    const base = new Float32Array(n * 4);
    const rgb = regionColors.map(hexToRgb);
    const slate = hexToRgb(PALETTE.slate);
    for (let i = 0; i < n; i++) {
      const c = rgb[regionOf[i]] ?? slate;
      // Inactive neurons: muted blue-grey carrying a subtle regional tint.
      base[4 * i] = slate[0] * 0.55 + c[0] * 0.45;
      base[4 * i + 1] = slate[1] * 0.55 + c[1] * 0.45;
      base[4 * i + 2] = slate[2] * 0.55 + c[2] * 0.45;
      base[4 * i + 3] = classOf[i];
    }
    this.glow = new Float32Array(n);
    this.state = new Float32Array(n * 3);
    this.glowAttr = new InstancedBufferAttribute(this.glow, 1);
    this.glowAttr.setUsage(DynamicDrawUsage);
    this.stateAttr = new InstancedBufferAttribute(this.state, 3);
    this.stateAttr.setUsage(DynamicDrawUsage);

    const pos = instancedBufferAttribute<'vec3'>(new InstancedBufferAttribute(positions, 3), 'vec3');
    const baseNode = instancedBufferAttribute<'vec4'>(new InstancedBufferAttribute(base, 4), 'vec4');
    const glow = instancedDynamicBufferAttribute<'float'>(this.glowAttr, 'float');
    const st = instancedDynamicBufferAttribute<'vec3'>(this.stateAttr, 'vec3');
    const u = this.uniforms;

    const isInh = baseNode.w;
    const spikeColor = mix(vec3(...hexToRgb(PALETTE.cyan)), vec3(...hexToRgb(PALETTE.magenta)), isInh);
    const classColor = mix(vec3(...hexToRgb('#2f9fd0')), vec3(...hexToRgb('#c0459f')), isInh);
    const aux = st.x;
    const hl = st.y;
    const dim = st.z;
    const highlight = select(
      hl.greaterThan(2.5),
      vec3(...hexToRgb(PALETTE.white)),
      select(hl.greaterThan(1.5), vec3(...hexToRgb(PALETTE.violet)), vec3(...hexToRgb(PALETTE.amber))),
    );
    const hlOn = smoothstep(0.5, 0.6, hl);

    // Radial profile: bright core with a soft halo.
    const d = length(uv().sub(0.5)).mul(2);
    const core = exp(d.mul(d).mul(-18));
    const halo = exp(d.mul(d).mul(-3.2)).mul(0.35);
    const profile = core.add(halo).mul(smoothstep(1.0, 0.85, d));

    const g = glow.mul(glow);
    let col = baseNode.xyz.mul(u.base.mul(0.2));
    col = col.add(spikeColor.mul(g).mul(u.spike.mul(2.4)));
    col = col.add(vec3(...hexToRgb(PALETTE.white)).mul(g.mul(g)).mul(u.spike.mul(1.2)));
    col = col.add(heatRamp(clamp(aux, 0, 1)).mul(u.heat.mul(0.55)));
    col = col.add(classColor.mul(u.cls.mul(0.45)));
    col = mix(col, highlight.mul(1.4), hlOn.mul(0.8));

    // Depth attenuation (atmospheric falloff) and dimming.
    const depth = positionView.z.negate();
    const fog = exp(depth.mul(u.fog).negate());
    const intensity = fog.mul(float(1).sub(dim.mul(0.92))).mul(u.opacity);

    const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    mat.positionNode = pos;
    mat.colorNode = vec4(col.mul(profile).mul(intensity), 1);
    mat.scaleNode = u.size.mul(float(1).add(g.mul(1.4)).add(hlOn.mul(0.8))).mul(float(1).sub(dim.mul(0.5)).max(0.35));
    mat.sizeAttenuation = true;

    this.sprite = new Sprite(mat);
    this.sprite.count = n;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 2;
  }

  markGlowDirty(): void {
    this.glowAttr.needsUpdate = true;
  }

  markStateDirty(): void {
    this.stateAttr.needsUpdate = true;
  }

  setWeights(w: NeuronModeWeights): void {
    this.uniforms.base.value = w.base;
    this.uniforms.spike.value = w.spike;
    this.uniforms.heat.value = w.heat;
    this.uniforms.cls.value = w.cls;
  }

  dispose(): void {
    this.sprite.geometry.dispose();
    (this.sprite.material as SpriteNodeMaterial).dispose();
  }
}
