import type { BakedOrigami } from './data.js';

/** A face-hinge tree. All scratch storage belongs to the instance. */
export class FoldUp {
  private matrices: Float64Array;
  private local = new Float64Array(12);
  private sums: Float64Array;
  private counts: Uint16Array;
  private axes: Float64Array;

  private data: BakedOrigami;

  constructor(data: BakedOrigami) {
    this.data = data;
    this.matrices = new Float64Array(data.faces.length * 12);
    this.sums = new Float64Array(data.positions.length * 3);
    this.counts = new Uint16Array(data.positions.length);
    this.axes = new Float64Array(data.tree.length * 3);
    data.faces.forEach(f => f.vertices.forEach(v => this.counts[v]++));
    data.tree.forEach((node, i) => {
      if (node.parent < 0) return;
      const a = data.sheetPositions[node.a], b = data.sheetPositions[node.b];
      const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
      this.axes[i * 3] = (b[0] - a[0]) / length;
      this.axes[i * 3 + 2] = (b[2] - a[2]) / length;
    });
  }

  private rotation(x: number, y: number, z: number, angle: number) {
    const c = Math.cos(angle), s = Math.sin(angle), d = 1 - c, m = this.local;
    m[0] = c + x * x * d; m[1] = x * y * d - z * s; m[2] = x * z * d + y * s;
    m[4] = y * x * d + z * s; m[5] = c + y * y * d; m[6] = y * z * d - x * s;
    m[8] = z * x * d - y * s; m[9] = z * y * d + x * s; m[10] = c + z * z * d;
  }

  /** Writes model-space positions. Shared vertices are averaged, including cycles. */
  apply(t: number, out: Float32Array): void {
    const data = this.data, m = this.matrices, local = this.local;
    const time = Math.max(0, Math.min(1, t)) * data.stages;
    this.sums.fill(0);
    for (let i = 0; i < data.tree.length; i++) {
      const node = data.tree[i], offset = node.face * 12;
      let progress = Math.max(0, Math.min(1, time - node.stage + 1));
      progress *= progress * (3 - 2 * progress);
      if (node.parent < 0) {
        const r = data.rootRotation;
        this.rotation(r[0], r[1], r[2], r[3] * progress);
        local[3] = data.rootTranslation[0] * progress;
        local[7] = data.rootTranslation[1] * progress;
        local[11] = data.rootTranslation[2] * progress;
        for (let j = 0; j < 12; j++) m[offset + j] = local[j];
      } else {
        this.rotation(this.axes[i * 3], this.axes[i * 3 + 1], this.axes[i * 3 + 2], node.angle * progress);
        const p = data.sheetPositions[node.a];
        local[3] = p[0] - local[0] * p[0] - local[2] * p[2];
        local[7] = -local[4] * p[0] - local[6] * p[2];
        local[11] = p[2] - local[8] * p[0] - local[10] * p[2];
        const parent = node.parent * 12;
        for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
          m[offset + row * 4 + col] = m[parent + row * 4] * local[col] + m[parent + row * 4 + 1] * local[4 + col] + m[parent + row * 4 + 2] * local[8 + col] + (col === 3 ? m[parent + row * 4 + 3] : 0);
        }
      }
      const face = data.faces[node.face];
      for (let j = 0; j < face.vertices.length; j++) {
        const v = face.vertices[j], p = data.sheetPositions[v];
        for (let k = 0; k < 3; k++) this.sums[v * 3 + k] += m[offset + k * 4] * p[0] + m[offset + k * 4 + 2] * p[2] + m[offset + k * 4 + 3];
      }
    }
    // Relaxed faces need a final correction beyond the rigid hinge tree.
    let settle = Math.max(0, Math.min(1, time - data.stages + 1));
    settle *= settle * (3 - 2 * settle);
    for (let i = 0; i < this.counts.length; i++) for (let k = 0; k < 3; k++) {
      const rigid = time >= data.stages - 1 ? data.flatPositions[i][k] : this.sums[i * 3 + k] / this.counts[i];
      out[i * 3 + k] = rigid + (data.positions[i][k] - rigid) * settle;
    }
  }
}
