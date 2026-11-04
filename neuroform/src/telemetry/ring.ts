/** Fixed-capacity numeric ring buffer: bounded memory for unbounded streams. */
export class Ring {
  readonly capacity: number;
  private data: Float64Array;
  private head = 0;
  private count = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.data = new Float64Array(capacity);
  }

  push(v: number): void {
    this.data[this.head] = v;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  get length(): number {
    return this.count;
  }

  /** k-th oldest retained value (0 = oldest). */
  at(k: number): number {
    return this.data[(this.head - this.count + k + this.capacity) % this.capacity];
  }

  last(): number {
    return this.count ? this.at(this.count - 1) : NaN;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  toArray(): number[] {
    const out = new Array<number>(this.count);
    for (let k = 0; k < this.count; k++) out[k] = this.at(k);
    return out;
  }
}

/** Ring of (time, value) events stored as parallel arrays (raster, probes). */
export class EventRing {
  readonly capacity: number;
  readonly t: Float64Array;
  readonly a: Uint32Array;
  private head = 0;
  private count = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.t = new Float64Array(capacity);
    this.a = new Uint32Array(capacity);
  }

  push(t: number, a: number): void {
    this.t[this.head] = t;
    this.a[this.head] = a;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  get length(): number {
    return this.count;
  }

  index(k: number): number {
    return (this.head - this.count + k + this.capacity) % this.capacity;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}
