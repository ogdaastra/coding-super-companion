/**
 * The built-in experiments. Each runs against the live network through the
 * `ExperimentContext`: real stimuli, real spikes, real weights. Conditions that are
 * compared start from identical initial conditions (a reset to time zero with the
 * network's seed), so differences come from the manipulation alone.
 */

import type { NetInfo } from '../engine/types.ts';
import type { ExperimentContext, ExperimentDefinition, ExperimentResult, ParamValue } from './types.ts';
import { binned, countByRegion, distinctNeurons, fmt, mean, onsetBin, pct, pearson, std } from './analysis.ts';

function findRegion(info: NetInfo, ids: string[], fallback = 0): number {
  for (const id of ids) {
    const i = info.regions.findIndex((r) => r.id === id);
    if (i >= 0) return i;
  }
  return Math.min(fallback, info.regions.length - 1);
}

function interProjection(info: NetInfo): number {
  const i = info.projections.findIndex((p) => p.from !== p.to && p.source === 'excitatory');
  return i >= 0 ? i : 0;
}

const num = (v: ParamValue) => Number(v);
const name = (info: NetInfo, r: number) => info.regions[r]?.name ?? `Region ${r}`;

function regionSizes(info: NetInfo): number[] {
  return info.regions.map((r) => r.end - r.start);
}

/** Region-wise rates (Hz) from a capture window. */
function rates(ctx: ExperimentContext, spikes: Uint32Array, from: number, to: number): number[] {
  const counts = countByRegion(spikes, ctx.regionOf, ctx.info.regions.length, from, to);
  const secs = ((to - from) * ctx.dt) / 1000;
  return counts.map((c, i) => c / Math.max(1, regionSizes(ctx.info)[i]) / Math.max(1e-9, secs));
}

async function settle(ctx: ExperimentContext, ms: number, reset: boolean): Promise<void> {
  if (reset) await ctx.reset();
  ctx.progress(0.02, 'Settling network');
  await ctx.advance(ms);
}

/** One stimulus trial: baseline window then response window, all spikes captured. */
async function propagationTrial(ctx: ExperimentContext, source: number, amplitude: number, durationMs: number, fraction: number, baselineMs: number, windowMs: number) {
  const startStep = ctx.step();
  const cap = await ctx.capture(async () => {
    await ctx.advance(baselineMs);
    await ctx.stimulate({ label: 'Experiment stimulus', target: { kind: 'regions', regions: [source], fraction }, amplitude, pattern: 'constant', durationMs });
    await ctx.advance(windowMs);
  });
  const onset = startStep + Math.round(baselineMs / ctx.dt);
  return { cap, onset, end: onset + Math.round(windowMs / ctx.dt), baselineStart: startStep };
}

function propagationAnalysis(ctx: ExperimentContext, trial: Awaited<ReturnType<typeof propagationTrial>>, binMs = 4) {
  const { cap, onset, end, baselineStart } = trial;
  const info = ctx.info;
  const R = info.regions.length;
  const binSteps = Math.max(1, Math.round(binMs / ctx.dt));
  const baseBins = Math.floor((onset - baselineStart) / binSteps);
  const respBins = Math.floor((end - onset) / binSteps);
  const base = binned(cap.spikes, ctx.regionOf, R, baselineStart, binSteps, baseBins);
  const resp = binned(cap.spikes, ctx.regionOf, R, onset, binSteps, respBins);
  const baseRate = rates(ctx, cap.spikes, baselineStart, onset);
  const respRate = rates(ctx, cap.spikes, onset, end);
  const latency = info.regions.map((_, r) => {
    const b = onsetBin(resp[r], mean(base[r]), std(base[r]), 3.5);
    return b < 0 ? NaN : b * binMs;
  });
  const spikes = countByRegion(cap.spikes, ctx.regionOf, R, onset, end).reduce((a, b) => a + b, 0);
  const baselineSpikes = countByRegion(cap.spikes, ctx.regionOf, R, baselineStart, onset).reduce((a, b) => a + b, 0) * ((end - onset) / Math.max(1, onset - baselineStart));
  const activated = distinctNeurons(cap.spikes, onset, end);
  return { baseRate, respRate, latency, spikes, baselineSpikes, activated, resp, binMs };
}

// ---------------------------------------------------------------------- A

const signalPropagation: ExperimentDefinition = {
  id: 'propagation',
  letter: 'A',
  name: 'Signal propagation',
  summary: 'Stimulate one population and follow the activity through connected populations.',
  description: [
    'A constant current is injected into part of the source region after a quiet baseline.',
    'Every spike of every neuron is captured; responses are compared region by region with the baseline that preceded the stimulus.',
  ],
  method: 'Latency: first 4-ms bin after stimulus onset in which a region’s spike count exceeds its baseline mean + 3.5σ (σ of the 4-ms baseline bins) for two consecutive bins. Activated neurons: distinct neurons that fired at least once in the response window.',
  suggestedPreset: 'observatory',
  params: [
    { key: 'source', label: 'Source region', type: 'region', default: (i) => findRegion(i, ['visual', 'inputA', 'l4', 'column', 'common', 'm1']) },
    { key: 'amplitude', label: 'Amplitude', type: 'number', default: () => 4, min: 0.1, max: 20, step: 0.1, unit: 'I' },
    { key: 'duration', label: 'Stimulus duration', type: 'number', default: () => 30, min: 1, max: 500, step: 1, unit: 'ms' },
    { key: 'fraction', label: 'Fraction stimulated', type: 'number', default: () => 0.7, min: 0.01, max: 1, step: 0.01 },
    { key: 'window', label: 'Response window', type: 'number', default: () => 150, min: 20, max: 2000, step: 10, unit: 'ms' },
    { key: 'reset', label: 'Start from time zero (reproducible)', type: 'boolean', default: () => true },
  ],
  async run(ctx, p) {
    const info = ctx.info;
    const source = num(p.source);
    await settle(ctx, 300, Boolean(p.reset));
    ctx.progress(0.3, 'Baseline and stimulus');
    const trial = await propagationTrial(ctx, source, num(p.amplitude), num(p.duration), num(p.fraction), 200, num(p.window));
    ctx.progress(0.9, 'Analysing spikes');
    const a = propagationAnalysis(ctx, trial);
    const reached = a.latency.filter((l, r) => r !== source && Number.isFinite(l)).length;
    ctx.live({ 'Neurons activated': a.activated.toLocaleString('en-GB'), 'Spikes in window': a.spikes.toLocaleString('en-GB') });
    const order = info.regions.map((_, r) => r).filter((r) => Number.isFinite(a.latency[r])).sort((x, y) => a.latency[x] - a.latency[y]);
    return {
      headline: `Activity reached ${reached} of ${info.regions.length - 1} other regions${order.length > 1 ? `; first ${name(info, order[0])}, last ${name(info, order[order.length - 1])} at ${fmt(a.latency[order[order.length - 1]], 1)} ms` : ''}.`,
      summary: [
        { label: 'Neurons activated', value: a.activated.toLocaleString('en-GB'), note: 'distinct neurons firing in the window' },
        { label: 'Spikes generated', value: a.spikes.toLocaleString('en-GB'), note: `baseline expectation ${Math.round(a.baselineSpikes).toLocaleString('en-GB')}` },
        { label: 'Extra spikes', value: Math.round(a.spikes - a.baselineSpikes).toLocaleString('en-GB') },
        { label: 'Regions responding', value: `${reached + (Number.isFinite(a.latency[source]) ? 1 : 0)} / ${info.regions.length}` },
      ],
      tables: [
        {
          title: 'Regional responses',
          columns: ['Region', 'Baseline Hz', 'Response Hz', 'Change', 'Latency ms'],
          rows: info.regions.map((r, i) => [r.name, fmt(a.baseRate[i]), fmt(a.respRate[i]), pct(a.baseRate[i], a.respRate[i]), Number.isFinite(a.latency[i]) ? fmt(a.latency[i], 1) : 'no response']),
        },
      ],
      charts: [
        {
          title: 'Population response after stimulus onset',
          xLabel: 'ms after onset',
          yLabel: 'spikes per 4 ms',
          x: a.resp[0].map((_, b) => b * a.binMs),
          series: info.regions.map((r, i) => ({ name: r.name, values: a.resp[i] })),
        },
      ],
      notes: [`Stimulus: ${num(p.amplitude)} current units for ${num(p.duration)} ms into ${Math.round(num(p.fraction) * 100)} % of ${name(info, source)}.`],
    };
  },
};

// ---------------------------------------------------------------------- B

const synchronisation: ExperimentDefinition = {
  id: 'synchrony',
  letter: 'B',
  name: 'Synchronisation',
  summary: 'Drive two populations with shared or independent input and measure how synchronised they become.',
  description: [
    'Three conditions, each from identical initial conditions: no extra input, independent input (pulse trains at different frequencies), and shared input (one pulse train delivered to both).',
    'The drive is the same strength in both input conditions; only its timing relationship differs.',
  ],
  method: 'χ (Golomb–Rinzel): √(variance over time of the mean membrane potential ÷ mean variance of individual membrane potentials), over a fixed sample of neurons from both populations. 0 ≈ independent, 1 = identical. r: Pearson correlation of the two populations’ spike counts in 2-ms bins.',
  suggestedPreset: 'sync-lab',
  params: [
    { key: 'a', label: 'Population A', type: 'region', default: (i) => findRegion(i, ['popA', 'sensory', 'inputA'], 0) },
    { key: 'b', label: 'Population B', type: 'region', default: (i) => findRegion(i, ['popB', 'memory', 'inputB'], 1) },
    { key: 'amplitude', label: 'Pulse amplitude', type: 'number', default: () => 2.5, min: 0.1, max: 20, step: 0.1, unit: 'I' },
    { key: 'frequency', label: 'Pulse frequency', type: 'number', default: () => 25, min: 2, max: 200, step: 1, unit: 'Hz' },
    { key: 'fraction', label: 'Fraction driven', type: 'number', default: () => 0.6, min: 0.05, max: 1, step: 0.05 },
    { key: 'duration', label: 'Condition length', type: 'number', default: () => 1000, min: 200, max: 10000, step: 100, unit: 'ms' },
  ],
  async run(ctx, p) {
    const info = ctx.info;
    const A = num(p.a);
    const B = num(p.b);
    const f = num(p.frequency);
    const dur = num(p.duration);
    const amp = num(p.amplitude);
    const frac = num(p.fraction);
    await ctx.setSyncGroup([A, B]);
    const conditions = ['No input', 'Independent input', 'Shared input'] as const;
    const out: { chi: number; chiA: number; chiB: number; r: number; rateA: number; rateB: number }[] = [];
    for (let c = 0; c < conditions.length; c++) {
      ctx.progress(0.05 + c * 0.3, conditions[c]);
      await ctx.reset();
      await ctx.advance(200);
      if (c > 0) {
        const pulse = Math.min(4, 400 / f);
        const fa = f;
        const fb = c === 1 ? f * 1.37 : f;
        await ctx.stimulate({ label: 'Drive A', target: { kind: 'regions', regions: [A], fraction: frac }, amplitude: amp, pattern: 'pulses', frequencyHz: fa, pulseMs: pulse, durationMs: dur });
        await ctx.stimulate({ label: 'Drive B', target: { kind: 'regions', regions: [B], fraction: frac }, amplitude: amp, pattern: 'pulses', frequencyHz: fb, pulseMs: pulse, durationMs: dur, startMs: c === 1 ? 500 / f : 0 });
      }
      await ctx.measure();
      const start = ctx.step();
      const cap = await ctx.capture(() => ctx.advance(dur));
      const m = await ctx.measure();
      const binSteps = Math.round(2 / ctx.dt);
      const bins = Math.floor((cap.endStep - start) / binSteps);
      const b = binned(cap.spikes, ctx.regionOf, info.regions.length, start, binSteps, bins);
      const rr = rates(ctx, cap.spikes, start, cap.endStep);
      out.push({ chi: m.groupSynchrony, chiA: m.regions[A].synchrony, chiB: m.regions[B].synchrony, r: pearson(b[A], b[B]), rateA: rr[A], rateB: rr[B] });
      ctx.live({ [conditions[c]]: `χ ${fmt(m.groupSynchrony, 3)} · r ${fmt(out[c].r, 3)}` });
    }
    const [none, ind, shared] = out;
    return {
      headline: `Shared input ${shared.chi > ind.chi ? 'increased' : 'did not increase'} synchrony: χ ${fmt(ind.chi, 3)} (independent) → ${fmt(shared.chi, 3)} (shared); cross-population r ${fmt(ind.r, 3)} → ${fmt(shared.r, 3)}.`,
      summary: [
        { label: 'χ no input', value: fmt(none.chi, 3) },
        { label: 'χ independent', value: fmt(ind.chi, 3) },
        { label: 'χ shared', value: fmt(shared.chi, 3) },
        { label: 'r shared − independent', value: fmt(shared.r - ind.r, 3) },
      ],
      tables: [
        {
          title: 'Conditions',
          columns: ['Condition', 'χ (A ∪ B)', `χ ${name(info, A)}`, `χ ${name(info, B)}`, 'r (A, B)', `${name(info, A)} Hz`, `${name(info, B)} Hz`],
          rows: conditions.map((c, i) => [c, fmt(out[i].chi, 3), fmt(out[i].chiA, 3), fmt(out[i].chiB, 3), fmt(out[i].r, 3), fmt(out[i].rateA), fmt(out[i].rateB)]),
        },
      ],
      charts: [{ title: 'Synchrony by condition', xLabel: 'condition', yLabel: 'value', kind: 'bar', x: [0, 1, 2], series: [{ name: 'χ (A ∪ B)', values: out.map((o) => o.chi) }, { name: 'r (A, B)', values: out.map((o) => o.r) }] }],
      notes: [`Independent condition: A at ${fmt(f, 0)} Hz, B at ${fmt(f * 1.37, 1)} Hz with a half-period offset. Shared: both at ${fmt(f, 0)} Hz in phase.`],
    };
  },
};

// ---------------------------------------------------------------------- C

async function pathwayWeights(ctx: ExperimentContext, from: number, to: number): Promise<{ mean: number; synapses: number; plastic: boolean }> {
  const stats = await ctx.projectionStats();
  let sum = 0;
  let n = 0;
  let plastic = false;
  ctx.info.projections.forEach((pr, i) => {
    if (pr.from === from && pr.to === to && pr.source === 'excitatory') {
      sum += stats[i].meanWeight * stats[i].synapses;
      n += stats[i].synapses;
      plastic ||= pr.plastic;
    }
  });
  return { mean: n ? sum / n : NaN, synapses: n, plastic };
}

async function responseOf(ctx: ExperimentContext, stimRegion: number, readRegion: number, amplitude: number, trials: number): Promise<number> {
  const counts: number[] = [];
  for (let t = 0; t < trials; t++) {
    const start = ctx.step();
    const cap = await ctx.capture(async () => {
      await ctx.stimulate({ label: 'Test', target: { kind: 'regions', regions: [stimRegion], fraction: 0.5 }, amplitude, pattern: 'constant', durationMs: 15 });
      await ctx.advance(60);
    });
    counts.push(countByRegion(cap.spikes, ctx.regionOf, ctx.info.regions.length, start, cap.endStep)[readRegion]);
    await ctx.advance(240);
  }
  return mean(counts);
}

const associationLearning: ExperimentDefinition = {
  id: 'association',
  letter: 'C',
  name: 'Association learning',
  summary: 'Pair two populations repeatedly with a fixed timing and measure whether the synapses between them strengthen.',
  description: [
    'Before and after training, population A is stimulated alone and the response of population B is counted (5 trials each).',
    'During training plasticity is switched on and A is stimulated, followed after Δt by B, many times. Pre-before-post timing should potentiate A → B synapses under STDP.',
    'Synaptic weights are read directly from the engine before and after.',
  ],
  method: 'Pathway weight: mean |w| over all A → B excitatory synapses (exact). Response: spikes in B within 60 ms of a 15 ms test stimulus to A, mean over 5 trials.',
  suggestedPreset: 'learning-lab',
  params: [
    { key: 'a', label: 'Population A (first)', type: 'region', default: (i) => findRegion(i, ['inputA', 'sensory', 'visual'], 0) },
    { key: 'b', label: 'Population B (second)', type: 'region', default: (i) => findRegion(i, ['inputB', 'association', 'memory'], 1) },
    { key: 'dt', label: 'Δt (A before B)', type: 'number', default: () => 8, min: -50, max: 50, step: 1, unit: 'ms' },
    { key: 'reps', label: 'Pairings', type: 'number', default: () => 60, min: 1, max: 1000, step: 1 },
    { key: 'interval', label: 'Interval', type: 'number', default: () => 150, min: 40, max: 2000, step: 10, unit: 'ms' },
    { key: 'amplitude', label: 'Amplitude', type: 'number', default: () => 4, min: 0.1, max: 20, step: 0.1, unit: 'I' },
    { key: 'rate', label: 'Learning-rate scale', type: 'number', default: () => 1, min: 0.1, max: 20, step: 0.1 },
  ],
  async run(ctx, p) {
    const info = ctx.info;
    const A = num(p.a);
    const B = num(p.b);
    const amp = num(p.amplitude);
    await ctx.reset();
    await ctx.setPlasticity(false);
    await ctx.advance(300);
    ctx.progress(0.08, 'Pre-training test');
    const preResp = await responseOf(ctx, A, B, amp, 5);
    const preAB = await pathwayWeights(ctx, A, B);
    const preBA = await pathwayWeights(ctx, B, A);
    if (preAB.synapses === 0) ctx.log(`No direct ${name(info, A)} → ${name(info, B)} pathway exists; weights are reported where available.`);
    await ctx.setPlasticity(true, num(p.rate));
    const reps = Math.round(num(p.reps));
    const iv = num(p.interval);
    const dt = num(p.dt);
    const startA = dt >= 0 ? 0 : -dt;
    const startB = dt >= 0 ? dt : 0;
    await ctx.stimulate({ label: 'Pair A', target: { kind: 'regions', regions: [A], fraction: 0.6 }, amplitude: amp, pattern: 'constant', durationMs: 6, repetitions: reps, intervalMs: iv, startMs: startA });
    await ctx.stimulate({ label: 'Pair B', target: { kind: 'regions', regions: [B], fraction: 0.6 }, amplitude: amp, pattern: 'constant', durationMs: 6, repetitions: reps, intervalMs: iv, startMs: startB });
    const xs: number[] = [0];
    const ws: number[] = [preAB.mean];
    const blocks = Math.min(20, reps);
    const perBlock = (reps * iv) / blocks;
    for (let k = 1; k <= blocks; k++) {
      ctx.progress(0.15 + (0.65 * k) / blocks, `Training: pairing ${Math.round((k * reps) / blocks)} of ${reps}`);
      await ctx.advance(perBlock);
      const w = await pathwayWeights(ctx, A, B);
      xs.push(Math.round((k * reps) / blocks));
      ws.push(w.mean);
      ctx.live({ [`${name(info, A)} → ${name(info, B)} weight`]: fmt(w.mean, 4) });
    }
    await ctx.setPlasticity(false);
    await ctx.advance(300);
    ctx.progress(0.88, 'Post-training test');
    const postResp = await responseOf(ctx, A, B, amp, 5);
    const postAB = await pathwayWeights(ctx, A, B);
    const postBA = await pathwayWeights(ctx, B, A);
    const top = await ctx.topChanges(10);
    const result: ExperimentResult = {
      headline: preAB.synapses
        ? `${name(info, A)} → ${name(info, B)} mean weight ${fmt(preAB.mean, 4)} → ${fmt(postAB.mean, 4)} (${pct(preAB.mean, postAB.mean)}); response of B to A ${fmt(preResp, 1)} → ${fmt(postResp, 1)} spikes.`
        : `No direct pathway from ${name(info, A)} to ${name(info, B)}; response of B to A ${fmt(preResp, 1)} → ${fmt(postResp, 1)} spikes.`,
      summary: [
        { label: `${name(info, A)} → ${name(info, B)}`, value: preAB.synapses ? pct(preAB.mean, postAB.mean) : 'no pathway', note: preAB.plastic ? 'plastic pathway' : 'pathway is not plastic' },
        { label: `${name(info, B)} → ${name(info, A)}`, value: preBA.synapses ? pct(preBA.mean, postBA.mean) : 'no pathway' },
        { label: 'Response of B to A', value: `${fmt(preResp, 1)} → ${fmt(postResp, 1)}`, note: 'spikes per test' },
        { label: 'Pairings', value: `${reps} at Δt = ${dt} ms` },
      ],
      tables: [
        {
          title: 'Pathway weights (mean |w|)',
          columns: ['Pathway', 'Synapses', 'Before', 'After', 'Change'],
          rows: [
            [`${name(info, A)} → ${name(info, B)}`, preAB.synapses, fmt(preAB.mean, 4), fmt(postAB.mean, 4), pct(preAB.mean, postAB.mean)],
            [`${name(info, B)} → ${name(info, A)}`, preBA.synapses, fmt(preBA.mean, 4), fmt(postBA.mean, 4), pct(preBA.mean, postBA.mean)],
          ],
        },
        { title: 'Largest individual weight changes', columns: ['Synapse', 'Pre', 'Post', 'Initial', 'Now', 'Δ'], rows: top.map((t) => [t.synapse, t.pre, t.post, fmt(Math.abs(t.initial), 4), fmt(Math.abs(t.weight), 4), fmt(t.delta, 4)]) },
      ],
      charts: [{ title: `${name(info, A)} → ${name(info, B)} weight during training`, xLabel: 'pairings', yLabel: 'mean |w|', x: xs, series: [{ name: 'mean weight', values: ws }] }],
      notes: preAB.plastic || preBA.plastic ? [] : ['Neither pathway is plastic in this configuration; weights cannot change. Use the Learning Lab preset or enable plasticity on these projections.'],
    };
    return result;
  },
};

// ---------------------------------------------------------------------- D

const repeatedStimulation: ExperimentDefinition = {
  id: 'repeated',
  letter: 'D',
  name: 'Repeated stimulation',
  summary: 'Stimulate the same population many times and track how its responses and outgoing weights change.',
  description: ['The same stimulus is delivered repeatedly. For each repetition the spikes evoked in the stimulated region and in every other region are counted. With plasticity on, outgoing pathway weights are measured before and after.'],
  method: 'Response per repetition: spikes within 50 ms of each stimulus onset, per region (exact counts from captured spikes).',
  suggestedPreset: 'observatory',
  params: [
    { key: 'region', label: 'Region', type: 'region', default: (i) => findRegion(i, ['sensory', 'inputA', 'l4', 'column'], 0) },
    { key: 'reps', label: 'Repetitions', type: 'number', default: () => 20, min: 2, max: 500, step: 1 },
    { key: 'interval', label: 'Interval', type: 'number', default: () => 250, min: 50, max: 5000, step: 10, unit: 'ms' },
    { key: 'amplitude', label: 'Amplitude', type: 'number', default: () => 3, min: 0.1, max: 20, step: 0.1, unit: 'I' },
    { key: 'duration', label: 'Duration', type: 'number', default: () => 15, min: 1, max: 200, step: 1, unit: 'ms' },
    { key: 'plasticity', label: 'Plasticity on during the run', type: 'boolean', default: (i) => i.plastic },
  ],
  async run(ctx, p) {
    const info = ctx.info;
    const R = num(p.region);
    const reps = Math.round(num(p.reps));
    const iv = num(p.interval);
    await settle(ctx, 200, true);
    const before = await ctx.projectionStats();
    if (p.plasticity) await ctx.setPlasticity(true);
    const start = ctx.step();
    await ctx.stimulate({ label: 'Repeated', target: { kind: 'regions', regions: [R], fraction: 0.5 }, amplitude: num(p.amplitude), pattern: 'constant', durationMs: num(p.duration), repetitions: reps, intervalMs: iv });
    const cap = await ctx.capture(async () => {
      const blocks = Math.min(reps, 25);
      for (let k = 0; k < blocks; k++) {
        ctx.progress(0.1 + (0.8 * k) / blocks, `Repetition ${Math.round(((k + 1) * reps) / blocks)} of ${reps}`);
        await ctx.advance((reps * iv) / blocks);
      }
    });
    if (p.plasticity) await ctx.setPlasticity(false);
    const after = await ctx.projectionStats();
    const ivSteps = Math.round(iv / ctx.dt);
    const win = Math.round(50 / ctx.dt);
    const perRep = info.regions.map(() => [] as number[]);
    for (let k = 0; k < reps; k++) {
      const c = countByRegion(cap.spikes, ctx.regionOf, info.regions.length, start + k * ivSteps, start + k * ivSteps + win);
      c.forEach((v, r) => perRep[r].push(v));
    }
    const first = mean(perRep[R].slice(0, Math.max(1, Math.floor(reps / 4))));
    const last = mean(perRep[R].slice(-Math.max(1, Math.floor(reps / 4))));
    const out = info.projections.map((pr, i) => ({ pr, i })).filter(({ pr }) => pr.from === R && pr.to !== R);
    return {
      headline: `Response of ${name(info, R)} changed ${pct(first, last)} from the first to the last quarter of repetitions.`,
      summary: [
        { label: 'First-quarter response', value: fmt(first, 1), note: 'spikes / repetition' },
        { label: 'Last-quarter response', value: fmt(last, 1) },
        { label: 'Change', value: pct(first, last) },
        { label: 'Repetitions', value: String(reps) },
      ],
      tables: [
        {
          title: 'Outgoing pathways',
          columns: ['Pathway', 'Plastic', 'Weight before', 'After', 'Change'],
          rows: out.map(({ pr, i }) => [`${name(info, pr.from)} → ${name(info, pr.to)}`, pr.plastic ? pr.rule : 'no', fmt(before[i].meanWeight, 4), fmt(after[i].meanWeight, 4), pct(before[i].meanWeight, after[i].meanWeight)]),
        },
      ],
      charts: [{ title: 'Spikes evoked per repetition', xLabel: 'repetition', yLabel: 'spikes in 50 ms', x: perRep[R].map((_, k) => k + 1), series: info.regions.map((r, i) => ({ name: r.name, values: perRep[i] })) }],
      notes: p.plasticity ? [] : ['Plasticity was off, so any change reflects network state (adaptation of activity), not learning.'],
    };
  },
};

// ---------------------------------------------------------------------- E

const disruption: ExperimentDefinition = {
  id: 'disruption',
  letter: 'E',
  name: 'Network disruption',
  summary: 'Disable a population or a pathway and compare signal propagation with the intact network.',
  description: ['The same propagation trial is run twice from identical initial conditions: once intact, once with the chosen region silenced or pathway cut. Nothing else differs.'],
  method: 'Responses per region: mean firing rate in the response window; latency as in Experiment A.',
  suggestedPreset: 'observatory',
  params: [
    { key: 'source', label: 'Stimulated region', type: 'region', default: (i) => findRegion(i, ['visual', 'inputA', 'l4', 'column'], 0) },
    {
      key: 'kind',
      label: 'Disrupt',
      type: 'select',
      default: () => 'region',
      options: [
        { value: 'region', label: 'A region' },
        { value: 'pathway', label: 'A pathway' },
      ],
    },
    { key: 'region', label: 'Region to silence', type: 'region', default: (i) => findRegion(i, ['sensory', 'association', 'inputB'], 1) },
    { key: 'projection', label: 'Pathway to cut', type: 'projection', default: (i) => interProjection(i) },
    { key: 'amplitude', label: 'Amplitude', type: 'number', default: () => 3, min: 0.1, max: 20, step: 0.1, unit: 'I' },
    { key: 'window', label: 'Response window', type: 'number', default: () => 120, min: 20, max: 2000, step: 10, unit: 'ms' },
  ],
  async run(ctx, p) {
    const info = ctx.info;
    const source = num(p.source);
    const trial = async () => {
      await settle(ctx, 300, true);
      return propagationAnalysis(ctx, await propagationTrial(ctx, source, num(p.amplitude), 20, 0.5, 200, num(p.window)));
    };
    ctx.progress(0.1, 'Intact network');
    const intact = await trial();
    const what = p.kind === 'pathway' ? info.projections[num(p.projection)] : null;
    if (what) await ctx.setProjectionGain(num(p.projection), 0);
    else await ctx.setRegionEnabled(num(p.region), false);
    ctx.progress(0.55, 'Disrupted network');
    const broken = await trial();
    await ctx.restoreChanges();
    const label = what ? `pathway ${name(info, what.from)} → ${name(info, what.to)} cut` : `${name(info, num(p.region))} silenced`;
    const drop = info.regions.map((_, r) => (intact.respRate[r] > 0 ? (broken.respRate[r] - intact.respRate[r]) / intact.respRate[r] : 0));
    const worst = drop.reduce((a, d, r) => (r !== source && d < drop[a] ? r : a), source === 0 ? 1 : 0);
    return {
      headline: `With the ${label}, total spikes in the response window changed ${pct(intact.spikes, broken.spikes)}; ${name(info, worst)} was affected most (${pct(intact.respRate[worst], broken.respRate[worst])}).`,
      summary: [
        { label: 'Activated neurons', value: `${intact.activated.toLocaleString('en-GB')} → ${broken.activated.toLocaleString('en-GB')}` },
        { label: 'Spikes in window', value: `${intact.spikes.toLocaleString('en-GB')} → ${broken.spikes.toLocaleString('en-GB')}` },
        { label: 'Change', value: pct(intact.spikes, broken.spikes) },
        { label: 'Disruption', value: label },
      ],
      tables: [
        {
          title: 'Responses: intact vs disrupted',
          columns: ['Region', 'Intact Hz', 'Disrupted Hz', 'Change', 'Latency intact', 'Latency disrupted'],
          rows: info.regions.map((r, i) => [r.name, fmt(intact.respRate[i]), fmt(broken.respRate[i]), pct(intact.respRate[i], broken.respRate[i]), Number.isFinite(intact.latency[i]) ? fmt(intact.latency[i], 1) : '—', Number.isFinite(broken.latency[i]) ? fmt(broken.latency[i], 1) : '—']),
        },
      ],
      charts: [{ title: 'Response rate by region', xLabel: 'region', yLabel: 'Hz', kind: 'bar', x: info.regions.map((_, i) => i), series: [{ name: 'Intact', values: intact.respRate }, { name: 'Disrupted', values: broken.respRate }] }],
      notes: ['The disruption was undone at the end of the experiment.'],
    };
  },
};

// ---------------------------------------------------------------------- F

const inhibitoryControl: ExperimentDefinition = {
  id: 'inhibition',
  letter: 'F',
  name: 'Inhibitory control',
  summary: 'Scale the excitability of inhibitory neurons and measure firing rates and synchrony.',
  description: ['For each level, the inhibitory population(s) excitability is set to the level × its original mean, the network is reset to identical initial conditions and measured. Original values are restored afterwards.'],
  method: 'Rates from exact spike counts over the measurement window; synchrony χ over the sampled neurons of the chosen region(s).',
  suggestedPreset: 'sync-lab',
  params: [
    { key: 'region', label: 'Region (−1 = all)', type: 'region', default: (i) => findRegion(i, ['popA', 'association', 'l23'], 0) },
    { key: 'all', label: 'Apply to every region', type: 'boolean', default: () => false },
    { key: 'window', label: 'Measurement window', type: 'number', default: () => 800, min: 100, max: 10000, step: 100, unit: 'ms' },
  ],
  async run(ctx, p) {
    const info = ctx.info;
    const regions = p.all ? info.regions.map((_, i) => i) : [num(p.region)];
    const levels = [0.25, 0.5, 0.75, 1, 1.5, 2];
    const base = await Promise.all(regions.map((r) => ctx.populationMean(r, 'inhibitory', 'excitability')));
    await ctx.setSyncGroup(regions);
    const exc: number[] = [];
    const inh: number[] = [];
    const chi: number[] = [];
    for (let k = 0; k < levels.length; k++) {
      ctx.progress(0.05 + (0.9 * k) / levels.length, `Inhibitory excitability × ${levels[k]}`);
      for (let j = 0; j < regions.length; j++) if (Number.isFinite(base[j])) await ctx.setPopulationParam(regions[j], 'inhibitory', 'excitability', base[j] * levels[k]);
      await ctx.reset();
      await ctx.advance(200);
      await ctx.measure();
      await ctx.advance(num(p.window));
      const m = await ctx.measure();
      const secs = m.windowMs / 1000;
      let se = 0, si = 0, ne = 0, ni = 0;
      for (const r of regions) {
        const reg = info.regions[r];
        se += m.regions[r].spikesExc;
        si += m.regions[r].spikesInh;
        ne += reg.excEnd - reg.start;
        ni += reg.end - reg.excEnd;
      }
      exc.push(se / Math.max(1, ne) / secs);
      inh.push(si / Math.max(1, ni) / secs);
      chi.push(m.groupSynchrony);
      ctx.live({ [`× ${levels[k]}`]: `E ${fmt(exc[k])} Hz · I ${fmt(inh[k])} Hz · χ ${fmt(chi[k], 3)}` });
    }
    await ctx.restoreChanges();
    const i1 = levels.indexOf(1);
    return {
      headline: `Halving inhibitory excitability changed excitatory firing ${pct(exc[i1], exc[levels.indexOf(0.5)])}; doubling it changed it ${pct(exc[i1], exc[levels.indexOf(2)])}.`,
      summary: [
        { label: 'E rate at ×1', value: `${fmt(exc[i1])} Hz` },
        { label: 'E rate at ×0.25', value: `${fmt(exc[0])} Hz` },
        { label: 'E rate at ×2', value: `${fmt(exc[levels.length - 1])} Hz` },
        { label: 'χ range', value: `${fmt(Math.min(...chi), 3)} – ${fmt(Math.max(...chi), 3)}` },
      ],
      tables: [{ title: 'Levels', columns: ['Inhibitory excitability', 'E rate Hz', 'I rate Hz', 'χ'], rows: levels.map((l, k) => [`× ${l}`, fmt(exc[k]), fmt(inh[k]), fmt(chi[k], 3)]) }],
      charts: [
        { title: 'Firing rate vs inhibitory excitability', xLabel: '× original', yLabel: 'Hz', x: levels, series: [{ name: 'Excitatory', values: exc }, { name: 'Inhibitory', values: inh }] },
        { title: 'Synchrony vs inhibitory excitability', xLabel: '× original', yLabel: 'χ', x: levels, series: [{ name: 'χ', values: chi }] },
      ],
      notes: [`Applied to: ${regions.map((r) => name(info, r)).join(', ')}. Original values restored.`],
    };
  },
};

// ---------------------------------------------------------------------- G

const weightExploration: ExperimentDefinition = {
  id: 'weights',
  letter: 'G',
  name: 'Weight exploration',
  summary: 'Sweep the strength of a pathway and measure how activity in its target responds.',
  description: ['For each gain, every synapse of the pathway is scaled by the gain (its stored weights are untouched), the network is reset to identical initial conditions, and the target is measured, optionally while the source is driven.'],
  method: 'Target firing rate from exact spike counts; transmitted events from the engine’s per-pathway event counter.',
  suggestedPreset: 'observatory',
  params: [
    { key: 'projection', label: 'Pathway', type: 'projection', default: (i) => interProjection(i) },
    { key: 'drive', label: 'Drive the source region', type: 'boolean', default: () => true },
    { key: 'window', label: 'Measurement window', type: 'number', default: () => 600, min: 100, max: 10000, step: 100, unit: 'ms' },
  ],
  async run(ctx, p) {
    const info = ctx.info;
    const pi = num(p.projection);
    const pr = info.projections[pi];
    const gains = [0, 0.5, 1, 1.5, 2, 3];
    const target: number[] = [];
    const events: number[] = [];
    for (let k = 0; k < gains.length; k++) {
      ctx.progress(0.05 + (0.9 * k) / gains.length, `Gain × ${gains[k]}`);
      await ctx.setProjectionGain(pi, gains[k]);
      await ctx.reset();
      await ctx.advance(200);
      if (p.drive) await ctx.stimulate({ label: 'Drive', target: { kind: 'regions', regions: [pr.from], fraction: 0.4 }, amplitude: 1.5, pattern: 'poisson', rateHz: 60, durationMs: num(p.window) });
      await ctx.measure();
      await ctx.advance(num(p.window));
      const m = await ctx.measure();
      const reg = info.regions[pr.to];
      target.push((m.regions[pr.to].spikesExc + m.regions[pr.to].spikesInh) / (reg.end - reg.start) / (m.windowMs / 1000));
      events.push(m.projectionEvents[pi] / (m.windowMs / 1000));
      ctx.live({ [`× ${gains[k]}`]: `${name(info, pr.to)} ${fmt(target[k])} Hz` });
    }
    await ctx.restoreChanges();
    return {
      headline: `${name(info, pr.to)} fired at ${fmt(target[0])} Hz with the pathway cut and ${fmt(target[target.length - 1])} Hz at ×3.`,
      summary: [
        { label: 'Pathway', value: `${name(info, pr.from)} → ${name(info, pr.to)}`, note: `${pr.synapses.toLocaleString('en-GB')} synapses` },
        { label: 'Target at ×0', value: `${fmt(target[0])} Hz` },
        { label: 'Target at ×1', value: `${fmt(target[2])} Hz` },
        { label: 'Target at ×3', value: `${fmt(target[5])} Hz` },
      ],
      tables: [{ title: 'Sweep', columns: ['Gain', 'Target rate Hz', 'Events / s on pathway'], rows: gains.map((g, k) => [`× ${g}`, fmt(target[k]), Math.round(events[k]).toLocaleString('en-GB')]) }],
      charts: [{ title: `${name(info, pr.to)} rate vs pathway gain`, xLabel: 'gain', yLabel: 'Hz', x: gains, series: [{ name: 'Target rate', values: target }] }],
      notes: ['Gain restored to its previous value afterwards.'],
    };
  },
};

export const EXPERIMENTS: readonly ExperimentDefinition[] = [
  signalPropagation,
  synchronisation,
  associationLearning,
  repeatedStimulation,
  disruption,
  inhibitoryControl,
  weightExploration,
];
