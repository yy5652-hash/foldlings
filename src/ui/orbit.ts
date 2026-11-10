/** Camera limits in radians/metres, independent of rendering and input. */
export const ORBIT_LIMITS = {
  yaw: 55 * Math.PI / 180,
  minPitch: 20 * Math.PI / 180,
  maxPitch: 65 * Math.PI / 180,
  minDistance: 0.48,
  maxDistance: 1.8,
} as const;

export function clampYaw(value: number): number {
  return Math.max(-ORBIT_LIMITS.yaw, Math.min(ORBIT_LIMITS.yaw, value));
}

export function clampPitch(value: number): number {
  return Math.max(ORBIT_LIMITS.minPitch, Math.min(ORBIT_LIMITS.maxPitch, value));
}

export function clampDistance(value: number): number {
  return Math.max(ORBIT_LIMITS.minDistance, Math.min(ORBIT_LIMITS.maxDistance, value));
}

const finite = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);

export function damp(current: number, target: number, delta: number): number {
  return current + (target - current) * (1 - Math.exp(-10 * Math.max(0, delta)));
}

/** Mutable scalar state: advance() creates no objects, vectors or callbacks. */
export class Orbit {
  yaw = 0;
  pitch = 40 * Math.PI / 180;
  distance: number;
  targetYaw = this.yaw;
  targetPitch = this.pitch;
  targetDistance: number;
  opening = 0;
  focusY = 0.06;
  focusZ = -0.03;

  constructor(reducedMotion: boolean, aspect = 1) {
    // A canvas that is still 0×0 when the page starts reports a NaN aspect.
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
    this.distance = this.targetDistance = clampDistance(0.86 / Math.min(1, Math.max(0.4, a) / 0.9));
    if (reducedMotion) this.opening = 2.5;
    else { this.focusY = 0.24; this.focusZ = -0.08; }
  }

  /** Stop at the displayed pose so beginning a fold never moves its camera. */
  hold() {
    this.opening = 2.5;
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.targetDistance = this.distance;
  }

  rotate(dx: number, dy: number) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.targetYaw = clampYaw(this.targetYaw - dx * 0.006);
    this.targetPitch = clampPitch(this.targetPitch + dy * 0.006);
  }

  zoom(factor: number) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    this.targetDistance = clampDistance(this.targetDistance * factor);
  }

  advance(delta: number, reducedMotion = false) {
    // A NaN frame time (first frame, hidden tab) would otherwise stick in every field forever.
    delta = finite(delta, 0);
    if (!Number.isFinite(this.yaw + this.pitch + this.distance + this.opening)) {
      this.targetYaw = finite(this.targetYaw, 0);
      this.targetPitch = finite(this.targetPitch, 40 * Math.PI / 180);
      this.targetDistance = finite(this.targetDistance, 0.86);
      this.yaw = this.targetYaw; this.pitch = this.targetPitch; this.distance = this.targetDistance;
      this.opening = 2.5; this.focusY = 0.06; this.focusZ = -0.03;
    }
    if (this.opening < 2.5 && !reducedMotion) {
      this.opening = Math.min(2.5, this.opening + Math.max(0, delta));
      const t = this.opening / 2.5;
      const ease = t * t * (3 - 2 * t);
      this.yaw = (-20 * Math.PI / 180) * (1 - ease);
      this.pitch = ORBIT_LIMITS.maxPitch + (this.targetPitch - ORBIT_LIMITS.maxPitch) * ease;
      this.distance = ORBIT_LIMITS.maxDistance + (this.targetDistance - ORBIT_LIMITS.maxDistance) * ease;
      this.focusY = 0.24 - 0.18 * ease;
      this.focusZ = -0.08 + 0.05 * ease;
      return;
    }
    if (reducedMotion && this.opening < 2.5) {
      this.focusY = 0.06;
      this.focusZ = -0.03;
    }
    this.opening = 2.5;
    this.yaw = reducedMotion ? this.targetYaw : damp(this.yaw, this.targetYaw, delta);
    this.pitch = reducedMotion ? this.targetPitch : damp(this.pitch, this.targetPitch, delta);
    this.distance = reducedMotion ? this.targetDistance : damp(this.distance, this.targetDistance, delta);
  }
}
