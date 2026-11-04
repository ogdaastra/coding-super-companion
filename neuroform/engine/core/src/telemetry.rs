//! Measurements accumulated over a telemetry window and read out by the host.
//!
//! Everything here is derived from simulation state as it evolves; nothing is
//! estimated from configuration. The host (worker) reads a window, which clears it.
//!
//! # Synchrony
//!
//! Synchrony is the Golomb–Rinzel measure χ over a fixed sample of neurons:
//!
//! ```text
//! χ² = Var_t[ V̄(t) ] / mean_i Var_t[ V_i(t) ],   V̄(t) = mean_i V_i(t)
//! ```
//!
//! χ → 1 when the sampled neurons' membrane potentials move together and
//! χ ≈ 1/√K for K independent neurons. It is computed per region, over all
//! sampled neurons, and over a host-selected group of regions.

use crate::network::Network;
use serde::Serialize;

pub(crate) const MAX_REGIONS: usize = crate::config::limits::MAX_REGIONS;

#[derive(Clone)]
pub struct TelemetryWindow {
    pub steps: u64,
    pub start_step: u64,
    pub pop_spikes: Vec<u64>,
    pub region_vsum: Vec<f64>,
    pub proj_tx: Vec<u64>,
    pub events_scheduled: u64,
    pub events_delivered: u64,
    pub firing_last_step: u32,

    sample_sum: Vec<f64>,
    sample_sq: Vec<f64>,
    region_mean_sum: Vec<f64>,
    region_mean_sq: Vec<f64>,
    global_sum: f64,
    global_sq: f64,
    pub group_mask: u64,
    group_sum: f64,
    group_sq: f64,

    pub prof_stimulus: f64,
    pub prof_integrate: f64,
    pub prof_plasticity: f64,
    pub prof_propagate: f64,
    pub prof_record: f64,
}

impl TelemetryWindow {
    pub fn new(regions: usize, projections: usize, samples: usize) -> Self {
        TelemetryWindow {
            steps: 0,
            start_step: 0,
            pop_spikes: vec![0; regions * 2],
            region_vsum: vec![0.0; regions],
            proj_tx: vec![0; projections],
            events_scheduled: 0,
            events_delivered: 0,
            firing_last_step: 0,
            sample_sum: vec![0.0; samples],
            sample_sq: vec![0.0; samples],
            region_mean_sum: vec![0.0; regions],
            region_mean_sq: vec![0.0; regions],
            global_sum: 0.0,
            global_sq: 0.0,
            group_mask: 0,
            group_sum: 0.0,
            group_sq: 0.0,
            prof_stimulus: 0.0,
            prof_integrate: 0.0,
            prof_plasticity: 0.0,
            prof_propagate: 0.0,
            prof_record: 0.0,
        }
    }

    pub fn clear(&mut self, start_step: u64) {
        self.steps = 0;
        self.start_step = start_step;
        self.pop_spikes.fill(0);
        self.region_vsum.fill(0.0);
        self.proj_tx.fill(0);
        self.events_scheduled = 0;
        self.events_delivered = 0;
        self.sample_sum.fill(0.0);
        self.sample_sq.fill(0.0);
        self.region_mean_sum.fill(0.0);
        self.region_mean_sq.fill(0.0);
        self.global_sum = 0.0;
        self.global_sq = 0.0;
        self.group_sum = 0.0;
        self.group_sq = 0.0;
        self.prof_stimulus = 0.0;
        self.prof_integrate = 0.0;
        self.prof_plasticity = 0.0;
        self.prof_propagate = 0.0;
        self.prof_record = 0.0;
    }

    pub(crate) fn record_sample(&mut self, v: &[f32], sample: &[u32], region_of: &[u16], regions: usize) {
        let mut rsum = [0.0f64; MAX_REGIONS];
        let mut rcnt = [0u32; MAX_REGIONS];
        let mut total = 0.0;
        for (k, &i) in sample.iter().enumerate() {
            let x = v[i as usize] as f64;
            self.sample_sum[k] += x;
            self.sample_sq[k] += x * x;
            let r = region_of[i as usize] as usize;
            rsum[r] += x;
            rcnt[r] += 1;
            total += x;
        }
        if sample.is_empty() {
            return;
        }
        let g = total / sample.len() as f64;
        self.global_sum += g;
        self.global_sq += g * g;
        let (mut gs, mut gc) = (0.0, 0u32);
        for r in 0..regions {
            if rcnt[r] > 0 {
                let m = rsum[r] / rcnt[r] as f64;
                self.region_mean_sum[r] += m;
                self.region_mean_sq[r] += m * m;
                if self.group_mask & (1u64 << r) != 0 {
                    gs += rsum[r];
                    gc += rcnt[r];
                }
            }
        }
        if gc > 0 {
            let m = gs / gc as f64;
            self.group_sum += m;
            self.group_sq += m * m;
        }
    }

    fn chi(&self, mean_sum: f64, mean_sq: f64, members: &[usize]) -> f64 {
        let t = self.steps as f64;
        if t < 2.0 || members.is_empty() {
            return 0.0;
        }
        let var_pop = (mean_sq / t - (mean_sum / t).powi(2)).max(0.0);
        let mut mv = 0.0;
        for &k in members {
            mv += (self.sample_sq[k] / t - (self.sample_sum[k] / t).powi(2)).max(0.0);
        }
        mv /= members.len() as f64;
        if mv <= 1e-12 {
            return 0.0;
        }
        (var_pop / mv).sqrt().min(1.0)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionReport {
    pub spikes_exc: u64,
    pub spikes_inh: u64,
    pub v_mean: f64,
    pub active: u32,
    pub synchrony: f64,
    pub enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryReport {
    pub step: u64,
    pub time_ms: f64,
    pub window_steps: u64,
    pub window_ms: f64,
    pub regions: Vec<RegionReport>,
    /// Synaptic events scheduled per projection in this window.
    pub projection_events: Vec<u64>,
    pub events_scheduled: u64,
    pub events_delivered: u64,
    pub pending_events: u64,
    pub active_neurons: u32,
    pub active_exc: u32,
    pub active_inh: u32,
    pub active_synapses: u64,
    pub firing_last_step: u32,
    pub v_mean: f64,
    pub synchrony: f64,
    pub group_synchrony: f64,
    pub plasticity: PlasticityReport,
    pub profile_ms: ProfileReport,
    pub stimuli: Vec<StimulusReport>,
    pub frame_dropped: u64,
    pub raster_dropped: u64,
    pub probe_dropped: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlasticityReport {
    pub enabled: bool,
    pub rate_scale: f32,
    pub potentiation: f64,
    pub depression: f64,
    pub updates: u64,
    pub modulator: f32,
    pub modulated_change: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileReport {
    pub stimulus: f64,
    pub integrate: f64,
    pub plasticity: f64,
    pub propagate: f64,
    pub record: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StimulusReport {
    pub id: u32,
    pub label: String,
    pub targets: usize,
    pub on: bool,
    pub start_ms: f64,
    pub end_ms: f64,
    pub events: u64,
}

impl Network {
    /// Selects the regions (bit mask) whose combined synchrony is reported.
    pub fn set_synchrony_group(&mut self, mask: u64) {
        self.tw.group_mask = mask;
    }

    /// Reads the current telemetry window and starts a new one.
    pub fn take_telemetry(&mut self) -> TelemetryReport {
        let tw = &self.tw;
        let steps = tw.steps.max(1) as f64;
        let start_stamp = (tw.start_step + 1) as u32;
        let rcount = self.regions.len();

        // Neurons that fired at least once during the window.
        let mut active = vec![[0u32; 2]; rcount];
        // Synapses that carried at least one event: every outgoing synapse of a
        // neuron that fired in the window (pathway gains of zero excluded).
        let mut active_synapses = 0u64;
        for i in 0..self.n {
            if self.last_spike[i] >= start_stamp && self.last_spike[i] != 0 {
                active[self.p.region[i] as usize][self.p.class[i] as usize] += 1;
                let (lo, hi) = (self.row_ptr[i] as usize, self.row_ptr[i + 1] as usize);
                for s in lo..hi {
                    if self.gain_table[self.syn_proj[s] as usize] != 0.0 {
                        active_synapses += 1;
                    }
                }
            }
        }

        let mut members: Vec<Vec<usize>> = vec![Vec::new(); rcount];
        for (k, &i) in self.sample.iter().enumerate() {
            members[self.p.region[i as usize] as usize].push(k);
        }
        let all: Vec<usize> = (0..self.sample.len()).collect();
        let group: Vec<usize> = (0..rcount)
            .filter(|&r| tw.group_mask & (1u64 << r) != 0)
            .flat_map(|r| members[r].iter().copied())
            .collect();

        let mut vsum_total = 0.0;
        let regions: Vec<RegionReport> = (0..rcount)
            .map(|r| {
                vsum_total += tw.region_vsum[r];
                RegionReport {
                    spikes_exc: tw.pop_spikes[2 * r],
                    spikes_inh: tw.pop_spikes[2 * r + 1],
                    v_mean: tw.region_vsum[r] / steps / self.regions[r].count().max(1) as f64,
                    active: active[r][0] + active[r][1],
                    synchrony: tw.chi(tw.region_mean_sum[r], tw.region_mean_sq[r], &members[r]),
                    enabled: self.regions[r].enabled,
                }
            })
            .collect();
        let ps = &self.plasticity;
        let report = TelemetryReport {
            step: self.step,
            time_ms: self.time_ms(),
            window_steps: tw.steps,
            window_ms: tw.steps as f64 * self.dt as f64,
            regions,
            projection_events: tw.proj_tx.clone(),
            events_scheduled: tw.events_scheduled,
            events_delivered: tw.events_delivered,
            pending_events: self.slot_events.iter().sum(),
            active_neurons: active.iter().map(|a| a[0] + a[1]).sum(),
            active_exc: active.iter().map(|a| a[0]).sum(),
            active_inh: active.iter().map(|a| a[1]).sum(),
            active_synapses,
            firing_last_step: tw.firing_last_step,
            v_mean: vsum_total / steps / self.n.max(1) as f64,
            synchrony: tw.chi(tw.global_sum, tw.global_sq, &all),
            group_synchrony: tw.chi(tw.group_sum, tw.group_sq, &group),
            plasticity: PlasticityReport {
                enabled: ps.enabled && ps.any_plastic,
                rate_scale: ps.rate_scale,
                potentiation: ps.potentiation,
                depression: ps.depression,
                updates: ps.updates,
                modulator: ps.modulator,
                modulated_change: ps.modulated_change,
            },
            profile_ms: ProfileReport {
                stimulus: tw.prof_stimulus,
                integrate: tw.prof_integrate,
                plasticity: tw.prof_plasticity,
                propagate: tw.prof_propagate,
                record: tw.prof_record,
            },
            stimuli: self
                .stimuli
                .iter()
                .map(|s| StimulusReport {
                    id: s.id,
                    label: s.spec.label.clone(),
                    targets: s.targets.len(),
                    on: s.on,
                    start_ms: s.start_step as f64 * self.dt as f64,
                    end_ms: s.end_step() as f64 * self.dt as f64,
                    events: s.events,
                })
                .collect(),
            frame_dropped: self.frame_dropped,
            raster_dropped: self.raster_dropped,
            probe_dropped: self.probe_dropped,
        };
        self.tw.clear(self.step);
        self.plasticity.window_clear();
        report
    }

    // ------------------------------------------------------------ drained buffers

    /// Spikes since the last drain as (step, neuron) pairs.
    pub fn frame_spikes(&self) -> &[u32] {
        &self.frame_spikes
    }
    pub fn clear_frame_spikes(&mut self) {
        self.frame_spikes.clear();
    }
    /// Raster events for sampled rows as (step, row) pairs.
    pub fn raster_events(&self) -> &[u32] {
        &self.raster
    }
    pub fn clear_raster(&mut self) {
        self.raster.clear();
    }
    pub fn probe_samples(&self) -> &[f32] {
        &self.probe_buf
    }
    pub fn clear_probe_samples(&mut self) {
        self.probe_buf.clear();
    }
    pub fn probes(&self) -> &[u32] {
        &self.probes
    }

    /// Sets the neurons whose membrane potential is recorded every step.
    pub fn set_probes(&mut self, ids: &[u32]) {
        self.probes = ids
            .iter()
            .copied()
            .filter(|&i| (i as usize) < self.n)
            .take(crate::network::MAX_PROBES)
            .collect();
        self.probe_buf.clear();
    }
}
