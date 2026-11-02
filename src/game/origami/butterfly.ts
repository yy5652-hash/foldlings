import { Construction } from './construction.js';
import type { Definition } from './definition.js';
import { transform } from './flat.js';
import type { CreasePattern } from './pattern.js';

export function butterfly(): Definition {
  const base: CreasePattern = { side: .2, creases: [
    { a: [-.1, -.1], b: [.1, .1], assignment: 'M', stage: 1 },
    { a: [-.1, .1], b: [.1, -.1], assignment: 'M', stage: 1 },
    { a: [-.1, 0], b: [.1, 0], assignment: 'V', stage: 1 },
  ] };
  const c = new Construction(base, () => 'body');
  // Fold the front corners toward the apex, leaving separate hindwing tips.
  const dx = .1 - .035, dz = .1 - .015, length = Math.hypot(dx, dz);
  for (const s of [-1, 1]) {
    const nx = s * dx / length, nz = dz / length;
    c.fold({ nx: (nx + nz) * Math.SQRT1_2, ny: (nx - nz) * Math.SQRT1_2,
      d: (dx * .0675 + dz * .0575) / length }, [[s * .1, .1]], 2);
  }
  // Turn the apex into the leading head before tucking the hindwing shoulders.
  c.fold({ nx: -Math.SQRT1_2, ny: Math.SQRT1_2, d: -.055 }, [[0, 0]], 3);
  const shoulder = (dx * .0675 + dz * .0575) / (dx + dz), tuck = Math.hypot(1, .2);
  for (const s of [-1, 1]) c.fold({ nx: (s + .2) * Math.SQRT1_2 / tuck,
    ny: (s - .2) * Math.SQRT1_2 / tuck, d: .04 / tuck }, [[s * shoulder, shoulder]], 4);
  for (const s of [-1, 1]) c.fold({ nx: (s - .75) * Math.SQRT1_2 / Math.hypot(1, .75),
    ny: (s + .75) * Math.SQRT1_2 / Math.hypot(1, .75), d: -.015 / Math.hypot(1, .75) }, [[s * .1, -.1]], 4);
  c.fold({ nx: Math.SQRT1_2, ny: -Math.SQRT1_2, d: .105 }, [[-.1, -.1], [.1, -.1]], 5);
  for (const s of [-1, 1]) c.fold({ nx: (.2 * s - 1) * Math.SQRT1_2 / tuck,
    ny: (.2 * s + 1) * Math.SQRT1_2 / tuck, d: -.018 / tuck }, [[s * .1, .1]], 6);
  for (const s of [-1, 1]) c.crease({ nx: s * Math.SQRT1_2, ny: s * Math.SQRT1_2, d: .004 }, 7);
  c.crease({ nx: Math.SQRT1_2, ny: -Math.SQRT1_2, d: .095 }, 7);
  for (const f of c.facets) {
    const points = f.sheet.map(p => transform(f.map, p));
    const x = points.reduce((sum, [u, v]) => sum + (u + v) * Math.SQRT1_2, 0) / points.length;
    const z = points.reduce((sum, [u, v]) => sum + (u - v) * Math.SQRT1_2, 0) / points.length;
    f.part = Math.abs(x) > .004 + 1e-9 ? x < 0 ? 'wingL' : 'wingR' : z > .095 ? 'head' : 'body';
  }
  const construction = c.finish();
  return {
    kind: 'butterfly', construction,
    shape(flat) {
      const angle = 15 * Math.PI / 180;
      return { positions: flat.positions.map(([u, v]) => {
        const x = (u + v) * Math.SQRT1_2, z = (u - v) * Math.SQRT1_2;
        const wing = Math.max(0, Math.abs(x) - .004);
        return [x - Math.sign(x) * wing * (1 - Math.cos(angle)), wing * Math.sin(angle), .08 - z];
      }), flatPositions: flat.positions.map(([u, v]) => [(u + v) * Math.SQRT1_2, 0, .08 - (u - v) * Math.SQRT1_2]) };
    },
    rig: { body: 'body', head: 'body', wingL: 'wingL', wingR: 'wingR' },
    eyes: [-1, 1].map(s => ({ face: { part: 'head', side: s < 0 ? 'left' : 'right' }, weights: s < 0 ? [.25, .25, .5] : [.25, .5, .25], normal: [0, 1, 0], radius: .001 })),
    touchesGround: false,
  };
}
