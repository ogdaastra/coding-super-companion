//! WebAssembly binary interface for `neuroform-core`.
//!
//! A deliberately small C ABI rather than generated bindings:
//!
//! * no JavaScript glue or extra build tools: `cargo build --target
//!   wasm32-unknown-unknown` is the whole toolchain;
//! * explicit memory ownership: networks are opaque handles freed by the host, and
//!   large arrays are exposed as `(pointer, length)` pairs the host reads through
//!   typed-array views over linear memory, without copying;
//! * one import, `env.nf_now`, a millisecond clock used only while profiling.
//!
//! Variable-sized results (JSON documents, synapse records, snapshots) are written
//! to a module-level result buffer, read with `nf_result_ptr`/`nf_result_len`, and
//! must be copied by the host before the next call. Errors set a message read with
//! `nf_error_ptr`/`nf_error_len`.
//!
//! The TypeScript side of this contract is `src/engine/wasmEngine.ts`.

use neuroform_core::config::{estimate_memory_bytes, BrainConfig};
use neuroform_core::network::Network;
use neuroform_core::stimulus::{ClassFilter, StimulusSpec};
use neuroform_core::{NetworkBuilder, NeuronParam};
use serde::Serialize;
use std::cell::RefCell;

thread_local! {
    static ERROR: RefCell<String> = const { RefCell::new(String::new()) };
    static RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn set_error(msg: impl Into<String>) {
    ERROR.with(|e| *e.borrow_mut() = msg.into());
}

fn set_result(bytes: Vec<u8>) -> i32 {
    let len = bytes.len() as i32;
    RESULT.with(|r| *r.borrow_mut() = bytes);
    len
}

fn set_json<T: Serialize>(value: &T) -> i32 {
    match serde_json::to_vec(value) {
        Ok(b) => set_result(b),
        Err(e) => {
            set_error(format!("serialisation failed: {e}"));
            -1
        }
    }
}

fn words(w: Vec<u32>) -> Vec<u8> {
    let mut out = Vec::with_capacity(w.len() * 4);
    for x in w {
        out.extend_from_slice(&x.to_le_bytes());
    }
    out
}

unsafe fn str_arg<'a>(ptr: *const u8, len: usize) -> Result<&'a str, String> {
    if ptr.is_null() {
        return Err("null string".into());
    }
    std::str::from_utf8(std::slice::from_raw_parts(ptr, len)).map_err(|e| e.to_string())
}

unsafe fn net<'a>(h: *mut Network) -> &'a mut Network {
    &mut *h
}

#[cfg(target_arch = "wasm32")]
mod clock {
    #[link(wasm_import_module = "env")]
    extern "C" {
        fn nf_now() -> f64;
    }
    pub fn now() -> f64 {
        unsafe { nf_now() }
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod clock {
    use std::sync::OnceLock;
    use std::time::Instant;
    static START: OnceLock<Instant> = OnceLock::new();
    pub fn now() -> f64 {
        START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
    }
}

// ------------------------------------------------------------------ memory & status

#[no_mangle]
pub extern "C" fn nf_version() -> u32 {
    neuroform_core::ENGINE_VERSION
}

#[no_mangle]
pub extern "C" fn nf_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr` must come from `nf_alloc(len)` with the same `len`.
#[no_mangle]
pub unsafe extern "C" fn nf_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
    }
}

#[no_mangle]
pub extern "C" fn nf_error_ptr() -> *const u8 {
    ERROR.with(|e| e.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn nf_error_len() -> usize {
    ERROR.with(|e| e.borrow().len())
}

#[no_mangle]
pub extern "C" fn nf_result_ptr() -> *const u8 {
    RESULT.with(|r| r.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn nf_result_len() -> usize {
    RESULT.with(|r| r.borrow().len())
}

/// Releases the result buffer's memory (after large snapshots).
#[no_mangle]
pub extern "C" fn nf_result_clear() {
    RESULT.with(|r| *r.borrow_mut() = Vec::new());
}

// ------------------------------------------------------------------ configuration

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Validation {
    totals: neuroform_core::ConfigTotals,
    memory_bytes: f64,
}

/// Validates a configuration. Result: `{ totals, memoryBytes }`.
///
/// # Safety
/// `ptr..ptr+len` must be valid UTF-8 in linear memory.
#[no_mangle]
pub unsafe extern "C" fn nf_validate(ptr: *const u8, len: usize) -> i32 {
    let json = match str_arg(ptr, len) {
        Ok(s) => s,
        Err(e) => {
            set_error(e);
            return -1;
        }
    };
    match BrainConfig::from_json(json).and_then(|c| c.validate()) {
        Ok(t) => set_json(&Validation {
            memory_bytes: estimate_memory_bytes(&t),
            totals: t,
        }),
        Err(e) => {
            set_error(e.to_string());
            -1
        }
    }
}

/// # Safety
/// `ptr..ptr+len` must be valid UTF-8 in linear memory.
#[no_mangle]
pub unsafe extern "C" fn nf_builder_new(ptr: *const u8, len: usize) -> *mut NetworkBuilder {
    let built = str_arg(ptr, len)
        .map_err(|e| e.to_string())
        .and_then(|s| BrainConfig::from_json(s).map_err(|e| e.to_string()))
        .and_then(|c| NetworkBuilder::new(c).map_err(|e| e.to_string()));
    match built {
        Ok(b) => Box::into_raw(Box::new(b)),
        Err(e) => {
            set_error(e);
            std::ptr::null_mut()
        }
    }
}

/// Returns progress 0..1, or −1 on error.
///
/// # Safety
/// `b` must be a live builder handle.
#[no_mangle]
pub unsafe extern "C" fn nf_builder_advance(b: *mut NetworkBuilder, budget: f64) -> f32 {
    match (*b).advance(budget.max(1.0) as u64) {
        Ok(p) => p,
        Err(e) => {
            set_error(e.to_string());
            -1.0
        }
    }
}

/// # Safety
/// `b` must be a live builder handle.
#[no_mangle]
pub unsafe extern "C" fn nf_builder_synapses(b: *mut NetworkBuilder) -> f64 {
    (*b).synapses_so_far() as f64
}

/// Consumes the builder. Returns a network handle, or null on error.
///
/// # Safety
/// `b` must be a live builder handle; it is invalid afterwards.
#[no_mangle]
pub unsafe extern "C" fn nf_builder_finish(b: *mut NetworkBuilder) -> *mut Network {
    let builder = Box::from_raw(b);
    match builder.finish() {
        Ok(n) => Box::into_raw(Box::new(n)),
        Err(e) => {
            set_error(e.to_string());
            std::ptr::null_mut()
        }
    }
}

/// # Safety
/// `b` must be a live builder handle; it is invalid afterwards.
#[no_mangle]
pub unsafe extern "C" fn nf_builder_free(b: *mut NetworkBuilder) {
    if !b.is_null() {
        drop(Box::from_raw(b));
    }
}

// ------------------------------------------------------------------ network lifecycle

/// # Safety
/// `n` must be a live network handle; it is invalid afterwards.
#[no_mangle]
pub unsafe extern "C" fn nf_net_free(n: *mut Network) {
    if !n.is_null() {
        drop(Box::from_raw(n));
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RegionInfo<'a> {
    id: &'a str,
    name: &'a str,
    start: u32,
    exc_end: u32,
    end: u32,
    center: [f32; 3],
    radius: [f32; 3],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectionInfo<'a> {
    id: &'a str,
    from: u16,
    to: u16,
    source: &'static str,
    plastic: bool,
    rule: &'static str,
    synapses: u64,
    gain: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NetInfo<'a> {
    neurons: usize,
    synapses: usize,
    dt: f32,
    seed: u32,
    ring_slots: usize,
    topology_hash: String,
    memory_bytes: f64,
    tau_exc_ms: f32,
    tau_inh_ms: f32,
    regions: Vec<RegionInfo<'a>>,
    projections: Vec<ProjectionInfo<'a>>,
    plastic: bool,
    reward: bool,
}

/// Static description of a built network (JSON).
///
/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_info(n: *mut Network) -> i32 {
    let net = net(n);
    let s = net.synapse_count() as f64;
    let nn = net.neuron_count() as f64;
    let mut mem = nn * neuroform_core::network::BYTES_PER_NEURON as f64
        + s * neuroform_core::network::BYTES_PER_SYNAPSE as f64
        + net.ring_slots() as f64 * nn * 8.0;
    if net.plasticity().any_plastic {
        mem += s * 4.0;
    }
    if net.plasticity().any_reward {
        mem += s * 4.0;
    }
    let (te, ti) = net.synaptic_taus();
    let info = NetInfo {
        neurons: net.neuron_count(),
        synapses: net.synapse_count(),
        dt: net.dt(),
        seed: net.seed(),
        ring_slots: net.ring_slots(),
        topology_hash: format!("{:016x}", net.topology_hash()),
        memory_bytes: mem,
        tau_exc_ms: te,
        tau_inh_ms: ti,
        regions: net
            .regions()
            .iter()
            .map(|r| RegionInfo {
                id: &r.id,
                name: &r.name,
                start: r.start,
                exc_end: r.exc_end,
                end: r.end,
                center: r.center,
                radius: r.radius,
            })
            .collect(),
        projections: net
            .projections()
            .iter()
            .map(|p| ProjectionInfo {
                id: &p.id,
                from: p.from,
                to: p.to,
                source: if p.source.index() == 0 { "excitatory" } else { "inhibitory" },
                plastic: p.plastic,
                rule: match p.rule {
                    neuroform_core::config::PlasticityRule::Stdp => "stdp",
                    neuroform_core::config::PlasticityRule::Reward => "reward",
                },
                synapses: p.synapses,
                gain: p.gain,
            })
            .collect(),
        plastic: net.plasticity().any_plastic,
        reward: net.plasticity().any_reward,
    };
    set_json(&info)
}

/// Runs `steps` timesteps. Returns the number of spikes emitted.
///
/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_run(n: *mut Network, steps: u32) -> f64 {
    net(n).run(steps) as f64
}

/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_step_index(n: *mut Network) -> f64 {
    net(n).step_index() as f64
}

/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_set_profiling(n: *mut Network, on: u32) {
    net(n).set_clock(if on != 0 { Some(clock::now) } else { None });
}

/// Array identifiers for `nf_net_array_ptr` / `nf_net_array_len`.
/// Keep in sync with `ArrayId` in `src/engine/wasmEngine.ts`.
fn array(net: &Network, which: u32) -> (*const u8, usize) {
    fn p<T>(s: &[T]) -> (*const u8, usize) {
        (s.as_ptr() as *const u8, s.len())
    }
    let a = net.neurons();
    match which {
        0 => p(net.positions()),
        1 => p(net.region_of()),
        2 => p(net.class_of()),
        3 => p(net.membrane()),
        4 => p(net.spike_counts()),
        5 => p(net.last_spikes()),
        6 => p(net.row_ptr()),
        7 => p(net.targets()),
        8 => p(net.weights()),
        9 => p(net.delays()),
        10 => p(net.synapse_projection()),
        11 => p(net.in_ptr()),
        12 => p(net.in_synapses()),
        13 => p(net.in_sources()),
        14 => p(net.frame_spikes()),
        15 => p(net.raster_events()),
        16 => p(net.probe_samples()),
        17 => p(net.sample()),
        18 => p(&a.v_th),
        19 => p(&a.excitability),
        20 => p(net.probes()),
        21 => p(&a.v_reset),
        22 => p(&a.v_rest),
        _ => (std::ptr::null(), 0),
    }
}

/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_array_ptr(n: *mut Network, which: u32) -> *const u8 {
    array(net(n), which).0
}

/// Length in elements (not bytes).
///
/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_array_len(n: *mut Network, which: u32) -> usize {
    array(net(n), which).1
}

/// Clears drained buffers: bit0 frame spikes, bit1 raster, bit2 probe samples.
///
/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_clear_buffers(n: *mut Network, mask: u32) {
    let net = net(n);
    if mask & 1 != 0 {
        net.clear_frame_spikes();
    }
    if mask & 2 != 0 {
        net.clear_raster();
    }
    if mask & 4 != 0 {
        net.clear_probe_samples();
    }
}

/// # Safety
/// `n` must be a live network handle; `ids..ids+count` must be valid u32s.
#[no_mangle]
pub unsafe extern "C" fn nf_net_set_probes(n: *mut Network, ids: *const u32, count: usize) {
    let slice = if ids.is_null() { &[][..] } else { std::slice::from_raw_parts(ids, count) };
    net(n).set_probes(slice);
}

/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_set_sync_group(n: *mut Network, lo: u32, hi: u32) {
    net(n).set_synchrony_group(lo as u64 | (hi as u64) << 32);
}

/// Reads and clears the telemetry window (JSON).
///
/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_telemetry(n: *mut Network) -> i32 {
    let report = net(n).take_telemetry();
    set_json(&report)
}

// ------------------------------------------------------------------ inspection

/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_neuron_detail(n: *mut Network, i: u32) -> i32 {
    match net(n).neuron_detail(i as usize) {
        Some(d) => set_json(&d),
        None => {
            set_error(format!("neuron {i} does not exist"));
            -1
        }
    }
}

/// Synapse records (see `analysis::SYNAPSE_RECORD_WORDS`). Returns the total count.
///
/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_synapses(n: *mut Network, i: u32, incoming: u32, offset: u32, limit: u32) -> i32 {
    let (recs, total) = net(n).synapse_records(i as usize, incoming != 0, offset as usize, limit as usize);
    set_result(words(recs));
    total as i32
}

/// # Safety
/// `n` must be a live network handle; `ids..ids+count` must be valid u32s.
#[no_mangle]
pub unsafe extern "C" fn nf_net_synapses_by_id(n: *mut Network, ids: *const u32, count: usize) -> i32 {
    let slice = std::slice::from_raw_parts(ids, count);
    let recs = net(n).synapse_records_by_id(slice);
    set_result(words(recs))
}

/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_weight_histogram(n: *mut Network, projection: i32, bins: u32, max_count: u32) -> i32 {
    let h = net(n).weight_histogram(projection, bins as usize, max_count as usize);
    set_json(&h)
}

/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_projection_stats(n: *mut Network) -> i32 {
    let s = net(n).projection_stats();
    set_json(&s)
}

/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_top_changes(n: *mut Network, k: u32) -> i32 {
    let s = net(n).top_weight_changes(k as usize);
    set_json(&s)
}

/// Result layout: u32 JSON length, JSON summary, then one u32 label per neuron.
///
/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_communities(n: *mut Network, iterations: u32) -> i32 {
    let (labels, summary) = net(n).communities(iterations);
    let json = serde_json::to_vec(&summary).unwrap_or_default();
    let mut out = Vec::with_capacity(4 + json.len() + labels.len() * 4);
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&json);
    while out.len() % 4 != 0 {
        out.push(b' ');
    }
    for l in labels {
        out.extend_from_slice(&l.to_le_bytes());
    }
    set_result(out)
}

// ------------------------------------------------------------------ modification

fn param(p: u32) -> Option<NeuronParam> {
    NeuronParam::from_index(p)
}

fn class(c: u32) -> ClassFilter {
    match c {
        1 => ClassFilter::Excitatory,
        2 => ClassFilter::Inhibitory,
        _ => ClassFilter::All,
    }
}

/// Returns the previous value, or NaN on error.
///
/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_set_neuron_param(n: *mut Network, i: u32, p: u32, value: f32) -> f32 {
    let Some(p) = param(p) else {
        set_error("unknown parameter");
        return f32::NAN;
    };
    match net(n).set_neuron_param(i as usize, p, value) {
        Ok(old) => old,
        Err(e) => {
            set_error(e.to_string());
            f32::NAN
        }
    }
}

/// Returns the previous population mean, or NaN on error.
///
/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_set_population_param(n: *mut Network, region: u32, c: u32, p: u32, value: f32) -> f32 {
    let Some(p) = param(p) else {
        set_error("unknown parameter");
        return f32::NAN;
    };
    match net(n).set_population_param(region as usize, class(c), p, value) {
        Ok(old) => old,
        Err(e) => {
            set_error(e.to_string());
            f32::NAN
        }
    }
}

/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_population_mean(n: *mut Network, region: u32, c: u32, p: u32) -> f32 {
    param(p)
        .and_then(|p| net(n).population_mean(region as usize, class(c), p))
        .unwrap_or(f32::NAN)
}

/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_set_region_enabled(n: *mut Network, region: u32, enabled: u32) -> i32 {
    match net(n).set_region_enabled(region as usize, enabled != 0) {
        Ok(old) => old as i32,
        Err(e) => {
            set_error(e.to_string());
            -1
        }
    }
}

/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_set_projection_gain(n: *mut Network, p: u32, gain: f32) -> f32 {
    match net(n).set_projection_gain(p as usize, gain) {
        Ok(old) => old,
        Err(e) => {
            set_error(e.to_string());
            f32::NAN
        }
    }
}

/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_set_synapse_weight(n: *mut Network, s: u32, magnitude: f32) -> f32 {
    match net(n).set_synapse_weight(s as usize, magnitude) {
        Ok(old) => old,
        Err(e) => {
            set_error(e.to_string());
            f32::NAN
        }
    }
}

/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_set_membrane(n: *mut Network, i: u32, v: f32) -> f32 {
    match net(n).set_membrane_potential(i as usize, v) {
        Ok(old) => old,
        Err(e) => {
            set_error(e.to_string());
            f32::NAN
        }
    }
}

/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_set_plasticity(n: *mut Network, enabled: u32, rate_scale: f32) -> i32 {
    let net = net(n);
    net.set_plasticity_enabled(enabled != 0);
    match net.set_learning_rate_scale(rate_scale) {
        Ok(()) => 0,
        Err(e) => {
            set_error(e.to_string());
            -1
        }
    }
}

/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_inject_reward(n: *mut Network, amount: f32) {
    net(n).inject_reward(amount);
}

/// Adds a stimulus from a JSON specification. Returns its id (> 0) or −1;
/// the result holds the targeted neuron indices (u32).
///
/// # Safety
/// `n` must be a live network handle; `ptr..ptr+len` valid UTF-8.
#[no_mangle]
pub unsafe extern "C" fn nf_net_add_stimulus(n: *mut Network, ptr: *const u8, len: usize) -> i32 {
    let spec: Result<StimulusSpec, String> = str_arg(ptr, len)
        .and_then(|s| serde_json::from_str(s).map_err(|e| format!("invalid stimulus: {e}")));
    let net = net(n);
    match spec.and_then(|s| net.add_stimulus(s).map_err(|e| e.to_string())) {
        Ok((id, _)) => {
            let targets = net
                .stimuli()
                .iter()
                .find(|s| s.id == id)
                .map(|s| s.targets.clone())
                .unwrap_or_default();
            set_result(words(targets));
            id as i32
        }
        Err(e) => {
            set_error(e);
            -1
        }
    }
}

/// Sets rate-coded Poisson input (see `Network::set_input`). `ptr` holds `count`
/// little-endian u32 neuron ids followed by `count` little-endian f32 rates (Hz);
/// `count` 0 clears the input. Returns the number of neurons receiving input, or
/// -1 on error.
///
/// # Safety
/// `n` must be a live network handle; `ptr..ptr+8*count` must be readable.
#[no_mangle]
pub unsafe extern "C" fn nf_net_set_input(n: *mut Network, ptr: *const u8, count: usize, amplitude: f32) -> i32 {
    let bytes = if ptr.is_null() || count == 0 { &[][..] } else { std::slice::from_raw_parts(ptr, count * 8) };
    // Decoded byte-wise: the buffer is only guaranteed to be byte-aligned.
    let word = |k: usize| [bytes[4 * k], bytes[4 * k + 1], bytes[4 * k + 2], bytes[4 * k + 3]];
    let ids: Vec<u32> = (0..count).map(|k| u32::from_le_bytes(word(k))).collect();
    let rates: Vec<f32> = (0..count).map(|k| f32::from_le_bytes(word(count + k))).collect();
    match net(n).set_input(&ids, &rates, amplitude) {
        Ok(c) => c as i32,
        Err(e) => {
            set_error(e.to_string());
            -1
        }
    }
}

/// Clears eligibility traces and the neuromodulator (see
/// `PlasticityState::clear_eligibility`).
///
/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_clear_eligibility(n: *mut Network) {
    net(n).clear_eligibility();
}

/// Sets the reward gate per projection (see `Network::set_reward_gate`). `ptr`
/// holds `count` little-endian f32 values; `count` 0 opens every projection.
/// Returns 0, or -1 on error.
///
/// # Safety
/// `n` must be a live network handle; `ptr..ptr+4*count` must be readable.
#[no_mangle]
pub unsafe extern "C" fn nf_net_set_reward_gate(n: *mut Network, ptr: *const u8, count: usize) -> i32 {
    let bytes = if ptr.is_null() || count == 0 { &[][..] } else { std::slice::from_raw_parts(ptr, count * 4) };
    let gates: Vec<f32> = (0..count)
        .map(|k| f32::from_le_bytes([bytes[4 * k], bytes[4 * k + 1], bytes[4 * k + 2], bytes[4 * k + 3]]))
        .collect();
    match net(n).set_reward_gate(&gates) {
        Ok(()) => 0,
        Err(e) => {
            set_error(e.to_string());
            -1
        }
    }
}

/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_cancel_stimulus(n: *mut Network, id: u32) -> i32 {
    net(n).cancel_stimulus(id) as i32
}

/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_clear_stimuli(n: *mut Network) {
    net(n).clear_stimuli();
}

/// Resets dynamics to time zero; bit0 of `flags` also restores initial weights.
///
/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_reset(n: *mut Network, flags: u32) {
    let net = net(n);
    net.reset_dynamics();
    if flags & 1 != 0 {
        net.reset_weights();
    }
}

/// Serialises the state into the result buffer. Returns its length.
///
/// # Safety
/// `n` must be a live network handle.
#[no_mangle]
pub unsafe extern "C" fn nf_net_snapshot(n: *mut Network) -> i32 {
    let s = net(n).snapshot();
    set_result(s)
}

/// # Safety
/// `n` must be a live network handle; `ptr..ptr+len` readable.
#[no_mangle]
pub unsafe extern "C" fn nf_net_restore(n: *mut Network, ptr: *const u8, len: usize) -> i32 {
    let data = std::slice::from_raw_parts(ptr, len);
    match net(n).restore(data) {
        Ok(()) => 0,
        Err(e) => {
            set_error(e);
            -1
        }
    }
}
