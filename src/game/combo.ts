/** Session-only campaign streak. Best is persisted separately in progress. */
export class Combo {
  private streak = 0;
  get value(): number { return this.streak; }
  break(): void { this.streak = 0; }
  solve(moves: number, par: number, hinted: boolean): number {
    this.streak = !hinted && moves <= par ? Math.min(5, this.streak + 1) : 0;
    return this.streak;
  }
}
