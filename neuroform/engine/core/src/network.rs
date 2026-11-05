//! The runtime network and its time-stepped simulation.
//!
//! # Model
//!
//! Every neuron is a leaky integrate-and-fire (LIF) unit:
//!
//! ```text
//! dV/dt     = (V_rest − V)/τ_m + R_m · ε · I_total
//! I_total   = I_exc + I_inh + I_bias + I_ext + I_stim + I_noise
//! dI_exc/dt = −I_exc/τ_exc        (jumps by +w when an excitatory event arrives)
//! dI_inh/dt = −I_inh/τ_inh        (jumps by −|w| when an inhibitory event arrives)
//! ```
//!
//! where ε is the neuron's individual excitability. When V ≥ V_threshold the neuron
//! emits a spike, V is set to V_reset and held there for the refractory period.
//!
//! # Integration
//!
//! Input current is held constant across a step of length Δt, for which the membrane
//! equation has the exact solution
//!
//! ```text
//! V_∞      = V_rest + τ_m · R_m · ε · I_total
//! V(t+Δt)  = V_∞ + (V(t) − V_∞) · exp(−Δt/τ_m)
//! ```
//!
//! ("exponential Euler"). Unlike forward Euler it is unconditionally stable and exact
//! for piecewise-constant input. Synaptic currents decay by exp(−Δt/τ_syn) after each
//! step. Gaussian white-noise current with intensity σ contributes σ·ξ/√Δt, ξ ~ N(0,1).
//!
//! # Event scheduling
//!
//! A spike at step t schedules one event per outgoing synapse into a calendar queue
//! (a ring of `max_delay + 1` slots × neurons × {exc, inh}). The event is added to
//! the slot `(t + delay) mod slots`, and each step consumes (and clears) exactly one
//! slot. Scheduling and delivery are O(1) per event, with no allocation and no
//! sorting, and memory is bounded by the maximum delay rather than by activity.

use crate::config::{NeuronClass, PlasticityRule};
use crate::plasticity::PlasticityState;
use crate::rng::Rng;
use crate::stimulus::Stimulus;
use crate::telemetry::TelemetryWindow;

/// Per-neuron bytes (all state and parameter arrays). Used for memory estimates.
pub const BYTES_PER_NEURON: usize = 113;
/// Per-synapse bytes: target u32, weight f32, delay u8, projection u8, CSC u32 ×2.
pub const BYTES_PER_SYNAPSE: usize = 18;

/// Maximum number of neurons whose membrane trace is recorded every step.
pub const MAX_PROBES: usize = 8;
/// Values recorded per probe per step: V, I_syn, flags.
pub const PROBE_STRIDE: usize = 3;
pub const PROBE_FLAG_SPIKE: f32 = 1.0;
pub const PROBE_FLAG_REFRACTORY: f32 = 2.0;
/// Bounded buffers drained by the host (worker). Overflow is counted, not grown.
pub const FRAME_SPIKE_CAPACITY: usize = 1 << 18;
pub const RASTER_CAPACITY: usize = 1 << 17;
pub const PROBE_CAPACITY_STEPS: usize = 1 << 15;

#[derive(Debug, Clone)]
pub struct RegionState {
    pub id: String,
    pub name: String,
    pub start: u32,
    /// `start..exc_end` are excitatory, `exc_end..end` inhibitory.
    pub exc_end: u32,
    pub end: u32,
    pub enabled: bool,
    pub center: [f32; 3],
    pub radius: [f32; 3],
}

impl RegionState {
    pub fn count(&self) -> u32 {
        self.end - self.start
    }
}

#[derive(Debug, Clone)]
pub struct ProjectionState {
    pub id: String,
    pub from: u16,
    pub to: u16,
    pub source: NeuronClass,
    /// Multiplier on every synapse of this projection. 0 disables the pathway.
    pub gain: f32,
    pub plastic: bool,
    pub rule: PlasticityRule,
    pub a_plus: f32,
    pub a_minus: f32,
    pub w_min: f32,
    pub w_max: f32,
    pub synapses: u64,
}

/// Everything the builder hands over.
pub(crate) struct Parts {
    pub seed: u32,
    pub dt: f32,
    pub tau_exc: f32,
    pub tau_inh: f32,
    pub ring_slots: usize,
    pub regions: Vec<RegionState>,
    pub projections: Vec<ProjectionState>,
    pub neurons: NeuronArrays,
    pub positions: Vec<f32>,
    pub row_ptr: Vec<u32>,
    pub target: Vec<u32>,
    pub weight: Vec<f32>,
    pub delay: Vec<u8>,
    pub syn_proj: Vec<u8>,
    pub plasticity: PlasticityState,
    pub topology_hash: u64,
}

/// Per-neuron parameters as configured (cold) plus precomputed integration
/// coefficients (hot). Structure-of-arrays: one allocation per field, no objects.
#[derive(Clone, Default)]
pub struct NeuronArrays {
    // configured parameters
    pub v_rest: Vec<f32>,
    pub v_th: Vec<f32>,
    pub v_reset: Vec<f32>,
    pub tau: Vec<f32>,
    pub refractory_ms: Vec<f32>,
    pub resistance: Vec<f32>,
    pub excitability: Vec<f32>,
    pub bias: Vec<f32>,
    pub i_ext: Vec<f32>,
    pub noise_std: Vec<f32>,
    pub class: Vec<u8>,
    pub region: Vec<u16>,
    // derived
    pub i_stim: Vec<f32>,
    pub leak: Vec<f32>,
    pub k_in: Vec<f32>,
    pub v_base: Vec<f32>,
    pub noise_k: Vec<f32>,
    pub ref_steps: Vec<u16>,
}

impl NeuronArrays {
    pub fn with_capacity(n: usize) -> NeuronArrays {
        let f = || Vec::with_capacity(n);
        NeuronArrays {
            v_rest: f(),
            v_th: f(),
            v_reset: f(),
            tau: f(),
            refractory_ms: f(),
            resistance: f(),
            excitability: f(),
            bias: f(),
            i_ext: f(),
            noise_std: f(),
            class: Vec::with_capacity(n),
            region: Vec::with_capacity(n),
            i_stim: f(),
            leak: f(),
            k_in: f(),
            v_base: f(),
            noise_k: f(),
            ref_steps: Vec::with_capacity(n),
        }
    }

    pub fn len(&self) -> usize {
        self.v_rest.len()
    }

    pub fn is_empty(&self) -> bool {
        self.v_rest.is_empty()
    }

    /// Recomputes the integration coefficients of neuron `i` from its parameters.
    pub fn refresh(&mut self, i: usize, dt: f32) {
        let tau = self.tau[i];
        let k = tau * self.resistance[i] * self.excitability[i];
        self.leak[i] = (-dt / tau).exp();
        self.k_in[i] = k;
        self.v_base[i] = self.v_rest[i] + k * (self.bias[i] + self.i_ext[i] + self.i_stim[i]);
        self.noise_k[i] = k * self.noise_std[i] / dt.sqrt();
        self.ref_steps[i] = (self.refractory_ms[i] / dt).round().clamp(0.0, u16::MAX as f32) as u16;
    }
}

pub struct Network {
    pub(crate) seed: u32,
    pub(crate) dt: f32,
    pub(crate) step: u64,
    pub(crate) n: usize,
    pub(crate) regions: Vec<RegionState>,
    pub(crate) projections: Vec<ProjectionState>,

    // Dynamic neuron state.
    pub(crate) v: Vec<f32>,
    pub(crate) i_exc: Vec<f32>,
    pub(crate) i_inh: Vec<f32>,
    pub(crate) ref_left: Vec<u16>,
    pub(crate) spike_count: Vec<u32>,
    /// Step of the most recent spike plus one; 0 = never fired.
    pub(crate) last_spike: Vec<u32>,
    pub(crate) p: NeuronArrays,
    pub(crate) positions: Vec<f32>,

    // Synapses: CSR by presynaptic neuron (rows sorted by target) and a CSC index.
    pub(crate) row_ptr: Vec<u32>,
    pub(crate) target: Vec<u32>,
    pub(crate) weight: Vec<f32>,
    pub(crate) delay: Vec<u8>,
    pub(crate) syn_proj: Vec<u8>,
    pub(crate) in_ptr: Vec<u32>,
    pub(crate) in_syn: Vec<u32>,
    pub(crate) in_src: Vec<u32>,

    // Calendar queue.
    pub(crate) ring: Vec<f32>,
    pub(crate) ring_slots: usize,
    pub(crate) slot_events: Vec<u64>,
    pub(crate) slot_offsets: Vec<usize>,
    pub(crate) slot_ids: Vec<usize>,
    pub(crate) gain_table: Vec<f32>,
    pub(crate) channel_table: Vec<u8>,
    pub(crate) decay_exc: f32,
    pub(crate) decay_inh: f32,
    pub(crate) tau_exc: f32,
    pub(crate) tau_inh: f32,

    pub(crate) plasticity: PlasticityState,
    pub(crate) stimuli: Vec<Stimulus>,
    pub(crate) input: crate::stimulus::InputLayer,
    pub(crate) next_stimulus_id: u32,

    pub(crate) rng: Rng,
    pub(crate) normal: Vec<f32>,

    // Outputs drained by the host.
    pub(crate) fired: Vec<u32>,
    pub(crate) frame_spikes: Vec<u32>,
    pub(crate) frame_dropped: u64,
    pub(crate) sample: Vec<u32>,
    pub(crate) sample_row: Vec<u16>,
    pub(crate) raster: Vec<u32>,
    pub(crate) raster_dropped: u64,
    pub(crate) probes: Vec<u32>,
    pub(crate) probe_buf: Vec<f32>,
    pub(crate) probe_dropped: u64,

    pub(crate) tw: TelemetryWindow,
    pub(crate) clock: Option<fn() -> f64>,
    pub(crate) topology_hash: u64,
    pub(crate) scratch: Vec<u8>,
}

/// Raster/synchrony sample rows per region.
pub fn sample_rows_per_region(regions: usize) -> u32 {
    (640 / regions.max(1) as u32).clamp(16, 96)
}

impl Network {
    pub(crate) fn assemble(parts: Parts) -> Network {
        let n = parts.neurons.len();
        let s = parts.target.len();
        // Structural invariants the unchecked propagation loop relies on. Checked
        // once here, in every build profile; the topology never changes afterwards
        // (edits rebuild the network, snapshots restore state onto the same topology).
        assert!(parts.row_ptr.len() == n + 1 && parts.row_ptr[n] as usize == s, "CSR row pointers do not match the synapse count");
        assert!(parts.row_ptr.windows(2).all(|w| w[0] <= w[1]), "CSR row pointers are not monotonic");
        assert!(parts.weight.len() == s && parts.delay.len() == s && parts.syn_proj.len() == s, "synapse arrays differ in length");
        assert!((1..=256).contains(&parts.ring_slots), "ring slot count out of range");
        assert!(parts.target.iter().all(|&t| (t as usize) < n), "synapse target out of range");
        assert!(parts.delay.iter().all(|&d| (d as usize) < parts.ring_slots), "synaptic delay exceeds the event ring");
        assert!(parts.syn_proj.iter().all(|&p| (p as usize) < parts.projections.len()), "synapse projection out of range");
        let mut in_ptr = vec![0u32; n + 1];
        for &t in &parts.target {
            in_ptr[t as usize + 1] += 1;
        }
        for i in 0..n {
            in_ptr[i + 1] += in_ptr[i];
        }
        let mut fill = in_ptr.clone();
        let mut in_syn = vec![0u32; s];
        let mut in_src = vec![0u32; s];
        for j in 0..n {
            for k in parts.row_ptr[j]..parts.row_ptr[j + 1] {
                let t = parts.target[k as usize] as usize;
                let slot = fill[t] as usize;
                in_syn[slot] = k;
                in_src[slot] = j as u32;
                fill[t] += 1;
            }
        }

        // Raster/synchrony sample: the first rows of each region's excitatory and
        // inhibitory blocks. Positions are random within a region, so these are a
        // spatially unbiased sample.
        let rows = sample_rows_per_region(parts.regions.len());
        let mut sample = Vec::new();
        let mut sample_row = vec![0u16; n];
        for r in &parts.regions {
            let ne = r.exc_end - r.start;
            let ni = r.end - r.exc_end;
            let total = ne + ni;
            let k = rows.min(total);
            let ki = if total == 0 { 0 } else { ((k as u64 * ni as u64) / total as u64) as u32 };
            let ki = ki.max((ni > 0 && k > 1) as u32).min(ni);
            let ke = (k - ki).min(ne);
            for i in (r.start..r.start + ke).chain(r.exc_end..r.exc_end + ki) {
                sample.push(i);
                sample_row[i as usize] = sample.len() as u16;
            }
        }

        let tw = TelemetryWindow::new(parts.regions.len(), parts.projections.len(), sample.len());
        let mut net = Network {
            seed: parts.seed,
            dt: parts.dt,
            step: 0,
            n,
            v: vec![0.0; n],
            i_exc: vec![0.0; n],
            i_inh: vec![0.0; n],
            ref_left: vec![0; n],
            spike_count: vec![0; n],
            last_spike: vec![0; n],
            p: parts.neurons,
            positions: parts.positions,
            row_ptr: parts.row_ptr,
            target: parts.target,
            weight: parts.weight,
            delay: parts.delay,
            syn_proj: parts.syn_proj,
            in_ptr,
            in_syn,
            in_src,
            ring: vec![0.0; parts.ring_slots * n * 2],
            ring_slots: parts.ring_slots,
            slot_events: vec![0; parts.ring_slots],
            slot_offsets: vec![0; parts.ring_slots],
            slot_ids: vec![0; parts.ring_slots],
            gain_table: Vec::new(),
            channel_table: Vec::new(),
            decay_exc: (-parts.dt / parts.tau_exc).exp(),
            decay_inh: (-parts.dt / parts.tau_inh).exp(),
            tau_exc: parts.tau_exc,
            tau_inh: parts.tau_inh,
            plasticity: parts.plasticity,
            stimuli: Vec::new(),
            input: crate::stimulus::InputLayer::default(),
            next_stimulus_id: 1,
            rng: Rng::new(parts.seed as u64, crate::build::DYNAMICS_STREAM),
            normal: crate::rng::normal_table(),
            fired: Vec::with_capacity(n),
            frame_spikes: Vec::with_capacity(1024),
            frame_dropped: 0,
            sample,
            sample_row,
            raster: Vec::with_capacity(1024),
            raster_dropped: 0,
            probes: Vec::new(),
            probe_buf: Vec::new(),
            probe_dropped: 0,
            tw,
            clock: None,
            topology_hash: parts.topology_hash,
            regions: parts.regions,
            projections: parts.projections,
            scratch: Vec::new(),
        };
        net.refresh_projection_tables();
        net.plasticity.prepare(&net.weight, &net.syn_proj, &net.projections);
        net.reset_dynamics();
        net
    }

    /// Restores time zero: membrane potentials (randomised between reset and
    /// threshold so the network does not start in lock-step), currents, queued
    /// events, traces, stimuli and the noise generator. Parameters are kept.
    pub fn reset_dynamics(&mut self) {
        self.step = 0;
        self.rng = Rng::new(self.seed as u64, crate::build::DYNAMICS_STREAM);
        let mut init = Rng::new(self.seed as u64, crate::build::INITIAL_STATE_STREAM);
        for i in 0..self.n {
            let lo = self.p.v_reset[i];
            let hi = self.p.v_th[i];
            self.v[i] = lo + (hi - lo) * 0.9 * init.next_f32();
        }
        self.i_exc.fill(0.0);
        self.i_inh.fill(0.0);
        self.ref_left.fill(0);
        self.spike_count.fill(0);
        self.last_spike.fill(0);
        self.ring.fill(0.0);
        self.slot_events.fill(0);
        for s in self.stimuli.drain(..) {
            for &t in &s.targets {
                self.p.i_stim[t as usize] = 0.0;
            }
        }
        for i in 0..self.n {
            self.p.refresh(i, self.dt);
        }
        self.plasticity.reset_traces();
        self.fired.clear();
        self.frame_spikes.clear();
        self.raster.clear();
        self.probe_buf.clear();
        self.tw.clear(0);
    }

    /// Restores every plastic weight to its value at construction.
    pub fn reset_weights(&mut self) {
        self.plasticity.restore_initial_weights(&mut self.weight);
    }

    /// Enables per-phase step profiling with a millisecond clock, or disables it.
    pub fn set_clock(&mut self, clock: Option<fn() -> f64>) {
        self.clock = clock;
    }

    #[inline]
    fn now(&self) -> f64 {
        self.clock.map(|c| c()).unwrap_or(0.0)
    }

    /// Advances the simulation by `steps` timesteps. Returns spikes emitted.
    pub fn run(&mut self, steps: u32) -> u64 {
        let mut total = 0;
        for _ in 0..steps {
            total += self.step_once() as u64;
        }
        total
    }

    /// One timestep: stimuli → membrane integration → plasticity → event
    /// scheduling → recording. Returns the number of spikes emitted.
    pub fn step_once(&mut self) -> usize {
        let t = self.step;
        let profiling = self.clock.is_some();
        let t0 = if profiling { self.now() } else { 0.0 };

        let slot = (t % self.ring_slots as u64) as usize;
        self.tw.events_delivered += self.slot_events[slot];
        self.slot_events[slot] = 0;
        crate::stimulus::apply(self, t, slot);
        crate::stimulus::apply_input(self, slot);

        let t1 = if profiling { self.now() } else { 0.0 };
        self.integrate(t, slot);
        let t2 = if profiling { self.now() } else { 0.0 };
        crate::plasticity::on_spikes(self, t);
        let t3 = if profiling { self.now() } else { 0.0 };
        self.propagate(t);
        let t4 = if profiling { self.now() } else { 0.0 };
        self.record(t);

        self.step += 1;
        self.tw.steps += 1;
        if profiling {
            let t5 = self.now();
            self.tw.prof_stimulus += t1 - t0;
            self.tw.prof_integrate += t2 - t1;
            self.tw.prof_plasticity += t3 - t2;
            self.tw.prof_propagate += t4 - t3;
            self.tw.prof_record += t5 - t4;
        }
        self.fired.len()
    }

    fn integrate(&mut self, t: u64, slot: usize) {
        let n2 = self.n * 2;
        let ring = &mut self.ring[slot * n2..(slot + 1) * n2];
        let p = &self.p;
        let (de, di) = (self.decay_exc, self.decay_inh);
        let normal = &self.normal[..];
        let shift = 32 - crate::rng::NORMAL_TABLE_BITS;
        let rng = &mut self.rng;
        let fired = &mut self.fired;
        let stamp = (t + 1).min(u32::MAX as u64) as u32;
        fired.clear();

        for (ri, r) in self.regions.iter().enumerate() {
            let (a, b) = (r.start as usize, r.end as usize);
            let len = b - a;
            // Equal-length slices let the compiler drop per-element bounds checks.
            let v = &mut self.v[a..b];
            let ie = &mut self.i_exc[a..b];
            let ii = &mut self.i_inh[a..b];
            let rl = &mut self.ref_left[a..b];
            let arr = &mut ring[2 * a..2 * b];
            let (v_base, k_in, noise_k, leak) = (&p.v_base[a..b], &p.k_in[a..b], &p.noise_k[a..b], &p.leak[a..b]);
            let (v_th, v_reset, v_rest, ref_steps) = (&p.v_th[a..b], &p.v_reset[a..b], &p.v_rest[a..b], &p.ref_steps[a..b]);
            assert!(v.len() == len && ie.len() == len && ii.len() == len && rl.len() == len && arr.len() == 2 * len);
            assert!(v_base.len() == len && k_in.len() == len && noise_k.len() == len && leak.len() == len);
            assert!(v_th.len() == len && v_reset.len() == len && v_rest.len() == len && ref_steps.len() == len);
            let mut vsum = 0.0f64;
            if !r.enabled {
                // A disabled region is silenced: arriving events are discarded and
                // membranes are clamped at rest. Its neurons and synapses still exist.
                arr.fill(0.0);
                ie.fill(0.0);
                ii.fill(0.0);
                rl.fill(0);
                v.copy_from_slice(v_rest);
                for &x in v.iter() {
                    vsum += x as f64;
                }
                self.tw.region_vsum[ri] += vsum;
                continue;
            }
            let mut fsum = 0.0f32;
            for k in 0..len {
                let e = ie[k] + arr[2 * k];
                let h = ii[k] + arr[2 * k + 1];
                arr[2 * k] = 0.0;
                arr[2 * k + 1] = 0.0;
                let mut vi = v[k];
                if rl[k] > 0 {
                    rl[k] -= 1;
                    vi = v_reset[k];
                } else {
                    let nk = noise_k[k];
                    let noise = if nk != 0.0 {
                        nk * normal[(rng.next_u32() >> shift) as usize]
                    } else {
                        0.0
                    };
                    // Exact solution for input held constant over the step.
                    let v_inf = v_base[k] + k_in[k] * (e + h) + noise;
                    vi = v_inf + (vi - v_inf) * leak[k];
                    if vi >= v_th[k] {
                        let i = a + k;
                        fired.push(i as u32);
                        self.spike_count[i] = self.spike_count[i].wrapping_add(1);
                        self.last_spike[i] = stamp;
                        vi = v_reset[k];
                        rl[k] = ref_steps[k];
                    }
                }
                v[k] = vi;
                ie[k] = e * de;
                ii[k] = h * di;
                fsum += vi;
            }
            vsum += fsum as f64;
            self.tw.region_vsum[ri] += vsum;
        }
    }

    fn propagate(&mut self, t: u64) {
        let n2 = self.n * 2;
        let slots = self.ring_slots;
        for k in 0..slots {
            let id = (t as usize + k) % slots;
            self.slot_ids[k] = id;
            self.slot_offsets[k] = id * n2;
        }
        let (gains, chans) = (&self.gain_table, &self.channel_table);
        let (offsets, ids) = (&self.slot_offsets, &self.slot_ids);
        let (row_ptr, target, weight, delay, syn_proj) =
            (&self.row_ptr, &self.target, &self.weight, &self.delay, &self.syn_proj);
        let tx = &mut self.tw.proj_tx;
        let slot_events = &mut self.slot_events;
        let ring = &mut self.ring;
        let mut scheduled = 0u64;
        // Per-delay event counts for this step, folded into the slots afterwards.
        let mut per_delay = [0u64; 256];
        // Cheap per-call checks; the per-synapse invariants are checked in `assemble`.
        assert!(gains.len() == self.projections.len() && chans.len() == gains.len() && tx.len() == gains.len());
        assert!(offsets.len() == slots && ring.len() == slots * n2 && slots <= per_delay.len());
        debug_assert!(self.target.iter().all(|&t| (t as usize) < self.n));
        debug_assert!(self.delay.iter().all(|&d| (d as usize) < slots));
        debug_assert!(self.syn_proj.iter().all(|&p| (p as usize) < gains.len()));
        for &j in &self.fired {
            let (lo, hi) = (row_ptr[j as usize] as usize, row_ptr[j as usize + 1] as usize);
            assert!(hi <= target.len() && hi <= weight.len() && hi <= delay.len() && hi <= syn_proj.len());
            for s in lo..hi {
                // SAFETY: `s < hi ≤ len` (asserted above). `assemble` asserts
                // target < n, delay < ring_slots and projection < projections.len()
                // for every synapse, and the table lengths are asserted above, so
                // every index below is in bounds:
                // offsets[d] + 2·target + channel < slots · n · 2 = ring.len().
                unsafe {
                    let pj = *syn_proj.get_unchecked(s) as usize;
                    let g = *gains.get_unchecked(pj);
                    if g == 0.0 {
                        continue;
                    }
                    let d = *delay.get_unchecked(s) as usize;
                    let idx = *offsets.get_unchecked(d) + 2 * *target.get_unchecked(s) as usize + *chans.get_unchecked(pj) as usize;
                    *ring.get_unchecked_mut(idx) += *weight.get_unchecked(s) * g;
                    *per_delay.get_unchecked_mut(d) += 1;
                    *tx.get_unchecked_mut(pj) += 1;
                }
                scheduled += 1;
            }
        }
        if scheduled > 0 {
            for d in 1..slots {
                slot_events[ids[d]] += per_delay[d];
            }
        }
        self.tw.events_scheduled += scheduled;
    }

    /// Rebuilds the per-projection lookup tables used by the propagation loop.
    pub(crate) fn refresh_projection_tables(&mut self) {
        self.gain_table = self.projections.iter().map(|p| p.gain).collect();
        self.channel_table = self.projections.iter().map(|p| p.source.index() as u8).collect();
    }

    fn record(&mut self, t: u64) {
        let tw = &mut self.tw;
        // Spikes per population and the per-frame event list.
        for &j in &self.fired {
            let r = self.p.region[j as usize] as usize;
            let c = self.p.class[j as usize] as usize;
            tw.pop_spikes[r * 2 + c] += 1;
            if self.frame_spikes.len() + 2 <= FRAME_SPIKE_CAPACITY {
                self.frame_spikes.push(t as u32);
                self.frame_spikes.push(j);
            } else {
                self.frame_dropped += 1;
            }
            let row = self.sample_row[j as usize];
            if row != 0 {
                if self.raster.len() + 2 <= RASTER_CAPACITY {
                    self.raster.push(t as u32);
                    self.raster.push(row as u32 - 1);
                } else {
                    self.raster_dropped += 1;
                }
            }
        }
        tw.firing_last_step = self.fired.len() as u32;
        tw.record_sample(&self.v, &self.sample, &self.p.region, self.regions.len());

        if !self.probes.is_empty() {
            if self.probe_buf.len() + self.probes.len() * PROBE_STRIDE
                <= PROBE_CAPACITY_STEPS * MAX_PROBES * PROBE_STRIDE
            {
                let stamp = (t + 1) as u32;
                for &pi in &self.probes {
                    let i = pi as usize;
                    let spiked = self.last_spike[i] == stamp;
                    // On the spike step the membrane has already been reset; record
                    // the threshold crossing so traces show the spike explicitly.
                    let v = if spiked { self.p.v_th[i] } else { self.v[i] };
                    let flags = if spiked {
                        PROBE_FLAG_SPIKE
                    } else if self.ref_left[i] > 0 {
                        PROBE_FLAG_REFRACTORY
                    } else {
                        0.0
                    };
                    self.probe_buf.push(v);
                    self.probe_buf.push(self.i_exc[i] + self.i_inh[i]);
                    self.probe_buf.push(flags);
                }
            } else {
                self.probe_dropped += 1;
            }
        }
    }

    // ----------------------------------------------------------------- accessors

    pub fn neuron_count(&self) -> usize {
        self.n
    }
    pub fn synapse_count(&self) -> usize {
        self.target.len()
    }
    pub fn step_index(&self) -> u64 {
        self.step
    }
    pub fn time_ms(&self) -> f64 {
        self.step as f64 * self.dt as f64
    }
    pub fn dt(&self) -> f32 {
        self.dt
    }
    pub fn seed(&self) -> u32 {
        self.seed
    }
    pub fn regions(&self) -> &[RegionState] {
        &self.regions
    }
    pub fn projections(&self) -> &[ProjectionState] {
        &self.projections
    }
    pub fn positions(&self) -> &[f32] {
        &self.positions
    }
    pub fn region_of(&self) -> &[u16] {
        &self.p.region
    }
    pub fn class_of(&self) -> &[u8] {
        &self.p.class
    }
    pub fn membrane(&self) -> &[f32] {
        &self.v
    }
    pub fn spike_counts(&self) -> &[u32] {
        &self.spike_count
    }
    pub fn last_spikes(&self) -> &[u32] {
        &self.last_spike
    }
    pub fn fired(&self) -> &[u32] {
        &self.fired
    }
    pub fn row_ptr(&self) -> &[u32] {
        &self.row_ptr
    }
    pub fn targets(&self) -> &[u32] {
        &self.target
    }
    pub fn weights(&self) -> &[f32] {
        &self.weight
    }
    pub fn delays(&self) -> &[u8] {
        &self.delay
    }
    pub fn synapse_projection(&self) -> &[u8] {
        &self.syn_proj
    }
    pub fn in_ptr(&self) -> &[u32] {
        &self.in_ptr
    }
    pub fn in_synapses(&self) -> &[u32] {
        &self.in_syn
    }
    pub fn in_sources(&self) -> &[u32] {
        &self.in_src
    }
    pub fn sample(&self) -> &[u32] {
        &self.sample
    }
    pub fn topology_hash(&self) -> u64 {
        self.topology_hash
    }
    pub fn ring_slots(&self) -> usize {
        self.ring_slots
    }
    pub fn pending_events(&self) -> u64 {
        self.slot_events.iter().sum()
    }
    pub fn neurons(&self) -> &NeuronArrays {
        &self.p
    }
    /// Excitatory and inhibitory synaptic decay constants (ms).
    pub fn synaptic_taus(&self) -> (f32, f32) {
        (self.tau_exc, self.tau_inh)
    }
    pub fn synaptic_current(&self, i: usize) -> (f32, f32) {
        (self.i_exc[i], self.i_inh[i])
    }
    pub fn refractory_left_ms(&self, i: usize) -> f32 {
        self.ref_left[i] as f32 * self.dt
    }
    pub fn plasticity(&self) -> &PlasticityState {
        &self.plasticity
    }
    pub fn plasticity_mut(&mut self) -> &mut PlasticityState {
        &mut self.plasticity
    }

    /// Presynaptic neuron of synapse `s` (binary search over the CSR row pointers).
    pub fn synapse_source(&self, s: usize) -> u32 {
        let k = s as u32;
        // first row whose end is > k
        let mut lo = 0usize;
        let mut hi = self.n;
        while lo < hi {
            let mid = (lo + hi) / 2;
            if self.row_ptr[mid + 1] <= k {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        lo as u32
    }

    /// The synapse from `pre` to `post`, if it exists (rows are sorted by target).
    pub fn find_synapse(&self, pre: u32, post: u32) -> Option<usize> {
        let (lo, hi) = (
            self.row_ptr[pre as usize] as usize,
            self.row_ptr[pre as usize + 1] as usize,
        );
        self.target[lo..hi].binary_search(&post).ok().map(|k| lo + k)
    }

    /// Effective strength of synapse `s`: weight × pathway gain, or 0 when its source
    /// region is disabled.
    pub fn effective_weight(&self, s: usize) -> f32 {
        let pj = self.syn_proj[s] as usize;
        let p = &self.projections[pj];
        if !self.regions[p.from as usize].enabled {
            return 0.0;
        }
        self.weight[s] * p.gain
    }

    pub fn scratch_mut(&mut self) -> &mut Vec<u8> {
        &mut self.scratch
    }
    pub fn scratch(&self) -> &[u8] {
        &self.scratch
    }
}

