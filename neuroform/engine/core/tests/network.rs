//! Whole-network behaviour: reproducibility, reset, snapshots, propagation,
//! stimulation and run-time edits.

mod common;
use common::*;
use neuroform_core::{NeuronParam, StimulusSpec};
use serde_json::json;

fn chain() -> serde_json::Value {
    // a → b → c feed-forward, each with local recurrence and inhibition.
    let mut regions = vec![];
    let mut projections = vec![];
    for (k, id) in ["a", "b", "c"].iter().enumerate() {
        let mut r = region(id, 200, 160, [k as f64 * 4.0, 0.0, 0.0]);
        r["heterogeneity"] = json!(0.3);
        r["excitatory"]["noiseStd"] = json!(1.0);
        r["excitatory"]["bias"] = json!(0.55);
        regions.push(r);
        projections.push(projection(id, "excitatory", id, 0.05, 0.4, 1.0, 3.0));
        projections.push(projection(id, "inhibitory", id, 0.1, 1.2, 0.5, 1.0));
    }
    projections.push(projection("a", "excitatory", "b", 0.1, 1.0, 2.0, 4.0));
    projections.push(projection("b", "excitatory", "c", 0.1, 1.0, 2.0, 4.0));
    config(regions, projections)
}

fn region_stim(region: u16, amp: f32) -> StimulusSpec {
    serde_json::from_value(json!({
        "target": { "kind": "regions", "regions": [region] },
        "amplitude": amp, "pattern": "constant", "durationMs": 20.0
    }))
    .unwrap()
}

#[test]
fn same_seed_same_network_and_spikes() {
    let mut a = build(&chain());
    let mut b = build(&chain());
    assert_eq!(a.topology_hash(), b.topology_hash());
    assert_eq!(a.positions(), b.positions());
    assert_eq!(spikes(&mut a, 3000), spikes(&mut b, 3000));

    let mut other = chain();
    other["seed"] = json!(99);
    let c = build(&other);
    assert_ne!(a.topology_hash(), c.topology_hash());
}

#[test]
fn chunked_stepping_equals_continuous_stepping() {
    // Pausing and resuming must not change the simulation.
    let mut a = build(&chain());
    let mut b = build(&chain());
    a.run(2000);
    for _ in 0..40 {
        b.run(50);
    }
    assert_eq!(a.membrane(), b.membrane());
    assert_eq!(a.spike_counts(), b.spike_counts());
}

#[test]
fn reset_reproduces_the_original_run() {
    let mut net = build(&chain());
    let first = spikes(&mut net, 2000);
    net.reset_dynamics();
    let second = spikes(&mut net, 2000);
    assert!(!first.is_empty());
    assert_eq!(first, second);
}

#[test]
fn snapshot_restores_exactly() {
    let mut net = build(&chain());
    net.run(1500);
    net.add_stimulus(region_stim(1, 3.0)).unwrap();
    net.run(50);
    let snap = net.snapshot();
    let expected = spikes(&mut net, 1500);

    let mut fresh = build(&chain());
    fresh.restore(&snap).expect("restores");
    assert_eq!(fresh.step_index(), 1550);
    assert_eq!(fresh.stimuli().len(), 1);
    assert_eq!(spikes(&mut fresh, 1500), expected);
}

#[test]
fn snapshot_rejects_a_different_network() {
    let net = build(&chain());
    let snap = net.snapshot();
    let mut other = chain();
    other["seed"] = json!(5);
    let mut different = build(&other);
    assert!(different.restore(&snap).is_err());
    assert!(different.restore(&snap[..100]).is_err());
    assert!(different.restore(b"garbage").is_err());
}

#[test]
fn activity_propagates_between_connected_populations() {
    let mut net = build(&chain());
    // Silence background drive so only the stimulus can cause activity.
    for r in 0..3 {
        net.set_population_param(r, Default::default(), NeuronParam::Bias, 0.0).unwrap();
        net.set_population_param(r, Default::default(), NeuronParam::NoiseStd, 0.0).unwrap();
    }
    quiet(&mut net);
    net.run(500);
    net.take_telemetry();
    net.add_stimulus(region_stim(0, 2.0)).unwrap();
    let s = spikes(&mut net, 600);
    let first = |r: u32| s.iter().find(|&&(_, j)| j / 200 == r).map(|&(t, _)| t);
    let (fa, fb, fc) = (first(0), first(1), first(2));
    assert!(fa.is_some() && fb.is_some() && fc.is_some(), "{fa:?} {fb:?} {fc:?}");
    assert!(fa < fb && fb < fc, "propagation order a < b < c: {fa:?} {fb:?} {fc:?}");
    let t = net.take_telemetry();
    assert!(t.projection_events[6] > 0, "a→b transmitted");
    assert!(t.active_neurons > 0);
}

#[test]
fn stimulating_one_neuron_makes_it_fire() {
    let mut net = build(&chain());
    for r in 0..3 {
        net.set_population_param(r, Default::default(), NeuronParam::Bias, 0.0).unwrap();
        net.set_population_param(r, Default::default(), NeuronParam::NoiseStd, 0.0).unwrap();
    }
    quiet(&mut net);
    let spec: StimulusSpec = serde_json::from_value(json!({
        "target": { "kind": "neurons", "ids": [17] },
        "amplitude": 6.0, "pattern": "pulses", "frequencyHz": 50.0, "pulseMs": 5.0,
        "durationMs": 100.0
    }))
    .unwrap();
    let (_, n) = net.add_stimulus(spec).unwrap();
    assert_eq!(n, 1);
    let s = spikes(&mut net, 1200);
    assert!(s.iter().filter(|&&(_, j)| j == 17).count() >= 3);
    assert!(net.stimuli().is_empty(), "finished stimulus is removed");
    assert_eq!(net.neurons().i_stim[17], 0.0, "and its current withdrawn");
}

#[test]
fn sphere_and_fractional_targets_resolve_to_real_neurons() {
    let mut net = build(&chain());
    let spec: StimulusSpec = serde_json::from_value(json!({
        "target": { "kind": "sphere", "center": [0.0, 0.0, 0.0], "radius": 0.5 },
        "amplitude": 1.0, "pattern": "poisson", "rateHz": 200.0, "durationMs": 10.0
    }))
    .unwrap();
    let (_, n) = net.add_stimulus(spec).unwrap();
    assert!(n > 0 && n < 200);
    let spec: StimulusSpec = serde_json::from_value(json!({
        "target": { "kind": "regions", "regions": [1, 2], "fraction": 0.25, "class": "excitatory" },
        "amplitude": 1.0, "pattern": "constant", "durationMs": 10.0
    }))
    .unwrap();
    let (_, n) = net.add_stimulus(spec).unwrap();
    assert_eq!(n, 80);
}

#[test]
fn population_edits_preserve_heterogeneity() {
    let mut net = build(&chain());
    let before: Vec<f32> = net.neurons().v_th[0..160].to_vec();
    let mean = net.population_mean(0, neuroform_core::stimulus::ClassFilter::Excitatory, NeuronParam::VThreshold).unwrap();
    net.set_population_param(0, neuroform_core::stimulus::ClassFilter::Excitatory, NeuronParam::VThreshold, mean + 2.0).unwrap();
    for (k, &b) in before.iter().enumerate() {
        assert!((net.neurons().v_th[k] - (b + 2.0)).abs() < 1e-4);
    }
}

#[test]
fn telemetry_measures_real_activity() {
    let mut net = build(&chain());
    net.run(2000);
    let t = net.take_telemetry();
    let spikes: u64 = t.regions.iter().map(|r| r.spikes_exc + r.spikes_inh).sum();
    let counted: u64 = net.spike_counts().iter().map(|&c| c as u64).sum();
    assert_eq!(spikes, counted, "window spike count equals per-neuron totals");
    assert!(t.synchrony >= 0.0 && t.synchrony <= 1.0);
    assert!(t.v_mean < -40.0 && t.v_mean > -80.0);
    assert_eq!(t.window_steps, 2000);
}

#[test]
fn communities_follow_the_region_structure() {
    // Two densely recurrent modules joined by a sparse, weak pathway.
    let net = build(&config(
        vec![region("a", 200, 160, [0.0; 3]), region("b", 200, 160, [4.0, 0.0, 0.0])],
        vec![
            projection("a", "excitatory", "a", 0.1, 0.5, 1.0, 2.0),
            projection("b", "excitatory", "b", 0.1, 0.5, 1.0, 2.0),
            projection("a", "inhibitory", "a", 0.1, 0.5, 1.0, 2.0),
            projection("b", "inhibitory", "b", 0.1, 0.5, 1.0, 2.0),
            projection("a", "excitatory", "b", 0.005, 0.2, 1.0, 2.0),
        ],
    ));
    let (labels, summary) = net.communities(10);
    assert_eq!(labels.len(), 400);
    assert!(summary.count >= 2);
    assert!(summary.modularity > 0.2, "Q = {}", summary.modularity);
}

#[test]
fn local_topology_connects_nearby_neurons() {
    let mut cfg = chain();
    cfg["projections"][0]["topology"] = json!("local");
    cfg["projections"][0]["spread"] = json!(0.15);
    let net = build(&cfg);
    let pos = net.positions();
    let (mut local, mut count) = (0.0f64, 0);
    for j in 0..160usize {
        for s in net.row_ptr()[j] as usize..net.row_ptr()[j + 1] as usize {
            let t = net.targets()[s] as usize;
            if t < 200 {
                let d: f32 = (0..3).map(|k| (pos[3 * j + k] - pos[3 * t + k]).powi(2)).sum::<f32>().sqrt();
                local += d as f64;
                count += 1;
            }
        }
    }
    assert!(count > 0);
    assert!(local / (count as f64) < 0.6, "mean local distance {}", local / count as f64);
}

#[test]
fn rejects_invalid_configurations() {
    let mut bad = chain();
    bad["projections"][0]["to"] = json!("nowhere");
    let cfg: neuroform_core::BrainConfig = serde_json::from_value(bad).unwrap();
    let e = cfg.validate().unwrap_err();
    assert!(e.path.contains("projections[0].to"), "{e}");

    let mut bad = chain();
    bad["regions"][0]["excitatory"]["vReset"] = json!(-40.0);
    let cfg: neuroform_core::BrainConfig = serde_json::from_value(bad).unwrap();
    assert!(cfg.validate().is_err());

    let mut bad = chain();
    bad["timestepMs"] = json!(5.0);
    let cfg: neuroform_core::BrainConfig = serde_json::from_value(bad).unwrap();
    assert!(cfg.validate().is_err());
}

#[test]
fn rate_coded_input_drives_listed_neurons_at_their_rates() {
    let mut net = build(&chain());
    for r in 0..3 {
        net.set_population_param(r, Default::default(), NeuronParam::Bias, 0.0).unwrap();
        net.set_population_param(r, Default::default(), NeuronParam::NoiseStd, 0.0).unwrap();
    }
    quiet(&mut net);
    // Ten neurons at 200 Hz, ten at 0 Hz (skipped), one at 1000 Hz.
    let mut ids: Vec<u32> = (0..10).collect();
    let mut rates = vec![200.0f32; 10];
    ids.extend(10..20);
    rates.extend([0.0f32; 10]);
    ids.push(30);
    rates.push(1000.0);
    assert_eq!(net.set_input(&ids, &rates, 8.0).unwrap(), 11);

    let steps = 10_000;
    let s = spikes(&mut net, steps);
    // Expected events: (10 × 200 + 1000) Hz × simulated time; allow 5 Poisson sd.
    let expected = 3000.0 * steps as f64 * net.dt() as f64 / 1000.0;
    let ev = net.input().events as f64;
    assert!((ev - expected).abs() < 5.0 * expected.sqrt(), "events {ev}, expected {expected}");
    let fired = |lo: u32, hi: u32| s.iter().filter(|&&(_, j)| (lo..hi).contains(&j)).count();
    assert!(fired(0, 10) > 100, "driven neurons fire");
    // Rate-0 neurons get no input events; they can only fire through recurrent
    // synapses from the driven ones.
    assert!(fired(10, 20) * 4 < fired(0, 10), "undriven {} vs driven {}", fired(10, 20), fired(0, 10));
    assert!(s.iter().filter(|&&(_, j)| j == 30).count() > s.iter().filter(|&&(_, j)| j == 0).count(), "a higher rate drives more spikes");

    // Clearing stops the input.
    net.clear_input();
    let _ = spikes(&mut net, 200); // let queued events and currents decay
    let s = spikes(&mut net, 2000);
    assert_eq!(fired_in(&s, 0, 10) + fired_in(&s, 30, 31), 0);

    // Invalid input is rejected without changing the current input.
    assert!(net.set_input(&[0, 1], &[10.0], 1.0).is_err());
    assert!(net.set_input(&[100_000], &[10.0], 1.0).is_err());
    assert!(net.set_input(&[0], &[-1.0], 1.0).is_err());
    assert_eq!(net.input().events, 0, "the cleared input is still in place");
}

fn fired_in(s: &[(u64, u32)], lo: u32, hi: u32) -> usize {
    s.iter().filter(|&&(_, j)| (lo..hi).contains(&j)).count()
}
