# The NEUROFORM simulation

This document describes exactly what the engine computes. Source:
`engine/core/src/` (Rust). Everything shown in the interface is read from this
state; nothing is animated independently of it.

## Neurons

Every neuron is a leaky integrate-and-fire (LIF) unit with its own state and
parameters, stored as structure-of-arrays (one contiguous array per field):

| Per-neuron field | Meaning |
|---|---|
| `v` | membrane potential V (mV) |
| `v_rest`, `v_th`, `v_reset` | resting, threshold and reset potentials |
| `tau` | membrane time constant τ_m (ms) |
| `refractory_ms`, `ref_left` | refractory period and remaining refractory steps |
| `resistance` | membrane resistance R_m |
| `excitability` | individual input gain ε |
| `bias`, `i_ext`, `i_stim` | background, user-applied and stimulus currents |
| `noise_std` | white-noise current intensity σ |
| `i_exc`, `i_inh` | excitatory and inhibitory synaptic currents |
| `spike_count`, `last_spike` | total spikes and step of the latest spike |
| `class`, `region`, position | excitatory/inhibitory, region id, x y z |
| plasticity traces | presynaptic x and postsynaptic y (see STDP) |

Each region holds an excitatory block followed by an inhibitory block. Neuron
class is simulation metadata: it decides the sign of every outgoing synapse.

### Membrane equation

```
dV/dt     = (V_rest − V)/τ_m + R_m · ε · I_total
I_total   = I_exc + I_inh + I_bias + I_ext + I_stim + I_noise
```

### Integration (exponential Euler)

With the input current held constant across a step Δt the equation has an exact
solution, which the engine uses:

```
V_∞       = V_rest + τ_m · R_m · ε · I_total
V(t + Δt) = V_∞ + (V(t) − V_∞) · exp(−Δt / τ_m)
```

This is unconditionally stable (no time-step restriction from τ_m) and exact for
piecewise-constant input. The only approximation is that synaptic current, which
decays within the step, is sampled once per step; with the default Δt = 0.5 ms
and τ_syn ≥ 5 ms the error is below 5 % of a single PSP. The analytic firing rate
of a LIF neuron under constant drive, t_ref + τ ln((V_∞ − V_reset)/(V_∞ − V_th)),
is reproduced to within one time step (test `suprathreshold_current_fires_at_the_analytic_rate`).

Coefficients that depend only on parameters (exp(−Δt/τ), τR ε, V_rest + τRε(I_bias +
I_ext + I_stim), the noise scale) are precomputed per neuron and refreshed when a
parameter changes, so the per-step work is one multiply-add chain per neuron.

**Spikes.** When V ≥ V_th after integration the neuron emits a spike, V is set to
V_reset and held there for `round(refractory_ms / Δt)` steps; synaptic current keeps
accumulating and decaying during the refractory period.

**Noise.** I_noise = σ ξ / √Δt with ξ ~ N(0, 1) drawn per neuron per step from a
4096-entry inverse-CDF table indexed by xoshiro128++ (unit variance, tails truncated
at about ±3.5σ). Scaling by 1/√Δt keeps the diffusion independent of Δt.

**Safeguards.** Parameters are range-checked on build and on every edit (for
example V_reset < V_th, τ_m ≥ Δt, finite values); refractory and delay counts are
integers; invalid edits are rejected with an explanation and leave the neuron
unchanged.

### Model selection

The model is selected per network; LIF is the implemented model. Integration is
isolated in `Network::integrate`, so further models (adaptive exponential IF,
conductance-based) can be added as additional per-region kernels without
changing synapses, scheduling, plasticity or the interface.

## Synapses

Every synapse is stored individually in compressed sparse row (CSR) form, rows
sorted by target:

| Per-synapse field | Size | Meaning |
|---|---|---|
| index in CSR | — | the synapse id |
| row | — | presynaptic neuron (binary search over `row_ptr`) |
| `target` | u32 | postsynaptic neuron |
| `weight` | f32 | signed weight (sign = presynaptic class) |
| `delay` | u8 | transmission delay in steps (≥ 1) |
| `syn_proj` | u8 | the projection that created it: class, plasticity rule, gain |

A second index (CSC: `in_ptr`, `in_syn`, `in_src`) lists each neuron's incoming
synapses for the inspector and for STDP. Memory is 18 bytes per synapse
(+4 initial weight when any pathway is plastic, +4 eligibility for reward-modulated
pathways). No dense matrix is ever allocated.

**Effective strength** = weight × pathway gain, or 0 while the source region is
disabled. Gains are run-time multipliers (Connectome, experiment G); stored
weights are untouched by them.

## Connectivity

A projection connects one class of one region to a class of another (or the same)
region. Each source neuron contacts each eligible target independently with
probability p:

* `random`: targets drawn by geometric skipping (exact Bernoulli(p), O(k) per source);
* `local`: k ~ Binomial(N, p) targets, each the nearest neuron to a Gaussian point
  (σ = `spread` × target radius) around the source;
* `topographic`: as local, around the source's position mapped into the target
  region (preserves spatial maps between regions).

Duplicate pairs are merged and redrawn so each (pre, post) pair is unique;
autapses are excluded unless allowed. Weights are |N(mean, std)|; delays are
uniform integers in [round(min/Δt), round(max/Δt)], at least one step. A
configured 0 ms delay is delivered on the next step.

## Synaptic transmission (event scheduling)

```
spike of j at step t
  → for every outgoing synapse s of j (gain > 0):
        ring[(t + delay_s) mod D][target_s][class_s] += weight_s × gain_s
step t'
  → every neuron reads and clears ring[t' mod D][i][exc|inh]
     I_exc ← I_exc + arrivals_exc,   I_inh ← I_inh + arrivals_inh
     (integrate V with these currents)
     I_exc ← I_exc · exp(−Δt/τ_exc),  I_inh ← I_inh · exp(−Δt/τ_inh)
```

The ring is a calendar queue of D = max_delay + 1 slots: scheduling and delivery
are O(1) per event with no allocation or sorting, and memory is bounded by the
largest delay. Arrival adds the weight to the current (so a weight of 1 is a jump
of 1 current unit), which then decays as dI/dt = −I/τ_syn. Inhibitory weights are
negative and go to the inhibitory current, so the sign of every effect is
preserved. The number of events scheduled, delivered and still queued is counted
exactly (Performance mode).

## Plasticity

### Pair-based STDP (all-to-all traces)

```
dx/dt = −x/τ₊,  x ← x + 1 when the neuron fires (presynaptic trace)
dy/dt = −y/τ₋,  y ← y + 1 when the neuron fires (postsynaptic trace)

presynaptic spike of j, plastic synapse j → i:   Δ|w| = −η · A₋ · y_i   (depression)
postsynaptic spike of i, plastic synapse j → i:  Δ|w| = +η · A₊ · x_j   (potentiation)
|w| ← clamp(|w| + Δ|w|, w_min, w_max)
```

Traces are read before the current step's spikes are added, so coincident
pre/post spikes produce no change. Timing uses emission times (the axonal delay is
not added). η is the run-time learning-rate scale; A₊, A₋, w_min and w_max can be
set per projection, so excitatory and inhibitory pathways can have separate
parameters (inhibitory plasticity changes |w|; the sign never flips). Traces are
stored lazily as (value, last-update step) and decayed on read from a table, so
silent neurons cost nothing. Plasticity can be switched on and off at run time.

### Reward-modulated STDP

For projections with rule `reward` the STDP update is not applied to the weight
but accumulated in a per-synapse eligibility trace e. A single global
neuromodulator M converts eligibility into weight change:

```
de/dt   = −e/τ_e + STDP(t)
dM/dt   = −M/τ_M + reward events + k · (spikes of the modulator region)
d|w|/dt = r · η · M(t) · e(t)          (t in seconds)
```

Rewards are delivered from the interface (reward / punish) or by an experiment;
the configured modulator region (the Reward & Modulation region in the Neural
Observatory) also releases modulator in proportion to its spikes. The weight and
eligibility updates are applied every ≈10 ms with M and e held constant within the
batch (error of order batch/τ_e, about 1 % at defaults).

This is a standard computational learning rule. NEUROFORM does not claim it
models human learning or biological memory; it exposes the actual weights,
traces and modulator so the rule's effects can be inspected.

Two controls let a task use the rule trial by trial:

* **Clearing eligibility** (`clear_eligibility`) zeroes every eligibility trace
  and the modulator, without touching weights or spike traces. Clearing at the
  start of each trial makes a following reward credit only that trial's activity.
* **Reward gate** (`set_reward_gate`): a factor in [0, 1] per projection on how
  much of M reaches its synapses (`d|w|/dt = r · η · g_p · M · e`). It is 1
  everywhere by default. A task can open only the pathway of the action that was
  taken, so a reward or punishment credits that action alone.

## Vision Lab: learning to recognise images

The Vision Lab preset (Laboratory → Vision) learns to tell classes of photos
apart from reward and punishment alone. Code: `src/vision/`; calibration and
learning tests: `tests/unit/vision.test.ts`.

**Network.**
* **Retina:** three interleaved mosaics of 512 neurons each, red, green and blue
  "cones". They lie on a flat disc that is mapped onto a 16 × 16 image by quantile
  binning, so every pixel has exactly two neurons per colour.
* **Visual cortex:** about 1,200 neurons, receiving topographic projections from
  each mosaic (8 inputs per cone type, weights with a 70 % relative spread).
* **Answer populations:** one per class, of 120 neurons each, with
  cross-inhibition. Cortex → answer synapses use reward-modulated STDP
  (A₊ = 0.012 > A₋ = 0.006, τ_e = 300 ms, τ_M = 100 ms, r = 4).

**Input.** Each photo is cropped to its centre square and averaged down to
16 × 16. Each channel is divided by the photo's brightest value. Each cone neuron
receives Poisson input (rate-coded input, below) at a rate proportional to its
pixel's channel, scaled so that the retina's mean rate is 60 Hz for every photo
(at most 240 Hz per neuron). Every event adds 3 to the neuron's synaptic current.

**Trial.**
1. Clear eligibility, then show the photo for 200 ms.
2. Count each answer population's spikes from 40 ms to 200 ms.
3. The answer is the population with the largest count relative to its typical
   count (a running average over training).
4. With input off, open the reward gate on the answer's pathway only, deliver
   the reward or punishment, and rest for 150 ms while it acts.

**Reward.** The modulator delivered is a reward prediction error: +1 or −1 minus
the running average of recent outcomes. A correct answer stops being rewarded
once it is expected, while a mistake stands out.

**Measured on synthetic photos** (fruit on random backgrounds, accuracy on
held-out photos, chance 50 % for two classes):

* Apple vs banana (different colour and shape): 85–98 % across seeds after
  2,000 trials. The unit test reaches 80 % after 480 trials.
* Apple vs tomato (red and round vs orange-red with a green top): 55–63 %. An
  ideal nearest-centroid read-out of the raw pixels reaches only 72 % here.
* Three fruits: 50–60 % (chance 33 %).

**Rejected designs**, each measured before it was rejected:

* **A single global reward:** the losing population was punished for its own
  class and learned backwards; training collapsed to one answer.
* **One mixed retina:** cortex neurons summed all three colours, so colour was
  lost. Apple vs tomato was separable from cortex activity only 53 % of the time,
  against 62 % with separate mosaics.
* **Weight-based and activity-based synaptic scaling:** runaway growth, or an
  oscillating answer bias.
* **Raw ±1 rewards:** once accuracy passed 50 %, rewards outnumbered
  punishments, weights ratcheted up to their limit and accuracy fell back.

## Stimulation

A stimulus resolves its selection (neurons, regions with a class filter and
fraction, or a sphere) to explicit neuron indices, then follows a schedule in
steps: start, duration, repetitions and interval. Patterns:

* `constant`: a DC current while on;
* `pulses`: a square pulse train (frequency, pulse width) while on;
* `poisson`: independent Poisson input events per target at a rate, each added to
  the target's synaptic current like a synaptic event.

DC components only touch neurons at on/off transitions (they shift V_∞), so long
stimuli are free per step.

### Rate-coded input

`set_input(ids, rates, amplitude)` drives a list of neurons with independent
Poisson events, each neuron at its own rate. Each event adds `amplitude` to the
neuron's synaptic current, exactly like a synaptic event. This is how an image
reaches the retina. Neurons with rate 0 cost nothing, and the input stays on
until it is replaced or cleared. It is not part of snapshots.

## Telemetry (what the numbers mean)

All read from the engine per telemetry window (default 10 Hz wall clock):

* **spikes per region** (E and I) and per-region **mean V** (all neurons, every step);
* **active neurons**: fired at least once in the window; **active synapses**: all
  outgoing synapses of those neurons (each carried ≥ 1 event);
* **events scheduled / delivered / queued**, per projection and in total;
* **synchrony χ** (Golomb–Rinzel) over a fixed sample of neurons
  (≈ 100 per region): χ² = Var_t[V̄(t)] / mean_i Var_t[V_i(t)], computed per region,
  globally and for a selectable group of regions. χ ≈ 1/√K for K independent
  neurons and → 1 for identical membrane trajectories;
* **plasticity**: total potentiation, depression and modulated change, and M;
* **raster**: every spike of the sampled neurons (exact times);
* **probes**: V, synaptic current and spike/refractory flags of up to 8 selected
  neurons at every step.

Firing rates shown in the interface are spike counts divided by neurons and
simulated time. Experiments additionally capture every spike of every neuron.

## Determinism

The same configuration and seed build the same network (placement, parameters,
connectivity each use their own seeded stream). Dynamics are deterministic for a
given sequence of commands at given steps; free-running interactive commands
arrive at wall-clock dependent steps, which is why experiments pause and advance
the simulation in exact step counts. Results are reproducible on the same engine
build; floating-point transcendental functions may differ in the last bit between
platforms (native vs WebAssembly), so bit-identical results across platforms are
not claimed.

## Limits

Engine hard limits (`engine/core/src/config.rs`): 500,000 neurons, 40 million
synapses, 32 regions, 250 projections, delays ≤ 255 steps, 0.05 ≤ Δt ≤ 1 ms.
Recommended sizes per device are measured, see `PERFORMANCE.md`.
