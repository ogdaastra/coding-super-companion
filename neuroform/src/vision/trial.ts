/**
 * One trial of the vision task: show an image, read the network's answer, and
 * (when learning) reward or punish it. The same code runs in the simulation
 * worker and, in tests, directly on the engine in Node.
 *
 *   ┌ present ─────────────────────────┐┌ rest ─────────────┐
 *   input on   settle │ count output spikes │ input off, reward/punishment acts
 *
 * The answer is the class whose output population fired most while counting.
 * Reward-modulated STDP turns the reward into weight changes on the synapses that
 * were active (eligible) during the trial; eligibility is cleared at the start of
 * each trial so a reward only credits that trial's activity.
 *
 * The reward or punishment reaches only the read-out pathways of the answer that
 * was given (the engine's per-projection reward gate). With a single global
 * signal, a losing population that was still somewhat active would be punished
 * for its own correct class whenever another population won, and learn the
 * opposite of what it should.
 */

export interface TrialNet {
  /** Simulation timestep, ms. */
  readonly dt: number;
  setInput(ids: ArrayLike<number>, ratesHz: ArrayLike<number>, amplitude: number): number;
  clearInput(): void;
  clearEligibility(): void;
  run(steps: number): void;
  injectReward(amount: number): void;
  /** Per-projection share of the neuromodulator; empty opens all. */
  setRewardGate(gates: ArrayLike<number>): void;
  /** Excitatory spikes per region since the previous call. */
  regionSpikes(): number[];
}

export interface TrialSpec {
  ids: ArrayLike<number>;
  rates: ArrayLike<number>;
  amplitude: number;
  presentMs: number;
  /** Start of the presentation that is not counted (response latency). */
  settleMs: number;
  restMs: number;
  /** Region index of each class's output population. */
  outputs: number[];
  /** Projection indices of each class's learned read-out pathway. */
  readProjections: number[][];
  projectionCount: number;
  /**
   * Per class: multiplier on its spike count when deciding (for example the
   * inverse of its typical response). Defaults to 1.
   */
  scale?: number[];
  /** The correct class, or null when there is none (classifying a new image). */
  label: number | null;
  /** Deliver reward/punishment (training) or only measure (testing). */
  learn: boolean;
  reward: number;
  punishment: number;
}

export interface TrialResult {
  counts: number[];
  /** Class index, or -1 when no output fired or the top classes tied. */
  guess: number;
  correct: boolean | null;
  /** Reward delivered (positive), punishment (negative) or 0. */
  delivered: number;
}

export function decide(counts: number[]): number {
  let best = -1;
  let top = 0;
  let tie = false;
  counts.forEach((c, k) => {
    if (c > top) {
      top = c;
      best = k;
      tie = false;
    } else if (c === top && c > 0) {
      tie = true;
    }
  });
  return tie ? -1 : best;
}

export function runTrial(net: TrialNet, spec: TrialSpec): TrialResult {
  const steps = (ms: number) => Math.max(0, Math.round(ms / net.dt));
  const settle = Math.min(spec.settleMs, spec.presentMs);
  net.clearEligibility();
  net.setInput(spec.ids, spec.rates, spec.amplitude);
  net.run(steps(settle));
  net.regionSpikes();
  net.run(steps(spec.presentMs - settle));
  const all = net.regionSpikes();
  const counts = spec.outputs.map((r) => all[r] ?? 0);
  net.clearInput();
  const guess = decide(spec.scale ? counts.map((c, k) => c * (spec.scale![k] ?? 1)) : counts);
  const correct = spec.label === null ? null : guess === spec.label;
  let delivered = 0;
  if (spec.learn && correct !== null) {
    delivered = correct ? spec.reward : -spec.punishment;
    if (delivered !== 0) {
      // Credit the answer given; with no clear answer, every read-out pathway.
      const open = guess >= 0 ? [guess] : spec.outputs.map((_, k) => k);
      const gate = new Float32Array(spec.projectionCount);
      for (const k of open) for (const p of spec.readProjections[k]) gate[p] = 1;
      net.setRewardGate(gate);
      net.injectReward(delivered);
    }
  }
  net.run(steps(spec.restMs));
  if (delivered !== 0) net.setRewardGate([]);
  net.regionSpikes();
  return { counts, guess, correct, delivered };
}
