import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AppController } from './AppController.ts';
import type { AppState } from './state.ts';
import { useStore } from './store.ts';

const Ctx = createContext<AppController | null>(null);

export function AppProvider({ app, children }: { app: AppController; children: ReactNode }) {
  return <Ctx.Provider value={app}>{children}</Ctx.Provider>;
}

export function useApp(): AppController {
  const app = useContext(Ctx);
  if (!app) throw new Error('AppProvider missing');
  return app;
}

export function useAppState<S>(selector: (s: AppState) => S): S {
  return useStore(useApp().store, selector);
}

/**
 * Re-renders at most every `ms` when telemetry arrives. Charts and readouts use
 * this so high-frequency data never floods React.
 */
export function useTelemetryTick(ms = 250): number {
  const app = useApp();
  const [v, setV] = useState(0);
  useEffect(() => {
    let last = 0;
    let timer = 0;
    const un = app.telemetry.subscribe(() => {
      const now = performance.now();
      if (now - last >= ms) {
        last = now;
        setV(app.telemetry.version);
      } else if (!timer) {
        timer = window.setTimeout(() => {
          timer = 0;
          last = performance.now();
          setV(app.telemetry.version);
        }, ms - (now - last));
      }
    });
    return () => {
      un();
      window.clearTimeout(timer);
    };
  }, [app, ms]);
  return v;
}
