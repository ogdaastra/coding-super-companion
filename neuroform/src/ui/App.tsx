import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useAppState } from '../app/context.tsx';
import { Viewport } from './shell/Viewport.tsx';
import { TopBar } from './shell/TopBar.tsx';
import { Dock } from './shell/Dock.tsx';
import { Banners, BuildOverlay, FatalOverlay, Hud, Intro, Toasts } from './shell/Overlays.tsx';
import { CommandPalette, ContextMenu, Minimap, Shortcuts } from './shell/Interaction.tsx';
import { ExplorerWorkspace } from './explorer/ExplorerWorkspace.tsx';
import { ObservatoryWorkspace } from './observatory/ObservatoryWorkspace.tsx';
import { ConnectomeWorkspace } from './connectome/ConnectomeWorkspace.tsx';
import { LaboratoryWorkspace } from './lab/LaboratoryWorkspace.tsx';
import { StudyWorkspace } from './study/StudyWorkspace.tsx';
import { PerformanceWorkspace } from './performance/PerformanceWorkspace.tsx';
import { Dialogs } from './dialogs/Dialogs.tsx';

/** Catches rendering errors in a subtree so one broken panel cannot take down the app. */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label}]`, error, info.componentStack);
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel glass" style={{ padding: 16, maxWidth: 420, pointerEvents: 'auto' }} role="alert">
        <span className="label">{this.props.label} failed</span>
        <p className="hint" style={{ color: 'var(--text-2)' }}>{this.state.error.message}</p>
        <button type="button" className="btn btn--sm" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}

function Workspace() {
  const mode = useAppState((s) => s.mode);
  const ready = useAppState((s) => s.ready);
  if (!ready) return null;
  const view = (() => {
    switch (mode) {
      case 'explorer':
        return <ExplorerWorkspace />;
      case 'observatory':
        return <ObservatoryWorkspace />;
      case 'connectome':
        return <ConnectomeWorkspace />;
      case 'laboratory':
        return <LaboratoryWorkspace />;
      case 'study':
        return <StudyWorkspace />;
      case 'performance':
        return <PerformanceWorkspace />;
    }
  })();
  return (
    <ErrorBoundary key={mode} label={mode}>
      {view}
    </ErrorBoundary>
  );
}

export function App() {
  const reduced = useAppState((s) => s.render.reducedEffects || (s.render.stats?.adaptiveLevel ?? 0) >= 2);
  return (
    <div className={`app ${reduced ? 'reduced-effects' : ''}`}>
      <Viewport />
      <TopBar />
      <Workspace />
      <Hud />
      <Banners />
      <Minimap />
      <Dock />
      <BuildOverlay />
      <ErrorBoundary label="Dialog">
        <Dialogs />
      </ErrorBoundary>
      <CommandPalette />
      <ContextMenu />
      <Toasts />
      <Shortcuts />
      <FatalOverlay />
      <Intro />
    </div>
  );
}
