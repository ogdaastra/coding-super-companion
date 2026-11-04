//! Incremental network construction.
//!
//! Building a large network takes long enough (hundreds of milliseconds to
//! seconds) that the browser worker must report progress and stay responsive, so
//! `NetworkBuilder::advance` does a bounded amount of work per call.
//!
//! Construction is fully deterministic for a configuration: placement, parameters
//! and connectivity each draw from their own seeded random stream.
//!
//! # Connectivity
//!
//! A projection connects one class of one region to (a class of) another region.
//! Each source neuron contacts each eligible target independently with the
//! projection's probability p:
//!
//! * `random`: targets are drawn by geometric skipping (gaps between successes of a
//!   Bernoulli(p) sequence are geometric), which is exact and costs O(k) for k
//!   synapses instead of O(targets).
//! * `local` / `topographic`: the number of synapses k is drawn the same way, then
//!   each synapse goes to the target neuron nearest to a Gaussian-distributed point
//!   around an anchor (the source position, or its topographic image in the target
//!   region). A spatial grid makes each lookup O(1) on average.
//!
//! Self-connections (autapses) are excluded unless allowed and duplicate pairs are
//! merged, so every (pre, post) pair is unique and rows are sorted by target.

use crate::config::{
    BrainConfig, ConfigError, ConfigTotals, NeuronClass, NeuronParams, TargetFilter, Topology,
};
use crate::network::{NeuronArrays, Network, Parts, ProjectionState, RegionState};
use crate::plasticity::PlasticityState;
use crate::rng::{Fingerprint, Rng};
use std::collections::HashMap;

pub(crate) const TOPOLOGY_STREAM: u64 = 1;
pub(crate) const PLACEMENT_STREAM: u64 = 2;
pub(crate) const DYNAMICS_STREAM: u64 = 3;
pub(crate) const INITIAL_STATE_STREAM: u64 = 4;
pub(crate) const PARAMETER_STREAM: u64 = 5;

struct ProjRuntime {
    to: usize,
    t0: u32,
    t1: u32,
    log1m_p: f64,
    p: f64,
    w_mean: f32,
    w_std: f32,
    w_lo: f32,
    w_hi: f32,
    sign: f32,
    d_min: u32,
    d_span: u32,
    topology: Topology,
    spread: f32,
    allow_autapses: bool,
    grid: Option<usize>,
}

/// Uniform grid over a set of neurons, for nearest-neighbour lookup.
struct Grid {
    min: [f32; 3],
    inv_cell: f32,
    dims: [i32; 3],
    cell_start: Vec<u32>,
    items: Vec<u32>,
}

impl Grid {
    fn new(positions: &[f32], t0: u32, t1: u32) -> Grid {
        let mut min = [f32::INFINITY; 3];
        let mut max = [f32::NEG_INFINITY; 3];
        for i in t0..t1 {
            for k in 0..3 {
                let x = positions[3 * i as usize + k];
                min[k] = min[k].min(x);
                max[k] = max[k].max(x);
            }
        }
        let count = (t1 - t0).max(1) as f32;
        let ext = [
            (max[0] - min[0]).max(1e-3),
            (max[1] - min[1]).max(1e-3),
            (max[2] - min[2]).max(1e-3),
        ];
        // About four neurons per cell.
        let cell = (ext[0] * ext[1] * ext[2] / (count / 4.0)).cbrt().max(1e-3);
        let dims = [
            ((ext[0] / cell).ceil() as i32).clamp(1, 256),
            ((ext[1] / cell).ceil() as i32).clamp(1, 256),
            ((ext[2] / cell).ceil() as i32).clamp(1, 256),
        ];
        let inv_cell = 1.0 / cell;
        let ncell = (dims[0] * dims[1] * dims[2]) as usize;
        let mut counts = vec![0u32; ncell + 1];
        let cell_of = |i: u32| -> usize {
            let mut c = [0i32; 3];
            for k in 0..3 {
                c[k] = (((positions[3 * i as usize + k] - min[k]) * inv_cell) as i32).clamp(0, dims[k] - 1);
            }
            ((c[2] * dims[1] + c[1]) * dims[0] + c[0]) as usize
        };
        for i in t0..t1 {
            counts[cell_of(i) + 1] += 1;
        }
        for c in 0..ncell {
            counts[c + 1] += counts[c];
        }
        let mut fill = counts.clone();
        let mut items = vec![0u32; (t1 - t0) as usize];
        for i in t0..t1 {
            let c = cell_of(i);
            items[fill[c] as usize] = i;
            fill[c] += 1;
        }
        Grid {
            min,
            inv_cell,
            dims,
            cell_start: counts,
            items,
        }
    }

    /// A neuron close to `q` (excluding `exclude`): the nearest one within the first
    /// shell of cells around `q` that contains any candidate. The target point is
    /// itself random, so exact nearest-neighbour search is unnecessary; stopping at
    /// the first occupied shell keeps the lookup O(1) on average.
    fn nearest(&self, positions: &[f32], q: [f32; 3], exclude: u32) -> Option<u32> {
        let mut c = [0i32; 3];
        for k in 0..3 {
            c[k] = (((q[k] - self.min[k]) * self.inv_cell) as i32).clamp(0, self.dims[k] - 1);
        }
        let mut best = None;
        let mut best_d = f32::INFINITY;
        let max_r = self.dims[0].max(self.dims[1]).max(self.dims[2]);
        for r in 0..=max_r {
            for dz in -r..=r {
                for dy in -r..=r {
                    for dx in -r..=r {
                        if dx.abs() != r && dy.abs() != r && dz.abs() != r {
                            continue;
                        }
                        let (x, y, z) = (c[0] + dx, c[1] + dy, c[2] + dz);
                        if x < 0 || y < 0 || z < 0 || x >= self.dims[0] || y >= self.dims[1] || z >= self.dims[2] {
                            continue;
                        }
                        let cell = ((z * self.dims[1] + y) * self.dims[0] + x) as usize;
                        for k in self.cell_start[cell]..self.cell_start[cell + 1] {
                            let i = self.items[k as usize];
                            if i == exclude {
                                continue;
                            }
                            let p = &positions[3 * i as usize..3 * i as usize + 3];
                            let d = (p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2) + (p[2] - q[2]).powi(2);
                            if d < best_d {
                                best_d = d;
                                best = Some(i);
                            }
                        }
                    }
                }
            }
            if best.is_some() {
                return best;
            }
        }
        best
    }
}

pub struct NetworkBuilder {
    normal: Vec<f32>,
    cfg: BrainConfig,
    totals: ConfigTotals,
    regions: Vec<RegionState>,
    /// Projections leaving each (region, class) population.
    out_projs: Vec<Vec<usize>>,
    projs: Vec<ProjRuntime>,
    grids: Vec<Grid>,
    rng: Rng,

    neurons: NeuronArrays,
    positions: Vec<f32>,

    row_ptr: Vec<u32>,
    target: Vec<u32>,
    weight: Vec<f32>,
    delay: Vec<u8>,
    syn_proj: Vec<u8>,
    next_source: u32,
    scratch: Vec<(u32, f32, u8, u8)>,
}

fn smooth_noise(p: [f32; 3], ph: &[f32; 6]) -> f32 {
    (4.1 * p[0] + ph[0]).sin() * (3.7 * p[1] + ph[1]).sin() * (4.3 * p[2] + ph[2]).sin()
        + 0.5 * (7.9 * p[1] + ph[3]).sin() * (8.3 * p[2] + ph[4]).sin() * (7.1 * p[0] + ph[5]).sin()
}

impl NetworkBuilder {
    pub fn new(cfg: BrainConfig) -> Result<NetworkBuilder, ConfigError> {
        let totals = cfg.validate()?;
        let n = totals.neurons as usize;
        let ids = cfg.region_index();
        let dt = cfg.timestep_ms;

        let mut place = Rng::new(cfg.seed as u64, PLACEMENT_STREAM);
        let mut prm = Rng::new(cfg.seed as u64, PARAMETER_STREAM);
        let mut regions = Vec::with_capacity(cfg.regions.len());
        let mut neurons = NeuronArrays::with_capacity(n);
        let mut positions = Vec::with_capacity(n * 3);
        let mut start = 0u32;

        for (ri, r) in cfg.regions.iter().enumerate() {
            let ne = r.excitatory_count();
            let end = start + r.count;
            regions.push(RegionState {
                id: r.id.clone(),
                name: if r.name.is_empty() { r.id.clone() } else { r.name.clone() },
                start,
                exc_end: start + ne,
                end,
                enabled: true,
                center: r.shape.center,
                radius: r.shape.radius,
            });
            start = end;

            let mut phases = [0.0f32; 6];
            for p in phases.iter_mut() {
                *p = place.next_f32() * std::f32::consts::TAU;
            }
            // Inner radius of the shell as a fraction of the outer radius.
            let inner = r.shape.shell.clamp(0.0, 0.95);
            let inner3 = inner * inner * inner;
            for k in 0..r.count {
                let class = if k < ne { NeuronClass::Excitatory } else { NeuronClass::Inhibitory };
                // Uniform point in the (possibly hollow) unit ball, thinned by a
                // smooth density field for organic clustering.
                let (x, y, z) = loop {
                    let d = loop {
                        let x = place.next_f32() * 2.0 - 1.0;
                        let y = place.next_f32() * 2.0 - 1.0;
                        let z = place.next_f32() * 2.0 - 1.0;
                        let l2 = x * x + y * y + z * z;
                        if l2 > 1e-6 && l2 <= 1.0 {
                            let l = l2.sqrt();
                            break [x / l, y / l, z / l];
                        }
                    };
                    let rad = (inner3 + (1.0 - inner3) * place.next_f32()).cbrt();
                    let p = [d[0] * rad, d[1] * rad, d[2] * rad];
                    let density = 0.5 + 0.35 * smooth_noise(p, &phases);
                    let accept = (1.0 - r.shape.clumping) + r.shape.clumping * density.clamp(0.0, 1.0);
                    if place.next_f32() < accept {
                        break (p[0], p[1], p[2]);
                    }
                };
                let w = r.shape.warp;
                let (wx, wy, wz) = (
                    x + w * 0.35 * (2.3 * y + phases[0]).sin(),
                    y + w * 0.35 * (2.1 * z + phases[1]).sin(),
                    z + w * 0.35 * (2.7 * x + phases[2]).sin(),
                );
                positions.push(r.shape.center[0] + wx * r.shape.radius[0]);
                positions.push(r.shape.center[1] + wy * r.shape.radius[1]);
                positions.push(r.shape.center[2] + wz * r.shape.radius[2]);
                push_neuron(&mut neurons, r.params(class), class, ri as u16, r.heterogeneity, &mut prm, dt);
            }
        }

        // Projections.
        let mut out_projs = vec![Vec::new(); cfg.regions.len() * 2];
        let mut projs = Vec::with_capacity(cfg.projections.len());
        let mut grids: Vec<Grid> = Vec::new();
        let mut grid_index: HashMap<(usize, TargetFilter), usize> = HashMap::new();
        let mut max_row = 0usize;
        let mut row_estimate = vec![0.0f64; cfg.regions.len() * 2];
        let pl = &cfg.plasticity;
        for (pi, p) in cfg.projections.iter().enumerate() {
            let from = ids[p.from.as_str()];
            let to = ids[p.to.as_str()];
            let reg = &regions[to];
            let (t0, t1) = match p.target {
                TargetFilter::All => (reg.start, reg.end),
                TargetFilter::Excitatory => (reg.start, reg.exc_end),
                TargetFilter::Inhibitory => (reg.exc_end, reg.end),
            };
            let d_min = cfg.delay_steps(p.delay_ms.min);
            let d_max = cfg.delay_steps(p.delay_ms.max).max(d_min);
            let plastic = p.plasticity.enabled;
            let (w_lo, w_hi) = if plastic {
                (
                    p.plasticity.w_min.unwrap_or(pl.w_min),
                    p.plasticity.w_max.unwrap_or(pl.w_max),
                )
            } else {
                (0.0, f32::INFINITY)
            };
            let grid = if p.topology != Topology::Random && t1 > t0 {
                let key = (to, p.target);
                Some(*grid_index.entry(key).or_insert_with(|| {
                    grids.push(Grid::new(&positions, t0, t1));
                    grids.len() - 1
                }))
            } else {
                None
            };
            projs.push(ProjRuntime {
                to,
                t0,
                t1,
                log1m_p: (1.0 - p.probability).ln(),
                p: p.probability,
                w_mean: p.weight.mean,
                w_std: p.weight.std,
                w_lo,
                w_hi,
                sign: p.source.sign(),
                d_min,
                d_span: d_max - d_min + 1,
                topology: p.topology,
                spread: p.spread,
                allow_autapses: p.allow_autapses,
                grid,
            });
            out_projs[from * 2 + p.source.index()].push(pi);
            row_estimate[from * 2 + p.source.index()] += p.probability * (t1 - t0) as f64;
        }
        for est in row_estimate {
            max_row = max_row.max((est * 1.5 + 16.0) as usize);
        }

        let s = (totals.expected_synapses * 1.02 + 1024.0) as usize;
        let mut row_ptr = Vec::with_capacity(n + 1);
        row_ptr.push(0);
        Ok(NetworkBuilder {
            normal: crate::rng::normal_table(),
            rng: Rng::new(cfg.seed as u64, TOPOLOGY_STREAM),
            cfg,
            totals,
            regions,
            out_projs,
            projs,
            grids,
            neurons,
            positions,
            row_ptr,
            target: Vec::with_capacity(s),
            weight: Vec::with_capacity(s),
            delay: Vec::with_capacity(s),
            syn_proj: Vec::with_capacity(s),
            next_source: 0,
            scratch: Vec::with_capacity(max_row),
        })
    }

    pub fn totals(&self) -> ConfigTotals {
        self.totals
    }

    pub fn neuron_count(&self) -> u32 {
        self.totals.neurons as u32
    }

    pub fn synapses_so_far(&self) -> usize {
        self.target.len()
    }

    pub fn is_done(&self) -> bool {
        self.next_source as u64 >= self.totals.neurons
    }

    /// Fraction of construction completed, 0..1.
    pub fn progress(&self) -> f32 {
        if self.totals.neurons == 0 {
            1.0
        } else {
            self.next_source as f32 / self.totals.neurons as f32
        }
    }

    /// Generates outgoing synapses for source neurons until roughly `budget`
    /// synapses have been created. Returns progress, 0..1.
    pub fn advance(&mut self, budget: u64) -> Result<f32, ConfigError> {
        let n = self.totals.neurons as u32;
        let mut done: u64 = 0;
        while self.next_source < n && done < budget.max(1) {
            let j = self.next_source;
            let r = self.neurons.region[j as usize] as usize;
            let c = self.neurons.class[j as usize] as usize;
            self.scratch.clear();
            for &pi in &self.out_projs[r * 2 + c] {
                let p = &self.projs[pi];
                if p.t1 <= p.t0 || p.p <= 0.0 {
                    continue;
                }
                let before = self.scratch.len();
                match p.topology {
                    Topology::Random => {
                        bernoulli_targets(&mut self.rng, p, |t| {
                            if t != j || p.allow_autapses {
                                self.scratch.push((t, 0.0, 0, pi as u8));
                            }
                        });
                    }
                    Topology::Local | Topology::Topographic => {
                        let mut k = 0u32;
                        bernoulli_targets(&mut self.rng, p, |_| k += 1);
                        let anchor = anchor_point(&self.positions, &self.regions, j, r, p);
                        let grid = &self.grids[p.grid.unwrap()];
                        let tr = &self.regions[p.to];
                        let sigma = [
                            p.spread * tr.radius[0],
                            p.spread * tr.radius[1],
                            p.spread * tr.radius[2],
                        ];
                        let nt = &self.normal;
                        let shift = 32 - crate::rng::NORMAL_TABLE_BITS;
                        for _ in 0..k {
                            let q = [
                                anchor[0] + sigma[0] * nt[(self.rng.next_u32() >> shift) as usize],
                                anchor[1] + sigma[1] * nt[(self.rng.next_u32() >> shift) as usize],
                                anchor[2] + sigma[2] * nt[(self.rng.next_u32() >> shift) as usize],
                            ];
                            let exclude = if p.allow_autapses { u32::MAX } else { j };
                            if let Some(t) = grid.nearest(&self.positions, q, exclude) {
                                self.scratch.push((t, 0.0, 0, pi as u8));
                            }
                        }
                    }
                }
                // Merge duplicate targets within this projection.
                let block = &mut self.scratch[before..];
                block.sort_unstable_by_key(|s| s.0);
                let mut w = before;
                for k in before..self.scratch.len() {
                    if k == before || self.scratch[k].0 != self.scratch[w - 1].0 {
                        self.scratch[w] = self.scratch[k];
                        w += 1;
                    }
                }
                self.scratch.truncate(w);
                let shift = 32 - crate::rng::NORMAL_TABLE_BITS;
                for s in before..self.scratch.len() {
                    let z = self.normal[(self.rng.next_u32() >> shift) as usize];
                    let wmag = (p.w_mean + p.w_std * z).abs().clamp(p.w_lo, p.w_hi);
                    let dl = p.d_min + self.rng.below(p.d_span);
                    self.scratch[s].1 = wmag * p.sign;
                    self.scratch[s].2 = dl as u8;
                }
            }
            // Rows sorted by target: scattered writes into the event ring move
            // forward through memory, and (pre, post) lookups can binary-search.
            self.scratch.sort_unstable_by_key(|s| s.0);
            for &(t, w, dl, pj) in &self.scratch {
                self.target.push(t);
                self.weight.push(w);
                self.delay.push(dl);
                self.syn_proj.push(pj);
            }
            if self.target.len() as u64 > crate::config::limits::MAX_SYNAPSES {
                return Err(crate::config::err(
                    "projections",
                    "the network exceeds the engine's synapse limit",
                ));
            }
            self.row_ptr.push(self.target.len() as u32);
            done += self.scratch.len() as u64 + 1;
            self.next_source += 1;
        }
        Ok(self.progress())
    }

    /// Completes construction (running any remaining work) and returns the network.
    pub fn finish(mut self) -> Result<Network, ConfigError> {
        while !self.is_done() {
            self.advance(u64::MAX)?;
        }
        let cfg = &self.cfg;
        let n = self.totals.neurons as usize;
        let ids = cfg.region_index();
        let pl = &cfg.plasticity;
        let mut counts = vec![0u64; cfg.projections.len()];
        for &p in &self.syn_proj {
            counts[p as usize] += 1;
        }
        let projections: Vec<ProjectionState> = cfg
            .projections
            .iter()
            .enumerate()
            .map(|(i, p)| ProjectionState {
                id: if p.id.is_empty() { format!("p{i}") } else { p.id.clone() },
                from: ids[p.from.as_str()] as u16,
                to: ids[p.to.as_str()] as u16,
                source: p.source,
                gain: 1.0,
                plastic: p.plasticity.enabled,
                rule: p.plasticity.rule,
                a_plus: p.plasticity.a_plus.unwrap_or(pl.a_plus),
                a_minus: p.plasticity.a_minus.unwrap_or(pl.a_minus),
                w_min: p.plasticity.w_min.unwrap_or(pl.w_min),
                w_max: p.plasticity.w_max.unwrap_or(pl.w_max),
                synapses: counts[i],
            })
            .collect();

        let mut fp = Fingerprint::default();
        fp.add(n as u32);
        fp.add(self.target.len() as u32);
        for &x in &self.row_ptr {
            fp.add(x);
        }
        for i in 0..self.target.len() {
            fp.add(self.target[i]);
            fp.add(self.weight[i].to_bits());
            fp.add(self.delay[i] as u32 | (self.syn_proj[i] as u32) << 8);
        }
        for &x in &self.positions {
            fp.add(x.to_bits());
        }

        let modulator_region = pl.modulator_region.as_ref().map(|m| ids[m.as_str()]);
        let max_delay = self.delay.iter().copied().max().unwrap_or(1).max(1) as usize;
        Ok(Network::assemble(Parts {
            seed: cfg.seed,
            dt: cfg.timestep_ms,
            tau_exc: cfg.synapse.tau_exc_ms.max(cfg.timestep_ms),
            tau_inh: cfg.synapse.tau_inh_ms.max(cfg.timestep_ms),
            ring_slots: max_delay + 1,
            plasticity: PlasticityState::new(pl, cfg.timestep_ms, n, modulator_region),
            regions: self.regions,
            projections,
            neurons: self.neurons,
            positions: self.positions,
            row_ptr: self.row_ptr,
            target: self.target,
            weight: self.weight,
            delay: self.delay,
            syn_proj: self.syn_proj,
            topology_hash: fp.finish(),
        }))
    }
}

/// Calls `f` with each target chosen by independent Bernoulli(p) trials over
/// `[t0, t1)`, in increasing order (geometric skipping).
#[inline]
fn bernoulli_targets(rng: &mut Rng, p: &ProjRuntime, mut f: impl FnMut(u32)) {
    if p.p >= 1.0 {
        for t in p.t0..p.t1 {
            f(t);
        }
        return;
    }
    let mut idx = p.t0 as i64 - 1;
    loop {
        let u = (rng.next_u32() as f64 + 1.0) / 4_294_967_297.0;
        let skip = (u.ln() / p.log1m_p).floor();
        if !skip.is_finite() {
            break;
        }
        idx += skip as i64 + 1;
        if idx >= p.t1 as i64 {
            break;
        }
        f(idx as u32);
    }
}

fn anchor_point(positions: &[f32], regions: &[RegionState], j: u32, r: usize, p: &ProjRuntime) -> [f32; 3] {
    let pos = [
        positions[3 * j as usize],
        positions[3 * j as usize + 1],
        positions[3 * j as usize + 2],
    ];
    match p.topology {
        Topology::Topographic => {
            let s = &regions[r];
            let t = &regions[p.to];
            let mut q = [0.0; 3];
            for k in 0..3 {
                q[k] = t.center[k] + (pos[k] - s.center[k]) / s.radius[k] * t.radius[k];
            }
            q
        }
        _ => pos,
    }
}

/// Appends one neuron's parameters, with heterogeneity applied.
///
/// Threshold jitter has σ = 0.1·h·(V_th − V_rest); excitability has σ = 0.25·h
/// around 1 (clamped to [0.2, 3]). Thresholds always stay above the reset.
fn push_neuron(
    a: &mut NeuronArrays,
    p: &NeuronParams,
    class: NeuronClass,
    region: u16,
    h: f32,
    rng: &mut Rng,
    dt: f32,
) {
    let gap = (p.v_threshold - p.v_rest).abs().max(1.0);
    let (z1, z2) = if h > 0.0 { (rng.gaussian(), rng.gaussian()) } else { (0.0, 0.0) };
    let v_th = (p.v_threshold + 0.1 * h * gap * z1).max(p.v_reset + 0.5);
    let excitability = (1.0 + 0.25 * h * z2).clamp(0.2, 3.0);
    a.v_rest.push(p.v_rest);
    a.v_th.push(v_th);
    a.v_reset.push(p.v_reset);
    a.tau.push(p.tau_ms);
    a.refractory_ms.push(p.refractory_ms);
    a.resistance.push(p.resistance);
    a.excitability.push(excitability);
    a.bias.push(p.bias);
    a.i_ext.push(0.0);
    a.noise_std.push(p.noise_std);
    a.class.push(class.index() as u8);
    a.region.push(region);
    a.i_stim.push(0.0);
    a.leak.push(0.0);
    a.k_in.push(0.0);
    a.v_base.push(0.0);
    a.noise_k.push(0.0);
    a.ref_steps.push(0);
    let i = a.len() - 1;
    a.refresh(i, dt);
}

/// Builds a network in one call (native code, tests and benchmarks).
pub fn build_network(cfg: BrainConfig) -> Result<Network, ConfigError> {
    NetworkBuilder::new(cfg)?.finish()
}
