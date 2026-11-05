//! Brain configuration: the declarative, versioned description a network is built from.
//!
//! The JSON form is shared with the TypeScript application (`src/config/schema.ts`).
//! Fields the engine does not need (colours, descriptions, UI metadata) are ignored,
//! so the application can extend its own document without changing the engine.
//!
//! A configuration *recreates* a network: the same configuration and seed always
//! produce the same neurons, positions and synapses (see `docs/SIMULATION.md`).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

/// Hard limits enforced by the engine. The application recommends lower, measured
/// sizes per hardware tier (see `docs/PERFORMANCE.md`).
pub mod limits {
    pub const MAX_NEURONS: u64 = 500_000;
    pub const MAX_SYNAPSES: u64 = 40_000_000;
    pub const MAX_REGIONS: usize = 32;
    pub const MAX_PROJECTIONS: usize = 250;
    /// Expected synapses created per source neuron by one projection.
    pub const MAX_EXPECTED_FAN_OUT: f64 = 5_000.0;
    /// Delays are stored as `u8` steps.
    pub const MAX_DELAY_STEPS: u32 = 255;
    pub const MIN_TIMESTEP_MS: f32 = 0.05;
    pub const MAX_TIMESTEP_MS: f32 = 1.0;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NeuronClass {
    Excitatory,
    Inhibitory,
}

impl NeuronClass {
    pub fn index(self) -> usize {
        match self {
            NeuronClass::Excitatory => 0,
            NeuronClass::Inhibitory => 1,
        }
    }
    pub fn sign(self) -> f32 {
        match self {
            NeuronClass::Excitatory => 1.0,
            NeuronClass::Inhibitory => -1.0,
        }
    }
}

/// Which neurons of the target region a projection may contact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TargetFilter {
    #[default]
    All,
    Excitatory,
    Inhibitory,
}

/// Spatial structure of a projection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Topology {
    /// Every target is chosen independently with the projection's probability.
    #[default]
    Random,
    /// Targets cluster around the source neuron's own position.
    Local,
    /// The source position is mapped into the target region (normalised by both
    /// regions' radii) and targets cluster around that point. Preserves maps.
    Topographic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum PlasticityRule {
    /// Pair-based STDP applied directly to the weight.
    #[default]
    Stdp,
    /// STDP accumulates into an eligibility trace; the weight changes only when
    /// the global neuromodulator is non-zero (reward-modulated STDP).
    Reward,
}

/// Leaky integrate-and-fire parameters for one neuron class of one region.
///
/// dV/dt = (V_rest − V)/τ_m + R_m · excitability · I_total
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeuronParams {
    pub v_rest: f32,
    pub v_threshold: f32,
    pub v_reset: f32,
    pub tau_ms: f32,
    pub refractory_ms: f32,
    /// Membrane resistance R_m, in mV per (ms · current unit).
    #[serde(default = "one")]
    pub resistance: f32,
    /// Constant background current.
    #[serde(default)]
    pub bias: f32,
    /// Standard deviation of white-noise background current (current units·√ms).
    #[serde(default)]
    pub noise_std: f32,
}

fn one() -> f32 {
    1.0
}

impl NeuronParams {
    pub fn excitatory_default() -> NeuronParams {
        NeuronParams {
            v_rest: -65.0,
            v_threshold: -50.0,
            v_reset: -65.0,
            tau_ms: 20.0,
            refractory_ms: 2.0,
            resistance: 1.0,
            bias: 0.0,
            noise_std: 0.0,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapeConfig {
    pub center: [f32; 3],
    pub radius: [f32; 3],
    /// 0 = solid ellipsoid, towards 1 = thin shell.
    #[serde(default)]
    pub shell: f32,
    /// Smooth organic displacement of positions, as a fraction of the radius.
    #[serde(default)]
    pub warp: f32,
    /// Density variation, 0 = uniform, 1 = strongly clustered.
    #[serde(default)]
    pub clumping: f32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionConfig {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub count: u32,
    pub excitatory_fraction: f32,
    pub shape: ShapeConfig,
    pub excitatory: NeuronParams,
    pub inhibitory: NeuronParams,
    /// Relative per-neuron jitter of threshold and excitability, 0..1.
    #[serde(default)]
    pub heterogeneity: f32,
}

impl RegionConfig {
    pub fn excitatory_count(&self) -> u32 {
        ((self.count as f64) * (self.excitatory_fraction as f64)).round() as u32
    }
    pub fn inhibitory_count(&self) -> u32 {
        self.count - self.excitatory_count()
    }
    pub fn params(&self, class: NeuronClass) -> &NeuronParams {
        match class {
            NeuronClass::Excitatory => &self.excitatory,
            NeuronClass::Inhibitory => &self.inhibitory,
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeightConfig {
    /// Magnitude; the sign comes from the presynaptic class (Dale's principle).
    pub mean: f32,
    #[serde(default)]
    pub std: f32,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DelayConfig {
    pub min: f32,
    pub max: f32,
}

/// Per-projection plasticity. Unset rates and bounds fall back to the global values.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionPlasticity {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub rule: PlasticityRule,
    pub a_plus: Option<f32>,
    pub a_minus: Option<f32>,
    pub w_min: Option<f32>,
    pub w_max: Option<f32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionConfig {
    #[serde(default)]
    pub id: String,
    pub from: String,
    pub source: NeuronClass,
    pub to: String,
    #[serde(default)]
    pub target: TargetFilter,
    /// Probability that a given source neuron contacts a given target neuron.
    pub probability: f64,
    pub weight: WeightConfig,
    pub delay_ms: DelayConfig,
    #[serde(default)]
    pub topology: Topology,
    /// Spatial spread (σ) for local/topographic projections, as a fraction of the
    /// target region's radius.
    #[serde(default = "default_spread")]
    pub spread: f32,
    #[serde(default)]
    pub allow_autapses: bool,
    #[serde(default)]
    pub plasticity: ProjectionPlasticity,
}

fn default_spread() -> f32 {
    0.25
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SynapseConfig {
    /// Decay constant of excitatory synaptic current (dI/dt = −I/τ).
    pub tau_exc_ms: f32,
    /// Decay constant of inhibitory synaptic current.
    pub tau_inh_ms: f32,
}

impl Default for SynapseConfig {
    fn default() -> Self {
        SynapseConfig {
            tau_exc_ms: 5.0,
            tau_inh_ms: 10.0,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlasticityConfig {
    /// Master switch. Can also be toggled at run time.
    #[serde(default)]
    pub enabled: bool,
    pub tau_plus_ms: f32,
    pub tau_minus_ms: f32,
    pub a_plus: f32,
    pub a_minus: f32,
    pub w_min: f32,
    pub w_max: f32,
    /// Reward-modulated STDP: eligibility trace decay.
    pub eligibility_tau_ms: f32,
    /// Neuromodulator (reward signal) decay.
    pub modulator_tau_ms: f32,
    /// Learning rate applied to modulator × eligibility.
    pub reward_rate: f32,
    /// Region whose spikes release neuromodulator, if any.
    #[serde(default)]
    pub modulator_region: Option<String>,
    /// Modulator released per spike in `modulator_region`.
    #[serde(default)]
    pub modulator_per_spike: f32,
}

impl Default for PlasticityConfig {
    fn default() -> Self {
        PlasticityConfig {
            enabled: false,
            tau_plus_ms: 20.0,
            tau_minus_ms: 20.0,
            a_plus: 0.01,
            a_minus: 0.012,
            w_min: 0.0,
            w_max: 2.0,
            eligibility_tau_ms: 1000.0,
            modulator_tau_ms: 200.0,
            reward_rate: 1.0,
            modulator_region: None,
            modulator_per_spike: 0.0,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrainConfig {
    #[serde(default)]
    pub name: String,
    pub seed: u32,
    pub timestep_ms: f32,
    #[serde(default)]
    pub synapse: SynapseConfig,
    #[serde(default)]
    pub plasticity: PlasticityConfig,
    pub regions: Vec<RegionConfig>,
    #[serde(default)]
    pub projections: Vec<ProjectionConfig>,
}

/// A configuration error with a JSON-path-like location.
#[derive(Debug, Clone, PartialEq)]
pub struct ConfigError {
    pub path: String,
    pub message: String,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.path.is_empty() {
            write!(f, "{}", self.message)
        } else {
            write!(f, "{}: {}", self.path, self.message)
        }
    }
}

impl std::error::Error for ConfigError {}

pub(crate) fn err(path: impl Into<String>, message: impl Into<String>) -> ConfigError {
    ConfigError {
        path: path.into(),
        message: message.into(),
    }
}

fn in_range(path: &str, v: f32, lo: f32, hi: f32) -> Result<(), ConfigError> {
    if !v.is_finite() {
        return Err(err(path, "must be a finite number"));
    }
    if v < lo || v > hi {
        return Err(err(path, format!("must be between {lo} and {hi} (got {v})")));
    }
    Ok(())
}

/// Totals derived from a valid configuration, before anything is allocated.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigTotals {
    pub neurons: u64,
    /// Expected synapse count (random connectivity makes the exact count known
    /// only after construction).
    pub expected_synapses: f64,
    pub expected_plastic_synapses: f64,
    pub max_delay_steps: u32,
}

pub fn validate_neuron_params(path: &str, p: &NeuronParams, dt: f32) -> Result<(), ConfigError> {
    in_range(&format!("{path}.vRest"), p.v_rest, -200.0, 100.0)?;
    in_range(&format!("{path}.vThreshold"), p.v_threshold, -200.0, 100.0)?;
    in_range(&format!("{path}.vReset"), p.v_reset, -200.0, 100.0)?;
    if p.v_reset >= p.v_threshold {
        return Err(err(
            format!("{path}.vReset"),
            "must be below the firing threshold",
        ));
    }
    in_range(&format!("{path}.tauMs"), p.tau_ms, dt.max(0.5), 1000.0)?;
    in_range(&format!("{path}.refractoryMs"), p.refractory_ms, 0.0, 100.0)?;
    in_range(&format!("{path}.resistance"), p.resistance, 0.0, 100.0)?;
    in_range(&format!("{path}.bias"), p.bias, -100.0, 100.0)?;
    in_range(&format!("{path}.noiseStd"), p.noise_std, 0.0, 100.0)?;
    Ok(())
}

impl BrainConfig {
    pub fn from_json(json: &str) -> Result<BrainConfig, ConfigError> {
        serde_json::from_str(json).map_err(|e| err("", format!("invalid configuration: {e}")))
    }

    /// Delay in whole steps. Delays are quantised to the timestep with a minimum of
    /// one step: an event is never delivered in the step that emitted it.
    pub fn delay_steps(&self, ms: f32) -> u32 {
        ((ms / self.timestep_ms).round() as i64).max(1) as u32
    }

    pub fn region_index(&self) -> HashMap<&str, usize> {
        self.regions
            .iter()
            .enumerate()
            .map(|(i, r)| (r.id.as_str(), i))
            .collect()
    }

    fn target_count(&self, region: usize, filter: TargetFilter) -> u32 {
        let r = &self.regions[region];
        match filter {
            TargetFilter::All => r.count,
            TargetFilter::Excitatory => r.excitatory_count(),
            TargetFilter::Inhibitory => r.inhibitory_count(),
        }
    }

    /// Validates everything the engine relies on and returns the network totals.
    pub fn validate(&self) -> Result<ConfigTotals, ConfigError> {
        let dt = self.timestep_ms;
        in_range("timestepMs", dt, limits::MIN_TIMESTEP_MS, limits::MAX_TIMESTEP_MS)?;
        in_range("synapse.tauExcMs", self.synapse.tau_exc_ms, 0.0, 1000.0)?;
        in_range("synapse.tauInhMs", self.synapse.tau_inh_ms, 0.0, 1000.0)?;
        let pl = &self.plasticity;
        in_range("plasticity.tauPlusMs", pl.tau_plus_ms, 1.0, 1000.0)?;
        in_range("plasticity.tauMinusMs", pl.tau_minus_ms, 1.0, 1000.0)?;
        in_range("plasticity.aPlus", pl.a_plus, 0.0, 10.0)?;
        in_range("plasticity.aMinus", pl.a_minus, 0.0, 10.0)?;
        in_range("plasticity.wMin", pl.w_min, 0.0, 1000.0)?;
        in_range("plasticity.wMax", pl.w_max, 0.0, 1000.0)?;
        if pl.w_max < pl.w_min {
            return Err(err("plasticity.wMax", "must be ≥ wMin"));
        }
        in_range("plasticity.eligibilityTauMs", pl.eligibility_tau_ms, 1.0, 100_000.0)?;
        in_range("plasticity.modulatorTauMs", pl.modulator_tau_ms, 1.0, 100_000.0)?;
        in_range("plasticity.rewardRate", pl.reward_rate, 0.0, 1000.0)?;
        in_range("plasticity.modulatorPerSpike", pl.modulator_per_spike, -10.0, 10.0)?;

        if self.regions.is_empty() {
            return Err(err("regions", "at least one region is required"));
        }
        if self.regions.len() > limits::MAX_REGIONS {
            return Err(err(
                "regions",
                format!("at most {} regions are supported", limits::MAX_REGIONS),
            ));
        }
        if self.projections.len() > limits::MAX_PROJECTIONS {
            return Err(err(
                "projections",
                format!("at most {} projections are supported", limits::MAX_PROJECTIONS),
            ));
        }

        let mut neurons: u64 = 0;
        let mut ids = HashMap::new();
        for (i, r) in self.regions.iter().enumerate() {
            let p = format!("regions[{i}]");
            if r.id.trim().is_empty() {
                return Err(err(format!("{p}.id"), "must not be empty"));
            }
            if ids.insert(r.id.as_str(), i).is_some() {
                return Err(err(format!("{p}.id"), format!("duplicate region id '{}'", r.id)));
            }
            if r.count == 0 {
                return Err(err(format!("{p}.count"), "must be at least 1"));
            }
            neurons += r.count as u64;
            in_range(&format!("{p}.excitatoryFraction"), r.excitatory_fraction, 0.0, 1.0)?;
            in_range(&format!("{p}.heterogeneity"), r.heterogeneity, 0.0, 1.0)?;
            for k in 0..3 {
                in_range(&format!("{p}.shape.center[{k}]"), r.shape.center[k], -1.0e4, 1.0e4)?;
                in_range(&format!("{p}.shape.radius[{k}]"), r.shape.radius[k], 0.01, 1.0e4)?;
            }
            in_range(&format!("{p}.shape.shell"), r.shape.shell, 0.0, 0.95)?;
            in_range(&format!("{p}.shape.warp"), r.shape.warp, 0.0, 1.0)?;
            in_range(&format!("{p}.shape.clumping"), r.shape.clumping, 0.0, 1.0)?;
            validate_neuron_params(&format!("{p}.excitatory"), &r.excitatory, dt)?;
            validate_neuron_params(&format!("{p}.inhibitory"), &r.inhibitory, dt)?;
        }
        if neurons > limits::MAX_NEURONS {
            return Err(err(
                "regions",
                format!("{neurons} neurons exceeds the engine limit of {}", limits::MAX_NEURONS),
            ));
        }
        if let Some(m) = &pl.modulator_region {
            if !ids.contains_key(m.as_str()) {
                return Err(err("plasticity.modulatorRegion", format!("unknown region '{m}'")));
            }
        }

        let mut synapses = 0.0f64;
        let mut plastic = 0.0f64;
        let mut max_delay_steps = 1u32;
        let mut keys = HashMap::new();
        for (i, p) in self.projections.iter().enumerate() {
            let path = format!("projections[{i}]");
            let from = *ids
                .get(p.from.as_str())
                .ok_or_else(|| err(format!("{path}.from"), format!("unknown region '{}'", p.from)))?;
            let to = *ids
                .get(p.to.as_str())
                .ok_or_else(|| err(format!("{path}.to"), format!("unknown region '{}'", p.to)))?;
            if keys.insert((from, p.source, to, p.target), i).is_some() {
                return Err(err(
                    &path,
                    format!(
                        "duplicate projection {} ({:?}) → {} ({:?})",
                        p.from, p.source, p.to, p.target
                    ),
                ));
            }
            let overlaps = match p.target {
                TargetFilter::All => [TargetFilter::Excitatory, TargetFilter::Inhibitory]
                    .iter()
                    .any(|f| keys.contains_key(&(from, p.source, to, *f))),
                _ => keys.contains_key(&(from, p.source, to, TargetFilter::All)),
            };
            if overlaps {
                return Err(err(
                    &path,
                    "overlaps another projection between the same populations",
                ));
            }
            if !(0.0..=1.0).contains(&p.probability) || !p.probability.is_finite() {
                return Err(err(format!("{path}.probability"), "must be between 0 and 1"));
            }
            let sources = match p.source {
                NeuronClass::Excitatory => self.regions[from].excitatory_count(),
                NeuronClass::Inhibitory => self.regions[from].inhibitory_count(),
            } as f64;
            let targets = self.target_count(to, p.target) as f64;
            let fan_out = p.probability * targets;
            if fan_out > limits::MAX_EXPECTED_FAN_OUT {
                return Err(err(
                    format!("{path}.probability"),
                    format!(
                        "creates about {fan_out:.0} synapses per neuron; the maximum is {}",
                        limits::MAX_EXPECTED_FAN_OUT
                    ),
                ));
            }
            in_range(&format!("{path}.weight.mean"), p.weight.mean, 0.0, 1000.0)?;
            in_range(&format!("{path}.weight.std"), p.weight.std, 0.0, 1000.0)?;
            in_range(&format!("{path}.delayMs.min"), p.delay_ms.min, 0.0, 255.0)?;
            in_range(&format!("{path}.delayMs.max"), p.delay_ms.max, 0.0, 255.0)?;
            in_range(&format!("{path}.spread"), p.spread, 0.001, 10.0)?;
            if p.delay_ms.max < p.delay_ms.min {
                return Err(err(format!("{path}.delayMs"), "max must be ≥ min"));
            }
            let dmax = self.delay_steps(p.delay_ms.max);
            if dmax > limits::MAX_DELAY_STEPS {
                return Err(err(
                    format!("{path}.delayMs.max"),
                    format!(
                        "{} ms is {dmax} steps at {dt} ms per step; the maximum is {} steps",
                        p.delay_ms.max,
                        limits::MAX_DELAY_STEPS
                    ),
                ));
            }
            max_delay_steps = max_delay_steps.max(dmax);
            let pp = &p.plasticity;
            if let Some(v) = pp.a_plus {
                in_range(&format!("{path}.plasticity.aPlus"), v, 0.0, 10.0)?;
            }
            if let Some(v) = pp.a_minus {
                in_range(&format!("{path}.plasticity.aMinus"), v, 0.0, 10.0)?;
            }
            let wmin = pp.w_min.unwrap_or(pl.w_min);
            let wmax = pp.w_max.unwrap_or(pl.w_max);
            in_range(&format!("{path}.plasticity.wMin"), wmin, 0.0, 1000.0)?;
            in_range(&format!("{path}.plasticity.wMax"), wmax, 0.0, 1000.0)?;
            if wmax < wmin {
                return Err(err(format!("{path}.plasticity.wMax"), "must be ≥ wMin"));
            }
            let expected = sources * fan_out;
            synapses += expected;
            if pp.enabled {
                plastic += expected;
            }
        }
        if synapses > limits::MAX_SYNAPSES as f64 {
            return Err(err(
                "projections",
                format!(
                    "about {synapses:.0} synapses exceeds the engine limit of {}",
                    limits::MAX_SYNAPSES
                ),
            ));
        }
        Ok(ConfigTotals {
            neurons,
            expected_synapses: synapses,
            expected_plastic_synapses: plastic,
            max_delay_steps,
        })
    }
}

/// Bytes the engine allocates for a network of this shape. Mirrors `estimateMemory`
/// in `src/config/estimate.ts`; keep the two in sync.
pub fn estimate_memory_bytes(t: &ConfigTotals) -> f64 {
    let n = t.neurons as f64;
    let s = t.expected_synapses;
    let ring_slots = t.max_delay_steps as f64 + 1.0;
    let mut bytes = n * crate::network::BYTES_PER_NEURON as f64
        + s * crate::network::BYTES_PER_SYNAPSE as f64
        + ring_slots * n * 8.0
        + 2.0 * (n + 1.0) * 4.0;
    if t.expected_plastic_synapses > 0.0 {
        // initial weights (all synapses) + eligibility (plastic only)
        bytes += s * 4.0 + t.expected_plastic_synapses * 4.0;
    }
    bytes
}
