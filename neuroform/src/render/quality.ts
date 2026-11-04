/**
 * Rendering quality presets and the adaptive controller.
 *
 * Quality only changes how much is *drawn*: pixel ratio, how many synapses and
 * pulses are displayed, bloom. It never changes the simulation.
 */

export type QualityName = 'performance' | 'balanced' | 'high' | 'ultra';

export interface QualitySettings {
  name: QualityName;
  pixelRatio: number;
  synapses: number;
  pulses: number;
  bloom: boolean;
  bloomStrength: number;
  detailSynapses: number;
  neuronScale: number;
}

export const QUALITY: Record<QualityName, QualitySettings> = {
  performance: { name: 'performance', pixelRatio: 0.75, synapses: 6_000, pulses: 2_500, bloom: false, bloomStrength: 0, detailSynapses: 4_000, neuronScale: 1.15 },
  balanced: { name: 'balanced', pixelRatio: 1.25, synapses: 16_000, pulses: 8_000, bloom: true, bloomStrength: 0.75, detailSynapses: 10_000, neuronScale: 1 },
  high: { name: 'high', pixelRatio: 1.75, synapses: 32_000, pulses: 16_000, bloom: true, bloomStrength: 0.9, detailSynapses: 20_000, neuronScale: 1 },
  ultra: { name: 'ultra', pixelRatio: 2, synapses: 64_000, pulses: 32_000, bloom: true, bloomStrength: 1.0, detailSynapses: 40_000, neuronScale: 1 },
};

export const QUALITY_ORDER: QualityName[] = ['performance', 'balanced', 'high', 'ultra'];

/** The reductions the adaptive controller can apply, mildest first. */
export interface Reductions {
  /** Multiplier on pixel ratio (≤ 1). */
  resolution: number;
  /** Multiplier on displayed pulses. */
  pulses: number;
  /** Multiplier on displayed synapses. */
  synapses: number;
  bloom: boolean;
}

const LEVELS: Reductions[] = [
  { resolution: 1, pulses: 1, synapses: 1, bloom: true },
  { resolution: 0.85, pulses: 1, synapses: 1, bloom: true },
  { resolution: 0.85, pulses: 0.5, synapses: 1, bloom: true },
  { resolution: 0.7, pulses: 0.5, synapses: 0.6, bloom: true },
  { resolution: 0.7, pulses: 0.35, synapses: 0.4, bloom: false },
  { resolution: 0.55, pulses: 0.25, synapses: 0.25, bloom: false },
];

/**
 * Steps rendering detail down when frames are slow and back up when there is
 * headroom, with hysteresis so it does not oscillate.
 */
export class AdaptiveQuality {
  enabled = true;
  level = 0;
  private slow = 0;
  private fast = 0;
  private avg = 16.7;
  targetMs: number;

  constructor(targetMs = 1000 / 50) {
    this.targetMs = targetMs;
  }

  get reductions(): Reductions {
    return LEVELS[this.enabled ? this.level : 0];
  }

  get active(): boolean {
    return this.enabled && this.level > 0;
  }

  /** Feeds one frame duration. Returns true if the level changed. */
  sample(frameMs: number): boolean {
    if (!this.enabled) return false;
    this.avg = this.avg * 0.9 + Math.min(frameMs, 200) * 0.1;
    if (this.avg > this.targetMs * 1.25) {
      this.slow++;
      this.fast = 0;
    } else if (this.avg < this.targetMs * 0.6) {
      this.fast++;
      this.slow = 0;
    } else {
      this.slow = Math.max(0, this.slow - 1);
      this.fast = Math.max(0, this.fast - 1);
    }
    if (this.slow > 90 && this.level < LEVELS.length - 1) {
      this.level++;
      this.slow = 0;
      return true;
    }
    if (this.fast > 300 && this.level > 0) {
      this.level--;
      this.fast = 0;
      return true;
    }
    return false;
  }

  reset(): void {
    this.level = 0;
    this.slow = 0;
    this.fast = 0;
  }

  get averageFrameMs(): number {
    return this.avg;
  }
}
