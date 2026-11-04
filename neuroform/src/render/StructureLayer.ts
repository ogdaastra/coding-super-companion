/**
 * Aggregated structure for distant views and regional modes:
 *
 * - region halos: one soft glow per region, brightness from measured regional
 *   firing rate;
 * - pathway bundles: one curved tube per inter-region projection, thickness from
 *   its synapse count, brightness and flow speed from the measured rate of
 *   synaptic events it carries.
 *
 * Purely a rendering aggregation: the simulation is unaffected.
 */

import {
  AdditiveBlending,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  QuadraticBezierCurve3,
  Sprite,
  SpriteNodeMaterial,
  TubeGeometry,
  Vector3,
} from 'three/webgpu';
import {
  exp,
  float,
  fract,
  instancedBufferAttribute,
  instancedDynamicBufferAttribute,
  length,
  mix,
  smoothstep,
  time,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import type { NetInfo } from '../engine/types.ts';
import { hexToRgb, PALETTE } from './palette.ts';

export class StructureLayer {
  readonly group = new Group();
  private readonly halo: Sprite;
  private readonly haloState: Float32Array;
  private readonly haloAttr: InstancedBufferAttribute;
  readonly bundles: { mesh: Mesh; projection: number; level: ReturnType<typeof uniform>; speed: ReturnType<typeof uniform>; highlight: ReturnType<typeof uniform> }[] = [];
  readonly uniforms = { halo: uniform(0.25), bundles: uniform(0.25) };

  constructor(info: NetInfo, regionColors: string[]) {
    const r = info.regions.length;
    const centers = new Float32Array(r * 3);
    const colors = new Float32Array(r * 4);
    info.regions.forEach((reg, i) => {
      centers.set(reg.center, 3 * i);
      colors.set([...hexToRgb(regionColors[i]), Math.max(...reg.radius)], 4 * i);
    });
    this.haloState = new Float32Array(r * 2);
    this.haloAttr = new InstancedBufferAttribute(this.haloState, 2);
    this.haloAttr.setUsage(DynamicDrawUsage);
    const st = instancedDynamicBufferAttribute<'vec2'>(this.haloAttr, 'vec2');
    const cn = instancedBufferAttribute<'vec4'>(new InstancedBufferAttribute(colors, 4), 'vec4');
    const d = length(uv().sub(0.5)).mul(2);
    const profile = exp(d.mul(d).mul(-4)).mul(smoothstep(1.0, 0.6, d));
    const selected = st.y;
    const col = mix(cn.xyz, vec3(...hexToRgb(PALETTE.violet)), selected.mul(0.6));
    const hm = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    hm.positionNode = instancedBufferAttribute<'vec3'>(new InstancedBufferAttribute(centers, 3), 'vec3');
    hm.colorNode = vec4(col.mul(profile).mul(st.x.mul(0.18).add(selected.mul(0.08))).mul(this.uniforms.halo), 1);
    hm.scaleNode = cn.w.mul(2.6);
    this.halo = new Sprite(hm);
    this.halo.count = r;
    this.halo.frustumCulled = false;
    this.halo.renderOrder = 0;
    this.group.add(this.halo);

    const maxSyn = Math.max(1, ...info.projections.map((p) => p.synapses));
    info.projections.forEach((p, pi) => {
      if (p.from === p.to) return;
      const a = new Vector3(...info.regions[p.from].center);
      const b = new Vector3(...info.regions[p.to].center);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const span = a.distanceTo(b);
      // Bow the bundle outward/upward; reverse directions bow differently.
      const side = new Vector3().subVectors(b, a).cross(new Vector3(0, 1, 0)).normalize();
      const dir = p.from < p.to ? 1 : -1;
      mid.addScaledVector(side, span * 0.12 * dir).add(new Vector3(0, span * 0.18, 0));
      const curve = new QuadraticBezierCurve3(a, mid, b);
      const radius = 0.6 + 3.2 * Math.sqrt(p.synapses / maxSyn);
      const geo = new TubeGeometry(curve, 48, radius, 8, false);
      const level = uniform(0);
      const speed = uniform(0.2);
      const highlight = uniform(0);
      const inh = p.source === 'inhibitory';
      const base = inh ? hexToRgb(PALETTE.magenta) : hexToRgb(regionColors[p.from]);
      // Moving bands indicate direction; their speed follows the measured event rate.
      const flow = fract(uv().x.mul(7).sub(time.mul(speed)));
      const band = smoothstep(0.0, 0.15, flow).mul(smoothstep(0.55, 0.2, flow));
      const edge = float(1).sub(uv().y.sub(0.5).abs().mul(2)).pow(0.6);
      const col = mix(vec3(...base), vec3(...hexToRgb(PALETTE.violet)), highlight);
      const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
      mat.colorNode = vec4(col.mul(band.mul(0.7).add(0.3)).mul(edge).mul(level.mul(0.85).add(0.15).add(highlight.mul(0.6))).mul(this.uniforms.bundles).mul(0.5), 1);
      const mesh = new Mesh(geo, mat);
      mesh.renderOrder = 0;
      this.group.add(mesh);
      this.bundles.push({ mesh, projection: pi, level, speed, highlight });
    });
  }

  /** `activity` 0..1 per region; `selected` region index or -1. */
  setRegions(activity: number[], selected: number): void {
    for (let i = 0; i < activity.length; i++) {
      this.haloState[2 * i] = activity[i];
      this.haloState[2 * i + 1] = i === selected ? 1 : 0;
    }
    this.haloAttr.needsUpdate = true;
  }

  /** Normalised activity per projection, and an optional highlighted region. */
  setBundles(activity: Float64Array, selectedRegion: number, info: NetInfo): void {
    let max = 1e-9;
    for (const b of this.bundles) max = Math.max(max, activity[b.projection] ?? 0);
    for (const b of this.bundles) {
      const a = (activity[b.projection] ?? 0) / max;
      b.level.value = Math.sqrt(a);
      b.speed.value = 0.05 + 0.9 * Math.sqrt(a);
      const p = info.projections[b.projection];
      b.highlight.value = selectedRegion >= 0 && (p.from === selectedRegion || p.to === selectedRegion) ? 1 : 0;
    }
  }

  dispose(): void {
    this.halo.geometry.dispose();
    (this.halo.material as SpriteNodeMaterial).dispose();
    for (const b of this.bundles) {
      b.mesh.geometry.dispose();
      (b.mesh.material as MeshBasicNodeMaterial).dispose();
    }
  }
}
