import type { PatternGraph } from './pattern.js';
import type { Position } from './relax.js';

interface Row { ids: number[]; values: number[]; error: number }

/** Damped least squares keeps shared vertices and polygon frames coupled. */
export function project(g: PatternGraph, positions: Position[], targets: { vertex: number; position: Position; weight: number }[], iterations = 100) {
  const size = positions.length * 3;
  const points = Float64Array.from(positions.flat());
  const rigid = g.faces.map(face => {
    let best = 0, tri = [face[0], face[1], face[2]];
    for (let i = 1; i < face.length - 1; i++) for (let j = i + 1; j < face.length; j++) {
      const a = g.vertices[face[0]], b = g.vertices[face[i]], c = g.vertices[face[j]];
      const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      if (area > best) { best = area; tri = [face[0], face[i], face[j]]; }
    }
    const [a, b, c] = tri.map(v => g.vertices[v]);
    const d = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    return { tri, points: face.filter(v => !tri.includes(v)).map(v => {
      const p = g.vertices[v];
      const u = ((p[0] - a[0]) * (c[1] - a[1]) - (p[1] - a[1]) * (c[0] - a[0])) / d;
      const w = ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / d;
      return { v, weights: [1 - u - w, u, w] };
    }) };
  });
  const edges = new Map<string, [number, number, number]>();
  for (const face of g.faces) for (let i = 0; i < face.length; i++) for (let j = i + 1; j < face.length; j++) {
    const a = Math.min(face[i], face[j]), b = Math.max(face[i], face[j]);
    edges.set(`${a},${b}`, [a, b, Math.hypot(g.vertices[a][0] - g.vertices[b][0], g.vertices[a][1] - g.vertices[b][1])]);
  }
  const rows = (p: Float64Array): Row[] => {
    const out: Row[] = [];
    for (const [a, b, length] of edges.values()) {
      const dx = p[a * 3] - p[b * 3], dy = p[a * 3 + 1] - p[b * 3 + 1], dz = p[a * 3 + 2] - p[b * 3 + 2];
      const distance = Math.hypot(dx, dy, dz), scale = 1 / (distance * length);
      out.push({ ids: [a * 3, a * 3 + 1, a * 3 + 2, b * 3, b * 3 + 1, b * 3 + 2], values: [dx * scale, dy * scale, dz * scale, -dx * scale, -dy * scale, -dz * scale], error: distance / length - 1 });
    }
    for (const face of rigid) for (const { v, weights } of face.points) for (let k = 0; k < 3; k++) {
      const ids = [v * 3 + k, ...face.tri.map(i => i * 3 + k)], values = [100, ...weights.map(w => -100 * w)];
      out.push({ ids, values, error: ids.reduce((s, id, j) => s + p[id] * values[j], 0) });
    }
    for (const target of targets) for (let k = 0; k < 3; k++) out.push({ ids: [target.vertex * 3 + k], values: [target.weight], error: (p[target.vertex * 3 + k] - target.position[k]) * target.weight });
    return out;
  };
  const score = (r: Row[]) => r.reduce((s, row) => s + row.error * row.error, 0);
  let damping = 1e-3;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const current = rows(points), before = score(current);
    const rhs = new Float64Array(size), diag = new Float64Array(size).fill(damping);
    for (const row of current) row.ids.forEach((id, j) => { rhs[id] -= row.values[j] * row.error; diag[id] += row.values[j] ** 2; });
    const delta = new Float64Array(size), residual = rhs.slice(), z = rhs.map((v, i) => v / diag[i]), direction = z.slice();
    let rz = residual.reduce((s, v, i) => s + v * z[i], 0);
    for (let step = 0; step < size * 2 && rz > 1e-20; step++) {
      const product = direction.map(v => v * damping);
      for (const row of current) {
        const v = row.ids.reduce((s, id, j) => s + direction[id] * row.values[j], 0);
        row.ids.forEach((id, j) => { product[id] += row.values[j] * v; });
      }
      const alpha = rz / direction.reduce((s, v, i) => s + v * product[i], 0);
      for (let i = 0; i < size; i++) { delta[i] += alpha * direction[i]; residual[i] -= alpha * product[i]; z[i] = residual[i] / diag[i]; }
      const next = residual.reduce((s, v, i) => s + v * z[i], 0), beta = next / rz;
      for (let i = 0; i < size; i++) direction[i] = z[i] + beta * direction[i];
      rz = next;
    }
    const next = points.map((v, i) => v + delta[i]);
    if (score(rows(next)) < before) { points.set(next); damping = Math.max(1e-8, damping / 3); }
    else damping *= 10;
    if (Math.max(...delta.map(Math.abs)) < 1e-10) break;
  }
  positions.forEach((p, i) => { for (let k = 0; k < 3; k++) p[k] = points[i * 3 + k]; });
}
