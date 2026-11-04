// Temporary smoke bootstrap (replaced by the application shell).
import wasmUrl from './engine/generated/neuroform_engine.wasm?url';
import { SimulationClient } from './sim/SimulationClient.ts';
import { BrainView } from './render/BrainView.ts';
import { observatory } from './config/presets.ts';
import { regionColor } from './render/palette.ts';

const root = document.getElementById('root')!;
root.innerHTML = '<canvas id="c" style="position:fixed;inset:0;width:100vw;height:100vh;display:block"></canvas><div id="l" style="position:fixed;inset:0;pointer-events:none"></div><pre id="s" style="position:fixed;left:8px;top:8px;color:#9cf;font:11px monospace;margin:0"></pre>';
const log = (m: string) => { document.getElementById('s')!.textContent += m + '\n'; (window as any).__log = ((window as any).__log ?? '') + m + '\n'; };
const client = new SimulationClient(() => new Worker(new URL('./sim/simulation.worker.ts', import.meta.url), { type: 'module' }));
(async () => {
  try {
    const params = new URLSearchParams(location.search);
    const view = await BrainView.create(document.getElementById('c') as HTMLCanvasElement, document.getElementById('l')!, (params.get('backend') as any) ?? 'auto');
    log('backend ' + view.backend);
    await client.request('init', { wasmUrl });
    const cfg = observatory(Number(params.get('n') ?? 10000), 1);
    const built = await client.request('build', { config: cfg });
    log(`built ${built.info.neurons} neurons ${built.info.synapses} synapses in ${built.buildMs.toFixed(0)} ms`);
    view.setNetwork(built, cfg.regions.map((r, i) => regionColor(r.color, i)));
    view.setSynapseSample(await client.request('sampleSynapses', { budget: 16000, seed: 7 }));
    view.setMode((params.get('mode') as any) ?? 'normal');
    client.on('frame', (f) => view.ingestFrame(f));
    client.on('telemetry', (t) => { (window as any).__t = t.report.timeMs; });
    view.onWantFrame = () => client.requestFrame({ ...view.frameNeeds });
    view.onStats = (s) => { (window as any).__stats = s; };
    await client.request('setSpeed', { speed: Number(params.get('speed') ?? 0.25) });
    await client.request('run', {});
    view.running = true; view.speed = Number(params.get('speed') ?? 0.25);
    (window as any).__ready = true; (window as any).__view = view;
  } catch (e) { log('ERROR ' + (e instanceof Error ? e.stack : String(e))); (window as any).__error = String(e); }
})();
const st = document.createElement('style');
st.textContent = `.region-label{position:absolute;left:0;top:0;font:500 11px Inter,sans-serif;color:#cfe;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap}.region-label__rate{margin-left:8px;color:#7ad;font-family:monospace}`;
document.head.appendChild(st);
