/**
 * Keeps the frame rate. If a session cannot hold its target for a few seconds,
 * the costliest extra is given up, one step at a time; it never comes back
 * within the session, so the picture does not keep changing under the player.
 */

export const QUALITY_TARGET_FPS = 65;
const WINDOW = 2.5;
const SETTLE = 6;

export class QualityGuard {
  /** 0 is full quality; each step down is one more thing given up. */
  level = 0;
  private settle = SETTLE;
  private time = 0;
  private frames = 0;

  constructor(private maxLevel = 2) {}

  /** Feed each frame's delta; returns true when the level has just dropped. */
  update(dt: number): boolean {
    if (this.level >= this.maxLevel) return false;
    // Long gaps are the app in the background, not a slow frame rate.
    if (dt > 0.25) {
      this.time = this.frames = 0;
      return false;
    }
    if (this.settle > 0) {
      this.settle -= dt;
      return false;
    }
    this.time += dt;
    this.frames++;
    if (this.time < WINDOW) return false;
    const fps = this.frames / this.time;
    this.time = this.frames = 0;
    if (fps >= QUALITY_TARGET_FPS) return false;
    this.level++;
    this.settle = SETTLE / 2;
    return true;
  }

  reset() {
    this.level = 0;
    this.settle = SETTLE;
    this.time = this.frames = 0;
  }
}
