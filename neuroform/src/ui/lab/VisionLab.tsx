/** Vision Lab: teach the network to recognise photos by reward and punishment. */
import { useRef, useState, type DragEvent } from 'react';
import { useApp, useAppState } from '../../app/context.tsx';
import { useStore } from '../../app/store.ts';
import { MAX_CLASSES, MIN_PHOTOS, splitPhotos, type TrialView, type VisionState } from '../../app/VisionService.ts';
import { Icon } from '../icons.tsx';
import { Meter, Panel, Section, Segmented, Select, Stat } from '../primitives.tsx';
import { XYChart } from '../charts/charts.tsx';

const CLASS_COLORS = ['#ff6b6b', '#3ee6c1', '#ffb547', '#b48cff'];
const THUMBS = 15;

function useVision(): VisionState {
  const app = useApp();
  return useStore(app.vision.store, (s) => s);
}

function FilePick({ label, folder, onFiles, disabled, primary }: { label: string; folder?: boolean; onFiles: (f: FileList) => void; disabled?: boolean; primary?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={`btn btn--sm ${primary ? 'btn--primary' : ''}`} disabled={disabled} onClick={() => ref.current?.click()}>
        {Icon.upload({ width: 12 })} {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple={!folder}
        style={{ display: 'none' }}
        {...(folder ? ({ webkitdirectory: '', directory: '' } as Record<string, string>) : {})}
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </>
  );
}

function ClassCard({ k }: { k: number }) {
  const app = useApp();
  const v = useVision();
  const c = v.classes[k];
  const [over, setOver] = useState(false);
  const { train, test } = splitPhotos(c);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) void app.vision.addPhotos(k, e.dataTransfer.files);
  };
  return (
    <div
      className={`card vision-class ${over ? 'is-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <div className="vision-class__head">
        <i className="swatch" style={{ background: CLASS_COLORS[k] }} />
        <input className="input" value={c.name} aria-label={`Name of class ${k + 1}`} placeholder="e.g. Apple" onChange={(e) => app.vision.setClassName(k, e.target.value)} disabled={!!v.busy} />
        {v.classes.length > 2 && (
          <button type="button" className="icon-btn" aria-label={`Remove ${c.name}`} title="Remove this class" disabled={!!v.busy} onClick={() => app.vision.removeClass(k)}>{Icon.close({ width: 12 })}</button>
        )}
      </div>
      <div className="dim" style={{ fontSize: 11, margin: '6px 0' }}>
        {c.photos.length ? `${c.photos.length} photos · ${train.length} to train on, ${test.length} kept back for testing` : `Drop photos here, or add them below (at least ${MIN_PHOTOS}).`}
      </div>
      {c.photos.length > 0 && (
        <div className="vision-thumbs">
          {c.photos.slice(0, THUMBS).map((p) => (
            <button key={p.id} type="button" className="vision-thumb" title={`${p.name} — click to remove`} onClick={() => app.vision.removePhoto(k, p.id)} disabled={!!v.busy}>
              <img src={p.thumb} alt={p.name} />
            </button>
          ))}
          {c.photos.length > THUMBS && <span className="vision-more">+{c.photos.length - THUMBS}</span>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <FilePick label="Add photos" onFiles={(f) => void app.vision.addPhotos(k, f)} disabled={!!v.busy} />
        <FilePick label="Add a folder" folder onFiles={(f) => void app.vision.addPhotos(k, f)} disabled={!!v.busy} />
        {c.photos.length > 0 && <button type="button" className="btn btn--sm" disabled={!!v.busy} onClick={() => app.vision.clearPhotos(k)}>Clear</button>}
      </div>
    </div>
  );
}

export function VisionSetupPanel() {
  const app = useApp();
  const v = useVision();
  useAppState((s) => s.info);
  useAppState((s) => s.config);
  const ready = app.vision.networkMatches();
  const problems = app.vision.problems();
  const training = v.busy === 'training' || v.busy === 'testing';
  return (
    <Panel title="Vision Lab" meta="teach it to recognise photos" className="grow">
      <p className="hint" style={{ marginTop: 0, color: 'var(--text-2)' }}>
        Show the network photos of different things. It answers by which group of neurons fires most; a right answer is rewarded and a wrong one punished, and its connections change accordingly. Photos stay on this device.
      </p>
      <Section label="What should it recognise?" actions={v.classes.length < MAX_CLASSES ? <button type="button" className="btn btn--sm" disabled={!!v.busy} onClick={() => app.vision.addClass()}>{Icon.plus({ width: 11 })} Add a class</button> : undefined}>
        {v.classes.map((_, k) => <ClassCard key={k} k={k} />)}
      </Section>
      <Section label="Vision network" hint={ready ? 'Built with one answer group per class. Rebuilding starts learning from scratch.' : 'A retina with red, green and blue cones, a visual cortex, and one answer group per class (3,000 neurons).'}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={`chip ${ready ? 'chip--ok' : 'chip--amber'}`}>{ready ? 'Ready' : 'Not built'}</span>
          <button type="button" className={`btn btn--sm ${ready ? '' : 'btn--primary'}`} disabled={!!v.busy} onClick={() => void app.vision.buildNetwork()}>
            {Icon.brain({ width: 12 })} {ready ? 'Rebuild' : 'Build vision network'}
          </button>
        </div>
      </Section>
      <Section label="Training">
        <div className="field__row">
          <span className="field__label">Passes over the photos</span>
          <Select value={v.epochs} onChange={(epochs) => app.vision.store.set({ epochs })} options={[1, 3, 5, 10, 20].map((n) => ({ value: n, label: String(n) }))} />
        </div>
        <div className="field__row" style={{ marginTop: 6 }}>
          <span className="field__label">Pace</span>
          <Segmented value={v.pace} onChange={(pace) => app.vision.store.set({ pace })} options={[{ value: 'fast', label: 'Fast' }, { value: 'watch', label: 'Watch each photo' }]} />
        </div>
        {problems.length > 0 && <ul className="hint vision-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {training ? (
            <button type="button" className="btn btn--danger btn--block" onClick={() => app.vision.stop()}>{Icon.stop({ width: 12 })} Stop</button>
          ) : (
            <>
              <button type="button" className="btn btn--primary btn--block" disabled={!!v.busy || problems.length > 0} onClick={() => void app.vision.train()}>{Icon.reward({ width: 13 })} Train</button>
              <button type="button" className="btn btn--block" disabled={!!v.busy || problems.length > 0} onClick={() => void app.vision.test()}>{Icon.target({ width: 13 })} Test</button>
            </>
          )}
        </div>
        {v.progress && (
          <div style={{ marginTop: 10 }}>
            <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>{v.progress.label} · {v.progress.done} / {v.progress.total}</div>
            <Meter value={v.progress.done} max={v.progress.total} />
          </div>
        )}
        {v.message && <p className="hint" style={{ color: 'var(--amber)' }}>{v.message}</p>}
      </Section>
      <Section label="Try a new photo" hint="Shows it one photo and reports its answer, without learning from it.">
        <FilePick label="Choose a photo" onFiles={(f) => void app.vision.classify(f[0])} disabled={!!v.busy || !ready} primary={ready && v.trained > 0} />
      </Section>
    </Panel>
  );
}

function Answer({ t, classes }: { t: TrialView; classes: VisionState['classes'] }) {
  const max = Math.max(1e-9, ...t.scores);
  const name = (k: number) => classes[k]?.name || `Class ${k + 1}`;
  return (
    <div className="card vision-answer">
      <div className="vision-answer__images">
        <figure>
          <img src={t.photo.thumb} alt={t.photo.name} />
          <figcaption>Photo</figcaption>
        </figure>
        <figure>
          <img src={t.photo.retina} alt="What the retina receives" className="pixelated" />
          <figcaption>What its retina gets</figcaption>
        </figure>
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="vision-answer__verdict">
          {t.guess >= 0 ? <>Answer: <strong style={{ color: CLASS_COLORS[t.guess] }}>{name(t.guess)}</strong></> : <>No clear answer</>}
          {t.correct === true && <span className="chip chip--ok">right{t.delivered > 0 ? ' · rewarded' : ''}</span>}
          {t.correct === false && <span className="chip chip--danger">wrong{t.delivered < 0 ? ' · punished' : ''}{t.label !== null ? ` · was ${name(t.label)}` : ''}</span>}
        </div>
        {t.scores.map((s, k) => (
          <div key={k} className="vision-bar">
            <span>{name(k)}</span>
            <Meter value={s} max={max} color={CLASS_COLORS[k]} />
          </div>
        ))}
        <div className="dim" style={{ fontSize: 10.5, marginTop: 4 }}>Bars: how strongly each answer group responded, relative to its usual response.</div>
      </div>
    </div>
  );
}

export function VisionProgressPanel() {
  const v = useVision();
  const n = v.classes.length;
  const chance = 1 / n;
  const lastTest = v.tests.at(-1)?.accuracy ?? null;
  const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
  return (
    <Panel title="Learning progress" meta="vision" className="grow">
      <div className="stat-grid">
        <Stat label="Photos trained on" value={v.trained.toLocaleString('en-GB')} size="sm" />
        <Stat label="Test accuracy" value={pct(lastTest)} note={`on unseen photos · chance ${pct(chance)}`} size="sm" color={lastTest !== null && lastTest > chance + 0.1 ? 'var(--ok)' : undefined} />
        <Stat label="Expects to be right" value={pct((v.expected + 1) / 2)} note="its reward prediction" size="sm" />
      </div>
      {v.tried && (
        <Section label="Your photo">
          <Answer t={v.tried} classes={v.classes} />
        </Section>
      )}
      {v.last && v.last !== v.tried && (
        <Section label={v.busy === 'testing' ? 'Testing' : 'Latest photo'}>
          <Answer t={v.last} classes={v.classes} />
        </Section>
      )}
      {v.history.length > 1 && (
        <Section label="Accuracy while training" hint="Share of the last 20 training photos it got right.">
          <XYChart x={v.history.map((h) => h.trial)} series={[{ name: 'Training', values: v.history.map((h) => h.accuracy * 100), color: '#38e6ff' }, { name: 'Chance', values: v.history.map(() => chance * 100), color: '#5a6478' }]} height={130} xLabel="photos trained on" yLabel="% right" />
        </Section>
      )}
      {v.tests.length > 0 && (
        <Section label="Test accuracy after each pass" hint="Photos kept back from training, so this measures recognition, not memory.">
          <XYChart x={v.tests.map((_, i) => i + 1)} series={[{ name: 'Test', values: v.tests.map((t) => t.accuracy * 100), color: '#3ee6c1' }]} kind="bar" height={110} xLabel="pass" yLabel="% right" xTicks={v.tests.map((_, i) => String(i + 1))} />
        </Section>
      )}
      {v.confusion && (
        <Section label="Last test, answer by answer">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Photo of</th>{v.classes.map((c, k) => <th key={k}>said {c.name}</th>)}<th>no answer</th></tr>
              </thead>
              <tbody>
                {v.confusion.map((row, k) => (
                  <tr key={k}>
                    <td className="text">{v.classes[k]?.name}</td>
                    {row.map((x, j) => <td key={j} style={j === k && x > 0 ? { color: 'var(--ok)' } : undefined}>{x}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      <Section label="What to expect">
        <p className="hint">It sees each photo as 16×16 coloured pixels, so it learns mostly from colour and rough shape. Things that look clearly different (bananas and apples, say) reached 85–98% on unseen photos in our tests; things that look alike (apples and tomatoes) only about 55–65%, where chance is 50%. More photos and more passes help; a few hundred per class is a good start.</p>
        <p className="hint">Watch the brain while it trains: the cone mosaics on the left light up in the pattern of each photo.</p>
      </Section>
    </Panel>
  );
}
