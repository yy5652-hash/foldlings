export interface HitRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** One pinch owns a pull until release; failed pulls return smoothly to rest. */
export class PinchPull {
  progress = 0;
  commit = false;
  active = false;
  private wasOn = false;
  private start = 0;

  constructor(public distance: number, private hit: HitRect) {}

  reset(on = false) {
    this.progress = 0;
    this.commit = this.active = false;
    this.wasOn = on;
  }

  update(on: boolean, x: number, y: number, axis: number, dt: number, inReach = true) {
    this.commit = false;
    if (on && !this.wasOn && inReach && x >= this.hit.minX && x <= this.hit.maxX && y >= this.hit.minY && y <= this.hit.maxY) {
      this.active = true;
      this.start = axis;
    }
    if (this.active) {
      this.progress = Math.max(0, Math.min(1, (axis - this.start) / this.distance));
      if (!on) {
        this.commit = this.progress > 0.5;
        this.active = false;
      }
    } else {
      this.progress *= Math.exp(-18 * dt);
      if (this.progress < 0.001) this.progress = 0;
    }
    this.wasOn = on;
  }
}
