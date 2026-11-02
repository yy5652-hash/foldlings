import { birdBase } from './bird-base.js';
import { craneMetrics } from './crane-metrics.js';
import type { Definition } from './definition.js';
import { project } from './project.js';
import { rotate, type Position, type Rotation } from './relax.js';
import type { FlatState } from './flat.js';
import { Construction } from './construction.js';
import { validate, type Point } from './pattern.js';

function cranePattern() {
  const base = birdBase();
  const mid = .1 * (2 - Math.SQRT2);
  for (const s of [-1, 1]) base.creases.push({ a: [s * mid, 0], b: [0, s * mid], assignment: 'F', stage: 9 });
  for (const s of [-1, 1]) {
    base.creases.push({ a: [0, 0], b: [s * .1, -s * .1], assignment: 'F', stage: 9 });
    base.creases.push({ a: [s * mid, 0], b: [s * .1, 0], assignment: 'F', stage: 9 });
    base.creases.push({ a: [0, s * mid], b: [0, s * .1], assignment: 'F', stage: 9 });
  }
  const c = new Construction(base, () => 'body');
  const neck: Point = [.1, .1], tail: Point = [-.1, -.1];
  const left: Point = [-.1, .1], right: Point = [.1, -.1];
  const root = .1 * (Math.SQRT2 - 1), tip = .1 * Math.SQRT2;
  const a = Math.PI / 16;
  const q = .1 * (2 - Math.SQRT2);
  for (const sign of [-1, 1]) c.fold({ nx: Math.sin(a), ny: sign * Math.cos(a), d: Math.sin(a) * tip }, [[q, 0], [0, q], [-q, 0], [0, -q]], 4);
  const reverse = 17.5 * Math.PI / 180;
  c.fold({ nx: Math.cos(reverse), ny: -Math.sin(reverse), d: Math.cos(reverse) * q }, [neck], 5, 'neck');
  c.fold({ nx: Math.cos(reverse), ny: Math.sin(reverse), d: Math.cos(reverse) * q }, [tail], 6, 'tail');
  const neckTip: Point = [q - (tip - q) * Math.cos(2 * reverse), (tip - q) * Math.sin(2 * reverse)];
  const headRoot: Point = [q + .78 * (neckTip[0] - q), .78 * neckTip[1]];
  c.fold({ nx: -Math.cos(reverse), ny: -Math.sin(reverse), d: -Math.cos(reverse) * headRoot[0] - Math.sin(reverse) * headRoot[1] }, [neck], 7, 'head');
  // Lower the wings halfway down the folded body before opening them in 3D.
  c.fold({ nx: -1, ny: 0, d: -root / 2 }, [left], 8, 'wingL');
  c.fold({ nx: -1, ny: 0, d: -root / 2 }, [right], 8, 'wingR');
  const result = c.finish();
  validate(result.graph);
  return { ...result, wingAxis: [[root / 2, 0], [root / 2, root]] as [Point, Point] };
}

function openCrane(c: ReturnType<typeof cranePattern>, flat: FlatState): Position[] {
  const g = c.graph, q = .1 * (2 - Math.SQRT2), root = .05 * (Math.SQRT2 - 1);
  const angle = 21 * Math.PI / 180, program: Rotation[] = [];
  for (const s of [-1, 1]) {
    const faces = g.faces.flatMap((f, i) => s * f.reduce((sum, v) => sum + g.vertices[v][1] - g.vertices[v][0], 0) > 1e-10 ? [i] : []);
    const axis: [Position, Position] = [[.06347, -.1, 0], [.06347, .1, 0]];
    program.push({ faces: faces.filter(i => !['neck', 'head', 'tail'].includes(c.parts[i])), axis, angle: -s * angle });
    const hinge = [[root, -.1, 0], [root, .1, 0]].map(p => rotate(p as Position, axis, -s * angle)) as [Position, Position];
    program.push({ faces: faces.filter(i => c.parts[i].startsWith('wing')), axis: hinge, angle: s * (102 * Math.PI / 180 + angle) });
    for (const t of [-1, 1]) program.push({
      faces: faces.filter(i => t === 1 ? ['neck', 'head'].includes(c.parts[i]) : c.parts[i] === 'tail'),
      axis: [[q, 0, 0], [q - Math.cos(35 * Math.PI / 180) * .1, t * Math.sin(35 * Math.PI / 180) * .1, 0]],
      angle: s * t * 8 * Math.PI / 180,
    });
  }
  const copies = g.faces.map(f => f.map(v => [...flat.positions[v], 0] as Position));
  for (const step of program) for (const f of step.faces) copies[f] = copies[f].map(p => rotate(p, step.axis, step.angle));
  const positions: Position[] = g.vertices.map(() => [0, 0, 0]), counts = g.vertices.map(() => 0);
  g.faces.forEach((f, i) => f.forEach((v, j) => {
    for (let k = 0; k < 3; k++) positions[v][k] += copies[i][j][k];
    counts[v]++;
  }));
  positions.forEach((p, i) => {
    for (let k = 0; k < 3; k++) p[k] /= counts[i];
    p[0] += .012 * Math.max(0, 1 - (Math.abs(g.vertices[i][0]) + Math.abs(g.vertices[i][1])) / q);
  });
  const pins = [...new Set(g.faces.flatMap((f, i) => c.parts[i].startsWith('wing') ? f : []))].filter(v => Math.abs(c.positions[v][1]) < 1e-8);
  project(g, positions, pins.map(vertex => ({ vertex, position: [...positions[vertex]] as Position, weight: 50 })), 200);
  return positions;
}

export function crane(): Definition {
  const c = cranePattern();
  return {
    kind: 'crane', construction: c,
    shape(flat) {
      return { positions: openCrane(c, flat).map(p => [p[2], -p[0], -p[1]]),
        flatPositions: flat.positions.map(p => [0, -p[0], -p[1]]) };
    },
    rig: { body: 'body', neck: 'body', wingL: 'wingL', wingR: 'wingR', head: 'head', tail: 'tail' },
    eyes: [-1, 1].map(normalSign => ({ face: { part: 'head' }, weights: [.4, .4, .2], normalSign, radius: .0016 })),
    touchesGround: true,
    metrics: positions => craneMetrics(c.graph, c.parts, c.positions, positions),
  };
}
