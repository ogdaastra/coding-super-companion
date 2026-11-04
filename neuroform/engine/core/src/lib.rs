//! NEUROFORM simulation engine.
//!
//! A platform-independent spiking neural network simulator: leaky
//! integrate-and-fire neurons, individually stored synapses with delays, an
//! event-driven calendar queue, STDP and reward-modulated STDP, stimulation and
//! telemetry. It has no dependency on a browser, WebAssembly, rendering or UI; the
//! `neuroform-wasm` crate exposes it to the browser and a native host (for example
//! a Tauri shell) can link it directly.
//!
//! See `docs/SIMULATION.md` for the model and numerical methods.

pub mod analysis;
pub mod build;
pub mod config;
pub mod edit;
pub mod network;
pub mod plasticity;
pub mod rng;
pub mod snapshot;
pub mod stimulus;
pub mod telemetry;

pub use build::{build_network, NetworkBuilder};
pub use config::{BrainConfig, ConfigError, ConfigTotals};
pub use edit::NeuronParam;
pub use network::Network;
pub use stimulus::StimulusSpec;

/// Increment when the binary interface or snapshot layout changes.
pub const ENGINE_VERSION: u32 = 1;
