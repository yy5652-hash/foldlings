/** Visibility transition decisions, with time measured in seconds. */
export class Pause {
  private pausedAt: number | null = null;

  transition(wasVisible: boolean, visible: boolean, now: number): 'pause' | 'resume' | 'remind' | 'keep' {
    if (wasVisible === visible) return 'keep';
    if (!visible) {
      this.pausedAt = now;
      return 'pause';
    }
    const elapsed = this.pausedAt === null ? 0 : now - this.pausedAt;
    this.pausedAt = null;
    return elapsed > 5 ? 'remind' : 'resume';
  }
}
