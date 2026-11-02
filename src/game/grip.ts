/** Thumb-index gap below which an approaching hand takes hold. Tune on a headset. */
const ENGAGE = 0.03;
/** How far past its starting gap the hand must open to let go. */
const RELEASE = 0.02;

/** Gap-based grip with a release threshold relative to the initial grab. */
export class Grip {
  private previous = NaN;
  private armed = false;
  private grabGap = -1;

  get held(): boolean {
    return this.grabGap >= 0;
  }

  reset() {
    this.previous = NaN;
    this.armed = false;
    this.grabGap = -1;
  }

  update(gap: number, near: boolean): 'engage' | 'release' | undefined {
    const closing = gap < this.previous;
    this.previous = gap;
    if (this.held) {
      if (gap >= this.grabGap + RELEASE) {
        this.grabGap = -1;
        this.armed = gap >= ENGAGE;
        return 'release';
      }
      return;
    }
    if (!near) this.armed = false;
    else if (gap >= ENGAGE) this.armed = true;
    if (near && this.armed && closing && gap < ENGAGE) {
      this.grabGap = gap;
      this.armed = false;
      return 'engage';
    }
  }
}
