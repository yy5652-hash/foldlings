import { Construction, assign } from './construction.js';
import type { Definition } from './definition.js';
import { transform } from './flat.js';
import { graph, type CreasePattern, type Point } from './pattern.js';
import { rotate, type Position } from './relax.js';

export function frog(): Definition {
  const pattern: CreasePattern = { side: .2, creases: [
    { a: [0, -.1], b: [0, .1], assignment: 'M', stage: 1 },
  ] };
  // Double the square into a rectangle, then squash the head-end waterbomb.
  for (const s of [-1, 1]) pattern.creases.push(
    { a: [0, -.1], b: [s * .1, 0], assignment: 'M', stage: 2 },
    { a: [0, 0], b: [s * .1, -.1], assignment: 'M', stage: 2 },
    { a: [0, -.05], b: [s * .1, -.05], assignment: 'V', stage: 2 },
  );
  const g = graph(pattern);
  assign(g);
  pattern.creases = g.edges.filter(e => e.assignment !== 'B').map(e => ({
    a: g.vertices[e.a], b: g.vertices[e.b], assignment: e.assignment as 'M' | 'V' | 'F', stage: e.stage,
  }));
  let c = new Construction(pattern, () => 'body');
  for (const f of c.facets) {
    const m = f.map, q = Math.SQRT1_2;
    f.map = [-(m[0] + m[1]) * q, (m[0] - m[1]) * q,
      -(m[2] + m[3]) * q, (m[2] - m[3]) * q,
      .05 - (m[4] + m[5]) * q, (m[4] - m[5]) * q];
  }
  const frontX = .024, frontZ = -.03, dx = .05 - frontX, dz = -frontZ;
  const frontOffset = (.05 ** 2 - frontX ** 2 - frontZ ** 2) / 2, frontNormal = Math.hypot(dx, dz);
  for (const s of [-1, 1]) {
    const front: Point[] = s < 0 ? [[-.1, -.1], [.1, -.1]] : [[0, -.1]];
    c.fold({ nx: s * dx / frontNormal, ny: dz / frontNormal, d: frontOffset / frontNormal }, front, 3);
  }
  for (const s of [-1, 1]) c.fold({ nx: s, ny: 0, d: .025 }, [[0, .1], [-.1, .1], [.1, .1]], 4);
  const body = c.finish();
  // Squash the raised rear pocket before separating its two lower corners.
  const rear: CreasePattern = { side: .2, creases: body.pattern.creases.flatMap(e => {
    if (e.a[1] > .025 - 1e-9 && e.b[1] > .025 - 1e-9) return [];
    const a: Point = [...e.a], b: Point = [...e.b];
    if (a[1] > .025) { const t = (.025 - b[1]) / (a[1] - b[1]); a[0] = b[0] + t * (a[0] - b[0]); a[1] = .025; }
    if (b[1] > .025) { const t = (.025 - a[1]) / (b[1] - a[1]); b[0] = a[0] + t * (b[0] - a[0]); b[1] = .025; }
    return [{ ...e, a, b }];
  }) };
  const lines: [Point, Point][] = [
    [[-.05, .025], [-.025, .025]], [[.025, .025], [.05, .025]],
    [[-.025, .025], [-.05, .05]], [[.025, .025], [.05, .05]],
    [[-.025, .025], [.05, .1]], [[.025, .025], [-.05, .1]],
    [[-.05, .05], [.05, .05]],
  ];
  for (const s of [-1, 1]) for (const [a, b] of lines) rear.creases.push({ a: [s * (.05 - a[0]), a[1]], b: [s * (.05 - b[0]), b[1]], assignment: 'M', stage: 5 });
  rear.creases.push({ a: [0, .025], b: [0, .1], assignment: 'M', stage: 1 });
  const rg = graph(rear);
  assign(rg);
  rear.creases = rg.edges.filter(e => e.assignment !== 'B').map(e => ({ a: rg.vertices[e.a], b: rg.vertices[e.b], assignment: e.assignment as 'M' | 'V' | 'F', stage: e.stage }));
  c = new Construction(rear, () => 'body');
  const bm = c.facets.find(f => f.sheet.some(([x,y]) => x > 0 && y > .01) && f.sheet.some(([,y]) => y < .01) && f.sheet.every(([x]) => x >= -1e-9))!.map;
  const target = body.transforms[body.graph.faces.findIndex(f => f.some(v => body.graph.vertices[v][0] > 0 && body.graph.vertices[v][1] > .01) && f.some(v => body.graph.vertices[v][1] < .01) && f.every(v => body.graph.vertices[v][0] >= -1e-9))];
  for (const f of c.facets) {
    const m = f.map;
    const a = bm[0] * m[0] + bm[1] * m[1], b = bm[2] * m[0] + bm[3] * m[1];
    const d = bm[0] * m[2] + bm[1] * m[3], e = bm[2] * m[2] + bm[3] * m[3];
    const x = bm[0] * (m[4] - bm[4]) + bm[1] * (m[5] - bm[5]), y = bm[2] * (m[4] - bm[4]) + bm[3] * (m[5] - bm[5]);
    f.map = [target[0] * a + target[2] * b, target[1] * a + target[3] * b, target[0] * d + target[2] * e, target[1] * d + target[3] * e, target[0] * x + target[2] * y + target[4], target[1] * x + target[3] * y + target[5]];
  }
  for (const s of [-1, 1]) c.fold({ nx: s * Math.SQRT1_2, ny: -Math.SQRT1_2, d: 0 },
    s > 0 ? [[0, .1]] : [[-.1, .1], [.1, .1]], 6, s > 0 ? 'legR' : 'legL');
  // Keep the foot flaps separate until their knee hinges have been opened.
  const footX = .028, footZ = .041, footOffset = (.05 ** 2 - footX ** 2 - footZ ** 2) / 2;
  const footNormal = Math.hypot(footX, .05 - footZ);
  for (const s of [-1, 1]) c.fold({ nx: -s * footX / footNormal, ny: (.05 - footZ) / footNormal, d: footOffset / footNormal },
    s > 0 ? [[0, .1]] : [[-.1, .1], [.1, .1]], 7, s > 0 ? 'earR' : 'earL');
  // Close the rear Z pleat before opening the hip and knee hinges.
  c.fold({ nx: 0, ny: 1, d: .028 }, [[-.05, .05], [.05, .05]], 8);
  const closed = c.finish();
  c = new Construction(closed.pattern, () => 'body');
  c.facets.forEach((f, i) => { f.map = closed.transforms[i]; f.part = closed.parts[i]; });
  c.crease({ nx: 0, ny: 1, d: 0 }, 9);
  const rearFacets = c.facets.filter(f => f.sheet.every(p => transform(f.map, p)[1] >= -1e-9));
  c.facets = c.facets.filter(f => !rearFacets.includes(f));
  c.crease({ nx: 1, ny: 0, d: 0 }, 9);
  c.facets.push(...rearFacets);
  for (const f of c.facets) {
    const p = f.sheet.map(p => transform(f.map, p));
    const y = p.reduce((s, p) => s + p[1], 0) / p.length;
    if (!f.part.startsWith('leg') && !f.part.startsWith('ear')) f.part = y < 0 ? 'head' : 'body';
  }
  const construction = c.finish();
  const hips = [-1, 1].map(s => [...new Set(construction.graph.faces.flatMap((f, i) =>
    [s < 0 ? 'legL' : 'legR', s < 0 ? 'earL' : 'earR'].includes(construction.parts[i]) ? f : []))]);
  const feet = [-1, 1].map(s => [...new Set(construction.graph.faces.flatMap((f, i) => construction.parts[i] === (s < 0 ? 'earL' : 'earR') ? f : []))]);
  construction.parts = construction.parts.map(p => p === 'earL' ? 'legL' : p === 'earR' ? 'legR' : p);
  return {
    kind: 'frog', construction,
    shape(flat) {
      const positions: Position[] = flat.positions.map(([x, z]) => [x, 0, z]);
      for (const [i, s] of [-1, 1].entries()) {
        const knee: [Position, Position] = [[0, 0, footOffset / (.05 - footZ)],
          [s * .025, 0, (footOffset + footX * .025) / (.05 - footZ)]];
        for (const v of feet[i]) positions[v] = rotate(positions[v], knee, s * Math.PI / 2);
        for (const v of hips[i]) positions[v] = rotate(positions[v], [[0, 0, 0], [s * .025, 0, .025]], s * 110 * Math.PI / 180);
      }
      const pitch = 2 * Math.PI / 180;
      return { positions: positions.map(([x, y, z]) => [x, y * Math.cos(pitch) - z * Math.sin(pitch), z * Math.cos(pitch) + y * Math.sin(pitch)] as Position),
        flatPositions: flat.positions.map(([x, z]) => [x, 0, z] as Position) };
    },
    rig: { body: 'body', head: 'head', legL: 'legL', legR: 'legR' },
    // Match the differently triangulated halves of the doubled head.
    eyes: [-1, 1].map(s => ({ face: { part: 'head', side: s < 0 ? 'left' : 'right' }, weights: s < 0 ? [.28, .47424, .24576] : [.5, .149269, .350731], normal: [0, 1, 0], radius: .0018 })),
    touchesGround: true,
  };
}
