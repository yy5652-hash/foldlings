import { assign, Construction } from './construction.js';
import type { Definition } from './definition.js';
import { project } from './project.js';
import type { Position } from './relax.js';
import { graph, type CreasePattern, type Point } from './pattern.js';

/** Two rabbit ears on the opposite triangles of the square make a fish base. */
function fishBase(): CreasePattern {
  const a = .1 * Math.SQRT2, r = a * (Math.SQRT2 - 1);
  const sheet = ([u, v]: Point): Point => [(u - v) * Math.SQRT1_2, (u + v) * Math.SQRT1_2];
  const creases: CreasePattern['creases'] = [];
  for (const s of [-1, 1]) {
    for (const p of [[-a, 0], [a, 0], [0, s * a], [0, 0]] as Point[]) {
      creases.push({ a: sheet([0, s * r]), b: sheet(p), assignment: 'M', stage: 2 });
    }
    creases.push({ a: [0, 0], b: sheet([s * a, 0]), assignment: 'F', stage: 1 });
  }
  const g = graph({ side: .2, creases });
  assign(g);
  return { side: .2, creases: g.edges.filter(e => e.assignment !== 'B').map(e => ({ a: g.vertices[e.a], b: g.vertices[e.b], assignment: e.assignment as 'M' | 'V' | 'F', stage: e.stage })) };
}

export function fish(): Definition {
  const c = new Construction(fishBase(), () => 'body');
  // A 25 mm pleat shortens the two long points without scaling the sheet.
  const mouth: Point[] = [[.1, .1], [-.1, -.1]];
  c.fold({ nx: 1, ny: 0, d: .08 }, mouth, 3, 'head');
  c.fold({ nx: -1, ny: 0, d: -.055 }, mouth, 4, 'head');
  const r = .1 * (2 - Math.SQRT2);
  for (const s of [-1, 1]) {
    const tip: Point = s < 0 ? [.1, -.1] : [-.1, .1];
    const target: Point = [-.035, s * .035];
    const dx = -r - target[0], dy = -target[1], length = Math.hypot(dx, dy);
    c.fold({ nx: dx / length, ny: dy / length, d: (dx * (-r + target[0]) / 2 + dy * target[1] / 2) / length }, [tip], 5, 'tail');
  }
  c.crease({ nx: 1, ny: 0, d: .025 }, 6);
  c.crease({ nx: 1, ny: 0, d: .055 }, 6);
  c.crease({ nx: 0, ny: 1, d: 0 }, 6);
  for (const s of [-1, 1]) c.crease({ nx: r / Math.hypot(r, .025), ny: s * .025 / Math.hypot(r, .025), d: r * .025 / Math.hypot(r, .025) }, 6);
  for (const f of c.facets) {
    const uv = f.sheet.map(p => [f.map[0] * p[0] + f.map[2] * p[1] + f.map[4], f.map[1] * p[0] + f.map[3] * p[1] + f.map[5]]);
    const u = uv.reduce((sum, p) => sum + p[0], 0) / uv.length;
    const v = uv.reduce((sum, p) => sum + p[1], 0) / uv.length;
    const edge = f.sheet.some(p => p.some(n => Math.abs(n) > .099999));
    if (f.part === 'head') f.part = 'body';
    else if (f.part === 'body' && edge && u > .055 && u < .08 && v > 0) f.part = 'head';
    if (f.part === 'body' && edge && u > .025 && u < .055 && v < 0 && v > -.025) {
      f.part = f.sheet.reduce((sum, p) => sum + p[0] + p[1], 0) < 0 ? 'wingL' : 'wingR';
    }
  }
  const construction = c.finish();
  const cheek = (.1 * Math.SQRT2 - .055) * (Math.SQRT2 - 1);
  const brow = (.1 * Math.SQRT2 - .08) * (Math.SQRT2 - 1);
  return {
    kind: 'fish', construction,
    shape(flat) {
      const positions: Position[] = flat.positions.map(([u, v], i) => {
        const sum = construction.graph.vertices[i][0] + construction.graph.vertices[i][1];
        const side = Math.abs(sum) < 1e-8 ? 0 : Math.sign(sum);
        return [side * .014 * Math.max(0, 1 - Math.abs(u - .025) / .05) * Math.max(0, 1 - Math.abs(v) / r), v, -u];
      });
      const pins = flat.positions.flatMap(([u, v], vertex) => {
        if (Math.abs(u - .025) < 1e-8 && Math.abs(v) < 1e-8) {
          const outer = construction.graph.vertices[vertex].some(n => Math.abs(n) > .099);
          positions[vertex][0] = Math.sign(positions[vertex][0]) * (outer ? .025 : .012);
          return [{ vertex, position: [...positions[vertex]] as Position, weight: 3 }];
        }
        if (u > .09) return [{ vertex, position: [0, v, -u] as Position, weight: 3 }];
        return [];
      });
      project(construction.graph, positions, pins, 250);
      const mirror = construction.graph.vertices.map(p => construction.graph.vertices.findIndex(q => Math.hypot(p[0] + q[1], p[1] + q[0]) < 1e-8));
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < positions.length; i++) {
          const j = mirror[i];
          if (j < i) continue;
          const a = positions[i], b = positions[j];
          const x = (a[0] - b[0]) / 2, y = (a[1] + b[1]) / 2, z = (a[2] + b[2]) / 2;
          positions[i] = [x, y, z]; positions[j] = [-x, y, z];
        }
        if (pass < 2) project(construction.graph, positions, positions.map((p, vertex) => ({ vertex, position: [...p] as Position, weight: .1 })), 200);
      }
      const center = [0, 1, 2].map(k => (Math.min(...positions.map(p => p[k])) + Math.max(...positions.map(p => p[k]))) / 2);
      return { positions: positions.map(p => p.map((v, k) => v - center[k]) as Position), flatPositions: flat.positions.map(([u, v]) => [0, v - center[1], -u - center[2]]) };
    },
    rig: { body: 'body', head: 'body', wingL: 'body', wingR: 'body', tail: 'tail' },
    // Both dots lie at (u, v) = (67.5, 15) mm despite opposite cheek diagonals.
    eyes: [-1, 1].map(s => {
      const b = s < 0 ? (.015 - brow / 2) / cheek : .5 - .015 / cheek;
      return { face: { part: 'head', side: s < 0 ? 'left' : 'right' }, weights: [.5, b, .5 - b], normal: [s, 0, 0], radius: .0014 };
    }),
    touchesGround: false,
  };
}
