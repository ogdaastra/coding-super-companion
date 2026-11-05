/**
 * Camera navigation: damped orbit, free flight, smooth focus transitions and an
 * automatic cinematic tour. All motion is critically-damped interpolation toward a
 * goal state, so every transition (clicks, keys, focus, mode changes) is smooth.
 */

import { PerspectiveCamera, Vector3 } from 'three/webgpu';

export interface Waypoint {
  target: [number, number, number];
  distance: number;
  yaw: number;
  pitch: number;
  /** Seconds to hold (with slow drift) before moving on. */
  hold: number;
  label?: string;
}

const TAU = Math.PI * 2;

function approach(current: number, goal: number, k: number, dt: number): number {
  return current + (goal - current) * (1 - Math.exp(-k * dt));
}

function wrapAngle(a: number): number {
  return ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

export class CameraRig {
  readonly camera: PerspectiveCamera;
  mode: 'orbit' | 'fly' = 'orbit';

  readonly target = new Vector3();
  readonly goalTarget = new Vector3();
  distance = 400;
  goalDistance = 400;
  yaw = 0.6;
  goalYaw = 0.6;
  pitch = 0.35;
  goalPitch = 0.35;
  /** Interpolation stiffness; lower is slower and more cinematic. */
  stiffness = 9;
  minDistance = 2;
  maxDistance = 2400;
  autoRotate = 0;

  // Free flight.
  private readonly flyVelocity = new Vector3();
  private readonly keys = new Set<string>();
  flySpeed = 60;

  // Cinematic tour.
  private tour: Waypoint[] | null = null;
  private tourIndex = 0;
  private tourClock = 0;
  onTourWaypoint: ((w: Waypoint | null) => void) | null = null;

  private readonly tmp = new Vector3();
  private readonly fwd = new Vector3();
  private readonly right = new Vector3();

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(48, aspect, 0.5, 8000);
    this.apply();
  }

  get touring(): boolean {
    return this.tour !== null;
  }

  // ------------------------------------------------------------------ input

  orbitBy(dxPx: number, dyPx: number): void {
    this.stopTour();
    if (this.mode === 'fly') {
      this.goalYaw -= dxPx * 0.0035;
      this.goalPitch = Math.max(-1.5, Math.min(1.5, this.goalPitch - dyPx * 0.0035));
      return;
    }
    this.goalYaw -= dxPx * 0.006;
    this.goalPitch = Math.max(-1.45, Math.min(1.45, this.goalPitch + dyPx * 0.006));
    this.stiffness = 12;
  }

  panBy(dxPx: number, dyPx: number, viewportHeight: number): void {
    this.stopTour();
    const scale = (2 * this.distance * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.max(1, viewportHeight);
    this.camera.getWorldDirection(this.fwd);
    this.right.crossVectors(this.fwd, this.camera.up).normalize();
    const up = this.tmp.crossVectors(this.right, this.fwd).normalize();
    this.goalTarget.addScaledVector(this.right, -dxPx * scale).addScaledVector(up, dyPx * scale);
    if (this.mode === 'orbit') this.target.copy(this.goalTarget);
    this.stiffness = 14;
  }

  /** Positive `delta` zooms out. */
  zoomBy(delta: number): void {
    this.stopTour();
    if (this.mode === 'fly') {
      this.camera.getWorldDirection(this.fwd);
      this.flyVelocity.addScaledVector(this.fwd, -delta * this.flySpeed * 0.02);
      return;
    }
    const f = Math.exp(delta * 0.0012);
    this.goalDistance = Math.max(this.minDistance, Math.min(this.maxDistance, this.goalDistance * f));
    this.stiffness = 10;
  }

  keyDown(code: string): void {
    this.keys.add(code);
    if (this.mode === 'fly') this.stopTour();
  }

  keyUp(code: string): void {
    this.keys.delete(code);
  }

  clearKeys(): void {
    this.keys.clear();
  }

  // ------------------------------------------------------------------ commands

  /** Smoothly brings `point` into view at `distance` (keeps the current angle). */
  focus(point: [number, number, number], distance?: number, slow = true): void {
    this.stopTour();
    if (this.mode === 'fly') this.setMode('orbit');
    this.goalTarget.set(point[0], point[1], point[2]);
    if (distance !== undefined) this.goalDistance = Math.max(this.minDistance, Math.min(this.maxDistance, distance));
    this.stiffness = slow ? 3.2 : 8;
  }

  /** Frames a bounding sphere. */
  frame(center: [number, number, number], radius: number, yaw = 0.65, pitch = 0.32): void {
    this.stopTour();
    if (this.mode === 'fly') this.setMode('orbit');
    this.goalTarget.set(center[0], center[1], center[2]);
    const d = radius / Math.sin((this.camera.fov * Math.PI) / 360) * 1.05;
    this.goalDistance = Math.max(this.minDistance, Math.min(this.maxDistance, d));
    this.goalYaw = this.yaw + wrapAngle(yaw - this.yaw);
    this.goalPitch = pitch;
    this.stiffness = 2.8;
  }

  setMode(mode: 'orbit' | 'fly'): void {
    if (mode === this.mode) return;
    this.camera.getWorldDirection(this.fwd);
    if (mode === 'fly') {
      // Fly from the current pose; yaw/pitch now describe the look direction.
      this.yaw = this.goalYaw = Math.atan2(this.fwd.x, this.fwd.z);
      this.pitch = this.goalPitch = Math.asin(Math.max(-1, Math.min(1, this.fwd.y)));
      this.flyVelocity.set(0, 0, 0);
    } else {
      const d = Math.max(20, this.distance);
      this.goalTarget.copy(this.camera.position).addScaledVector(this.fwd, d);
      this.target.copy(this.goalTarget);
      this.distance = this.goalDistance = d;
      this.yaw = this.goalYaw = Math.atan2(-this.fwd.x, -this.fwd.z);
      this.pitch = this.goalPitch = Math.asin(Math.max(-1, Math.min(1, -this.fwd.y)));
    }
    this.mode = mode;
  }

  startTour(points: Waypoint[]): void {
    if (points.length === 0) return;
    if (this.mode === 'fly') this.setMode('orbit');
    this.tour = points;
    this.tourIndex = 0;
    this.tourClock = 0;
    this.goTo(points[0]);
  }

  stopTour(): void {
    if (this.tour) {
      this.tour = null;
      this.onTourWaypoint?.(null);
    }
  }

  private goTo(w: Waypoint): void {
    this.goalTarget.set(...w.target);
    this.goalDistance = w.distance;
    this.goalYaw = this.yaw + wrapAngle(w.yaw - this.yaw);
    this.goalPitch = w.pitch;
    this.stiffness = 0.9;
    this.onTourWaypoint?.(w);
  }

  // ------------------------------------------------------------------ frame update

  /** Advances the rig. Returns true while the camera is moving. */
  update(dt: number): boolean {
    dt = Math.min(dt, 0.1);
    const before = this.camera.position.clone();
    const beforeQ = this.camera.quaternion.clone();

    if (this.tour) {
      this.tourClock += dt;
      this.goalYaw += dt * 0.05;
      const w = this.tour[this.tourIndex];
      if (this.tourClock > w.hold) {
        this.tourIndex = (this.tourIndex + 1) % this.tour.length;
        this.tourClock = 0;
        this.goTo(this.tour[this.tourIndex]);
      }
    } else if (this.autoRotate !== 0 && this.mode === 'orbit') {
      this.goalYaw += dt * this.autoRotate;
    }

    if (this.mode === 'orbit') {
      const k = this.stiffness;
      this.target.x = approach(this.target.x, this.goalTarget.x, k, dt);
      this.target.y = approach(this.target.y, this.goalTarget.y, k, dt);
      this.target.z = approach(this.target.z, this.goalTarget.z, k, dt);
      this.distance = Math.exp(approach(Math.log(this.distance), Math.log(this.goalDistance), k, dt));
      this.yaw = approach(this.yaw, this.goalYaw, Math.max(k, 6), dt);
      this.pitch = approach(this.pitch, this.goalPitch, Math.max(k, 6), dt);
    } else {
      this.yaw = approach(this.yaw, this.goalYaw, 14, dt);
      this.pitch = approach(this.pitch, this.goalPitch, 14, dt);
      const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 4 : 1;
      const a = this.flySpeed * boost;
      this.fwd.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
      this.right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
      const acc = this.tmp.set(0, 0, 0);
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) acc.add(this.fwd);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) acc.sub(this.fwd);
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) acc.sub(this.right);
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) acc.add(this.right);
      if (this.keys.has('KeyE')) acc.y += 1;
      if (this.keys.has('KeyQ')) acc.y -= 1;
      if (acc.lengthSq() > 0) acc.normalize().multiplyScalar(a);
      this.flyVelocity.x = approach(this.flyVelocity.x, acc.x, 6, dt);
      this.flyVelocity.y = approach(this.flyVelocity.y, acc.y, 6, dt);
      this.flyVelocity.z = approach(this.flyVelocity.z, acc.z, 6, dt);
      this.camera.position.addScaledVector(this.flyVelocity, dt);
    }
    this.apply();
    return before.distanceToSquared(this.camera.position) > 1e-8 || beforeQ.angleTo(this.camera.quaternion) > 1e-6;
  }

  private apply(): void {
    const c = this.camera;
    if (this.mode === 'orbit') {
      const cp = Math.cos(this.pitch);
      c.position.set(
        this.target.x + this.distance * Math.sin(this.yaw) * cp,
        this.target.y + this.distance * Math.sin(this.pitch),
        this.target.z + this.distance * Math.cos(this.yaw) * cp,
      );
      c.lookAt(this.target);
    } else {
      this.fwd.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
      c.lookAt(this.tmp.copy(c.position).add(this.fwd));
    }
    c.updateMatrixWorld();
  }

  /** Orientation for the minimap: camera position and look direction. */
  pose(): { position: [number, number, number]; forward: [number, number, number] } {
    this.camera.getWorldDirection(this.fwd);
    const p = this.camera.position;
    return { position: [p.x, p.y, p.z], forward: [this.fwd.x, this.fwd.y, this.fwd.z] };
  }
}
