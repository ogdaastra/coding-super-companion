/**
 * Training and testing the Vision Lab network on images: one trial per image
 * (see trial.ts), plus homeostasis that keeps the answer populations balanced.
 *
 * Relative answers. Rewards and punishments change *which* visual features each
 * answer population listens to, but they also change how active it is overall.
 * Comparing raw spike counts, a population that happened to win early collects
 * rewards, grows louder on every image and ends up answering everything. So the
 * answer compares each population's response with its own typical response (a
 * running average over training trials): the decision reflects how much *this*
 * image excites it. (Also scaling each population's read-out towards a common
 * activity level, synaptic scaling, was tried: it fights this rule and makes the
 * answer bias oscillate, so it is not used.)
 *
 * Reward prediction error. The neuromodulator delivered is not the raw outcome
 * (+1 right, −1 wrong) but the outcome minus how well the network has been doing
 * lately, as dopamine signals in the brain: once it is usually right, a correct
 * answer is no surprise and changes little, while a mistake stands out. Without
 * this, rewards outnumber punishments as soon as accuracy passes 50%, weights
 * ratchet up until they saturate, and what was learned is lost.
 */
import { retinaRates, type RetinaLayout } from './retina.ts';
import { runTrial, type TrialNet, type TrialResult } from './trial.ts';

export type VisionNet = TrialNet;

export interface VisionSetup {
  layout: RetinaLayout;
  /** Region index of each class's answer population. */
  outputs: number[];
  /** Projection indices of each class's learned read-out pathway. */
  readProjections: number[][];
  projectionCount: number;
}

/** Trial timing and learning settings (calibrated in tests/unit/vision.test.ts). */
export const VISION_TRIAL = {
  /** Mean input rate over the retina for every image, Hz. */
  meanRateHz: 60,
  /** Synaptic current delivered per input event. */
  amplitude: 3,
  presentMs: 200,
  settleMs: 40,
  restMs: 150,
  reward: 1,
  punishment: 1,
  /** Averaging weight of each population's typical response. */
  averaging: 0.05,
  /** Averaging weight of the expected outcome (reward prediction). */
  expectationRate: 0.05,
};

export interface VisionTrialResult extends TrialResult {
  /** Responses relative to each population's typical response. */
  scores: number[];
}

export class VisionTrainer {
  /** Running average response of each answer population (training trials). */
  readonly typical: number[];
  readonly setup: VisionSetup;
  readonly settings: typeof VISION_TRIAL;
  private readonly net: VisionNet;
  private trained = 0;
  /** Expected outcome in [-1, 1]: running average of +1 (right) / −1 (wrong). */
  expected = 0;

  constructor(net: VisionNet, setup: VisionSetup, settings = VISION_TRIAL) {
    this.net = net;
    this.setup = setup;
    this.settings = settings;
    this.typical = setup.outputs.map(() => 0);
  }

  get trainedTrials(): number {
    return this.trained;
  }

  /**
   * Shows one image (features from `encodePixels`). With `learn`, the answer is
   * rewarded or punished against `label` and homeostasis is updated; otherwise
   * the network only answers.
   */
  trial(features: Float32Array, label: number | null, learn: boolean): VisionTrialResult {
    const s = this.settings;
    const warm = this.trained >= this.setup.outputs.length * 5;
    const scale = this.typical.map((t) => (warm ? 1 / Math.max(1, t) : 1));
    // Reward prediction error: outcome minus expectation, so `reward` and
    // `punishment` are what a right or wrong answer delivers right now.
    const reward = Math.max(0, s.reward * (1 - this.expected));
    const punishment = Math.max(0, s.punishment * (1 + this.expected));
    const r = runTrial(this.net, {
      ids: this.setup.layout.ids,
      rates: retinaRates(this.setup.layout, features, s.meanRateHz),
      amplitude: s.amplitude,
      presentMs: s.presentMs,
      settleMs: s.settleMs,
      restMs: s.restMs,
      outputs: this.setup.outputs,
      readProjections: this.setup.readProjections,
      projectionCount: this.setup.projectionCount,
      scale,
      label,
      learn: learn && label !== null,
      reward,
      punishment,
    });
    if (learn && label !== null) {
      this.expected += s.expectationRate * ((r.correct ? 1 : -1) - this.expected);
      this.observe(r.counts);
    }
    return { ...r, scores: r.counts.map((c, k) => c * scale[k]) };
  }

  private observe(counts: number[]): void {
    const s = this.settings;
    const first = this.trained < 10;
    counts.forEach((c, k) => {
      this.typical[k] = first ? (this.typical[k] * this.trained + c) / (this.trained + 1) : (1 - s.averaging) * this.typical[k] + s.averaging * c;
    });
    this.trained++;
  }
}
