import { assign } from './construction.js';
import { graph, type CreasePattern, type Point } from './pattern.js';

/** The 22.5-degree angle bisectors of the square's four bird-base flaps. */
export function birdBase(): CreasePattern {
  const creases: CreasePattern['creases'] = [];
  const q = .1 * (2 - Math.SQRT2);
  for (let i = 0; i < 4; i++) {
    const turn = (p: Point): Point => {
      for (let j = 0; j < i; j++) p = [-p[1], p[0]];
      return p;
    };
    for (const [a, b, stage] of [
      [[.1, .1], [q, 0], 2], [[.1, .1], [0, q], 2],
    ] as [Point, Point, number][]) creases.push({ a: turn(a), b: turn(b), assignment: 'M', stage });
    creases.push({ a: [0, 0], b: turn([q, 0]), assignment: i === 0 ? 'M' : 'V', stage: 1 });
    if (i % 2 === 0) creases.push({ a: [0, 0], b: turn([.1, .1]), assignment: 'M', stage: 1 });
    if (i % 2 === 1) creases.push({ a: turn([q, 0]), b: turn([0, q]), assignment: 'M', stage: 2 });
  }
  const g = graph({ side: .2, creases });
  assign(g);
  return { side: .2, creases: g.edges.filter(e => e.assignment !== 'B').map(e => ({ a: g.vertices[e.a], b: g.vertices[e.b], assignment: e.assignment as 'M' | 'V', stage: e.stage })) };
}

