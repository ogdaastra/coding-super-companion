# File formats

NEUROFORM distinguishes three kinds of saved data and never treats one as another.

| | Configuration | Snapshot | Recording |
|---|---|---|---|
| File | `.neuroform.json` | `.nfsnap` | `.nfrec` |
| Recreates the network | yes | yes (embedded configuration) | no |
| Restores state (V, currents, queued events, weights) | no | yes | no |
| Spike history | no | no | yes |
| Typical size (10k neurons) | 10 KB | 30–60 MB | proportional to spikes (8 B each) |

All binary formats are little-endian.

## Configuration (`neuroform.config`, version 1)

```json
{
  "format": "neuroform.config",
  "version": 1,
  "exportedAt": "2026-11-04T12:00:00.000Z",
  "config": { "name": "…", "seed": 1, "timestepMs": 0.5, "synapse": {…}, "plasticity": {…}, "regions": […], "projections": […] }
}
```

The schema is `src/config/schema.ts` (TypeScript) and `engine/core/src/config.rs`
(Rust, authoritative). Import accepts the envelope or a bare `config` object,
rejects other formats and newer versions, and lists validation problems with
their paths (for example `projections[3].delayMs.max: exceeds 255 steps at 0.5 ms
per step`). Presentation fields (`color`, `role`, `description`, `preset`) are
ignored by the engine.

## Snapshot (`.nfsnap`)

```
"NFSNAPF1"                 8 bytes
u32                        header length
header JSON                { format: "neuroform.snapshot", version: 1, createdAt, name,
                             timeMs, step, topologyHash, config }
engine state               rest of the file (below)
```

Engine state (`engine/core/src/snapshot.rs`):

```
"NFSTATE\x01", u32 version
u32 neurons, synapses, regions, projections, ring slots; u64 topology hash
f32 Δt; u64 step; u32×4 noise-generator state
per-neuron parameter arrays (11 × f32[N]): V_rest V_th V_reset τ refractory R ε
  bias I_ext noise I_stim
V, I_exc, I_inh (f32[N]); refractory left (u16[N]); spike count, last spike (u32[N])
event ring (f32[slots × N × 2]); events per slot (u64[slots])
weights (f32[S])
region enabled (u8 × regions); pathway gain (f32 × projections)
plasticity: enabled, rate scale, modulator, pending reward, traces, eligibility
next stimulus id; active stimuli (id, spec JSON, targets, start, on, events)
```

Every array is length-prefixed. Restoring rebuilds the network from the embedded
configuration if necessary, verifies the topology fingerprint, and refuses a
snapshot taken from a different network or engine version.

## Recording (`.nfrec`)

```
"NFREC\0\0\x01"
u32 header length, header JSON  { format: "neuroform.recording", version: 1, createdAt,
                                  configName, topologyHash, dt, neurons, regions[],
                                  startStep, endStep, startMs, endMs, spikes, truncated }
u32 spike count, then (u32 step, u32 neuron) per spike
u32 length, JSON array of samples { t, windowMs, spikes[region], vMean, synchrony, active }
```

Playback replays the spikes into the 3D view on its own clock while the live
simulation is paused; it is labelled PLAYBACK and does not alter the network.

## Synapse table (`.nfsyn`)

Used instead of CSV above 1.5 million synapses.

```
"NFSYN\0\0\x01", u32 header length, header JSON { format, version, synapses, neurons, projections[] }
padding to 4 bytes
u32[S] pre, u32[S] post, f32[S] weight, f32[S] delay ms, u8[S] projection index
```

## CSV exports

* neurons: `id, region, class, x, y, z, threshold_mV, excitability, membrane_mV, in_degree, out_degree, spike_count, mean_rate_hz`
* synapses: `id, pre, post, weight, delay_ms, projection, class, plasticity`
* spikes: `time_ms, neuron, region` (raster rows; use a recording for all neurons)
* telemetry: `time_ms, rate_hz, exc_rate_hz, inh_rate_hz, v_mean_mV, active_neurons, synchrony_chi, synaptic_events_per_s, <region>_hz…`

Experiment results export as JSON with their parameters, seed and topology hash.
