/**
 * Decides how many simulation steps to run in each worker time slice.
 *
 * The worker runs the engine in short slices (≈8 ms) so it can process messages
 * between them. Each slice is credited with the wall-clock time elapsed since the
 * previous slice, multiplied by the requested speed (simulated ms per wall ms). If
 * the engine cannot keep up, the backlog is capped rather than allowed to grow:
 * the simulation slows down (reported as `lagging`) instead of trying to catch up
 * in a burst that would starve the message loop.
 *
 * The *mathematics* is never changed to keep up — only the rate at which steps run.
 */

export interface SchedulerOptions {
  dtMs: number;
  /** Compute budget per slice, ms. */
  sliceMs?: number;
  /** Largest backlog carried between slices, in wall ms of simulated work. */
  maxBacklogMs?: number;
}

export class StepScheduler {
  dtMs: number;
  /** Simulated ms per wall ms. `Infinity` runs as fast as possible. */
  speed = 1;
  readonly sliceMs: number;
  private readonly maxBacklogMs: number;
  private owed = 0;
  private last = -1;
  /** Moving average of wall ms per step. */
  msPerStep = 0.05;
  lagging = false;

  constructor(opts: SchedulerOptions) {
    this.dtMs = opts.dtMs;
    this.sliceMs = opts.sliceMs ?? 8;
    this.maxBacklogMs = opts.maxBacklogMs ?? 100;
  }

  /** Call when (re)starting so idle time is not credited. */
  start(now: number): void {
    this.last = now;
    this.owed = 0;
    this.lagging = false;
  }

  /** Steps the next slice should aim to run. */
  credit(now: number): number {
    const elapsed = this.last < 0 ? 0 : Math.min(now - this.last, 250);
    this.last = now;
    if (!Number.isFinite(this.speed)) {
      // As fast as possible: as many steps as fit in the slice.
      this.owed = Math.max(1, Math.floor(this.sliceMs / Math.max(this.msPerStep, 1e-4)));
      return this.owed;
    }
    this.owed += (elapsed * this.speed) / this.dtMs;
    const cap = Math.max(1, (this.maxBacklogMs * this.speed) / this.dtMs);
    if (this.owed > cap) {
      this.owed = cap;
    }
    return Math.floor(this.owed);
  }

  /** Steps per engine call so each call takes about `targetMs`. */
  chunk(remaining: number, targetMs = 1): number {
    const n = Math.round(targetMs / Math.max(this.msPerStep, 1e-4));
    return Math.max(1, Math.min(remaining, n, 4000));
  }

  /** Records that `steps` ran in `ms` wall milliseconds. */
  ran(steps: number, ms: number): void {
    if (steps <= 0) return;
    const per = ms / steps;
    this.msPerStep = this.msPerStep * 0.8 + per * 0.2;
    if (Number.isFinite(this.speed)) this.owed = Math.max(0, this.owed - steps);
  }

  /** Called at the end of a slice with the steps still owed. */
  endSlice(): void {
    if (!Number.isFinite(this.speed)) {
      this.lagging = false;
      return;
    }
    // More than one slice of work still owed: the engine is slower than requested.
    const sliceSteps = (this.sliceMs * this.speed) / this.dtMs;
    this.lagging = this.owed > Math.max(2, sliceSteps * 1.5);
  }

  get pending(): number {
    return this.owed;
  }
}
