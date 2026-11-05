//! Inspection and analysis queries over the live network.
//!
//! These read the actual simulation state; they are intended for interactive use
//! (inspectors, histograms, connectome views) rather than every step.

use crate::config::PlasticityRule;
use crate::network::Network;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeuronDetail {
    pub id: u32,
    pub region: u16,
    pub class: &'static str,
    pub position: [f32; 3],
    pub v: f32,
    pub v_rest: f32,
    pub v_threshold: f32,
    pub v_reset: f32,
    pub tau_ms: f32,
    pub refractory_ms: f32,
    pub refractory_left_ms: f32,
    pub resistance: f32,
    pub excitability: f32,
    pub bias: f32,
    pub external_input: f32,
    pub stimulus_input: f32,
    pub noise_std: f32,
    pub i_exc: f32,
    pub i_inh: f32,
    pub spike_count: u32,
    pub last_spike_ms: Option<f64>,
    pub in_count: u32,
    pub out_count: u32,
    pub in_weight_mean: f32,
    pub out_weight_mean: f32,
    pub trace_pre: f32,
    pub trace_post: f32,
    pub region_enabled: bool,
}

/// One synapse as returned by `synapse_records` (9 × 4 bytes, little-endian):
/// id u32, other neuron u32, weight f32, delay ms f32, projection u32,
/// initial weight f32 (NaN if not plastic), eligibility f32 (NaN if none),
/// effective strength f32, flags u32 (bit0 plastic, bit1 reward rule, bit2 inhibitory).
pub const SYNAPSE_RECORD_WORDS: usize = 9;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Histogram {
    pub min: f32,
    pub max: f32,
    pub excitatory: Vec<u32>,
    pub inhibitory: Vec<u32>,
    pub counted: u64,
    pub total: u64,
    pub sampled: bool,
    pub mean_excitatory: f64,
    pub mean_inhibitory: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionStats {
    pub synapses: u64,
    pub mean_weight: f64,
    pub mean_effective: f64,
    pub min_weight: f32,
    pub max_weight: f32,
    pub mean_initial: Option<f64>,
    pub mean_delay_ms: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeightChange {
    pub synapse: u32,
    pub pre: u32,
    pub post: u32,
    pub initial: f32,
    pub weight: f32,
    pub delta: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Communities {
    pub count: u32,
    pub modularity: f64,
    pub sizes: Vec<u32>,
    pub iterations: u32,
}

impl Network {
    pub fn neuron_detail(&self, i: usize) -> Option<NeuronDetail> {
        if i >= self.n {
            return None;
        }
        let p = &self.p;
        let (lo, hi) = (self.row_ptr[i] as usize, self.row_ptr[i + 1] as usize);
        let (ilo, ihi) = (self.in_ptr[i] as usize, self.in_ptr[i + 1] as usize);
        let out_mean = if hi > lo {
            self.weight[lo..hi].iter().map(|w| *w as f64).sum::<f64>() / (hi - lo) as f64
        } else {
            0.0
        };
        let in_mean = if ihi > ilo {
            self.in_syn[ilo..ihi]
                .iter()
                .map(|&s| self.weight[s as usize] as f64)
                .sum::<f64>()
                / (ihi - ilo) as f64
        } else {
            0.0
        };
        let (x, y) = self.plasticity.traces(i, self.step);
        Some(NeuronDetail {
            id: i as u32,
            region: p.region[i],
            class: if p.class[i] == 0 { "excitatory" } else { "inhibitory" },
            position: [self.positions[3 * i], self.positions[3 * i + 1], self.positions[3 * i + 2]],
            v: self.v[i],
            v_rest: p.v_rest[i],
            v_threshold: p.v_th[i],
            v_reset: p.v_reset[i],
            tau_ms: p.tau[i],
            refractory_ms: p.refractory_ms[i],
            refractory_left_ms: self.ref_left[i] as f32 * self.dt,
            resistance: p.resistance[i],
            excitability: p.excitability[i],
            bias: p.bias[i],
            external_input: p.i_ext[i],
            stimulus_input: p.i_stim[i],
            noise_std: p.noise_std[i],
            i_exc: self.i_exc[i],
            i_inh: self.i_inh[i],
            spike_count: self.spike_count[i],
            last_spike_ms: if self.last_spike[i] == 0 {
                None
            } else {
                Some((self.last_spike[i] - 1) as f64 * self.dt as f64)
            },
            in_count: (ihi - ilo) as u32,
            out_count: (hi - lo) as u32,
            in_weight_mean: in_mean as f32,
            out_weight_mean: out_mean as f32,
            trace_pre: x,
            trace_post: y,
            region_enabled: self.regions[p.region[i] as usize].enabled,
        })
    }

    fn push_record(&self, out: &mut Vec<u32>, s: usize, other: u32) {
        let pj = self.syn_proj[s] as usize;
        let proj = &self.projections[pj];
        let mut flags = 0u32;
        if proj.plastic {
            flags |= 1;
        }
        if proj.plastic && proj.rule == PlasticityRule::Reward {
            flags |= 2;
        }
        if proj.source.index() == 1 {
            flags |= 4;
        }
        let w0 = if proj.plastic {
            self.plasticity.initial_weight(s).unwrap_or(f32::NAN)
        } else {
            f32::NAN
        };
        let e = self.plasticity.eligibility(s).unwrap_or(f32::NAN);
        out.extend_from_slice(&[
            s as u32,
            other,
            self.weight[s].to_bits(),
            (self.delay[s] as f32 * self.dt).to_bits(),
            pj as u32,
            w0.to_bits(),
            e.to_bits(),
            self.effective_weight(s).to_bits(),
            flags,
        ]);
    }

    /// Outgoing (`incoming == false`) or incoming synapses of neuron `i`, from
    /// `offset`, at most `limit`. Returns the records and the total count.
    pub fn synapse_records(&self, i: usize, incoming: bool, offset: usize, limit: usize) -> (Vec<u32>, usize) {
        let mut out = Vec::new();
        if i >= self.n {
            return (out, 0);
        }
        if incoming {
            let (lo, hi) = (self.in_ptr[i] as usize, self.in_ptr[i + 1] as usize);
            for k in (lo + offset).min(hi)..(lo + offset + limit).min(hi) {
                self.push_record(&mut out, self.in_syn[k] as usize, self.in_src[k]);
            }
            (out, hi - lo)
        } else {
            let (lo, hi) = (self.row_ptr[i] as usize, self.row_ptr[i + 1] as usize);
            for s in (lo + offset).min(hi)..(lo + offset + limit).min(hi) {
                self.push_record(&mut out, s, self.target[s]);
            }
            (out, hi - lo)
        }
    }

    /// Records for explicit synapse ids; `other` is the postsynaptic neuron and the
    /// presynaptic neuron is appended as a tenth word.
    pub fn synapse_records_by_id(&self, ids: &[u32]) -> Vec<u32> {
        let mut out = Vec::new();
        for &s in ids {
            let s = s as usize;
            if s >= self.weight.len() {
                continue;
            }
            self.push_record(&mut out, s, self.target[s]);
            out.push(self.synapse_source(s));
        }
        out
    }

    /// Histogram of synaptic weight magnitudes, split by class. `projection < 0`
    /// means all synapses. Networks above `max_count` synapses are sampled with a
    /// fixed stride, and the result says so.
    pub fn weight_histogram(&self, projection: i32, bins: usize, max_count: usize) -> Histogram {
        let bins = bins.clamp(4, 512);
        let total = self.weight.len();
        let stride = (total / max_count.max(1)).max(1);
        let pick = |s: usize| projection < 0 || self.syn_proj[s] as i32 == projection;
        let mut max = 0.0f32;
        let mut s = 0;
        while s < total {
            if pick(s) {
                max = max.max(self.weight[s].abs());
            }
            s += stride;
        }
        let max = if max <= 0.0 { 1.0 } else { max };
        let mut ex = vec![0u32; bins];
        let mut inh = vec![0u32; bins];
        let (mut se, mut si, mut ne, mut ni) = (0.0f64, 0.0f64, 0u64, 0u64);
        let mut s = 0;
        while s < total {
            if pick(s) {
                let w = self.weight[s];
                let m = w.abs();
                let b = ((m / max) * bins as f32).min(bins as f32 - 1.0) as usize;
                if self.channel_table[self.syn_proj[s] as usize] == 1 {
                    inh[b] += 1;
                    si += m as f64;
                    ni += 1;
                } else {
                    ex[b] += 1;
                    se += m as f64;
                    ne += 1;
                }
            }
            s += stride;
        }
        Histogram {
            min: 0.0,
            max,
            excitatory: ex,
            inhibitory: inh,
            counted: ne + ni,
            total: total as u64,
            sampled: stride > 1,
            mean_excitatory: if ne > 0 { se / ne as f64 } else { 0.0 },
            mean_inhibitory: if ni > 0 { si / ni as f64 } else { 0.0 },
        }
    }

    /// Exact per-projection weight statistics (one pass over all synapses).
    pub fn projection_stats(&self) -> Vec<ProjectionStats> {
        let pc = self.projections.len();
        let mut sum = vec![0.0f64; pc];
        let mut eff = vec![0.0f64; pc];
        let mut init = vec![0.0f64; pc];
        let mut dsum = vec![0.0f64; pc];
        let mut cnt = vec![0u64; pc];
        let mut lo = vec![f32::INFINITY; pc];
        let mut hi = vec![0.0f32; pc];
        let w0 = &self.plasticity.w0;
        for s in 0..self.weight.len() {
            let p = self.syn_proj[s] as usize;
            let m = self.weight[s].abs();
            sum[p] += m as f64;
            eff[p] += (m * self.projections[p].gain) as f64;
            dsum[p] += self.delay[s] as f64;
            if !w0.is_empty() {
                init[p] += w0[s].abs() as f64;
            }
            cnt[p] += 1;
            lo[p] = lo[p].min(m);
            hi[p] = hi[p].max(m);
        }
        (0..pc)
            .map(|p| {
                let c = cnt[p].max(1) as f64;
                let enabled = self.regions[self.projections[p].from as usize].enabled;
                ProjectionStats {
                    synapses: cnt[p],
                    mean_weight: sum[p] / c,
                    mean_effective: if enabled { eff[p] / c } else { 0.0 },
                    min_weight: if cnt[p] > 0 { lo[p] } else { 0.0 },
                    max_weight: hi[p],
                    mean_initial: if w0.is_empty() || !self.projections[p].plastic {
                        None
                    } else {
                        Some(init[p] / c)
                    },
                    mean_delay_ms: dsum[p] / c * self.dt as f64,
                }
            })
            .collect()
    }

    /// The `k` plastic synapses whose weight moved furthest from its initial value.
    pub fn top_weight_changes(&self, k: usize) -> Vec<WeightChange> {
        let w0 = &self.plasticity.w0;
        if w0.is_empty() || k == 0 {
            return Vec::new();
        }
        let mut best: Vec<(f32, u32, u32)> = Vec::with_capacity(k + 1);
        for j in 0..self.n {
            for s in self.row_ptr[j] as usize..self.row_ptr[j + 1] as usize {
                if !self.projections[self.syn_proj[s] as usize].plastic {
                    continue;
                }
                let d = (self.weight[s].abs() - w0[s].abs()).abs();
                if d <= 0.0 || (best.len() == k && d <= best[k - 1].0) {
                    continue;
                }
                let pos = best.partition_point(|b| b.0 >= d);
                best.insert(pos, (d, s as u32, j as u32));
                best.truncate(k);
            }
        }
        best.into_iter()
            .map(|(_, s, pre)| {
                let su = s as usize;
                WeightChange {
                    synapse: s,
                    pre,
                    post: self.target[su],
                    initial: w0[su],
                    weight: self.weight[su],
                    delta: self.weight[su].abs() - w0[su].abs(),
                }
            })
            .collect()
    }

    /// Weighted label propagation on the undirected synapse graph (|w| as edge
    /// weight, both directions). Returns labels (renumbered by community size,
    /// largest first) and summary statistics including Newman modularity Q.
    pub fn communities(&self, max_iterations: u32) -> (Vec<u32>, Communities) {
        let n = self.n;
        let mut label: Vec<u32> = (0..n as u32).collect();
        let mut order: Vec<u32> = (0..n as u32).collect();
        let mut rng = crate::rng::Rng::new(self.seed as u64, 77);
        let mut acc: Vec<(u32, f32)> = Vec::new();
        let mut iterations = 0;
        for _ in 0..max_iterations.max(1) {
            iterations += 1;
            for k in (1..n).rev() {
                let j = rng.below(k as u32 + 1) as usize;
                order.swap(k, j);
            }
            let mut changed = 0usize;
            for &i in &order {
                let i = i as usize;
                acc.clear();
                for s in self.row_ptr[i] as usize..self.row_ptr[i + 1] as usize {
                    acc.push((label[self.target[s] as usize], self.weight[s].abs()));
                }
                for k in self.in_ptr[i] as usize..self.in_ptr[i + 1] as usize {
                    acc.push((label[self.in_src[k] as usize], self.weight[self.in_syn[k] as usize].abs()));
                }
                if acc.is_empty() {
                    continue;
                }
                acc.sort_unstable_by_key(|a| a.0);
                let (mut best, mut best_w) = (label[i], -1.0f32);
                let mut k = 0;
                while k < acc.len() {
                    let l = acc[k].0;
                    let mut w = 0.0;
                    while k < acc.len() && acc[k].0 == l {
                        w += acc[k].1;
                        k += 1;
                    }
                    if w > best_w {
                        best_w = w;
                        best = l;
                    }
                }
                if best != label[i] {
                    label[i] = best;
                    changed += 1;
                }
            }
            if changed * 1000 < n {
                break;
            }
        }
        // Renumber by size.
        let mut size = std::collections::HashMap::new();
        for &l in &label {
            *size.entry(l).or_insert(0u32) += 1;
        }
        let mut ranked: Vec<(u32, u32)> = size.into_iter().collect();
        ranked.sort_unstable_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        let mut remap = std::collections::HashMap::new();
        for (k, &(l, _)) in ranked.iter().enumerate() {
            remap.insert(l, k as u32);
        }
        for l in label.iter_mut() {
            *l = remap[l];
        }
        // Modularity of the undirected weighted graph.
        let c = ranked.len();
        let mut internal = vec![0.0f64; c];
        let mut degree = vec![0.0f64; c];
        let mut m2 = 0.0f64;
        for j in 0..n {
            for s in self.row_ptr[j] as usize..self.row_ptr[j + 1] as usize {
                let w = self.weight[s].abs() as f64;
                let (a, b) = (label[j] as usize, label[self.target[s] as usize] as usize);
                m2 += 2.0 * w;
                degree[a] += w;
                degree[b] += w;
                if a == b {
                    internal[a] += 2.0 * w;
                }
            }
        }
        let q = if m2 > 0.0 {
            (0..c).map(|k| internal[k] / m2 - (degree[k] / m2).powi(2)).sum()
        } else {
            0.0
        };
        let summary = Communities {
            count: c as u32,
            modularity: q,
            sizes: ranked.iter().map(|r| r.1).take(64).collect(),
            iterations,
        };
        (label, summary)
    }
}
