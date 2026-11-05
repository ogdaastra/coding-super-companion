//! Experimental stimulation: current injection into chosen neurons.
//!
//! A stimulus resolves its target selection to explicit neuron indices when it is
//! added, then follows a schedule measured in simulation steps:
//!
//! ```text
//! start ── duration ──┐          ┌── duration ──┐
//!         (on)        └─ off ... ┘     (on)      └─ ...   × repetitions
//! └────────── interval ──────────┘
//! ```
//!
//! * `constant`: a DC current of `amplitude` while on.
//! * `pulses`: a square pulse train at `frequency_hz` with `pulse_ms` width while on.
//! * `poisson`: independent Poisson input events at `rate_hz` per target while on,
//!   each delivering `amplitude` to the target's excitatory (or, if negative,
//!   inhibitory) synaptic current, exactly like a synaptic event.
//!
//! DC components only touch neurons at on/off transitions (they shift the
//! precomputed V_∞ base), so a long sustained stimulus costs nothing per step.

use crate::config::{err, ConfigError, NeuronClass};
use crate::network::Network;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Pattern {
    Constant,
    Pulses,
    Poisson,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ClassFilter {
    #[default]
    All,
    Excitatory,
    Inhibitory,
}

impl ClassFilter {
    fn accepts(self, class: u8) -> bool {
        match self {
            ClassFilter::All => true,
            ClassFilter::Excitatory => class == NeuronClass::Excitatory.index() as u8,
            ClassFilter::Inhibitory => class == NeuronClass::Inhibitory.index() as u8,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum TargetSpec {
    Neurons {
        ids: Vec<u32>,
    },
    #[serde(rename_all = "camelCase")]
    Regions {
        regions: Vec<u16>,
        #[serde(default)]
        class: ClassFilter,
        #[serde(default = "one")]
        fraction: f32,
    },
    #[serde(rename_all = "camelCase")]
    Sphere {
        center: [f32; 3],
        radius: f32,
        #[serde(default)]
        class: ClassFilter,
    },
}

fn one() -> f32 {
    1.0
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StimulusSpec {
    #[serde(default)]
    pub label: String,
    pub target: TargetSpec,
    pub amplitude: f32,
    pub pattern: Pattern,
    #[serde(default = "default_freq")]
    pub frequency_hz: f32,
    #[serde(default = "default_pulse")]
    pub pulse_ms: f32,
    #[serde(default = "default_rate")]
    pub rate_hz: f32,
    /// Delay from the current simulation time.
    #[serde(default)]
    pub start_ms: f32,
    pub duration_ms: f32,
    #[serde(default = "default_reps")]
    pub repetitions: u32,
    /// Time between the starts of successive repetitions.
    #[serde(default)]
    pub interval_ms: f32,
}

fn default_freq() -> f32 {
    20.0
}
fn default_pulse() -> f32 {
    5.0
}
fn default_rate() -> f32 {
    100.0
}
fn default_reps() -> u32 {
    1
}

#[derive(Debug, Clone)]
pub struct Stimulus {
    pub id: u32,
    pub spec: StimulusSpec,
    pub targets: Vec<u32>,
    pub start_step: u64,
    duration: u64,
    interval: u64,
    period: u64,
    pulse: u64,
    poisson_p: f32,
    /// Whether the DC component is currently applied.
    pub on: bool,
    pub finished: bool,
    pub events: u64,
}

impl Stimulus {
    /// First step after the stimulus has completed all repetitions.
    pub fn end_step(&self) -> u64 {
        let reps = self.spec.repetitions.max(1) as u64;
        let span = if reps == 1 {
            self.duration
        } else {
            self.interval.saturating_mul(reps - 1).saturating_add(self.duration)
        };
        self.start_step.saturating_add(span)
    }
}

pub(crate) fn resolve_targets(net: &Network, spec: &TargetSpec) -> Result<Vec<u32>, ConfigError> {
    let n = net.n as u32;
    let mut out = Vec::new();
    match spec {
        TargetSpec::Neurons { ids } => {
            for &i in ids {
                if i >= n {
                    return Err(err("target.ids", format!("neuron {i} does not exist")));
                }
                out.push(i);
            }
            out.sort_unstable();
            out.dedup();
        }
        TargetSpec::Regions {
            regions,
            class,
            fraction,
        } => {
            if !(0.0..=1.0).contains(fraction) {
                return Err(err("target.fraction", "must be between 0 and 1"));
            }
            for &r in regions {
                let reg = net
                    .regions
                    .get(r as usize)
                    .ok_or_else(|| err("target.regions", format!("region {r} does not exist")))?;
                let members: Vec<u32> = (reg.start..reg.end)
                    .filter(|&i| class.accepts(net.p.class[i as usize]))
                    .collect();
                // Neurons are randomly placed within a region, so a prefix of each
                // class block is a random subset; take an evenly strided subset to
                // cover both classes proportionally.
                let k = ((members.len() as f32) * fraction).round() as usize;
                if k == 0 {
                    continue;
                }
                let stride = members.len() as f64 / k as f64;
                for m in 0..k {
                    out.push(members[(m as f64 * stride) as usize]);
                }
            }
        }
        TargetSpec::Sphere {
            center,
            radius,
            class,
        } => {
            let r2 = radius * radius;
            for i in 0..net.n {
                let dx = net.positions[3 * i] - center[0];
                let dy = net.positions[3 * i + 1] - center[1];
                let dz = net.positions[3 * i + 2] - center[2];
                if dx * dx + dy * dy + dz * dz <= r2 && class.accepts(net.p.class[i]) {
                    out.push(i as u32);
                }
            }
        }
    }
    Ok(out)
}

/// Validates a specification and creates the runtime stimulus with explicit targets.
pub(crate) fn build(
    net: &Network,
    spec: StimulusSpec,
    start_step: u64,
    targets: Vec<u32>,
) -> Result<Stimulus, ConfigError> {
    let dt = net.dt;
    if !spec.amplitude.is_finite() || spec.amplitude.abs() > 1000.0 {
        return Err(err("amplitude", "must be a finite number with magnitude ≤ 1000"));
    }
    if !(spec.duration_ms > 0.0 && spec.duration_ms <= 3.6e6) {
        return Err(err("durationMs", "must be positive"));
    }
    if spec.repetitions == 0 || spec.repetitions > 100_000 {
        return Err(err("repetitions", "must be between 1 and 100000"));
    }
    if !(spec.start_ms >= 0.0 && spec.start_ms <= 3.6e6) {
        return Err(err("startMs", "must be ≥ 0"));
    }
    let duration = ((spec.duration_ms / dt).round() as u64).max(1);
    let interval = if spec.repetitions > 1 {
        let iv = (spec.interval_ms / dt).round() as u64;
        if iv < duration {
            return Err(err("intervalMs", "must be at least the duration"));
        }
        iv
    } else {
        u64::MAX
    };
    let (period, pulse) = if spec.pattern == Pattern::Pulses {
        if !(spec.frequency_hz > 0.0 && spec.frequency_hz <= 1000.0) {
            return Err(err("frequencyHz", "must be between 0 and 1000"));
        }
        let period = ((1000.0 / spec.frequency_hz / dt).round() as u64).max(1);
        let pulse = ((spec.pulse_ms / dt).round() as u64).clamp(1, period);
        (period, pulse)
    } else {
        (1, 1)
    };
    if spec.pattern == Pattern::Poisson && !(spec.rate_hz > 0.0 && spec.rate_hz <= 10_000.0) {
        return Err(err("rateHz", "must be between 0 and 10000"));
    }
    if targets.is_empty() {
        return Err(err("target", "the selection contains no neurons"));
    }
    Ok(Stimulus {
        id: 0,
        start_step,
        duration,
        interval,
        period,
        pulse,
        poisson_p: (spec.rate_hz * dt / 1000.0).min(1.0),
        spec,
        targets,
        on: false,
        finished: false,
        events: 0,
    })
}

impl Network {
    /// Schedules a stimulus. Returns its id and the number of targeted neurons.
    pub fn add_stimulus(&mut self, spec: StimulusSpec) -> Result<(u32, usize), ConfigError> {
        let targets = resolve_targets(self, &spec.target)?;
        let start = self.step + (spec.start_ms.max(0.0) / self.dt).round() as u64;
        let mut st = build(self, spec, start, targets)?;
        st.id = self.next_stimulus_id;
        self.next_stimulus_id += 1;
        let out = (st.id, st.targets.len());
        self.stimuli.push(st);
        Ok(out)
    }

    /// Cancels a stimulus immediately, removing any current it applies.
    pub fn cancel_stimulus(&mut self, id: u32) -> bool {
        if let Some(k) = self.stimuli.iter().position(|s| s.id == id) {
            let s = self.stimuli.remove(k);
            if s.on {
                set_dc(self, &s.targets, -s.spec.amplitude);
            }
            true
        } else {
            false
        }
    }

    pub fn clear_stimuli(&mut self) {
        let ids: Vec<u32> = self.stimuli.iter().map(|s| s.id).collect();
        for id in ids {
            self.cancel_stimulus(id);
        }
    }

    pub fn stimuli(&self) -> &[Stimulus] {
        &self.stimuli
    }
}

fn set_dc(net: &mut Network, targets: &[u32], delta: f32) {
    for &t in targets {
        let i = t as usize;
        net.p.i_stim[i] += delta;
        if net.p.i_stim[i].abs() < 1e-6 {
            net.p.i_stim[i] = 0.0;
        }
        net.p.v_base[i] = net.p.v_rest[i]
            + net.p.k_in[i] * (net.p.bias[i] + net.p.i_ext[i] + net.p.i_stim[i]);
    }
}

/// Applies scheduled stimuli for step `t` (before integration).
pub(crate) fn apply(net: &mut Network, t: u64, slot: usize) {
    if net.stimuli.is_empty() {
        return;
    }
    let mut stimuli = std::mem::take(&mut net.stimuli);
    let n2 = net.n * 2;
    for s in stimuli.iter_mut() {
        if t < s.start_step {
            continue;
        }
        let rel = t - s.start_step;
        let within = if s.interval == u64::MAX { rel } else { rel % s.interval };
        let done = t >= s.end_step();
        let active = !done && within < s.duration;
        match s.spec.pattern {
            Pattern::Constant | Pattern::Pulses => {
                let want = active
                    && (s.spec.pattern == Pattern::Constant || within % s.period < s.pulse);
                if want != s.on {
                    let delta = if want { s.spec.amplitude } else { -s.spec.amplitude };
                    set_dc(net, &s.targets, delta);
                    s.on = want;
                    if want {
                        s.events += 1;
                    }
                }
            }
            Pattern::Poisson => {
                if active {
                    let ch = (s.spec.amplitude < 0.0) as usize;
                    let base = slot * n2;
                    for &i in &s.targets {
                        if net.rng.next_f32() < s.poisson_p {
                            net.ring[base + 2 * i as usize + ch] += s.spec.amplitude;
                            s.events += 1;
                        }
                    }
                }
            }
        }
        if done && !s.on {
            s.finished = true;
        }
    }
    stimuli.retain(|s| !s.finished);
    net.stimuli = stimuli;
}

/// Rate-coded input: independent Poisson events for each listed neuron, each at
/// its own rate, for driving a population with a pattern such as an image. Every
/// event delivers `amplitude` to the neuron's excitatory synaptic current (or, if
/// negative, inhibitory), exactly like a synaptic event. The input stays on until
/// replaced or cleared. It is not part of snapshots.
#[derive(Debug, Clone, Default)]
pub struct InputLayer {
    pub(crate) ids: Vec<u32>,
    /// Event probability per step.
    pub(crate) p: Vec<f32>,
    pub(crate) amplitude: f32,
    /// Events delivered since the input was set.
    pub events: u64,
}

impl Network {
    /// Replaces the rate-coded input: neuron `ids[k]` receives Poisson events at
    /// `rates_hz[k]`. Neurons with rate 0 are skipped. An empty list clears the
    /// input. Returns the number of neurons receiving input.
    pub fn set_input(&mut self, ids: &[u32], rates_hz: &[f32], amplitude: f32) -> Result<usize, ConfigError> {
        if ids.len() != rates_hz.len() {
            return Err(err("input", "ids and rates must have the same length"));
        }
        if !amplitude.is_finite() || amplitude.abs() > 1000.0 {
            return Err(err("input.amplitude", "must be a finite number with magnitude ≤ 1000"));
        }
        let mut layer = InputLayer { amplitude, ..InputLayer::default() };
        for (&i, &r) in ids.iter().zip(rates_hz) {
            if i as usize >= self.n {
                return Err(err("input.ids", format!("neuron {i} does not exist")));
            }
            if !(r.is_finite() && (0.0..=10_000.0).contains(&r)) {
                return Err(err("input.rates", "must be between 0 and 10000 Hz"));
            }
            if r > 0.0 {
                layer.ids.push(i);
                layer.p.push((r * self.dt / 1000.0).min(1.0));
            }
        }
        let count = layer.ids.len();
        self.input = layer;
        Ok(count)
    }

    pub fn clear_input(&mut self) {
        self.input = InputLayer::default();
    }

    pub fn input(&self) -> &InputLayer {
        &self.input
    }
}

/// Delivers this step's rate-coded input events (before integration).
pub(crate) fn apply_input(net: &mut Network, slot: usize) {
    if net.input.ids.is_empty() {
        return;
    }
    let a = net.input.amplitude;
    let base = slot * net.n * 2 + (a < 0.0) as usize;
    for k in 0..net.input.ids.len() {
        if net.rng.next_f32() < net.input.p[k] {
            net.ring[base + 2 * net.input.ids[k] as usize] += a;
            net.input.events += 1;
        }
    }
}
