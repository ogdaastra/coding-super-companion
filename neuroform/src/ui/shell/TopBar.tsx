import { useLayoutEffect, useRef, useState } from 'react';
import { useApp, useAppState } from '../../app/context.tsx';
import { APP_MODES } from '../../app/state.ts';
import { Icon } from '../icons.tsx';
import { IconButton, Kbd } from '../primitives.tsx';

export function BrandMark() {
  return (
    <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <radialGradient id="nf-core" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#eef6ff" />
          <stop offset="0.45" stopColor="#38e6ff" />
          <stop offset="1" stopColor="#38e6ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g stroke="#38e6ff" strokeOpacity="0.55" strokeWidth="1">
        <path d="M16 16 6 9M16 16l10.5-6M16 16l-8 9M16 16l9 8M16 16V4" />
      </g>
      <g fill="#9b7bff">
        <circle cx="6" cy="9" r="1.6" />
        <circle cx="26.5" cy="10" r="1.6" />
        <circle cx="8" cy="25" r="1.6" />
        <circle cx="25" cy="24" r="1.6" />
        <circle cx="16" cy="4" r="1.4" />
      </g>
      <circle cx="16" cy="16" r="6.5" fill="url(#nf-core)" />
    </svg>
  );
}

export function TopBar() {
  const app = useApp();
  const mode = useAppState((s) => s.mode);
  const project = useAppState((s) => s.project);
  const fullscreen = useAppState((s) => s.fullscreen);
  const draft = useAppState((s) => s.draft);
  const modesRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const update = () => {
      const el = modesRef.current?.querySelector<HTMLButtonElement>(`button[aria-current='true']`);
      if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [mode]);

  return (
    <header className="topbar">
      <div className="brand">
        <BrandMark />
        <span className="brand__name">NEUROFORM</span>
        <div className="brand__project">
          <button type="button" onClick={() => app.openDialog('projects')} title="Projects, snapshots and recordings">
            {project?.name ?? 'Unsaved brain'}
          </button>
          {draft && <span className="chip chip--amber" title="Structural changes waiting for a rebuild">rebuild pending</span>}
        </div>
      </div>
      <nav className="modes glass" ref={modesRef} aria-label="Application mode">
        <span className="modes__indicator" style={{ left: indicator.left, width: indicator.width }} />
        {APP_MODES.map((m) => (
          <button key={m.id} type="button" aria-current={m.id === mode} onClick={() => app.setMode(m.id)} title={`${m.describe} (${m.key})`}>
            <span className="long">{m.label}</span>
            <span className="short" style={{ display: 'none' }}>{m.label.split(' ').pop()}</span>
          </button>
        ))}
      </nav>
      <div className="topbar__right">
        <button type="button" className="palette-trigger" onClick={() => app.setPalette(true)} aria-label="Command palette">
          {Icon.search({ width: 14, height: 14 })}
          <span>Commands</span>
          <Kbd>⌘K</Kbd>
        </button>
        <IconButton icon={Icon.brain()} label="Brain designer" onClick={() => app.openDialog('designer')} kbd="N" />
        <IconButton icon={Icon.save()} label="Save project" onClick={() => void app.projects.saveProject()} kbd="Ctrl S" />
        <IconButton icon={Icon.download()} label="Import & export" onClick={() => app.openDialog('export')} />
        <IconButton icon={Icon.settings()} label="Settings" onClick={() => app.openDialog('settings')} />
        <IconButton icon={Icon.help()} label="Help & shortcuts" onClick={() => app.openDialog('help')} kbd="?" />
        <IconButton icon={fullscreen ? Icon.collapse() : Icon.expand()} label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={() => void app.toggleFullscreen()} kbd="F" />
      </div>
    </header>
  );
}
