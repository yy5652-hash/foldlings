import { Construction } from './construction.js';
import type { Definition } from './definition.js';
import { transform } from './flat.js';
import { project } from './project.js';
import { rotate, type Position } from './relax.js';

/** Traditional sitting fox: triangle, corner folds, half fold, opened three-layer head. */
export function fox(): Definition {
  const c = new Construction({ side: .2, creases: [
    { a: [-.1, -.1], b: [.1, .1], assignment: 'M', stage: 1 },
    { a: [-.1, .1], b: [.1, -.1], assignment: 'F', stage: 1 },
  ] }, () => 'body');
  const h = Math.SQRT1_2, tip = .1 * Math.SQRT2;
  c.fold({ nx: h, ny: h, d: 0 }, [[.1, .1]], 2);
  c.fold({ nx: -h, ny: h, d: 0 }, [[-.1, -.1]], 2);
  c.fold({ nx: 1, ny: 0, d: 0 }, [[.1, .1]], 3);
  const a = 25 * Math.PI / 180;
  c.fold({ nx: Math.cos(a), ny: -Math.sin(a), d: .0405 }, [[-.1, .1], [.1, -.1]], 4, 'head');
  c.crease({ nx: 0, ny: -1, d: .105 }, 5);
  for (const f of c.facets) {
    const p = f.sheet.map(p => transform(f.map, p));
    if (f.part === 'body' && p.every(p => p[1] <= -.105 + 1e-9)) {
      const s = f.sheet.reduce((sum, p) => sum + p[0] + p[1], 0);
      f.part = s < 0 ? 'earR' : 'earL';
    }
  }
  c.fold({ nx: 0, ny: 1, d: -.025 }, [[0, 0]], 6, 'tail');
  c.crease({ nx: 0, ny: -1, d: .038 }, 7);
  // Diagonal gussets let the tail curl sideways without stretching the folded layers.
  for (const s of [-1, 1]) c.crease({ nx: s * h, ny: h, d: -.038 * h }, 7);
  const construction = c.finish();
  return {
    kind: 'fox', construction,
    shape(flat) {
      const g = construction.graph;
      const copies = g.faces.map((face, i) => {
        const s = face.reduce((sum, v) => sum + g.vertices[v][0] + g.vertices[v][1], 0) < 0 ? -1 : 1;
        return face.map(v => {
          let p: Position = [...flat.positions[v], 0];
          if (construction.parts[i] === 'tail') {
            if (p[1] < -.038) p = rotate(p, [[-.1, -.038, 0], [.1, -.038, 0]], -.25);
            p = rotate(p, [[-.1, -.025, 0], [.1, -.025, 0]], 3.05);
          }
          if (construction.parts[i].startsWith('ear')) p = rotate(p, [[-.1, -.105, 0], [.1, -.105, 0]], s * .35);
          return rotate(p, [[0, 0, 0], [0, -tip, 0]], s * .22);
        });
      });
      const positions: Position[] = g.vertices.map(() => [0, 0, 0]), counts = g.vertices.map(() => 0);
      g.faces.forEach((face, i) => face.forEach((v, j) => {
        for (let k = 0; k < 3; k++) positions[v][k] += copies[i][j][k];
        counts[v]++;
      }));
      positions.forEach((p, i) => { for (let k = 0; k < 3; k++) p[k] /= counts[i]; });
      project(g, positions, [], 200);
      // Rest the front feet and the haunch on the same support plane.
      const body = [...new Set(g.faces.flatMap((face, i) => construction.parts[i] === 'body' ? face : []))];
      const support = body.filter(v => Math.abs(construction.positions[v][0] - construction.positions[v][1]) < 1e-9);
      const front = positions[support.reduce((a, b) => positions[a][0] + positions[a][1] < positions[b][0] + positions[b][1] ? a : b)];
      const rear = positions[support.reduce((a, b) => positions[a][0] + positions[a][1] > positions[b][0] + positions[b][1] ? a : b)];
      const center = (Math.min(...body.map(v => positions[v][2])) + Math.max(...body.map(v => positions[v][2]))) / 2;
      const pitch = Math.atan((front[0] - front[1] - rear[0] + rear[1]) / (front[0] + front[1] - rear[0] - rear[1]));
      const orient = ([u, v, w]: Position): Position => {
        const y = (u - v) * h, z = (u + v) * h;
        return [w - center, y * Math.cos(pitch) - z * Math.sin(pitch), y * Math.sin(pitch) + z * Math.cos(pitch)];
      };
      return { positions: positions.map(orient), flatPositions: flat.positions.map(([u, v]) => orient([u, v, 0])) };
    },
    rig: { body: 'body', head: 'head', earL: 'earL', earR: 'earR', tail: 'tail' },
    eyes: [-1, 1].map(s => ({ face: { part: 'head', side: s < 0 ? 'left' : 'right' }, weights: s < 0 ? [.34, .33, .33] : [.43, .22, .35], normal: [s, 0, 0], radius: .0015 })),
    touchesGround: true,
  };
}
