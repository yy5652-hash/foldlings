import type { Part, PatternGraph, Point } from './pattern.js';
import type { Position } from './relax.js';

export function craneMetrics(g: PatternGraph, parts: Part[], flat: Point[], positions: Position[]) {
  const vertex = (p: Point) => g.vertices.findIndex(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9);
  const hinge = (part: Part): Position => {
    const ids = [...new Set(g.edges.filter(e => e.faces.length === 2 && e.faces.some(f => parts[f] === part) && e.faces.some(f => parts[f] !== part)).flatMap(e => [e.a, e.b]))];
    ids.sort((a, b) => flat[a][1] - flat[b][1]);
    const a = positions[ids[0]], b = positions[ids[ids.length - 1]];
    return a.map((n, k) => (n + b[k]) / 2) as Position;
  };
  const left = hinge('wingL'), right = hinge('wingR');
  const tips = [positions[vertex([-.1, .1])], positions[vertex([.1, -.1])]];
  const head = new Set(g.faces.flatMap((face, f) => parts[f] === 'head' ? face : []));
  let mirrorError = 0;
  positions.forEach((p, v) => {
    if (head.has(v)) return;
    const error = Math.min(...positions.map(q => Math.hypot(p[0] + q[0], p[1] - q[1], p[2] - q[2])));
    mirrorError = Math.max(mirrorError, error);
  });
  const root = .1 * (Math.SQRT2 - 1);
  const neck = positions[vertex([root, root])], tail = positions[vertex([-root, -root])];
  return {
    mirrorError,
    wingTipAlignment: Math.max(Math.abs(tips[0][2] - left[2]), Math.abs(tips[1][2] - right[2])),
    neckTailRootHeightDifference: Math.abs(neck[1] - tail[1]),
    bodyWidth: Math.abs(left[0] - right[0]),
    wingRiseDegrees: tips.map((p, i) => Math.atan2(p[1] - [left, right][i][1], Math.abs(p[0] - [left, right][i][0])) * 180 / Math.PI),
  };
}

/** The specified hinge leaves this much paper between each root and wing tip. */
export function minimumCraneSpan(bodyWidth: number, riseDegrees: number, strain: number, foreAftError: number): number {
  const wingLength = .1 * (2 - Math.SQRT2) + .05 * (Math.SQRT2 - 1);
  const horizontal = wingLength * (1 - strain) * Math.cos(riseDegrees * Math.PI / 180);
  return bodyWidth + 2 * Math.sqrt(horizontal * horizontal - foreAftError * foreAftError);
}
