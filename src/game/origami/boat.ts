import { Construction, assign } from './construction.js';
import { transform } from './flat.js';
import { triangulate } from './triangulate.js';
import type { Definition } from './definition.js';
import type { Point } from './pattern.js';
import { project } from './project.js';
import type { Position } from './relax.js';

export function boat(): Definition {
  let c = new Construction({ side: .2, creases: [
    { a: [-.1, 0], b: [.1, 0], assignment: 'F', stage: 1 },
    { a: [0, -.1], b: [0, .1], assignment: 'F', stage: 1 },
  ] }, () => 'body');
  // Keep the unfolded sheet axes for the quarter-width tuck and hat folds.
  for (const f of c.facets) f.map = [1, 0, 0, 1, 0, 0];
  const corners: Point[] = [[-.1, -.1], [.1, -.1], [.1, .1], [-.1, .1], [.05, -.1], [.05, .1]];
  c.fold({ nx: 1, ny: 0, d: .05 }, [[.1, -.1], [.1, .1]], 1);
  c.fold({ nx: 0, ny: 1, d: 0 }, [[-.1, .1]], 2);
  for (const s of [-1, 1]) c.fold({ nx: s * Math.SQRT1_2, ny: Math.SQRT1_2, d: -s * .025 * Math.SQRT1_2 }, [[s < 0 ? -.1 : .05, 0]], 3);
  c.fold({ nx: 0, ny: -1, d: .075 }, corners, 4);
  for (const s of [-1, 1]) c.fold({ nx: s * Math.SQRT1_2, ny: Math.SQRT1_2, d: -s * .025 * Math.SQRT1_2 }, corners, 5);
  c.crease({ nx: 0, ny: 1, d: -.05 }, 8);
  // The diamond squash opens opposite hat diagonals and closes its centre.
  c.crease({ nx: 1, ny: 0, d: -.025 }, 6);
  const hat = c.finish();
  for (const e of hat.graph.edges) {
    if (e.assignment === 'B') continue;
    const a = hat.graph.vertices[e.a], b = hat.graph.vertices[e.b];
    const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
    const tucked = (x > .05 ? .1 - x : x) + .025;
    if (e.stage === 3 && tucked * y < 0) e.assignment = 'F';
    if (e.stage === 6) e.assignment = 'M';
  }
  assign(hat.graph);
  c = new Construction({ side: .2, creases: hat.graph.edges.filter(e => e.assignment !== 'B').map(e => ({
    a: hat.graph.vertices[e.a], b: hat.graph.vertices[e.b], assignment: e.assignment as 'M' | 'V' | 'F', stage: e.stage,
  })) }, () => 'body');
  const diamond = c.finish();
  const point = (x: number, y: number) => diamond.positions[diamond.graph.vertices.findIndex(p => Math.hypot(p[0] - x, p[1] - y) < 1e-9)];
  const o = point(-.025, 0), tip = point(-.1, -.075);
  const dx = tip[0] - o[0], dy = tip[1] - o[1], length = Math.hypot(dx, dy);
  c.fold({ nx: dx / length, ny: dy / length, d: (dx * (tip[0] + o[0]) + dy * (tip[1] + o[1])) / (2 * length) },
    [[-.1, -.075], [.05, -.075], [-.1, .075], [.05, .075]], 7);
  c.crease({ nx: -dy / length, ny: dx / length, d: (-dy * o[0] + dx * o[1]) / length }, 8);
  for (const f of c.facets) {
    const x = f.sheet.reduce((sum, p) => sum + (p[0] > .05 ? .1 - p[0] : p[0]) + .025, 0) / f.sheet.length;
    const y = Math.abs(f.sheet.reduce((sum, p) => sum + p[1], 0) / f.sheet.length);
    f.part = y > .05 && Math.abs(x) + y < .075 + 1e-9 ? 'tail' : 'body';
  }
  const closed = c.finish();
  const open = () => {
    const w = .075, tipHeight = .035, halfLength = Math.sqrt(w * w - tipHeight ** 2), g = closed.graph;
    // Pull the small diamond apart along its bisectors, keeping the lower corners raised.
    const middleZ = (w - tipHeight) * w / (2 * halfLength);
    const middleX = Math.sqrt(w * w / 4 - middleZ * middleZ);
    const core = ([sx, sy]: Point): Position => {
      const signedX = (sx > .05 ? .1 - sx : sx) + .025;
      let x = Math.abs(signedX), y = Math.abs(sy);
      if (x + y > w) [x, y] = [w - y, w - x];
      const middle = 2 * Math.min(x, y) / w;
      return [Math.sign(sy) * middleX * middle,
        Math.max(0, y - x) + w / 2 * middle + Math.max(0, x - y) / w * tipHeight,
        Math.sign(signedX) * (middleZ * middle + Math.max(0, x - y) / w * halfLength)];
    };
    const anchors: [Point, Position][] = [];
    for (const x of [-w, -w / 2, 0, w / 2, w]) for (const y of [-w, 0, w]) {
      const p: Point = [x - .025, y];
      anchors.push([p, core(p)]);
    }
    const positions: Position[] = g.vertices.map(p => {
      if (Math.abs(p[1]) <= w + 1e-9) return core(p);
      const x = p[0] > .05 ? .1 - p[0] : p[0];
      const weights = anchors.map(([q]) => 1 / Math.hypot(q[0] - x, q[1] - p[1]) ** 3);
      const sum = weights.reduce((a, b) => a + b, 0);
      return [0, 1, 2].map(k => anchors.reduce((s, a, i) => s + weights[i] * a[1][k], 0) / sum) as Position;
    });
    const pins = g.vertices.flatMap((p, vertex) => Math.abs(p[1]) <= w + 1e-9
      ? [{ vertex, position: core(p), weight: 50 }] : []);
    for (const s of [-1, 1]) {
      const vertex = g.vertices.findIndex(([x, y]) => Math.hypot(x + .025, y - s * .1) < 1e-9);
      const position: Position = [s * .024, w - Math.sqrt(.025 ** 2 - .024 ** 2), 0];
      positions[vertex] = [...position];
      pins.push({ vertex, position, weight: 50 });
    }
    project(g, positions, pins, 200);
    project(g, positions, [], 200);
    return positions;
  };
  const opened = open(), keel = .0015, crown = .05, wall = .02;
  const triangles = closed.graph.faces.flatMap(f => triangulate(f, closed.graph.vertices));
  const sample = (p: Point): Position => {
    for (const ids of triangles) {
      const [a, b, c] = ids.map(v => closed.graph.vertices[v]);
      const d = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const u = ((p[0] - a[0]) * (c[1] - a[1]) - (p[1] - a[1]) * (c[0] - a[0])) / d;
      const v = ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / d;
      if (u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9) return [0, 1, 2].map(k =>
        opened[ids[0]][k] * (1 - u - v) + opened[ids[1]][k] * u + opened[ids[2]][k] * v) as Position;
    }
    throw new Error('Boat point outside sheet');
  };
  // Narrow the walls, tuck the crown and reverse the keel using rigid finishing folds.
  c = new Construction(closed.pattern, () => 'body');
  c.facets.forEach((f, i) => { f.map = closed.transforms[i]; });
  const planes: { normal: Position; offset: number; stage: number }[] = [
    { normal: [-1, 0, 0], offset: wall, stage: 9 },
    { normal: [1, 0, 0], offset: wall, stage: 9 },
  ];
  const slope = wall / Math.sqrt(.075 ** 2 - .035 ** 2), scale = Math.hypot(1, slope);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) planes.push({
    normal: [sx / scale, 0, sz * slope / scale], offset: wall / scale, stage: 10,
  });
  planes.push({ normal: [0, 1, 0], offset: crown, stage: 11 },
    { normal: [0, -1, 0], offset: -keel, stage: 12 });
  const pose = (p: Point, count: number): Position => {
    const q = sample(p);
    for (const { normal, offset } of planes.slice(0, count)) {
      const distance = q[0] * normal[0] + q[1] * normal[1] + q[2] * normal[2] - offset;
      if (distance > 0) for (let k = 0; k < 3; k++) q[k] -= 2 * distance * normal[k];
    }
    return q;
  };
  for (const [i, plane] of planes.entries()) {
    const facets = [] as typeof c.facets;
    for (const f of c.facets) {
      const cuts: Point[] = [];
      const distance = (p: Point) => pose(p, i).reduce((sum, v, k) => sum + v * plane.normal[k], -plane.offset);
      f.sheet.forEach((a, j) => {
        const b = f.sheet[(j + 1) % f.sheet.length], da = distance(a), db = distance(b);
        if (Math.abs(da) < 1e-10) cuts.push(transform(f.map, a));
        else if (da * db < -1e-16) {
          const t = da / (da - db);
          cuts.push(transform(f.map, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]));
        }
      });
      const unique = cuts.filter((p, j) => !cuts.slice(0, j).some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9));
      if (unique.length === 2) {
        const [a, b] = unique, dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
        c.facets = [f];
        c.crease({ nx: dy / length, ny: -dx / length, d: (dy * a[0] - dx * a[1]) / length }, plane.stage);
        facets.push(...c.facets);
      } else facets.push(f);
    }
    c.facets = facets;
  }
  for (const f of c.facets) {
    const points = f.sheet.map(sample);
    f.part = points.every(p => Math.abs(p[2]) < .035) && points.some(p => p[1] > .07) ? 'tail' : 'body';
  }
  const construction = c.finish(), positions = construction.graph.vertices.map(p => pose(p, planes.length));
  return {
    kind: 'boat', construction,
    shape(flat) {
      // Keep the closed pose axis-aligned through runtime quantization.
      return { positions: positions.map(p => [...p]), flatPositions: flat.positions.map(([u, v]) => [0, (u - v) * Math.SQRT1_2, (u + v) * Math.SQRT1_2]) };
    },
    rig: { body: 'body', tail: 'tail' }, eyes: [], touchesGround: true,
  };
}
