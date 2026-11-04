/**
 * Run-time modifications of the live network, each recorded with an undo action.
 * Every change is applied by the engine (which validates it); the previous value
 * returned by the engine is what undo restores.
 */

import type { AppController } from './AppController.ts';
import { NEURON_PARAM_META, neuronParamIndex, type NeuronParamKey } from '../config/schema.ts';
import type { NeuronClassFilter } from '../engine/wasmEngine.ts';

interface UndoEntry {
  label: string;
  undo: () => Promise<unknown>;
}

const MAX_UNDO = 50;

export class EditService {
  private readonly app: AppController;
  private stack: UndoEntry[] = [];

  constructor(app: AppController) {
    this.app = app;
  }

  private push(entry: UndoEntry): void {
    this.stack.push(entry);
    if (this.stack.length > MAX_UNDO) this.stack.shift();
    this.publish();
  }

  private publish(): void {
    this.app.store.set({ undo: this.stack.map((e) => e.label) });
  }

  clear(): void {
    this.stack = [];
    this.publish();
  }

  async undo(): Promise<void> {
    const e = this.stack.pop();
    this.publish();
    if (!e) return;
    try {
      await e.undo();
      this.app.toast('info', `Undone: ${e.label}`);
      await this.app.refreshNeuron();
    } catch (err) {
      this.app.toast('error', 'Undo failed', String(err));
    }
  }

  private fail(title: string, e: unknown): never {
    const msg = e instanceof Error ? e.message : String(e);
    this.app.toast('error', title, msg);
    throw e;
  }

  async setNeuronParam(neuron: number, key: NeuronParamKey, value: number): Promise<void> {
    const c = this.app.client;
    const param = neuronParamIndex(key);
    let old: number;
    try {
      old = await c.request('setNeuronParam', { neuron, param, value });
    } catch (e) {
      this.fail(`${NEURON_PARAM_META[key].label} not changed`, e);
    }
    this.push({
      label: `#${neuron} ${NEURON_PARAM_META[key].label} ${fmt(old)} → ${fmt(value)}`,
      undo: () => c.request('setNeuronParam', { neuron, param, value: old }),
    });
    await this.app.refreshNeuron();
  }

  async setPopulationParam(region: number, cls: NeuronClassFilter, key: NeuronParamKey, value: number): Promise<void> {
    const c = this.app.client;
    const param = neuronParamIndex(key);
    let oldMean: number;
    try {
      oldMean = await c.request('setPopulationParam', { region, cls, param, value });
    } catch (e) {
      this.fail(`${NEURON_PARAM_META[key].label} not changed`, e);
    }
    const name = this.app.state.info?.regions[region]?.name ?? `Region ${region}`;
    this.push({
      label: `${name} (${cls}) ${NEURON_PARAM_META[key].label} ${fmt(oldMean)} → ${fmt(value)}`,
      undo: () => c.request('setPopulationParam', { region, cls, param, value: oldMean }),
    });
    await this.app.refreshNeuron();
  }

  async setRegionEnabled(region: number, enabled: boolean): Promise<void> {
    const c = this.app.client;
    const old = await c.request('setRegionEnabled', { region, enabled });
    const name = this.app.state.info?.regions[region]?.name ?? `Region ${region}`;
    this.push({ label: `${enabled ? 'Enable' : 'Disable'} ${name}`, undo: () => c.request('setRegionEnabled', { region, enabled: old }) });
    this.app.toast(enabled ? 'info' : 'warning', `${name} ${enabled ? 'enabled' : 'disabled'}`, enabled ? undefined : 'Its neurons are clamped at rest and transmit nothing. Its neurons and synapses still exist.');
  }

  async setProjectionGain(projection: number, gain: number): Promise<void> {
    const c = this.app.client;
    const old = await c.request('setProjectionGain', { projection, gain });
    this.setGainState(projection, gain);
    const info = this.app.state.info;
    const p = info?.projections[projection];
    const label = p && info ? `${info.regions[p.from].name} → ${info.regions[p.to].name} (${p.source[0].toUpperCase()})` : `Pathway ${projection}`;
    this.push({
      label: `${label} gain ${fmt(old)} → ${fmt(gain)}`,
      undo: async () => {
        await c.request('setProjectionGain', { projection, gain: old });
        this.setGainState(projection, old);
      },
    });
  }

  private setGainState(projection: number, gain: number): void {
    this.app.store.set((s) => ({ gains: s.gains.map((g, i) => (i === projection ? gain : g)) }));
  }

  async setSynapseWeight(synapse: number, weight: number): Promise<void> {
    const c = this.app.client;
    const old = await c.request('setSynapseWeight', { synapse, weight });
    this.push({ label: `Synapse ${synapse} weight ${fmt(old)} → ${fmt(weight)}`, undo: () => c.request('setSynapseWeight', { synapse, weight: old }) });
    await this.app.refreshNeuron();
  }

  /** Scales every pathway's gain (immediate "average synaptic weight" control). */
  async scaleAllGains(gain: number): Promise<void> {
    const info = this.app.state.info;
    if (!info) return;
    const c = this.app.client;
    const olds: number[] = [];
    for (let p = 0; p < info.projections.length; p++) olds.push(await c.request('setProjectionGain', { projection: p, gain }));
    this.app.store.set({ gains: olds.map(() => gain) });
    this.push({
      label: `All pathway gains → ${fmt(gain)}`,
      undo: async () => {
        for (let p = 0; p < olds.length; p++) await c.request('setProjectionGain', { projection: p, gain: olds[p] });
        this.app.store.set({ gains: olds.slice() });
      },
    });
  }

  /** Applies a population parameter to every region (immediate global control). */
  async setAllPopulations(cls: NeuronClassFilter, key: NeuronParamKey, value: number): Promise<void> {
    const info = this.app.state.info;
    if (!info) return;
    const c = this.app.client;
    const param = neuronParamIndex(key);
    const olds: number[] = [];
    for (let r = 0; r < info.regions.length; r++) {
      const mean = await c.request('populationMean', { region: r, cls, param });
      olds.push(mean);
      if (Number.isFinite(mean)) await c.request('setPopulationParam', { region: r, cls, param, value });
    }
    this.push({
      label: `All regions (${cls}) ${NEURON_PARAM_META[key].label} → ${fmt(value)}`,
      undo: async () => {
        for (let r = 0; r < olds.length; r++) if (Number.isFinite(olds[r])) await c.request('setPopulationParam', { region: r, cls, param, value: olds[r] });
      },
    });
  }
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
}
