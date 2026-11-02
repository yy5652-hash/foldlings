import { Construction } from './construction.js';
import type { Definition } from './definition.js';
import { transform } from './flat.js';
import { project } from './project.js';
import { rotate, type Position } from './relax.js';

/** Sitting rabbit: broad corner ears, a shortened head flap and a pleated rear haunch. */
export function rabbit(): Definition {
  const c = new Construction({ side: .2, creases: [
    { a: [-.1, -.1], b: [.1, .1], assignment: 'M', stage: 1 },
    { a: [-.1, .1], b: [.1, -.1], assignment: 'F', stage: 1 },
  ] }, () => 'body');
  const h = Math.SQRT1_2;
  c.fold({ nx: h, ny: h, d: 0 }, [[.1, .1]], 2);
  c.fold({ nx: -h, ny: h, d: 0 }, [[-.1, -.1]], 2);
  c.fold({ nx: 1, ny: 0, d: 0 }, [[.1, .1]], 3);
  // Fold the rear into the body, then reverse a small cap out as the tail.
  c.fold({ nx: 0, ny: 1, d: -.04 }, [[0, 0]], 4);
  c.fold({ nx: 0, ny: -1, d: .065 }, [[0, 0]], 5);
  c.fold({ nx: 0, ny: 1, d: -.052 }, [[0, 0]], 6);
  c.fold({ nx: 0, ny: -1, d: .10 }, [[-.1, .1], [.1, -.1]], 7, 'neck');
  c.crease({ nx: 0, ny: -1, d: .10 }, 7);
  const a = 25 * Math.PI / 180;
  c.fold({ nx: Math.cos(a), ny: -Math.sin(a), d: .025 }, c.facets.filter(f => f.part === 'neck').flatMap(f => f.sheet), 8, 'head');
  c.crease({ nx: Math.cos(a), ny: -Math.sin(a), d: .025 }, 8);
  c.fold({ nx: 0, ny: -1, d: .133 }, [[.1, .1], [-.1, -.1]], 9);
  const seeds = c.facets.flatMap(f => f.sheet.filter(p => {
    const [u] = transform(f.map, p);
    return u < -.035 - 1e-9;
  }));
  c.fold({ nx: -1, ny: 0, d: .035 }, seeds, 10);
  c.crease({ nx: -1, ny: 0, d: .035 }, 10);
  const bevel = 1 / Math.hypot(1, .3);
  const shoulder = c.facets.flatMap(f => f.sheet.filter(p => {
    const [u, v] = transform(f.map, p);
    return u + .3 * v < -.0535 - 1e-9;
  }));
  c.fold({ nx: -bevel, ny: -.3 * bevel, d: .0535 * bevel }, shoulder, 10);
  c.crease({ nx: 0, ny: -1, d: .085 }, 11);
  // Keep the exposed cheek separate from paper tucked inside the same head rig.
  const rest = c.facets.filter(f => f.part !== 'head');
  c.facets = c.facets.filter(f => f.part === 'head');
  c.crease({ nx: 1, ny: 0, d: -.024 }, 11);
  c.facets.push(...rest);
  for (const f of c.facets) {
    if (f.part === 'neck') f.part = 'body';
    const p = f.sheet.map(p => transform(f.map, p));
    if (f.part === 'head' && !p.every(p => p[0] <= -.024 + 1e-9 && p[1] <= -.085 + 1e-9)) f.part = 'neck';
    if (f.part === 'body' && p.every(p => p[1] <= -.085 + 1e-9)) {
      const s = f.sheet.reduce((sum, p) => sum + p[0] + p[1], 0);
      f.part = s < 0 ? 'earR' : 'earL';
    }
  }
  c.crease({ nx: Math.cos(a), ny: -Math.sin(a), d: .025 }, 11);
  c.crease({ nx: 0, ny: -1, d: .10 }, 11);
  for (const s of [-1, 1]) c.crease({ nx: h, ny: s * h, d: -s * .052 * h }, 11);
  const construction = c.finish();
  return {
    kind: 'rabbit', construction,
    shape(flat) {
      const g = construction.graph;
      const copies = g.faces.map((face, i) => {
        const s = face.reduce((sum, v) => sum + g.vertices[v][0] + g.vertices[v][1], 0) < 0 ? -1 : 1;
        return face.map(v => {
          let p: Position = [...flat.positions[v], 0];
          if (construction.parts[i].startsWith('ear')) p = rotate(p, [[-.1, -.085, 0], [.1, -.085, 0]], s * .36);
          return rotate(p, [[0, 0, 0], [0, -.15, 0]], s * .6);
        });
      });
      const positions: Position[] = g.vertices.map(() => [0, 0, 0]), counts = g.vertices.map(() => 0);
      g.faces.forEach((face, i) => face.forEach((v, j) => {
        for (let k = 0; k < 3; k++) positions[v][k] += copies[i][j][k];
        counts[v]++;
      }));
      positions.forEach((p, i) => { for (let k = 0; k < 3; k++) p[k] /= counts[i]; });
      const pins = positions.map((p, vertex) => ({ vertex, position: [...p] as Position, weight: 5 }));
      // Open the low pleat into a tail bump before the unpinned rigid solve.
      g.vertices.forEach((p, vertex) => {
        if (p.every(n => Math.abs(Math.abs(n) - .04 * h) < 1e-9)) {
          pins[vertex] = { vertex, position: [.008, -.045, -Math.sign(p[0] + p[1]) * .004], weight: 30 };
        }
      });
      project(g, positions, pins, 10);
      project(g, positions, [], 15);
      const orient = ([u, v, w]: Position): Position => [w, -v * Math.cos(.2) + u * Math.sin(.2), v * Math.sin(.2) + u * Math.cos(.2)];
      return { positions: positions.map(orient), flatPositions: flat.positions.map(([u, v]) => orient([u, v, 0])) };
    },
    rig: { body: 'body', head: 'head', neck: 'head', earL: 'earL', earR: 'earR' },
    eyes: [-1, 1].map(s => ({ face: { part: 'head', side: s < 0 ? 'left' : 'right' }, weights: [1 / 3, 1 / 3, 1 / 3], normal: [s, 0, 0], radius: .0008 })),
    touchesGround: true,
  };
}
