/**
 * A minimal observable store. Components select slices with `useStore`, so a
 * telemetry update re-renders only what reads the changed values.
 */

import { useCallback, useRef, useSyncExternalStore } from 'react';

export class Store<T extends object> {
  private state: T;
  private listeners = new Set<() => void>();

  constructor(initial: T) {
    this.state = initial;
  }

  get = (): T => this.state;

  set(patch: Partial<T> | ((s: T) => Partial<T>)): void {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    let changed = false;
    for (const k of Object.keys(p) as (keyof T)[]) {
      if (!Object.is(this.state[k], p[k])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
}

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

export function useStore<T extends object, S>(store: Store<T>, selector: (s: T) => S, equal: (a: S, b: S) => boolean = shallowEqual): S {
  const last = useRef<{ s: T; v: S } | null>(null);
  const get = useCallback(() => {
    const s = store.get();
    if (last.current && last.current.s === s) return last.current.v;
    const v = selector(s);
    if (last.current && equal(last.current.v, v)) {
      last.current = { s, v: last.current.v };
      return last.current.v;
    }
    last.current = { s, v };
    return v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, selector]);
  return useSyncExternalStore(store.subscribe, get, get);
}
