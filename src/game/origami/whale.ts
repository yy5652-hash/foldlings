import { Construction } from './construction.js';
import type { Definition } from './definition.js';
import type { Point } from './pattern.js';
import { project } from './project.js';
import { rotate, type Position } from './relax.js';

export function whale(): Definition {
  const a = .1 * Math.SQRT2;
  const c = new Construction({ side: .2, creases: [
    { a: [-.1, -.1], b: [0, 0], assignment: 'F', stage: 1 },
    { a: [0, 0], b: [.1, .1], assignment: 'F', stage: 1 },
  ] }, () => 'body');
  // Bisect the two edges into the diagonal: the traditional kite base.
  for (const s of [-1, 1]) c.fold({ nx: Math.sin(Math.PI / 8), ny: s * Math.cos(Math.PI / 8), d: a * Math.sin(Math.PI / 8) }, [s < 0 ? [.1, -.1] : [-.1, .1]], 2);
  c.fold({ nx: -1, ny: 0, d: .065 }, [[-.1, -.1]], 3, 'head');
  for (const s of [-1, 1]) {
    const points = c.facets.flatMap(f => f.sheet.map(p => ({ p, v: f.map[1] * p[0] + f.map[3] * p[1] + f.map[5] })));
    const shoulder = points.reduce((a, b) => s * a.v > s * b.v ? a : b).p;
    c.fold({ nx: -Math.SQRT1_2, ny: s * Math.SQRT1_2, d: .07 }, [shoulder], 4, 'head');
    const r = .1 * (2 - Math.SQRT2), target: Point = [-.008, s * .045];
    const dx = -r - target[0], dy = -target[1], length = Math.hypot(dx, dy);
    c.fold({ nx: dx / length, ny: dy / length, d: (dx * (-r + target[0]) / 2 + dy * target[1] / 2) / length }, [s < 0 ? [.1, -.1] : [-.1, .1]], 5, s < 0 ? 'wingL' : 'wingR');
  }
  c.fold({ nx: 1, ny: 0, d: .075 }, [[.1, .1]], 6, 'tail');
  c.crease({ nx: 1, ny: 0, d: .035 }, 7);
  for (const s of [-1, 1]) c.crease({ nx: Math.SQRT1_2, ny: s * Math.SQRT1_2, d: .035 * Math.SQRT1_2 }, 7);
  const construction = c.finish();
  return {
    kind: 'whale', construction,
    shape(flat) {
      const angle = 55 * Math.PI / 180, lift = 40 * Math.PI / 180;
      const positions: Position[] = flat.positions.map(([u, v]) => {
        const x = v * Math.cos(angle), y = -Math.abs(v) * Math.sin(angle);
        return u <= .035 ? [x, y, u] : [x, y * Math.cos(lift) + (u - .035) * Math.sin(lift), .035 + (u - .035) * Math.cos(lift) - y * Math.sin(lift)];
      });
      for (const s of [-1, 1]) {
        const part = s < 0 ? 'wingL' : 'wingR';
        const g = construction.graph;
        const hinge = g.edges.filter(e => e.faces.length === 2 && e.faces.some(f => construction.parts[f] === part) && e.faces.some(f => construction.parts[f] !== part))
          .sort((a, b) => Math.hypot(...g.vertices[b.a].map((n, k) => n - g.vertices[b.b][k])) - Math.hypot(...g.vertices[a.a].map((n, k) => n - g.vertices[a.b][k])))[0];
        const axis: [Position, Position] = [positions[hinge.a], positions[hinge.b]];
        const tip = g.vertices.findIndex(p => Math.abs(p[0] + s * .1) < 1e-8 && Math.abs(p[1] - s * .1) < 1e-8);
        const angle = Math.PI / 3;
        const turn = s * rotate(positions[tip], axis, angle)[0] > s * rotate(positions[tip], axis, -angle)[0] ? angle : -angle;
        const ids = new Set(g.faces.flatMap((f, i) => construction.parts[i] === part ? f : []));
        for (const v of ids) positions[v] = rotate(positions[v], axis, turn);
      }
      project(construction.graph, positions, positions.map((p, vertex) => ({ vertex, position: [...p] as Position, weight: flat.positions[vertex][0] > .06 ? 5 : 1 })), 350);
      const mirror = construction.graph.vertices.map(p => construction.graph.vertices.findIndex(q => Math.hypot(p[0] - q[1], p[1] - q[0]) < 1e-8));
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
      return { positions: positions.map(p => p.map((v, k) => v - center[k]) as Position), flatPositions: flat.positions.map(([u, v]) => [v, -center[1], u - center[2]]) };
    },
    rig: { body: 'body', head: 'body', wingL: 'body', wingR: 'body', tail: 'tail' },
    eyes: [-1, 1].map(s => ({ face: { part: 'head', side: s < 0 ? 'left' : 'right' }, weights: [1 / 3, 1 / 3, 1 / 3], normal: [s, 1, 0], radius: .0016 })),
    touchesGround: false,
  };
}
