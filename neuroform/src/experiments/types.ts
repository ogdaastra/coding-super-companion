/** Experiment definitions, parameters and results. */

import type { NetInfo, ProjectionStats, TelemetryReport } from '../engine/types.ts';
import type { StimulusSpec } from '../sim/protocol.ts';
import type { NeuronParamKey } from '../config/schema.ts';
import type { NeuronClassFilter } from '../engine/wasmEngine.ts';

export type ParamValue = number | string | boolean | number[];

export interface ParamSpec {
  key: string;
  label: string;
  type: 'region' | 'projection' | 'number' | 'select' | 'boolean';
  default: (info: NetInfo) => ParamValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  help?: string;
}

export interface ResultTable {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface ResultChart {
  title: string;
  xLabel: string;
  yLabel: string;
  x: number[];
  series: { name: string; values: number[]; color?: string }[];
  kind?: 'line' | 'bar';
}

export interface ExperimentResult {
  headline: string;
  summary: { label: string; value: string; note?: string }[];
  tables: ResultTable[];
  charts: ResultChart[];
  notes: string[];
}

export interface Capture {
  spikes: Uint32Array;
  startStep: number;
  endStep: number;
}

/** Everything an experiment may do to the live network. */
export interface ExperimentContext {
  info: NetInfo;
  dt: number;
  regionOf: Uint16Array;
  signal: AbortSignal;
  /** Current simulation step. */
  step(): number;
  /** Advances exactly `ms` of simulated time. */
  advance(ms: number): Promise<void>;
  /** Exact measurement since the previous call (telemetry window). */
  measure(): Promise<TelemetryReport>;
  /** Captures every spike emitted while `fn` runs. */
  capture(fn: () => Promise<void>): Promise<Capture>;
  stimulate(spec: StimulusSpec): Promise<Uint32Array>;
  /** Resets dynamics (and weights) to time zero: identical initial conditions. */
  reset(): Promise<void>;
  projectionStats(): Promise<ProjectionStats[]>;
  topChanges(k: number): Promise<{ synapse: number; pre: number; post: number; initial: number; weight: number; delta: number }[]>;
  /** Temporary changes, automatically undone when the experiment ends. */
  setRegionEnabled(region: number, enabled: boolean): Promise<void>;
  setProjectionGain(projection: number, gain: number): Promise<void>;
  setPopulationParam(region: number, cls: NeuronClassFilter, key: NeuronParamKey, value: number): Promise<void>;
  populationMean(region: number, cls: NeuronClassFilter, key: NeuronParamKey): Promise<number>;
  setPlasticity(enabled: boolean, rate?: number): Promise<void>;
  setSyncGroup(regions: number[]): Promise<void>;
  /** Undoes temporary changes now (between conditions). */
  restoreChanges(): Promise<void>;
  progress(fraction: number, label: string): void;
  live(values: Record<string, string>): void;
  log(message: string): void;
}

export interface ExperimentDefinition {
  id: string;
  letter: string;
  name: string;
  summary: string;
  description: string[];
  /** How the main metric is computed, shown to the user. */
  method: string;
  params: ParamSpec[];
  /** Preset that best demonstrates the experiment. */
  suggestedPreset?: string;
  run(ctx: ExperimentContext, params: Record<string, ParamValue>): Promise<ExperimentResult>;
}
