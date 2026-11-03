/** Pure challenge state. Time is active play time, in seconds. */
export function flashPool(levels: readonly { id: string; world: number }[], solved: readonly string[]): number[] {
  const known = levels.flatMap((l, i) => l.world >= 0 && solved.includes(l.id) ? [i] : []);
  return known.length >= 3 ? known : levels.flatMap((l, i) => l.world === 0 ? [i] : []);
}

export class FlashFold {
  remaining = 60;
  score = 0;
  active = true;
  current: number;
  private random: number;
  private bag: number[] = [];
  private pool: number[];

  constructor(pool: readonly number[], seed: number) {
    this.pool = [...new Set(pool)];
    if (!this.pool.length) throw new RangeError('Flash Fold needs a puzzle pool');
    this.random = seed >>> 0;
    this.current = this.draw();
  }

  tick(seconds: number, paused = false): void {
    if (!this.active || paused || !Number.isFinite(seconds) || seconds <= 0) return;
    this.remaining = Math.max(0, this.remaining - seconds);
    if (this.remaining === 0) this.active = false;
  }

  solve(): boolean {
    if (!this.active) return false;
    this.score++;
    this.remaining = Math.min(90, this.remaining + 5);
    this.current = this.draw();
    return true;
  }

  cancel(): void { this.active = false; }

  private draw(): number {
    if (!this.bag.length) {
      this.bag = [...this.pool];
      for (let i = this.bag.length - 1; i > 0; i--) {
        this.random = (Math.imul(1664525, this.random) + 1013904223) >>> 0;
        const j = Math.floor(this.random / 4294967296 * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
      // Avoid an immediate repeat across shuffle bags, when possible.
      const last = this.bag.length - 1;
      if (last > 0 && this.bag[last] === this.current) {
        [this.bag[0], this.bag[last]] = [this.bag[last], this.bag[0]];
      }
    }
    return this.bag.pop()!;
  }
}
