/** Visualisation modes and the shader weights each one blends towards. */

export type VizMode =
  | 'normal'
  | 'spikes'
  | 'connectivity'
  | 'density'
  | 'strength'
  | 'ei'
  | 'local'
  | 'regional'
  | 'membrane';

export interface ModeWeights {
  nBase: number;
  nSpike: number;
  nHeat: number;
  nClass: number;
  sAlpha: number;
  sActive: number;
  sStrength: number;
  sEI: number;
  pulses: number;
  halo: number;
  bundles: number;
  focus: number;
}

export const VIZ_MODES: { id: VizMode; label: string; short: string; describe: string; needs?: 'rates' | 'membrane' | 'weights' | 'selection' }[] = [
  { id: 'normal', label: 'Normal activity', short: 'Normal', describe: 'Neurons flash when they fire; pulses travel along displayed synapses.' },
  { id: 'spikes', label: 'Spike visualisation', short: 'Spikes', describe: 'Structure recedes; individual spikes and their transmissions dominate.' },
  { id: 'connectivity', label: 'Connectivity', short: 'Connect', describe: 'Emphasises the synaptic relationships themselves.' },
  { id: 'density', label: 'Activity density', short: 'Density', describe: 'Each neuron coloured by its measured firing rate.', needs: 'rates' },
  { id: 'strength', label: 'Synaptic strength', short: 'Strength', describe: 'Synapses coloured and weighted by their current weight.', needs: 'weights' },
  { id: 'ei', label: 'Excitatory / inhibitory', short: 'E / I', describe: 'Cyan excitatory, magenta inhibitory neurons and pathways.' },
  { id: 'local', label: 'Local network', short: 'Local', describe: 'The selected neuron with its inputs, outputs and second-order outputs.', needs: 'selection' },
  { id: 'regional', label: 'Regional activity', short: 'Regional', describe: 'Neurons and regions coloured by their region’s firing rate.' },
  { id: 'membrane', label: 'Membrane potential', short: 'Voltage', describe: 'Each neuron coloured by V between reset and threshold.', needs: 'membrane' },
];

export const MODE_WEIGHTS: Record<VizMode, ModeWeights> = {
  normal: { nBase: 1, nSpike: 1, nHeat: 0, nClass: 0, sAlpha: 0.16, sActive: 0.45, sStrength: 0, sEI: 0, pulses: 1, halo: 0.25, bundles: 0.3, focus: 0.6 },
  spikes: { nBase: 0.3, nSpike: 1.35, nHeat: 0, nClass: 0, sAlpha: 0.035, sActive: 1.3, sStrength: 0, sEI: 0, pulses: 1.3, halo: 0.05, bundles: 0.1, focus: 0.4 },
  connectivity: { nBase: 0.6, nSpike: 0.35, nHeat: 0, nClass: 0, sAlpha: 0.6, sActive: 0.35, sStrength: 0, sEI: 0, pulses: 0.4, halo: 0.12, bundles: 0.7, focus: 1 },
  density: { nBase: 0.12, nSpike: 0.45, nHeat: 1, nClass: 0, sAlpha: 0.04, sActive: 0.2, sStrength: 0, sEI: 0, pulses: 0.3, halo: 0.2, bundles: 0.15, focus: 0.4 },
  strength: { nBase: 0.35, nSpike: 0.3, nHeat: 0, nClass: 0, sAlpha: 0.55, sActive: 0.2, sStrength: 1, sEI: 0, pulses: 0.3, halo: 0.05, bundles: 0.3, focus: 1 },
  ei: { nBase: 0.12, nSpike: 0.9, nHeat: 0, nClass: 1, sAlpha: 0.3, sActive: 0.6, sStrength: 0, sEI: 1, pulses: 0.8, halo: 0.05, bundles: 0.3, focus: 0.8 },
  local: { nBase: 0.9, nSpike: 1, nHeat: 0, nClass: 0, sAlpha: 0.05, sActive: 1, sStrength: 0, sEI: 0.6, pulses: 1, halo: 0.05, bundles: 0.05, focus: 1.2 },
  regional: { nBase: 0.12, nSpike: 0.4, nHeat: 1, nClass: 0, sAlpha: 0.05, sActive: 0.2, sStrength: 0, sEI: 0, pulses: 0.4, halo: 1, bundles: 0.7, focus: 0.4 },
  membrane: { nBase: 0.08, nSpike: 0.6, nHeat: 1, nClass: 0, sAlpha: 0.04, sActive: 0.2, sStrength: 0, sEI: 0, pulses: 0.4, halo: 0.05, bundles: 0.1, focus: 0.4 },
};
