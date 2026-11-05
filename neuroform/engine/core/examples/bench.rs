//! Native benchmark of the engine (no WebAssembly) for comparison with
//! `scripts/bench-engine.ts`. Reads a configuration JSON produced by the app's
//! presets: `cargo run --release -p neuroform-core --example bench -- config.json [seconds]`.

use neuroform_core::{build_network, BrainConfig};
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = args.get(1).expect("usage: bench <config.json> [seconds]");
    let seconds: f64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(3.0);
    let json = std::fs::read_to_string(path).expect("read config");
    let value: serde_json::Value = serde_json::from_str(&json).expect("parse JSON");
    let cfg_value = value.get("config").cloned().unwrap_or(value);
    let cfg: BrainConfig = serde_json::from_value(cfg_value).expect("configuration");
    let dt = cfg.timestep_ms as f64;
    let t0 = Instant::now();
    let mut net = build_network(cfg).expect("build");
    let build_ms = t0.elapsed().as_secs_f64() * 1000.0;
    net.run((300.0 / dt) as u32);
    net.take_telemetry();
    let start = Instant::now();
    let mut steps = 0u64;
    while start.elapsed().as_secs_f64() < seconds {
        net.run(100);
        steps += 100;
        net.clear_frame_spikes();
        net.clear_raster();
    }
    let wall = start.elapsed().as_secs_f64();
    let t = net.take_telemetry();
    let sim = steps as f64 * dt / 1000.0;
    println!(
        "{{\"neurons\":{},\"synapses\":{},\"buildMs\":{:.0},\"msPerSimSecond\":{:.0},\"realtimeFactor\":{:.3},\"eventsPerWallSecond\":{:.0}}}",
        net.neuron_count(),
        net.synapse_count(),
        build_ms,
        wall * 1000.0 / sim,
        sim / wall,
        t.events_scheduled as f64 / wall
    );
}
