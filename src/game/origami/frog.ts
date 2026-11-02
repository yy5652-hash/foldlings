import { birdBase } from './bird-base.js';
import { Construction } from './construction.js';
import type { Definition } from './definition.js';
import type { Point } from './pattern.js';
import type { Position } from './relax.js';

export function frog(): Definition {
  const c = new Construction(birdBase(), () => 'body');
  for (const s of [-1, 1]) {
    const front: Point = s < 0 ? [-.1, .1] : [.1, -.1];
    const back: Point = s < 0 ? [.1, .1] : [-.1, -.1];
    c.fold({ nx: -1, ny: 0, d: .038 }, [front], 3);
    const a = 55 * Math.PI / 180;
    c.fold({ nx: -Math.cos(a), ny: s * Math.sin(a), d: 0 }, [front], 4, s < 0 ? 'legR' : 'legL');
    const b = 30 * Math.PI / 180;
    c.fold({ nx: Math.cos(b), ny: s * Math.sin(b), d: Math.cos(b) * .06 }, [back], 5, s < 0 ? 'legR' : 'legL');
    c.fold({ nx: -.5, ny: -s * Math.sqrt(3) / 2, d: -.02 + .055 * Math.sqrt(3) / 2 }, [back], 6);
  }
  c.crease({ nx: 0, ny: 1, d: 0 }, 7);
  c.crease({ nx: 1, ny: 0, d: 0 }, 7);
  c.crease({ nx: 1, ny: 0, d: .025 }, 7);
  for (const s of [-1, 1]) c.crease({ nx: -Math.SQRT1_2, ny: s * Math.SQRT1_2, d: 0 }, 7);
  for (const f of c.facets) {
    const u = f.sheet.reduce((sum, p) => sum + f.map[0] * p[0] + f.map[2] * p[1] + f.map[4], 0) / f.sheet.length;
    const v = f.sheet.reduce((sum, p) => sum + f.map[1] * p[0] + f.map[3] * p[1] + f.map[5], 0) / f.sheet.length;
    f.part = f.part.startsWith('leg') || u < .025 && Math.abs(v) > u ? v < 0 ? 'legL' : 'legR' : u < .025 ? 'head' : 'body';
  }
  const construction = c.finish();
  return {
    kind: 'frog', construction,
    shape(flat) {
      const angle = 18 * Math.PI / 180;
      return {
        positions: flat.positions.map(([u, v]) => [v * Math.cos(angle), -Math.abs(v) * Math.sin(angle), u] as Position),
        flatPositions: flat.positions.map(([u, v]) => [v, 0, u] as Position),
      };
    },
    rig: { body: 'body', head: 'head', legL: 'legL', legR: 'legR' },
    eyes: [-1, 1].map(s => ({ face: { part: 'head', side: s < 0 ? 'left' : 'right' }, weights: [.4, .4, .2], normal: [0, 1, 0], radius: .0018 })),
    touchesGround: true,
  };
}
