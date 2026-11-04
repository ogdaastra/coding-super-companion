//! Single-neuron dynamics of the leaky integrate-and-fire model.

mod common;
use common::*;
use neuroform_core::NeuronParam;

fn single() -> neuroform_core::Network {
    let mut net = build(&config(vec![region("a", 1, 1, [0.0; 3])], vec![]));
    quiet(&mut net);
    net
}

#[test]
fn stays_at_rest_without_input() {
    let mut net = single();
    let s = spikes(&mut net, 5000);
    assert!(s.is_empty());
    assert!((net.membrane()[0] + 65.0).abs() < 1e-4, "v = {}", net.membrane()[0]);
}

#[test]
fn relaxes_to_rest_with_membrane_time_constant() {
    let mut net = single();
    net.set_membrane_potential(0, -55.0).unwrap(); // 10 mV above rest, below threshold
    // τ = 20 ms at Δt = 0.1 ms: after 200 steps the deviation is e^-1 of the start.
    net.run(200);
    let dev = net.membrane()[0] + 65.0;
    let expected = 10.0 * (-1.0f32).exp();
    assert!((dev - expected).abs() < 1e-3, "deviation {dev}, expected {expected}");
}

#[test]
fn subthreshold_current_settles_at_v_infinity() {
    let mut net = single();
    // V∞ = V_rest + τ R I = -65 + 20·0.5 = -55 (below threshold -50)
    net.set_neuron_param(0, NeuronParam::Bias, 0.5).unwrap();
    let s = spikes(&mut net, 4000);
    assert!(s.is_empty());
    assert!((net.membrane()[0] + 55.0).abs() < 1e-3);
}

#[test]
fn suprathreshold_current_fires_at_the_analytic_rate() {
    let mut net = single();
    let i_in = 1.5f64; // V∞ = -35
    net.set_neuron_param(0, NeuronParam::Bias, i_in as f32).unwrap();
    let s = spikes(&mut net, 20_000); // 2 s
    assert!(s.len() > 10);
    // Steady-state ISI: t_ref + τ ln((V∞ − V_reset)/(V∞ − V_th)).
    let v_inf = -65.0 + 20.0 * i_in;
    let isi = 2.0 + 20.0 * ((v_inf + 70.0) / (v_inf + 50.0)).ln();
    let measured = (s[s.len() - 1].0 - s[1].0) as f64 * 0.1 / (s.len() - 2) as f64;
    assert!((measured - isi).abs() < 0.15, "ISI {measured} ms, analytic {isi} ms");
}

#[test]
fn threshold_crossing_resets_and_holds_for_refractory_period() {
    let mut net = single();
    net.set_neuron_param(0, NeuronParam::Bias, 5.0).unwrap(); // strong drive
    let mut first = None;
    for _ in 0..2000 {
        let t = net.step_index();
        net.step_once();
        if !net.fired().is_empty() {
            first = Some(t);
            break;
        }
    }
    let first = first.expect("neuron fires");
    assert_eq!(net.membrane()[0], -70.0, "membrane resets to V_reset");
    // 2 ms refractory at 0.1 ms: held at reset for 20 steps, no spikes.
    for k in 0..20 {
        net.step_once();
        assert!(net.fired().is_empty(), "spiked during refractory period at +{k}");
        assert_eq!(net.membrane()[0], -70.0);
        let left = net.refractory_left_ms(0);
        assert!(left >= 0.0);
    }
    let s = spikes(&mut net, 2000);
    assert!(!s.is_empty());
    assert!(s[0].0 > first + 20);
}

#[test]
fn lowering_the_threshold_increases_firing() {
    let mut a = single();
    let mut b = single();
    a.set_neuron_param(0, NeuronParam::Bias, 0.9).unwrap();
    b.set_neuron_param(0, NeuronParam::Bias, 0.9).unwrap();
    b.set_neuron_param(0, NeuronParam::VThreshold, -54.0).unwrap();
    let na = spikes(&mut a, 10_000).len();
    let nb = spikes(&mut b, 10_000).len();
    assert!(nb > na, "{nb} vs {na}");
}

#[test]
fn rejects_invalid_parameters() {
    let mut net = single();
    assert!(net.set_neuron_param(0, NeuronParam::VReset, -40.0).is_err());
    assert!(net.set_neuron_param(0, NeuronParam::TauMs, f32::NAN).is_err());
    assert!(net.set_neuron_param(0, NeuronParam::Resistance, -1.0).is_err());
    let old = net.set_neuron_param(0, NeuronParam::VThreshold, -52.0).unwrap();
    assert_eq!(old, -50.0);
}

#[test]
fn noise_produces_irregular_firing_reproducibly() {
    let mk = || {
        let mut n = single();
        n.set_neuron_param(0, NeuronParam::NoiseStd, 3.0).unwrap();
        n.set_neuron_param(0, NeuronParam::Bias, 0.6).unwrap();
        n
    };
    let (mut a, mut b) = (mk(), mk());
    let sa = spikes(&mut a, 20_000);
    let sb = spikes(&mut b, 20_000);
    assert!(sa.len() > 5);
    assert_eq!(sa, sb);
    let isis: Vec<f64> = sa.windows(2).map(|w| (w[1].0 - w[0].0) as f64).collect();
    let mean = isis.iter().sum::<f64>() / isis.len() as f64;
    let var = isis.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / isis.len() as f64;
    assert!(var.sqrt() / mean > 0.1, "ISI CV should reflect noise");
}
