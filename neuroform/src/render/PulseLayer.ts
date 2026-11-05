/**
 * Travelling signal pulses. Every pulse is spawned by a real spike of the
 * presynaptic neuron and travels along a real displayed synapse. Active pulses are
 * compacted into a dynamic instance buffer each frame and drawn in one call.
 */

import { AdditiveBlending, DynamicDrawUsage, InstancedBufferAttribute, Sprite, SpriteNodeMaterial } from 'three/webgpu';
import { exp, instancedDynamicBufferAttribute, length, positionView, smoothstep, uniform, uv, vec4 } from 'three/tsl';

export class PulseLayer {
  readonly sprite: Sprite;
  readonly capacity: number;
  readonly pos: Float32Array;
  readonly col: Float32Array;
  private readonly posAttr: InstancedBufferAttribute;
  private readonly colAttr: InstancedBufferAttribute;
  readonly uniforms = { size: uniform(2.2), fog: uniform(0.0016), opacity: uniform(1) };

  constructor(capacity: number) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.posAttr = new InstancedBufferAttribute(this.pos, 3);
    this.posAttr.setUsage(DynamicDrawUsage);
    this.colAttr = new InstancedBufferAttribute(this.col, 4);
    this.colAttr.setUsage(DynamicDrawUsage);
    const p = instancedDynamicBufferAttribute<'vec3'>(this.posAttr, 'vec3');
    const c = instancedDynamicBufferAttribute<'vec4'>(this.colAttr, 'vec4');
    const d = length(uv().sub(0.5)).mul(2);
    const profile = exp(d.mul(d).mul(-14)).add(exp(d.mul(d).mul(-3)).mul(0.25)).mul(smoothstep(1.0, 0.8, d));
    const fog = exp(positionView.z.negate().mul(this.uniforms.fog).negate());
    const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    mat.positionNode = p;
    mat.colorNode = vec4(c.xyz.mul(c.w).mul(profile).mul(fog).mul(this.uniforms.opacity).mul(2.2), 1);
    mat.scaleNode = this.uniforms.size.mul(c.w.mul(0.5).add(0.6));
    this.sprite = new Sprite(mat);
    this.sprite.count = 0;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 3;
  }

  commit(active: number): void {
    this.sprite.count = active;
    this.sprite.visible = active > 0;
    if (active > 0) {
      this.posAttr.clearUpdateRanges();
      this.posAttr.addUpdateRange(0, active * 3);
      this.posAttr.needsUpdate = true;
      this.colAttr.clearUpdateRanges();
      this.colAttr.addUpdateRange(0, active * 4);
      this.colAttr.needsUpdate = true;
    }
  }

  dispose(): void {
    this.sprite.geometry.dispose();
    (this.sprite.material as SpriteNodeMaterial).dispose();
  }
}
