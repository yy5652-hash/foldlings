/** Adaptive low-pass filter: quiet at rest, responsive during a stroke. */
export class OneEuro {
  private value = 0;
  private raw = 0;
  private derivative = 0;
  private ready = false;

  constructor(private minCutoff = 1, private beta = 80, private dCutoff = 3) {}

  reset(value: number) {
    this.value = this.raw = value;
    this.derivative = 0;
    this.ready = true;
  }

  filter(value: number, dt: number): number {
    if (!this.ready) this.reset(value);
    if (dt <= 0) return this.value;
    const da = 1 / (1 + 1 / (2 * Math.PI * this.dCutoff * dt));
    this.derivative += da * ((value - this.raw) / dt - this.derivative);
    this.raw = value;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative);
    const a = 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    this.value += a * (value - this.value);
    return this.value;
  }
}
