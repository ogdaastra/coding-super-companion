#![allow(dead_code)]
//! Helpers for building small, fully controlled test networks.

use neuroform_core::{build_network, BrainConfig, Network};
use serde_json::{json, Value};

pub fn neuron(tau: f64, refractory: f64) -> Value {
    json!({
        "vRest": -65.0, "vThreshold": -50.0, "vReset": -70.0,
        "tauMs": tau, "refractoryMs": refractory,
        "resistance": 1.0, "bias": 0.0, "noiseStd": 0.0
    })
}

/// A region with `count` neurons; `exc` of them excitatory. Deterministic, noiseless.
pub fn region(id: &str, count: u32, exc: u32, center: [f64; 3]) -> Value {
    json!({
        "id": id, "name": id, "count": count,
        "excitatoryFraction": exc as f64 / count as f64,
        "shape": { "center": center, "radius": [1.0, 1.0, 1.0] },
        "excitatory": neuron(20.0, 2.0),
        "inhibitory": neuron(10.0, 1.0),
        "heterogeneity": 0.0
    })
}

pub fn projection(from: &str, source: &str, to: &str, p: f64, w: f64, dmin: f64, dmax: f64) -> Value {
    json!({
        "from": from, "source": source, "to": to, "probability": p,
        "weight": { "mean": w, "std": 0.0 },
        "delayMs": { "min": dmin, "max": dmax }
    })
}

pub fn config(regions: Vec<Value>, projections: Vec<Value>) -> Value {
    json!({
        "name": "test", "seed": 1234, "timestepMs": 0.1,
        "synapse": { "tauExcMs": 5.0, "tauInhMs": 10.0 },
        "regions": regions, "projections": projections
    })
}

pub fn build(v: &Value) -> Network {
    let cfg: BrainConfig = serde_json::from_value(v.clone()).expect("config parses");
    build_network(cfg).expect("network builds")
}

/// Runs `steps` steps and returns (step, neuron) for every spike.
pub fn spikes(net: &mut Network, steps: u32) -> Vec<(u64, u32)> {
    let mut out = Vec::new();
    for _ in 0..steps {
        let t = net.step_index();
        net.step_once();
        out.extend(net.fired().iter().map(|&j| (t, j)));
    }
    out
}

pub fn quiet(net: &mut Network) {
    // Start every neuron at rest so tests are not affected by the randomised
    // initial membrane potentials.
    for i in 0..net.neuron_count() {
        let rest = net.neurons().v_rest[i];
        net.set_membrane_potential(i, rest).unwrap();
    }
}
