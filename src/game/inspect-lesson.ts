/** Only deliberate hand turns and pulls complete the first inspection. */
export class InspectLesson {
  private turn = 0;
  private pulled = false;
  private completeTime = 0;

  update(dt: number, turn: number, pull: number): boolean {
    this.turn += Math.abs(turn);
    this.pulled ||= pull >= 0.25;
    if (this.turn >= 0.3 && this.pulled) this.completeTime += dt;
    return this.completeTime >= 2;
  }
}
