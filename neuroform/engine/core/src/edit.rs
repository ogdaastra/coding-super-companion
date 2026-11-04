//! Run-time modification of a built network.
//!
//! # Change policy
//!
//! *Immediate* (applied at the next step, no rebuild): neuron parameters,
//! population parameters, region enable/disable, pathway gain, individual synaptic
//! weights, plasticity switch and learning-rate scale, reward, stimulation.
//!
//! *Structural* (require rebuilding from the configuration): neuron counts,
//! excitatory/inhibitory ratio, connection probabilities, topology, delays, spatial
//! layout, timestep and seed. The application shows these as pending changes.
//!
//! Population edits preserve per-neuron heterogeneity: additive parameters
//! (potentials, currents) shift every neuron by (new − current mean); multiplicative
//! parameters (time constants, resistance, excitability, noise) scale every neuron
//! by new / current mean.

use crate::config::{err, ConfigError};
use crate::network::Network;
use crate::stimulus::ClassFilter;
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NeuronParam {
    VRest,
    VThreshold,
    VReset,
    TauMs,
    RefractoryMs,
    Resistance,
    Excitability,
    Bias,
    ExternalInput,
    NoiseStd,
}

impl NeuronParam {
    pub fn from_index(i: u32) -> Option<NeuronParam> {
        use NeuronParam::*;
        Some(match i {
            0 => VRest,
            1 => VThreshold,
            2 => VReset,
            3 => TauMs,
            4 => RefractoryMs,
            5 => Resistance,
            6 => Excitability,
            7 => Bias,
            8 => ExternalInput,
            9 => NoiseStd,
            _ => return None,
        })
    }

    fn range(self) -> (f32, f32) {
        use NeuronParam::*;
        match self {
            VRest | VThreshold | VReset => (-200.0, 100.0),
            TauMs => (0.5, 1000.0),
            RefractoryMs => (0.0, 100.0),
            Resistance => (0.0, 100.0),
            Excitability => (0.0, 10.0),
            Bias | ExternalInput => (-100.0, 100.0),
            NoiseStd => (0.0, 100.0),
        }
    }

    fn multiplicative(self) -> bool {
        use NeuronParam::*;
        matches!(self, TauMs | RefractoryMs | Resistance | Excitability | NoiseStd)
    }
}

impl Network {
    pub fn neuron_param(&self, i: usize, param: NeuronParam) -> f32 {
        use NeuronParam::*;
        let p = &self.p;
        match param {
            VRest => p.v_rest[i],
            VThreshold => p.v_th[i],
            VReset => p.v_reset[i],
            TauMs => p.tau[i],
            RefractoryMs => p.refractory_ms[i],
            Resistance => p.resistance[i],
            Excitability => p.excitability[i],
            Bias => p.bias[i],
            ExternalInput => p.i_ext[i],
            NoiseStd => p.noise_std[i],
        }
    }

    fn write_param(&mut self, i: usize, param: NeuronParam, value: f32) {
        use NeuronParam::*;
        let p = &mut self.p;
        match param {
            VRest => p.v_rest[i] = value,
            VThreshold => p.v_th[i] = value,
            VReset => p.v_reset[i] = value,
            TauMs => p.tau[i] = value.max(self.dt),
            RefractoryMs => p.refractory_ms[i] = value,
            Resistance => p.resistance[i] = value,
            Excitability => p.excitability[i] = value,
            Bias => p.bias[i] = value,
            ExternalInput => p.i_ext[i] = value,
            NoiseStd => p.noise_std[i] = value,
        }
        p.refresh(i, self.dt);
    }

    /// Sets one parameter of one neuron. Returns the previous value (for undo).
    pub fn set_neuron_param(&mut self, i: usize, param: NeuronParam, value: f32) -> Result<f32, ConfigError> {
        if i >= self.n {
            return Err(err("neuron", format!("neuron {i} does not exist")));
        }
        let (lo, hi) = param.range();
        if !value.is_finite() || value < lo || value > hi {
            return Err(err("value", format!("must be between {lo} and {hi}")));
        }
        let (th, reset) = match param {
            NeuronParam::VThreshold => (value, self.p.v_reset[i]),
            NeuronParam::VReset => (self.p.v_th[i], value),
            _ => (self.p.v_th[i], self.p.v_reset[i]),
        };
        if reset >= th {
            return Err(err("value", "the reset potential must stay below the threshold"));
        }
        let old = self.neuron_param(i, param);
        self.write_param(i, param, value);
        if param == NeuronParam::VReset && self.ref_left[i] > 0 {
            self.v[i] = value;
        }
        Ok(old)
    }

    /// Mean of a parameter over a region's neurons of the given class.
    pub fn population_mean(&self, region: usize, class: ClassFilter, param: NeuronParam) -> Option<f32> {
        let r = self.regions.get(region)?;
        let (a, b) = population_range(r, class);
        if b <= a {
            return None;
        }
        let sum: f64 = (a..b).map(|i| self.neuron_param(i, param) as f64).sum();
        Some((sum / (b - a) as f64) as f32)
    }

    /// Sets a population parameter to a new mean, preserving heterogeneity.
    pub fn set_population_param(
        &mut self,
        region: usize,
        class: ClassFilter,
        param: NeuronParam,
        value: f32,
    ) -> Result<f32, ConfigError> {
        let r = self
            .regions
            .get(region)
            .ok_or_else(|| err("region", format!("region {region} does not exist")))?
            .clone();
        let (lo, hi) = param.range();
        if !value.is_finite() || value < lo || value > hi {
            return Err(err("value", format!("must be between {lo} and {hi}")));
        }
        let (a, b) = population_range(&r, class);
        let mean = self
            .population_mean(region, class, param)
            .ok_or_else(|| err("class", "the population is empty"))?;
        for i in a..b {
            let old = self.neuron_param(i, param);
            let mut nv = if param.multiplicative() && mean.abs() > 1e-9 {
                old * value / mean
            } else if param.multiplicative() {
                value
            } else {
                old + (value - mean)
            };
            nv = nv.clamp(lo, hi);
            // Keep each neuron's reset below its threshold.
            match param {
                NeuronParam::VThreshold => nv = nv.max(self.p.v_reset[i] + 0.5),
                NeuronParam::VReset => nv = nv.min(self.p.v_th[i] - 0.5),
                _ => {}
            }
            self.write_param(i, param, nv);
        }
        Ok(mean)
    }

    /// Enables or silences a region. A disabled region keeps its neurons and
    /// synapses but does not integrate, fire or transmit.
    pub fn set_region_enabled(&mut self, region: usize, enabled: bool) -> Result<bool, ConfigError> {
        let r = self
            .regions
            .get_mut(region)
            .ok_or_else(|| err("region", format!("region {region} does not exist")))?;
        let old = r.enabled;
        r.enabled = enabled;
        Ok(old)
    }

    /// Scales every synapse of a projection (0 disables the pathway).
    pub fn set_projection_gain(&mut self, projection: usize, gain: f32) -> Result<f32, ConfigError> {
        if !gain.is_finite() || !(0.0..=100.0).contains(&gain) {
            return Err(err("gain", "must be between 0 and 100"));
        }
        let p = self
            .projections
            .get_mut(projection)
            .ok_or_else(|| err("projection", format!("projection {projection} does not exist")))?;
        let old = p.gain;
        p.gain = gain;
        self.refresh_projection_tables();
        Ok(old)
    }

    /// Sets the magnitude of one synapse's weight (the sign follows its class).
    pub fn set_synapse_weight(&mut self, s: usize, magnitude: f32) -> Result<f32, ConfigError> {
        if s >= self.weight.len() {
            return Err(err("synapse", format!("synapse {s} does not exist")));
        }
        if !magnitude.is_finite() || !(0.0..=1000.0).contains(&magnitude) {
            return Err(err("weight", "must be between 0 and 1000"));
        }
        let sign = self.projections[self.syn_proj[s] as usize].source.sign();
        let old = self.weight[s].abs();
        self.weight[s] = sign * magnitude;
        Ok(old)
    }

    /// Sets a neuron's membrane potential directly (a voltage step). The next step
    /// integrates from this value, so setting it above threshold fires the neuron.
    pub fn set_membrane_potential(&mut self, i: usize, v: f32) -> Result<f32, ConfigError> {
        if i >= self.n {
            return Err(err("neuron", format!("neuron {i} does not exist")));
        }
        if !v.is_finite() || !(-200.0..=100.0).contains(&v) {
            return Err(err("value", "must be between -200 and 100"));
        }
        let old = self.v[i];
        self.v[i] = v;
        self.ref_left[i] = 0;
        Ok(old)
    }

    pub fn set_plasticity_enabled(&mut self, enabled: bool) {
        self.plasticity.enabled = enabled;
    }

    pub fn set_learning_rate_scale(&mut self, scale: f32) -> Result<(), ConfigError> {
        if !scale.is_finite() || !(0.0..=100.0).contains(&scale) {
            return Err(err("scale", "must be between 0 and 100"));
        }
        self.plasticity.rate_scale = scale;
        Ok(())
    }

    pub fn inject_reward(&mut self, amount: f32) {
        if amount.is_finite() {
            self.plasticity.inject_reward(amount.clamp(-100.0, 100.0));
        }
    }
}

fn population_range(r: &crate::network::RegionState, class: ClassFilter) -> (usize, usize) {
    match class {
        ClassFilter::All => (r.start as usize, r.end as usize),
        ClassFilter::Excitatory => (r.start as usize, r.exc_end as usize),
        ClassFilter::Inhibitory => (r.exc_end as usize, r.end as usize),
    }
}
