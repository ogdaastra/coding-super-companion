//! Spike-timing-dependent plasticity (STDP) and reward-modulated STDP.
//!
//! # Pair-based STDP with all-to-all traces
//!
//! Each neuron carries a presynaptic trace x and a postsynaptic trace y:
//!
//! ```text
//! dx/dt = −x/τ₊,  x ← x + 1 when the neuron fires
//! dy/dt = −y/τ₋,  y ← y + 1 when the neuron fires
//! ```
//!
//! For a plastic synapse j → i with magnitude |w|:
//!
//! * when j fires (presynaptic spike):  Δ|w| = −η·A₋·y_i   (depression: post before pre)
//! * when i fires (postsynaptic spike): Δ|w| = +η·A₊·x_j   (potentiation: pre before post)
//!
//! then |w| is clamped to [w_min, w_max]. The sign (Dale's principle) never changes.
//! η is the run-time learning-rate scale. Traces are evaluated *before* the current
//! step's spikes are added, so a coincident pre/post pair produces no update. Timing
//! uses spike emission times; axonal delay is not added to the presynaptic time.
//!
//! Traces only change at spikes, so they are stored lazily as (value, last update
//! step) and decayed on read from a lookup table: no per-step work for silent neurons.
//!
//! # Reward-modulated STDP (eligibility traces)
//!
//! For projections using the `reward` rule the STDP update above is not applied to
//! the weight. It is accumulated in a per-synapse eligibility trace e instead:
//!
//! ```text
//! de/dt   = −e/τ_e + STDP(t)
//! dM/dt   = −M/τ_M + reward events + k · (spikes in the modulator region)
//! d|w|/dt = r · M(t) · e(t)            (t in seconds)
//! ```
//!
//! M is a single global neuromodulator. The weight and eligibility updates are
//! applied in batches every `batch_steps` (≈10 ms); within a batch e and M are taken
//! as constant. The error this introduces is of order batch/τ_e (1% at defaults).

use crate::config::{PlasticityConfig, PlasticityRule};
use crate::network::{Network, ProjectionState};

const TRACE_TABLE_MAX: usize = 1 << 20;

#[derive(Clone)]
pub struct PlasticityState {
    /// Run-time master switch.
    pub enabled: bool,
    /// Run-time learning-rate multiplier η.
    pub rate_scale: f32,
    pub any_plastic: bool,
    pub any_reward: bool,
    pub tau_plus_ms: f32,
    pub tau_minus_ms: f32,
    decay_plus: Vec<f32>,
    decay_minus: Vec<f32>,
    pub(crate) x_val: Vec<f32>,
    pub(crate) x_t: Vec<u32>,
    pub(crate) y_val: Vec<f32>,
    pub(crate) y_t: Vec<u32>,
    /// Weights at construction, kept when any projection is plastic.
    pub(crate) w0: Vec<f32>,
    /// Eligibility per synapse (only allocated when a projection uses `reward`).
    pub(crate) elig: Vec<f32>,
    pub(crate) reward_syn: Vec<u32>,

    pub modulator: f32,
    mod_decay: f32,
    pub reward_rate: f32,
    pub eligibility_tau_ms: f32,
    pub modulator_tau_ms: f32,
    batch_steps: u32,
    elig_decay_batch: f32,
    batch_seconds: f32,
    pub modulator_region: Option<usize>,
    pub modulator_per_spike: f32,
    pending_reward: f32,

    // Window statistics (cleared by telemetry).
    pub potentiation: f64,
    pub depression: f64,
    pub updates: u64,
    pub modulated_change: f64,
}

fn decay_table(tau_ms: f32, dt: f32) -> Vec<f32> {
    let len = ((8.0 * tau_ms / dt).ceil() as usize + 2).min(TRACE_TABLE_MAX);
    (0..len)
        .map(|k| (-(k as f64) * dt as f64 / tau_ms as f64).exp() as f32)
        .collect()
}

impl PlasticityState {
    pub fn new(cfg: &PlasticityConfig, dt: f32, n: usize, modulator_region: Option<usize>) -> Self {
        let batch_steps = ((10.0 / dt).round() as u32).max(1);
        PlasticityState {
            enabled: cfg.enabled,
            rate_scale: 1.0,
            any_plastic: false,
            any_reward: false,
            tau_plus_ms: cfg.tau_plus_ms,
            tau_minus_ms: cfg.tau_minus_ms,
            decay_plus: decay_table(cfg.tau_plus_ms, dt),
            decay_minus: decay_table(cfg.tau_minus_ms, dt),
            x_val: vec![0.0; n],
            x_t: vec![0; n],
            y_val: vec![0.0; n],
            y_t: vec![0; n],
            w0: Vec::new(),
            elig: Vec::new(),
            reward_syn: Vec::new(),
            modulator: 0.0,
            mod_decay: (-dt / cfg.modulator_tau_ms).exp(),
            reward_rate: cfg.reward_rate,
            eligibility_tau_ms: cfg.eligibility_tau_ms,
            modulator_tau_ms: cfg.modulator_tau_ms,
            batch_steps,
            elig_decay_batch: (-(batch_steps as f32) * dt / cfg.eligibility_tau_ms).exp(),
            batch_seconds: batch_steps as f32 * dt / 1000.0,
            modulator_region,
            modulator_per_spike: cfg.modulator_per_spike,
            pending_reward: 0.0,
            potentiation: 0.0,
            depression: 0.0,
            updates: 0,
            modulated_change: 0.0,
        }
    }

    /// Allocates per-synapse state once the topology is known.
    pub(crate) fn prepare(&mut self, weight: &[f32], syn_proj: &[u8], projections: &[ProjectionState]) {
        self.any_plastic = projections.iter().any(|p| p.plastic);
        self.any_reward = projections
            .iter()
            .any(|p| p.plastic && p.rule == PlasticityRule::Reward);
        if self.any_plastic {
            self.w0 = weight.to_vec();
        }
        if self.any_reward {
            self.elig = vec![0.0; weight.len()];
            self.reward_syn = syn_proj
                .iter()
                .enumerate()
                .filter(|(_, &p)| {
                    let p = &projections[p as usize];
                    p.plastic && p.rule == PlasticityRule::Reward
                })
                .map(|(s, _)| s as u32)
                .collect();
        }
    }

    pub(crate) fn reset_traces(&mut self) {
        self.x_val.fill(0.0);
        self.x_t.fill(0);
        self.y_val.fill(0.0);
        self.y_t.fill(0);
        self.elig.fill(0.0);
        self.modulator = 0.0;
        self.pending_reward = 0.0;
    }

    pub(crate) fn restore_initial_weights(&mut self, weight: &mut [f32]) {
        if !self.w0.is_empty() {
            weight.copy_from_slice(&self.w0);
        }
        self.elig.fill(0.0);
    }

    /// Adds a reward (or punishment, if negative) to the neuromodulator.
    pub fn inject_reward(&mut self, amount: f32) {
        self.pending_reward += amount;
    }

    pub fn initial_weight(&self, s: usize) -> Option<f32> {
        self.w0.get(s).copied()
    }

    pub fn eligibility(&self, s: usize) -> Option<f32> {
        self.elig.get(s).copied()
    }

    #[inline(always)]
    fn x_at(&self, j: usize, t: u32) -> f32 {
        let dtk = t.wrapping_sub(self.x_t[j]) as usize;
        self.x_val[j] * self.decay_plus.get(dtk).copied().unwrap_or(0.0)
    }

    #[inline(always)]
    fn y_at(&self, i: usize, t: u32) -> f32 {
        let dtk = t.wrapping_sub(self.y_t[i]) as usize;
        self.y_val[i] * self.decay_minus.get(dtk).copied().unwrap_or(0.0)
    }

    /// Current presynaptic and postsynaptic traces of a neuron.
    pub fn traces(&self, i: usize, t: u64) -> (f32, f32) {
        (self.x_at(i, t as u32), self.y_at(i, t as u32))
    }

    pub fn window_clear(&mut self) {
        self.potentiation = 0.0;
        self.depression = 0.0;
        self.updates = 0;
        self.modulated_change = 0.0;
    }

    /// Serialised dynamic plasticity state (for snapshots).
    pub(crate) fn write(&self, w: &mut crate::snapshot::Writer) {
        w.u8(self.enabled as u8);
        w.f32(self.rate_scale);
        w.f32(self.modulator);
        w.f32(self.pending_reward);
        w.f32_slice(&self.x_val);
        w.u32_slice(&self.x_t);
        w.f32_slice(&self.y_val);
        w.u32_slice(&self.y_t);
        w.f32_slice(&self.elig);
    }

    pub(crate) fn read(&mut self, r: &mut crate::snapshot::Reader) -> Result<(), String> {
        self.enabled = r.u8()? != 0;
        self.rate_scale = r.f32()?;
        self.modulator = r.f32()?;
        self.pending_reward = r.f32()?;
        r.f32_into(&mut self.x_val)?;
        r.u32_into(&mut self.x_t)?;
        r.f32_into(&mut self.y_val)?;
        r.u32_into(&mut self.y_t)?;
        r.f32_into(&mut self.elig)?;
        Ok(())
    }
}

#[inline(always)]
fn apply_update(
    weight: &mut [f32],
    elig: &mut [f32],
    s: usize,
    p: &ProjectionState,
    dw: f32,
    stats: &mut (f64, f64, u64),
) {
    if p.rule == PlasticityRule::Reward {
        elig[s] += dw;
        return;
    }
    let w = weight[s];
    let sign = if p.source.index() == 1 { -1.0 } else { 1.0 };
    let m0 = w.abs();
    let m = (m0 + dw).clamp(p.w_min, p.w_max);
    weight[s] = sign * m;
    let change = (m - m0) as f64;
    if change > 0.0 {
        stats.0 += change;
    } else {
        stats.1 -= change;
    }
    stats.2 += 1;
}

/// Runs after membrane integration each step: neuromodulator dynamics, STDP updates
/// for this step's spikes, trace increments and (periodically) reward-modulated
/// weight changes.
pub(crate) fn on_spikes(net: &mut Network, t: u64) {
    let ps = &mut net.plasticity;
    ps.modulator *= ps.mod_decay;
    if let Some(r) = ps.modulator_region {
        if ps.modulator_per_spike != 0.0 {
            let count = net
                .fired
                .iter()
                .filter(|&&j| net.p.region[j as usize] as usize == r)
                .count();
            ps.modulator += ps.modulator_per_spike * count as f32;
        }
    }
    ps.modulator += ps.pending_reward;
    ps.pending_reward = 0.0;

    if !ps.enabled || !ps.any_plastic {
        return;
    }
    let t32 = t as u32;
    let eta = ps.rate_scale;
    let projections = &net.projections;
    let weight = &mut net.weight;
    let mut stats = (0.0f64, 0.0f64, 0u64);

    if !net.fired.is_empty() {
        // Depression: presynaptic spike, read the target's postsynaptic trace.
        for &j in &net.fired {
            let (lo, hi) = (net.row_ptr[j as usize] as usize, net.row_ptr[j as usize + 1] as usize);
            for s in lo..hi {
                let p = &projections[net.syn_proj[s] as usize];
                if !p.plastic {
                    continue;
                }
                let y = ps.y_at(net.target[s] as usize, t32);
                if y > 0.0 {
                    apply_update(weight, &mut ps.elig, s, p, -eta * p.a_minus * y, &mut stats);
                }
            }
        }
        // Potentiation: postsynaptic spike, read each source's presynaptic trace.
        for &i in &net.fired {
            let (lo, hi) = (net.in_ptr[i as usize] as usize, net.in_ptr[i as usize + 1] as usize);
            for k in lo..hi {
                let s = net.in_syn[k] as usize;
                let p = &projections[net.syn_proj[s] as usize];
                if !p.plastic {
                    continue;
                }
                let x = ps.x_at(net.in_src[k] as usize, t32);
                if x > 0.0 {
                    apply_update(weight, &mut ps.elig, s, p, eta * p.a_plus * x, &mut stats);
                }
            }
        }
        for &j in &net.fired {
            let j = j as usize;
            ps.x_val[j] = ps.x_at(j, t32) + 1.0;
            ps.x_t[j] = t32;
            ps.y_val[j] = ps.y_at(j, t32) + 1.0;
            ps.y_t[j] = t32;
        }
    }

    if ps.any_reward && (t + 1) % ps.batch_steps as u64 == 0 {
        let m = ps.modulator;
        let k = ps.reward_rate * eta * m * ps.batch_seconds;
        let decay = ps.elig_decay_batch;
        let mut changed = 0.0f64;
        for &s in &ps.reward_syn {
            let s = s as usize;
            let e = ps.elig[s];
            if e == 0.0 {
                continue;
            }
            if k != 0.0 {
                let p = &projections[net.syn_proj[s] as usize];
                let w = weight[s];
                let sign = if p.source.index() == 1 { -1.0 } else { 1.0 };
                let m0 = w.abs();
                let m1 = (m0 + k * e).clamp(p.w_min, p.w_max);
                weight[s] = sign * m1;
                changed += (m1 - m0).abs() as f64;
            }
            let ne = e * decay;
            ps.elig[s] = if ne.abs() < 1e-12 { 0.0 } else { ne };
        }
        ps.modulated_change += changed;
    }
    ps.potentiation += stats.0;
    ps.depression += stats.1;
    ps.updates += stats.2;
}
