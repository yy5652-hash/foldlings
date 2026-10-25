/** Timing for one hand-held fold, independent of rendering and input devices. */
export type HandAction = 'keep' | 'end' | 'freeze' | 'resume' | 'cancel';

export class HandGrace {
  private active = false;
  private pinching = false;
  private released = 0;
  private lost = -1;

  begin() {
    this.active = true;
    this.pinching = true;
    this.released = 0;
    this.lost = -1;
  }

  reset() {
    this.active = false;
    this.pinching = false;
    this.released = 0;
    this.lost = -1;
  }

  get frozen(): boolean {
    return this.active && this.lost >= 0;
  }

  get pendingRelease(): boolean {
    return this.active && !this.pinching;
  }

  pinchEnded(): HandAction {
    if (this.pinching) this.released = 0;
    this.pinching = false;
    return this.frozen ? 'freeze' : 'keep';
  }

  pinchStarted(): HandAction {
    this.pinching = true;
    this.released = 0;
    return this.frozen ? 'freeze' : 'keep';
  }

  trackingLost(): HandAction {
    if (!this.active) return 'keep';
    if (this.lost < 0) this.lost = 0;
    return 'freeze';
  }

  trackingFound(pinching = this.pinching): HandAction {
    if (!this.frozen) return 'keep';
    if (!pinching) {
      this.reset();
      return 'cancel';
    }
    this.pinching = true;
    this.released = 0;
    this.lost = -1;
    return 'resume';
  }

  update(dt: number): HandAction {
    if (!this.active) return 'keep';
    if (this.frozen) {
      this.lost += dt;
      if (this.lost < 1) return 'freeze';
      this.reset();
      return 'cancel';
    }
    if (!this.pinching) {
      this.released += dt;
      if (this.released >= 0.25) {
        this.reset();
        return 'end';
      }
    }
    return 'keep';
  }
}

/** One reminder per absence, only while an immersive level is in progress. */
export class HandsMissing {
  private sessionTime = 0;
  private absentTime = 0;
  private prompted = false;

  reset() {
    this.sessionTime = 0;
    this.absentTime = 0;
    this.prompted = false;
  }

  update(dt: number, immersive: boolean, tracked: boolean, inProgress: boolean): boolean {
    if (!immersive) {
      this.reset();
      return false;
    }
    this.sessionTime += dt;
    if (tracked) {
      this.absentTime = 0;
      this.prompted = false;
      return false;
    }
    this.absentTime += dt;
    if (!inProgress || this.sessionTime < 2 || this.absentTime <= 3 || this.prompted) return false;
    this.prompted = true;
    return true;
  }
}
