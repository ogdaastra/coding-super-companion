/**
 * Main-thread handle on the simulation worker.
 *
 * A typed request/response API over `postMessage`, plus event subscriptions. The
 * rest of the application talks to the simulation only through this class (or the
 * `SimulationBackend` interface it implements), so a different backend — for
 * example a native engine in a desktop shell — can be substituted without touching
 * the interface or the renderer.
 */

import type {
  FrameEvent,
  FrameRequest,
  RequestType,
  Requests,
  SimStatus,
  TelemetryEvent,
  WorkerEvent,
  BenchmarkResult,
} from './protocol.ts';

export interface SimulationBackend {
  request<K extends RequestType>(type: K, payload: Requests[K]['req'], transfer?: Transferable[]): Promise<Requests[K]['res']>;
  requestFrame(opts: { membrane: boolean; rates: boolean; recycle?: ArrayBuffer[] }): void;
  on<E extends ClientEventName>(event: E, fn: (e: ClientEvents[E]) => void): () => void;
  readonly status: SimStatus;
  terminate(): void;
}

export interface ClientEvents {
  status: { status: SimStatus; detail?: string };
  progress: { phase: string; progress: number; detail: string };
  telemetry: TelemetryEvent;
  frame: FrameEvent;
  fatal: { error: string };
  benchmark: BenchmarkResult;
  crash: { error: string };
}
export type ClientEventName = keyof ClientEvents;

export class RequestError extends Error {
  readonly path: string | undefined;
  constructor(message: string, path?: string) {
    super(message);
    this.name = 'RequestError';
    this.path = path;
  }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; type: string };

export class SimulationClient implements SimulationBackend {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Map<ClientEventName, Set<(e: never) => void>>();
  private frameInFlight = false;
  status: SimStatus = 'booting';

  constructor(factory: () => Worker) {
    this.worker = factory();
    this.worker.onmessage = (ev: MessageEvent<WorkerEvent>) => this.onMessage(ev.data);
    this.worker.onerror = (ev) => {
      ev.preventDefault();
      this.crash(ev.message || 'The simulation worker failed to start.');
    };
    this.worker.onmessageerror = () => this.crash('A message from the simulation worker could not be read.');
  }

  private crash(error: string): void {
    this.status = 'error';
    for (const p of this.pending.values()) p.reject(new RequestError(error));
    this.pending.clear();
    this.emit('crash', { error });
    this.emit('status', { status: 'error', detail: error });
  }

  private onMessage(e: WorkerEvent): void {
    switch (e.type) {
      case 'reply': {
        const p = this.pending.get(e.id);
        if (!p) return;
        this.pending.delete(e.id);
        if (e.ok) p.resolve(e.value);
        else p.reject(new RequestError(e.error, e.path));
        return;
      }
      case 'status':
        this.status = e.status;
        this.emit('status', { status: e.status, detail: e.detail });
        return;
      case 'progress':
        this.emit('progress', e);
        return;
      case 'telemetry':
        this.emit('telemetry', e);
        return;
      case 'frame':
        this.frameInFlight = false;
        this.emit('frame', e);
        return;
      case 'fatal':
        this.emit('fatal', { error: e.error });
        return;
      case 'benchmark':
        this.emit('benchmark', e.result);
        return;
    }
  }

  request<K extends RequestType>(type: K, payload: Requests[K]['req'], transfer: Transferable[] = []): Promise<Requests[K]['res']> {
    const id = this.nextId++;
    return new Promise<Requests[K]['res']>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, type });
      this.worker.postMessage({ id, type, ...payload }, transfer);
    });
  }

  /** Asks for the spikes since the last frame. At most one request is in flight. */
  requestFrame(opts: { membrane: boolean; rates: boolean; recycle?: ArrayBuffer[] }): void {
    if (this.frameInFlight) return;
    this.frameInFlight = true;
    const recycle = opts.recycle ?? [];
    const msg: FrameRequest = { type: 'frame', membrane: opts.membrane, rates: opts.rates, recycle };
    this.worker.postMessage(msg, recycle);
  }

  on<E extends ClientEventName>(event: E, fn: (e: ClientEvents[E]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as (e: never) => void);
    return () => set!.delete(fn as (e: never) => void);
  }

  private emit<E extends ClientEventName>(event: E, payload: ClientEvents[E]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) (fn as (e: ClientEvents[E]) => void)(payload);
  }

  terminate(): void {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new RequestError('The simulation worker was stopped.'));
    this.pending.clear();
  }
}
