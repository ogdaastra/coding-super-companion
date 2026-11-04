//! Synaptic transmission: sign, delay, decay, gating.

mod common;
use common::*;

/// Neuron 0 → neuron 1 with one synapse (probability 1).
fn pair(source: &str, w: f64, delay: f64) -> neuroform_core::Network {
    let exc = if source == "excitatory" { 1 } else { 0 };
    let cfg = config(
        vec![region("pre", 1, exc, [0.0; 3]), region("post", 1, 1, [3.0, 0.0, 0.0])],
        vec![projection("pre", source, "post", 1.0, w, delay, delay)],
    );
    let mut net = build(&cfg);
    quiet(&mut net);
    net
}

fn fire_pre(net: &mut neuroform_core::Network) -> u64 {
    net.set_membrane_potential(0, -30.0).unwrap();
    let t = net.step_index();
    net.step_once();
    assert_eq!(net.fired(), &[0], "presynaptic neuron fires");
    t
}

#[test]
fn every_synapse_is_individually_stored() {
    let net = pair("excitatory", 0.8, 2.0);
    assert_eq!(net.synapse_count(), 1);
    let s = net.find_synapse(0, 1).expect("synapse 0→1 exists");
    assert_eq!(net.synapse_source(s), 0);
    assert_eq!(net.targets()[s], 1);
    assert!((net.weights()[s] - 0.8).abs() < 1e-6);
    assert_eq!(net.delays()[s], 20);
}

#[test]
fn excitatory_event_arrives_after_exact_delay() {
    let mut net = pair("excitatory", 0.8, 2.0); // 20 steps
    let t0 = fire_pre(&mut net);
    for _ in 1..20 {
        net.step_once();
        assert_eq!(net.synaptic_current(1).0, 0.0, "nothing before the delay");
    }
    let v_before = net.membrane()[1];
    net.step_once(); // step t0 + 20 delivers
    assert_eq!(net.step_index(), t0 + 21);
    let (e, i) = net.synaptic_current(1);
    // Arrival adds w, then the current decays once at the end of the step.
    let decay = (-0.1f32 / 5.0).exp();
    assert!((e - 0.8 * decay).abs() < 1e-6, "I_exc = {e}");
    assert_eq!(i, 0.0);
    assert!(net.membrane()[1] > v_before, "depolarised");
}

#[test]
fn inhibitory_event_hyperpolarises() {
    let mut net = pair("inhibitory", 0.8, 1.0);
    fire_pre(&mut net);
    net.run(10);
    let (e, i) = net.synaptic_current(1);
    assert_eq!(e, 0.0);
    assert!(i < 0.0, "I_inh = {i}");
    net.run(5);
    assert!(net.membrane()[1] < -65.0, "below rest: {}", net.membrane()[1]);
}

#[test]
fn synaptic_current_decays_exponentially() {
    let mut net = pair("excitatory", 1.0, 0.1);
    fire_pre(&mut net);
    net.step_once(); // delivery step
    let a = net.synaptic_current(1).0;
    net.run(50); // 5 ms = one τ_exc
    let b = net.synaptic_current(1).0;
    assert!((b / a - (-1.0f32).exp()).abs() < 1e-4, "ratio {}", b / a);
}

#[test]
fn zero_delay_is_delivered_on_the_next_step() {
    let mut net = pair("excitatory", 1.0, 0.0);
    assert_eq!(net.delays()[0], 1);
    fire_pre(&mut net);
    net.step_once();
    assert!(net.synaptic_current(1).0 > 0.0);
}

#[test]
fn disabled_pathway_and_region_do_not_transmit() {
    let mut net = pair("excitatory", 1.0, 1.0);
    net.set_projection_gain(0, 0.0).unwrap();
    assert_eq!(net.effective_weight(0), 0.0);
    fire_pre(&mut net);
    net.run(20);
    assert_eq!(net.synaptic_current(1).0, 0.0);

    let mut net = pair("excitatory", 1.0, 1.0);
    net.set_region_enabled(0, false).unwrap();
    net.set_membrane_potential(0, -30.0).unwrap();
    net.run(20);
    assert_eq!(net.spike_counts()[0], 0, "a disabled region cannot fire");
    assert_eq!(net.effective_weight(0), 0.0);
}

#[test]
fn strong_excitation_makes_the_target_fire() {
    let mut net = pair("excitatory", 6.0, 1.0);
    fire_pre(&mut net);
    let s = spikes(&mut net, 200);
    assert!(s.iter().any(|&(_, j)| j == 1), "postsynaptic spike");
}

#[test]
fn event_queue_accounting_balances() {
    let mut net = pair("excitatory", 0.5, 3.0);
    fire_pre(&mut net);
    assert_eq!(net.pending_events(), 1);
    net.run(40);
    assert_eq!(net.pending_events(), 0);
    let t = net.take_telemetry();
    assert_eq!(t.events_scheduled, 1);
    assert_eq!(t.events_delivered, 1);
}
