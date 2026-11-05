/** The Observatory: global measurements, all derived from engine telemetry. */

import { useEffect, useMemo, useState } from 'react';
import { useApp, useAppState, useTelemetryTick } from '../../app/context.tsx';
import type { WeightHistogram } from '../../engine/types.ts';
import { ChartCard, HistogramChart, Legend, MatrixChart, RasterChart, TimeChart } from '../charts/charts.tsx';
import { Panel, Segmented, Stat, fmt } from '../primitives.tsx';
import { RegionList } from '../explorer/BrainPanel.tsx';

export function CoreStats() {
  const app = useApp();
  const info = useAppState((s) => s.info);
  const stats = useAppState((s) => s.projectionStats);
  const fps = useAppState((s) => s.render.stats?.fps ?? 0);
  useTelemetryTick(250);
  if (!info) return null;
  const t = app.telemetry;
  const r = t.latest;
  const perf = t.perf;
  const secs = Math.max(1e-9, (r?.windowMs ?? 0) / 1000);
  let wsum = 0;
  let wn = 0;
  stats?.forEach((s) => {
    wsum += s.meanWeight * s.synapses;
    wn += s.synapses;
  });
  return (
    <div className="stat-grid">
      <Stat label="Neurons" value={fmt.int(info.neurons)} />
      <Stat label="Synapses" value={fmt.compact(info.synapses)} />
      <Stat label="Active neurons" value={fmt.int(r?.activeNeurons ?? 0)} note="fired in last window" />
      <Stat label="Firing now" value={fmt.int(r?.firingLastStep ?? 0)} note="in the latest step" />
      <Stat label="Spikes / s" value={fmt.compact(t.spikesPerSecond.last() || 0)} note="per simulated second" />
      <Stat label="Mean frequency" value={(t.rate.last() || 0).toFixed(2)} unit="Hz" />
      <Stat label="Mean membrane" value={(r?.vMean ?? NaN).toFixed(2)} unit="mV" />
      <Stat label="Mean |weight|" value={wn ? (wsum / wn).toFixed(4) : '…'} />
      <Stat label="Active E" value={fmt.int(r?.activeExc ?? 0)} color="var(--cyan)" />
      <Stat label="Active I" value={fmt.int(r?.activeInh ?? 0)} color="var(--magenta)" />
      <Stat label="Active synapses" value={fmt.compact(r?.activeSynapses ?? 0)} note="presynaptic neuron fired" />
      <Stat label="Events / s" value={fmt.compact((r?.eventsScheduled ?? 0) / secs)} />
      <Stat label="Synchrony χ" value={(r?.synchrony ?? 0).toFixed(3)} note="Golomb–Rinzel" />
      <Stat label="Sim time" value={fmt.time(r?.timeMs ?? 0)} />
      <Stat label="Steps / s" value={fmt.compact(perf?.stepsPerSecond ?? 0)} note={`${(perf?.realtimeFactor ?? 0).toFixed(2)}× real time`} />
      <Stat label="Compute" value={((perf?.busyFraction ?? 0) * 100).toFixed(0)} unit="%" note={`${((perf?.msPerStep ?? 0) * 1000).toFixed(0)} µs / step`} />
      <Stat label="Render" value={fps.toFixed(0)} unit="FPS" />
    </div>
  );
}

export function useWeightHistogram(refreshMs = 3000): WeightHistogram | null {
  const app = useApp();
  const status = useAppState((s) => s.sim.status);
  const info = useAppState((s) => s.info);
  const [h, setH] = useState<WeightHistogram | null>(null);
  useEffect(() => {
    if (!info) return;
    let live = true;
    const load = () => void app.client.request('histogram', { projection: -1, bins: 48 }).then((x) => live && setH(x)).catch(() => {});
    load();
    const id = window.setInterval(() => status === 'running' && load(), refreshMs);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [app, info, status, refreshMs]);
  return h;
}

export function RasterPanel({ height = 220, windowMs = 2000 }: { height?: number; windowMs?: number }) {
  const app = useApp();
  const info = useAppState((s) => s.info);
  const colors = useAppState((s) => s.regionColors);
  const sel = useAppState((s) => s.selection.neuron);
  const tick = useTelemetryTick(120);
  const [filter, setFilter] = useState<Set<number> | null>(null);
  const [win, setWin] = useState(windowMs);
  const t = app.telemetry;
  const rowClass = useMemo(() => {
    const cls = app.built?.classOf;
    return (row: number) => (cls ? cls[t.sampleNeurons[row]] : 0);
  }, [app.built, t.sampleNeurons]);
  if (!info) return null;
  const highlight = sel !== null ? t.sampleNeurons.indexOf(sel) : null;
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6, alignItems: 'center' }}>
        <button type="button" className={`chip ${filter === null ? 'chip--cyan' : ''}`} onClick={() => setFilter(null)}>All regions</button>
        {info.regions.map((r, i) => (
          <button type="button" key={r.id} className={`chip ${filter?.has(i) ? 'chip--cyan' : ''}`} onClick={() => {
            const f = new Set(filter ?? []);
            if (f.has(i)) f.delete(i);
            else f.add(i);
            setFilter(f.size ? f : null);
          }}>
            <i className="swatch" style={{ background: colors[i] }} />{r.name}
          </button>
        ))}
        <span style={{ marginLeft: 'auto' }}>
          <Segmented value={win} onChange={setWin} options={[{ value: 500, label: '0.5 s' }, { value: 2000, label: '2 s' }, { value: 10000, label: '10 s' }]} />
        </span>
      </div>
      <RasterChart
        raster={t.raster}
        rows={t.sampleNeurons.length}
        rowRegion={t.sampleRegion}
        rowClass={rowClass}
        regionColors={colors}
        regionNames={info.regions.map((r) => r.name)}
        windowMs={win}
        height={height}
        tick={tick}
        filter={filter}
        highlight={highlight !== null && highlight >= 0 ? highlight : null}
        onPick={(row) => void app.selectNeuron(t.sampleNeurons[row], { focus: true })}
      />
      <p className="hint">Each row is one recorded neuron ({t.sampleNeurons.length} sampled across regions); each mark is one of its spikes. Cyan excitatory, magenta inhibitory. Click a row to select that neuron; drag to inspect a time range.</p>
    </div>
  );
}

export function regionMatrix(app: ReturnType<typeof useApp>, kind: 'events' | 'synapses' | 'weight'): number[][] {
  const info = app.state.info!;
  const n = info.regions.length;
  const m = Array.from({ length: n }, () => new Array(n).fill(0));
  const stats = app.state.projectionStats;
  info.projections.forEach((p, i) => {
    if (kind === 'events') m[p.from][p.to] += app.telemetry.projectionRateSmooth[i] ?? 0;
    else if (kind === 'synapses') m[p.from][p.to] += p.synapses;
    else if (stats) m[p.from][p.to] += stats[i].meanWeight * stats[i].synapses;
  });
  if (kind === 'weight') {
    const counts = Array.from({ length: n }, () => new Array(n).fill(0));
    info.projections.forEach((p) => (counts[p.from][p.to] += p.synapses));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) m[i][j] = counts[i][j] ? m[i][j] / counts[i][j] : 0;
  }
  return m;
}

export function ObservatoryWorkspace() {
  const app = useApp();
  const info = useAppState((s) => s.info);
  const colors = useAppState((s) => s.regionColors);
  const tick = useTelemetryTick(200);
  const hist = useWeightHistogram();
  const [log, setLog] = useState(false);
  if (!info) return null;
  const t = app.telemetry;
  const regionSeries = info.regions.map((r, i) => ({ label: r.name, color: colors[i], ring: t.regionRate[i] }));
  const plastic = info.plastic;
  return (
    <div className="workspace ws-wide">
      <div className="slot slot-left">
        <Panel title="Populations" meta="live" className="grow">
          <RegionList />
        </Panel>
      </div>
      <div className="slot slot-right">
        <Panel title="Observatory" meta="all values measured from the running simulation" className="grow">
          <CoreStats />
          <div style={{ height: 14 }} />
          <div className="chart-grid">
            <ChartCard title="Network firing rate" meta="Hz" legend={<Legend items={[{ label: 'All', color: '#eef6ff' }, { label: 'Excitatory', color: '#38e6ff' }, { label: 'Inhibitory', color: '#ff4fd8' }]} />}
              expanded={<TimeChart t={t.t} tick={tick} height={420} unit="Hz" windowMs={120_000} series={[{ label: 'All', color: '#eef6ff', ring: t.rate }, { label: 'E', color: '#38e6ff', ring: t.excRate }, { label: 'I', color: '#ff4fd8', ring: t.inhRate }]} />}>
              <TimeChart t={t.t} tick={tick} height={120} unit="Hz" series={[{ label: 'All', color: '#eef6ff', ring: t.rate, fill: true }, { label: 'E', color: '#38e6ff', ring: t.excRate }, { label: 'I', color: '#ff4fd8', ring: t.inhRate }]} />
            </ChartCard>
            <ChartCard title="Mean membrane potential" meta="mV" expanded={<TimeChart t={t.t} tick={tick} height={420} unit="mV" windowMs={120_000} yMin={undefined} series={[{ label: 'V̄', color: '#9b7bff', ring: t.vMean }]} />}>
              <TimeChart t={t.t} tick={tick} height={120} unit="mV" yMin={undefined} series={[{ label: 'V̄', color: '#9b7bff', ring: t.vMean, fill: true }]} yFmt={(v) => v.toFixed(1)} />
            </ChartCard>
            <ChartCard title="Regional firing rates" meta="Hz" legend={<Legend items={info.regions.map((r, i) => ({ label: r.name, color: colors[i] }))} />} expanded={<TimeChart t={t.t} tick={tick} height={420} unit="Hz" windowMs={120_000} series={regionSeries} />}>
              <TimeChart t={t.t} tick={tick} height={120} unit="Hz" series={regionSeries} />
            </ChartCard>
            <ChartCard title="Active neurons" meta="fired in window" expanded={<TimeChart t={t.t} tick={tick} height={420} windowMs={120_000} series={[{ label: 'active', color: '#4be3a8', ring: t.active }]} />}>
              <TimeChart t={t.t} tick={tick} height={120} series={[{ label: 'active', color: '#4be3a8', ring: t.active, fill: true }]} />
            </ChartCard>
            <ChartCard title="Synaptic weight distribution" meta={hist ? `${fmt.compact(hist.counted)} synapses${hist.sampled ? ' (strided sample)' : ''}` : ''} legend={<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><Legend items={[{ label: `E · mean ${hist?.meanExcitatory.toFixed(3) ?? '…'}`, color: '#38e6ff' }, { label: `I · mean ${hist?.meanInhibitory.toFixed(3) ?? '…'}`, color: '#ff4fd8' }]} /><button type="button" className={`chip ${log ? 'chip--cyan' : ''}`} onClick={() => setLog(!log)}>log</button></div>}
              expanded={<HistogramChart h={hist} height={420} log={log} />}>
              <HistogramChart h={hist} height={120} log={log} />
            </ChartCard>
            <ChartCard title="Synchrony χ" meta="0 independent · 1 identical" expanded={<TimeChart t={t.t} tick={tick} height={420} windowMs={120_000} yMin={0} series={[{ label: 'χ', color: '#c08cff', ring: t.synchrony }]} />}>
              <TimeChart t={t.t} tick={tick} height={120} yMin={0} series={[{ label: 'χ', color: '#c08cff', ring: t.synchrony, fill: true }]} />
            </ChartCard>
            <ChartCard title="Region-to-region signalling" meta="synaptic events / s">
              <MatrixChart values={regionMatrix(app, 'events')} labels={info.regions.map((r) => r.name)} colors={colors} height={200} unit="events/s" onPick={(a) => app.selectRegion(a, true)} />
            </ChartCard>
            <ChartCard title="Plasticity" meta={plastic ? 'Σ |Δw| per window' : 'no plastic pathways'} legend={<Legend items={[{ label: 'Potentiation', color: '#4be3a8' }, { label: 'Depression', color: '#ff6b7d' }, { label: 'Modulator', color: '#ffb547' }]} />}
              expanded={<TimeChart t={t.t} tick={tick} height={420} windowMs={120_000} series={[{ label: 'LTP', color: '#4be3a8', ring: t.potentiation }, { label: 'LTD', color: '#ff6b7d', ring: t.depression }, { label: 'M', color: '#ffb547', ring: t.modulator }]} />}>
              <TimeChart t={t.t} tick={tick} height={120} series={[{ label: 'LTP', color: '#4be3a8', ring: t.potentiation }, { label: 'LTD', color: '#ff6b7d', ring: t.depression }, { label: 'M', color: '#ffb547', ring: t.modulator }]} />
            </ChartCard>
            {plastic && (
              <ChartCard title="Mean plastic weight" meta="sampled every 2 s">
                <TimeChart t={t.meanWeightT} tick={tick} height={120} windowMs={600_000} series={[{ label: '|w|', color: '#4be3a8', ring: t.meanWeight, fill: true }]} yMin={undefined} />
              </ChartCard>
            )}
            <ChartCard title="Simulation performance" meta="real-time factor · steps/s" legend={<Legend items={[{ label: 'Real-time factor', color: '#38e6ff' }]} />}>
              <TimeChart t={t.perfT} tick={tick} height={120} series={[{ label: 'RTF', color: '#38e6ff', ring: t.rtf, fill: true }]} />
            </ChartCard>
            <div className="card span-2" style={{ gridColumn: '1 / -1' }}>
              <div className="chart__head"><span className="label">Spike raster</span><span className="mono dim" style={{ fontSize: 10.5 }}>recorded spikes of sampled neurons</span></div>
              <RasterPanel height={240} />
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
