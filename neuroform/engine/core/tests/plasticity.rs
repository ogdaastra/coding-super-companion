//! STDP and reward-modulated STDP.

mod common;
use common::*;
use serde_json::json;

fn plastic_pair(rule: &str, w: f64, w_min: f64, w_max: f64) -> neuroform_core::Network {
    let mut p = projection("pre", "excitatory", "post", 1.0, w, 1.0, 1.0);
    p["plasticity"] = json!({ "enabled": true, "rule": rule, "aPlus": 0.1, "aMinus": 0.12,
                               "wMin": w_min, "wMax": w_max });
    let mut cfg = config(
        vec![region("pre", 1, 1, [0.0; 3]), region("post", 1, 1, [3.0, 0.0, 0.0])],
        vec![p],
    );
    cfg["plasticity"] = json!({
        "enabled": true, "tauPlusMs": 20.0, "tauMinusMs": 20.0, "aPlus": 0.1, "aMinus": 0.12,
        "wMin": 0.0, "wMax": 5.0, "eligibilityTauMs": 1000.0, "modulatorTauMs": 200.0,
        "rewardRate": 5.0
    });
    let mut net = build(&cfg);
    quiet(&mut net);
    net
}

fn fire(net: &mut neuroform_core::Network, i: usize) {
    net.set_membrane_potential(i, -30.0).unwrap();
    net.step_once();
    assert!(net.fired().contains(&(i as u32)));
}

#[test]
fn pre_before_post_potentiates_by_the_trace() {
    let mut net = plastic_pair("stdp", 0.1, 0.0, 5.0);
    fire(&mut net, 0);
    net.run(99); // post fires 10 ms (100 steps) after pre
    fire(&mut net, 1);
    let w = net.weights()[0];
    let expected = 0.1 + 0.1 * (-10.0f32 / 20.0).exp();
    assert!((w - expected).abs() < 1e-4, "w = {w}, expected {expected}");
}

#[test]
fn post_before_pre_depresses_by_the_trace() {
    let mut net = plastic_pair("stdp", 1.0, 0.0, 5.0);
    fire(&mut net, 1);
    net.run(99);
    fire(&mut net, 0);
    let w = net.weights()[0];
    let expected = 1.0 - 0.12 * (-10.0f32 / 20.0).exp();
    assert!((w - expected).abs() < 1e-4, "w = {w}, expected {expected}");
}

#[test]
fn weights_respect_bounds() {
    let mut net = plastic_pair("stdp", 0.5, 0.2, 0.6);
    for _ in 0..20 {
        fire(&mut net, 0);
        net.run(20);
        fire(&mut net, 1);
        net.run(300);
    }
    assert!((net.weights()[0] - 0.6).abs() < 1e-6, "clamped at wMax: {}", net.weights()[0]);
    for _ in 0..40 {
        fire(&mut net, 1);
        net.run(20);
        fire(&mut net, 0);
        net.run(300);
    }
    assert!((net.weights()[0] - 0.2).abs() < 1e-6, "clamped at wMin: {}", net.weights()[0]);
}

#[test]
fn disabling_plasticity_freezes_weights() {
    let mut net = plastic_pair("stdp", 0.5, 0.0, 5.0);
    net.set_plasticity_enabled(false);
    fire(&mut net, 0);
    net.run(50);
    fire(&mut net, 1);
    assert_eq!(net.weights()[0], 0.5);
}

#[test]
fn reward_rule_changes_weights_only_with_modulator() {
    let mut net = plastic_pair("reward", 0.5, 0.0, 5.0);
    fire(&mut net, 0);
    net.run(50);
    fire(&mut net, 1);
    net.run(500);
    assert_eq!(net.weights()[0], 0.5, "eligibility alone does not change the weight");
    let e = net.plasticity().eligibility(0).unwrap();
    assert!(e > 0.0, "eligibility trace recorded the pairing: {e}");
    net.inject_reward(1.0);
    net.run(3000);
    assert!(net.weights()[0] > 0.5, "reward converts eligibility into potentiation: {}", net.weights()[0]);
    net.reset_weights();
    assert_eq!(net.weights()[0], 0.5);
}

#[test]
fn repeated_paired_stimulation_strengthens_a_population_pathway() {
    // Population A (40) → B (40), p = 0.2, plastic. Stimulate A then B 5 ms later.
    let mut p = projection("a", "excitatory", "b", 0.2, 0.3, 1.0, 2.0);
    p["plasticity"] = json!({ "enabled": true });
    let mut cfg = config(
        vec![region("a", 40, 40, [0.0; 3]), region("b", 40, 40, [4.0, 0.0, 0.0])],
        vec![p],
    );
    cfg["plasticity"] = json!({
        "enabled": true, "tauPlusMs": 20.0, "tauMinusMs": 20.0, "aPlus": 0.02, "aMinus": 0.021,
        "wMin": 0.0, "wMax": 2.0, "eligibilityTauMs": 1000.0, "modulatorTauMs": 200.0,
        "rewardRate": 1.0
    });
    let mut net = build(&cfg);
    quiet(&mut net);
    let before: f64 = net.weights().iter().map(|&w| w as f64).sum::<f64>() / net.synapse_count() as f64;
    let stim = |region: u16, start: f32| -> neuroform_core::StimulusSpec {
        serde_json::from_value(json!({
            "target": { "kind": "regions", "regions": [region] },
            "amplitude": 8.0, "pattern": "constant", "startMs": start, "durationMs": 2.0,
            "repetitions": 30, "intervalMs": 100.0
        })).unwrap()
    };
    net.add_stimulus(stim(0, 0.0)).unwrap();
    net.add_stimulus(stim(1, 5.0)).unwrap();
    net.run(31_000);
    let after: f64 = net.weights().iter().map(|&w| w as f64).sum::<f64>() / net.synapse_count() as f64;
    assert!(after > before * 1.2, "mean weight {before:.4} → {after:.4}");
    let top = net.top_weight_changes(5);
    assert_eq!(top.len(), 5);
    assert!(top[0].delta > 0.0);
}
