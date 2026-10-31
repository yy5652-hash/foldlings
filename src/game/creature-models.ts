/**
 * Origami creature models: faceted paper solids and two-sided sheets, with
 * crease lines along every fold and ink-dot eyes. Pure geometry (no DOM, no
 * audio, no World), so the asset manifest and the game build identical rigs.
 *
 * Units are metres. Origin is the contact point, +Y is up, the creature faces
 * -Z. Animated parts hang from pivot groups; `folds` lists how each pivot
 * lies flat on the paper before the creature folds itself up.
 */

import {
  BufferGeometry,
  Color,
  EdgesGeometry,
  Float32BufferAttribute,
  FrontSide,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from '@iwsdk/core';
import type { CreatureKind } from './levels.js';

export type P = [number, number, number];
type Tri = [P, P, P];

/** A pivot that lies flat (rotated by `angle` about `axis`) until its beat. */
export interface Fold {
  obj: Object3D;
  axis: Vector3;
  angle: number;
  beat: number;
}

export interface Rig {
  /** Parentless; origin at the contact point, facing -Z. */
  root: Group;
  /** Everything visible; idle squash and the fold-up flatten act on it. */
  body: Group;
  /** Turns towards the player when present; otherwise the body turns. */
  head: Object3D | null;
  eyes: Object3D[];
  wingL?: Object3D;
  wingR?: Object3D;
  tail?: Object3D;
  legL?: Object3D;
  legR?: Object3D;
  earL?: Object3D;
  earR?: Object3D;
  folds: Fold[];
  /** Crease lines; brightened while the creature folds itself up. */
  lines: LineBasicMaterial;
  /** Every crease-line object, hidden on far-away creatures to save draw calls. */
  edges: LineSegments[];
}

const paper = new MeshStandardMaterial({ vertexColors: true, side: FrontSide, roughness: 0.82, metalness: 0, envMapIntensity: 0.95 });
const eyeMat = new MeshBasicMaterial({ vertexColors: true });

/** One unit eye: a flattened ink dot with its white glint, in one draw call. */
function eyeGeometry(): BufferGeometry {
  const ball = new IcosahedronGeometry(1, 2);
  ball.scale(1, 1, 0.45);
  const glint = new IcosahedronGeometry(1, 1);
  glint.scale(0.3, 0.3, 0.3);
  glint.translate(0.32, 0.36, 0.36);
  const pos: number[] = [];
  const col: number[] = [];
  for (const [g, c] of [
    [ball, [0.105, 0.09, 0.078]],
    [glint, [1, 1, 1]],
  ] as const) {
    const a = g.getAttribute('position');
    for (let i = 0; i < a.count; i++) {
      pos.push(a.getX(i), a.getY(i), a.getZ(i));
      col.push(c[0], c[1], c[2]);
    }
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new Float32BufferAttribute(col, 3));
  return out;
}
const eyeGeo = eyeGeometry();
const INK = new Color(0x2a2420);

const sub = (a: P, b: P): Vector3 => new Vector3(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const mix = (pts: P[], w: number[]): P => {
  const o: P = [0, 0, 0];
  pts.forEach((p, i) => {
    o[0] += p[0] * w[i];
    o[1] += p[1] * w[i];
    o[2] += p[2] * w[i];
  });
  return o;
};
const mirror = (p: P): P => [-p[0], p[1], p[2]];
const mean = (pts: P[]): P => mix(pts, pts.map(() => 1 / pts.length));

/**
 * Collects coloured triangles. Solids orient every face away from their
 * centre; sheets (wings, fins, ears) are drawn on both sides.
 */
class Model {
  private pos: number[] = [];
  private col: number[] = [];
  private n = 0;

  constructor(
    private lines: LineBasicMaterial,
    private edgeList: LineSegments[],
  ) {}

  private push(t: Tri, color: Color, shade: number) {
    // A faint per-face variation makes flat paper read as separate facets.
    const s = shade * (1 + (((this.n++ * 7919) % 9) - 4) * 0.012);
    for (const p of t) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(color.r * s, color.g * s, color.b * s);
    }
  }

  solid(faces: Tri[], color: Color, shade = 1, center?: P) {
    const c = center ?? mean(faces.flat());
    for (const f of faces) {
      const nrm = new Vector3().crossVectors(sub(f[1], f[0]), sub(f[2], f[0]));
      const out = sub(mean(f), c);
      this.push(nrm.dot(out) >= 0 ? f : [f[0], f[2], f[1]], color, shade);
    }
  }

  sheet(a: P, b: P, c: P, front: Color, back: Color = front, shade = 1) {
    this.push([a, b, c], front, shade);
    this.push([a, c, b], back, shade * 0.86);
  }

  build(): Group {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    const out = new Group();
    const mesh = new Mesh(g, paper);
    mesh.castShadow = true;
    mesh.name = 'Paper';
    const edges = new LineSegments(new EdgesGeometry(g, 14), this.lines);
    edges.name = 'Creases';
    this.edgeList.push(edges);
    out.add(mesh, edges);
    return out;
  }
}

const cone = (ring: P[], apex: P): Tri[] => ring.map((p, k) => [p, ring[(k + 1) % ring.length], apex]);
const tetra = (a: P, b: P, c: P, apex: P): Tri[] => [[a, b, c], ...cone([a, b, c], apex)];

/** Per-rig state shared by the part builders below. */
class Kit {
  readonly lines = new LineBasicMaterial({ color: INK, transparent: true, opacity: 0.35 });
  readonly eyes: Object3D[] = [];
  readonly folds: Fold[] = [];
  readonly edges: LineSegments[] = [];

  constructor(
    readonly o: Color,
    readonly i: Color,
  ) {}

  model(): Model {
    return new Model(this.lines, this.edges);
  }

  /** An ink-dot eye sitting on face `f` of a solid centred at `c`. */
  eye(f: Tri, w: number[], c: P, r: number): Object3D {
    const p = mix(f, w);
    const n = new Vector3().crossVectors(sub(f[1], f[0]), sub(f[2], f[0])).normalize();
    if (n.dot(sub(p, c)) < 0) n.negate();
    const g = new Group();
    g.name = 'Eye';
    g.position.set(p[0], p[1], p[2]).addScaledVector(n, r * 0.15);
    g.lookAt(g.position.clone().add(n));
    const ball = new Mesh(eyeGeo, eyeMat);
    ball.name = 'Ink';
    ball.scale.setScalar(r);
    g.add(ball);
    this.eyes.push(g);
    return g;
  }

  /** Both eyes: `f` is the right-hand (+X) face; the left one is mirrored. */
  eyes2(f: Tri, w: number[], c: P, r: number): Object3D[] {
    return [this.eye(f, w, c, r), this.eye(f.map(mirror) as Tri, w, mirror(c), r)];
  }

  /** Hangs `content` (authored in model space) from a pivot at `at`. */
  hinge(name: string, at: P, ...content: Object3D[]): Group {
    const g = new Group();
    g.name = name;
    g.position.set(at[0], at[1], at[2]);
    const inner = new Group();
    inner.position.set(-at[0], -at[1], -at[2]);
    inner.add(...content);
    g.add(inner);
    return g;
  }

  fold(obj: Object3D, axis: P, angle: number, beat: number) {
    this.folds.push({ obj, axis: new Vector3(...axis).normalize(), angle, beat });
  }
}

interface Parts {
  body: Group;
  head?: Object3D;
  wingL?: Object3D;
  wingR?: Object3D;
  tail?: Object3D;
  legL?: Object3D;
  legR?: Object3D;
  earL?: Object3D;
  earR?: Object3D;
}

function crane(k: Kit): Parts {
  const body = new Group();
  const m = k.model();
  const F: P = [0, 0.05, -0.046];
  const B: P = [0, 0.05, 0.046];
  const R: P = [0.03, 0.052, 0];
  const L = mirror(R);
  m.solid(
    [...cone([F, R, B, L], [0, 0.08, 0]), ...cone([F, R, B, L], [0, 0.004, 0])],
    k.o,
  );
  body.add(m.build());

  // Head: a small bent point at the top of the neck, beak forward and down.
  const hm = k.model();
  const ha: P = [-0.0045, 0.129, -0.088];
  const hb: P = [0.0045, 0.129, -0.088];
  const hc: P = [0, 0.141, -0.086];
  const tip: P = [0, 0.116, -0.126];
  const hf = tetra(ha, hb, hc, tip);
  hm.solid(hf, k.o, 1.05);
  const hcen = mean([ha, hb, hc, tip]);
  const head = k.hinge('Head', [0, 0.132, -0.09], hm.build(), ...k.eyes2([hb, hc, tip], [0.45, 0.4, 0.15], hcen, 0.0032));

  const nm = k.model();
  nm.solid(tetra([-0.0065, 0.05, -0.036], [0.0065, 0.05, -0.036], [0, 0.068, -0.032], [0, 0.136, -0.092]), k.o, 0.95);
  const neck = k.hinge('Neck', [0, 0.056, -0.038], nm.build(), head);
  const tm = k.model();
  tm.solid(tetra([-0.0065, 0.05, 0.036], [0.0065, 0.05, 0.036], [0, 0.068, 0.032], [0, 0.132, 0.104]), k.o, 0.95);
  const tail = k.hinge('Tail', [0, 0.056, 0.038], tm.build());

  const wing = (sx: number) => {
    const w = k.model();
    const s = (p: P): P => [p[0] * sx, p[1], p[2]];
    const rf = s([0.006, 0.07, -0.034]);
    const rm = s([0.008, 0.081, 0.004]);
    const rb = s([0.006, 0.07, 0.038]);
    const t = s([0.122, 0.104, 0.014]);
    w.sheet(rf, rm, t, k.o, k.o, 1.06);
    w.sheet(rm, rb, t, k.o, k.o, 0.97);
    return k.hinge(sx > 0 ? 'WingR' : 'WingL', s([0.004, 0.072, 0]), w.build());
  };
  const wingR = wing(1);
  const wingL = wing(-1);
  body.add(neck, tail, wingL, wingR);
  k.fold(wingR, [0, 0, 1], -0.95, 1);
  k.fold(wingL, [0, 0, 1], 0.95, 1);
  k.fold(neck, [1, 0, 0], -0.95, 2);
  k.fold(tail, [1, 0, 0], 0.86, 2);
  k.fold(head, [1, 0, 0], 0.7, 3);
  return { body, head, wingL, wingR, tail };
}

function frog(k: Kit): Parts {
  const body = new Group();
  const m = k.model();
  const N: P = [0, 0.032, -0.064];
  const R: P = [0.05, 0.028, 0.002];
  const B: P = [0, 0.036, 0.054];
  const L = mirror(R);
  const c: P = [0, 0.036, 0];
  m.solid(cone([N, R, B, L], [0, 0.074, -0.006]), k.o, 1, c);
  m.solid(cone([N, R, B, L], [0, 0.002, 0]), k.i, 0.92, c);
  // Front legs splay forward onto the ground.
  m.sheet([0.028, 0.02, -0.04], [0.058, 0.001, -0.074], [0.026, 0.001, -0.064], k.o, k.i);
  m.sheet(mirror([0.028, 0.02, -0.04]), mirror([0.026, 0.001, -0.064]), mirror([0.058, 0.001, -0.074]), k.o, k.i);
  body.add(m.build());

  // Eye bumps: little pyramids with the ink dots on their front faces.
  const em = k.model();
  const ea: P = [0.01, 0.057, -0.04];
  const eb: P = [0.038, 0.05, -0.032];
  const ec: P = [0.024, 0.064, -0.012];
  const ex: P = [0.025, 0.079, -0.03];
  const bump = tetra(ea, eb, ec, ex);
  em.solid(bump, k.o, 1.04);
  em.solid(bump.map((f) => f.map(mirror) as Tri), k.o, 1.04);
  const eyes = k.eyes2([ea, eb, ex], [0.3, 0.3, 0.4], mean([ea, eb, ec, ex]), 0.0055);
  const head = k.hinge('Head', [0, 0.05, -0.02], em.build(), ...eyes);

  const leg = (sx: number) => {
    const s = (p: P): P => [p[0] * sx, p[1], p[2]];
    const g = k.model();
    const hip = s([0.032, 0.042, -0.002]);
    const knee = s([0.07, 0.036, 0.032]);
    const heel = s([0.036, 0.003, 0.04]);
    const toe = s([0.062, 0.001, 0.074]);
    if (sx < 0) {
      g.sheet(hip, knee, heel, k.o, k.i, 1.04);
      g.sheet(knee, toe, heel, k.o, k.i, 0.95);
    } else {
      g.sheet(hip, heel, knee, k.o, k.i, 1.04);
      g.sheet(knee, heel, toe, k.o, k.i, 0.95);
    }
    return k.hinge(sx > 0 ? 'LegR' : 'LegL', s([0.034, 0.03, 0.02]), g.build());
  };
  const legR = leg(1);
  const legL = leg(-1);
  body.add(head, legL, legR);
  k.fold(legR, [0, 0, 1], -0.5, 1);
  k.fold(legL, [0, 0, 1], 0.5, 1);
  k.fold(head, [1, 0, 0], -0.6, 2);
  return { body, head, legL, legR };
}

function fox(k: Kit): Parts {
  const body = new Group();
  const m = k.model();
  const F: P = [0, 0, -0.036];
  const R: P = [0.044, 0, 0.012];
  const B: P = [0, 0, 0.052];
  const L = mirror(R);
  const A: P = [0, 0.094, -0.004];
  const bc = mean([F, R, B, L, A]);
  m.solid([...cone([F, R, B, L], A), [F, L, B], [F, B, R]], k.o, 1, bc);
  // White chest: a sheet laid over the front ridge.
  const lift = (p: P, d: number): P => [p[0], p[1], p[2] - d];
  const top = lift(mix([A, F], [0.78, 0.22]), 0.0016);
  const fl = lift(mix([A, F, L], [0.16, 0.6, 0.24]), 0.0016);
  const fr = lift(mix([A, F, R], [0.16, 0.6, 0.24]), 0.0016);
  const fb = lift(mix([A, F], [0.12, 0.88]), 0.0022);
  m.sheet(top, fl, fb, k.i, k.i);
  m.sheet(top, fb, fr, k.i, k.i);
  body.add(m.build());

  const hm = k.model();
  const TL: P = [-0.037, 0.118, -0.006];
  const TR = mirror(TL);
  const Fh: P = [0, 0.128, -0.024];
  const S: P = [0, 0.08, -0.07];
  const Bk: P = [0, 0.124, 0.022];
  const C: P = [0, 0.084, 0.002];
  const hc = mean([TL, TR, Fh, S, Bk, C]);
  const faceR: Tri = [Fh, TR, S];
  hm.solid(
    [[TL, Fh, S], faceR, [TL, Bk, Fh], [Fh, Bk, TR], [TL, S, C], [TR, C, S], [TL, C, Bk], [TR, Bk, C]],
    k.o,
    1.03,
    hc,
  );
  // Nose tip.
  hm.solid(tetra([-0.005, 0.083, -0.064], [0.005, 0.083, -0.064], [0, 0.088, -0.06], [0, 0.079, -0.073]), INK, 1);
  const ear = (sx: number) => {
    const s = (p: P): P => [p[0] * sx, p[1], p[2]];
    const a = s([0.012, 0.12, -0.012]);
    const b = s([0.039, 0.118, -0.006]);
    const c = s([0.026, 0.123, 0.012]);
    const tip = s([0.033, 0.172, -0.002]);
    const e = k.model();
    e.solid(tetra(a, b, c, tip), k.o, 1.08);
    const inA = mix([a, b, tip], [0.42, 0.42, 0.16]);
    const inB = mix([a, tip, b], [0.8, 0.1, 0.1]);
    const inC = mix([b, tip, a], [0.8, 0.1, 0.1]);
    const out = (p: P): P => [p[0], p[1] + 0.0004, p[2] - 0.0016];
    e.sheet(out(inB), out(inC), out(mix([inA, tip], [0.2, 0.8])), k.i, k.i);
    return k.hinge(sx > 0 ? 'EarR' : 'EarL', s([0.026, 0.12, 0]), e.build());
  };
  const earR = ear(1);
  const earL = ear(-1);
  const eyes = k.eyes2(faceR, [0.34, 0.4, 0.26], hc, 0.0048);
  const head = k.hinge('Head', [0, 0.09, -0.006], hm.build(), earL, earR, ...eyes);

  const t = k.model();
  const r0: P = [0.012, 0.012, 0.042];
  const mt: P = [0.062, 0.05, 0.052];
  const mb: P = [0.066, 0.004, 0.068];
  const tip: P = [0.12, 0.02, 0.06];
  t.sheet(r0, mt, tip, k.o, k.o, 1.04);
  t.sheet(r0, tip, mb, k.o, k.o, 0.94);
  const lt = mix([mt, tip], [0.4, 0.6]);
  const lb = mix([mb, tip], [0.4, 0.6]);
  t.sheet([lt[0], lt[1], lt[2] - 0.0012], [tip[0], tip[1], tip[2] - 0.0012], [lb[0], lb[1], lb[2] - 0.0012], k.i, k.i);
  const tail = k.hinge('Tail', [0.014, 0.01, 0.04], t.build());
  body.add(head, tail);
  k.fold(tail, [0, 1, 0], 1.1, 1);
  k.fold(head, [1, 0, 0], -0.9, 2);
  k.fold(earL, [0, 0, 1], 1.2, 3);
  k.fold(earR, [0, 0, 1], -1.2, 3);
  return { body, head, tail, earL, earR };
}

function fish(k: Kit): Parts {
  const body = new Group();
  const m = k.model();
  const N: P = [0, 0.004, -0.084];
  const R: P = [0.022, 0.004, -0.012];
  const K: P = [0, 0.004, 0.05];
  const L = mirror(R);
  const T: P = [0, 0.05, -0.008];
  const D: P = [0, -0.042, -0.002];
  const c = mean([N, R, K, L, T, D]);
  m.solid(cone([N, R, K, L], T), k.o, 1, c);
  m.solid(cone([N, R, K, L], D), k.i, 0.95, c);
  m.sheet([0, 0.046, -0.014], [0, 0.04, 0.016], [0, 0.07, 0.014], k.o);
  m.sheet([0.018, 0.0, -0.024], [0.042, -0.014, 0.002], [0.018, -0.006, 0.002], k.o, k.i);
  m.sheet(mirror([0.018, 0.0, -0.024]), mirror([0.018, -0.006, 0.002]), mirror([0.042, -0.014, 0.002]), k.o, k.i);
  const eyes = k.eyes2([T, N, R], [0.24, 0.48, 0.28], c, 0.0055);
  body.add(m.build(), ...eyes);
  const t = k.model();
  const root: P = [0, 0.004, 0.046];
  const mid: P = [0.005, 0.006, 0.086];
  t.sheet(root, [0, 0.054, 0.106], mid, k.o, k.o, 1.04);
  t.sheet(root, mid, [0, -0.044, 0.106], k.o, k.o, 0.94);
  const tail = k.hinge('Tail', root, t.build());
  body.add(tail);
  k.fold(tail, [0, 0, 1], 1.4, 1);
  return { body, tail };
}

function butterfly(k: Kit): Parts {
  const body = new Group();
  const m = k.model();
  const dark = new Color(0x3b3027);
  const c: P = [0, 0.007, 0.002];
  m.solid(
    [...cone([[0, 0.007, -0.03], [0.006, 0.007, 0], [0, 0.007, 0.04], [-0.006, 0.007, 0]], [0, 0.014, 0]),
      ...cone([[0, 0.007, -0.03], [0.006, 0.007, 0], [0, 0.007, 0.04], [-0.006, 0.007, 0]], [0, 0.0, 0])],
    dark,
    1,
    c,
  );
  const H: P[] = [[0, 0.009, -0.044], [0.008, 0.009, -0.034], [0, 0.009, -0.026], [-0.008, 0.009, -0.034]];
  const hc: P = [0, 0.009, -0.035];
  const headFaces = [...cone(H, [0, 0.018, -0.035]), ...cone(H, [0, 0.0, -0.035])];
  m.solid(headFaces, dark, 1.1, hc);
  m.sheet([0.002, 0.014, -0.04], [0.004, 0.016, -0.04], [0.016, 0.03, -0.066], dark, dark);
  m.sheet(mirror([0.002, 0.014, -0.04]), mirror([0.016, 0.03, -0.066]), mirror([0.004, 0.016, -0.04]), dark, dark);
  const eyes = k.eyes2([H[0], H[1], [0, 0.018, -0.035]], [0.4, 0.4, 0.2], hc, 0.0028);
  body.add(m.build(), ...eyes);
  const wing = (sx: number) => {
    const s = (p: P): P => [p[0] * sx, p[1], p[2]];
    const w = k.model();
    const tri = (a: P, b: P, cc: P, col: Color, shade = 1) =>
      sx > 0 ? w.sheet(s(a), s(b), s(cc), col, col, shade) : w.sheet(s(a), s(cc), s(b), col, col, shade);
    // Forewing with a crease from root to the outer corner, hindwing below.
    tri([0.003, 0.008, -0.024], [0.09, 0.012, -0.058], [0.072, 0.01, -0.004], k.o, 1.06);
    tri([0.003, 0.008, -0.024], [0.072, 0.01, -0.004], [0.004, 0.008, 0.002], k.o, 0.96);
    tri([0.004, 0.0075, 0.0], [0.066, 0.008, 0.012], [0.04, 0.0075, 0.058], k.o, 0.9);
    tri([0.004, 0.0075, 0.0], [0.04, 0.0075, 0.058], [0.006, 0.0075, 0.03], k.o, 0.84);
    const up = 0.0009;
    tri([0.05, 0.010 + up, -0.03], [0.07, 0.0105 + up, -0.042], [0.064, 0.0102 + up, -0.016], k.i);
    tri([0.032, 0.0078 + up, 0.02], [0.046, 0.0079 + up, 0.03], [0.034, 0.0078 + up, 0.04], k.i);
    return k.hinge(sx > 0 ? 'WingR' : 'WingL', s([0.002, 0.008, 0]), w.build());
  };
  const wingR = wing(1);
  const wingL = wing(-1);
  wingR.rotation.z = 0.5;
  wingL.rotation.z = -0.5;
  body.add(wingL, wingR);
  k.fold(wingR, [0, 0, 1], -0.5, 1);
  k.fold(wingL, [0, 0, 1], 0.5, 1);
  return { body, wingL, wingR };
}

function boat(k: Kit): Parts {
  const body = new Group();
  const m = k.model();
  const FT: P = [0, 0.046, -0.094];
  const BT: P = [0, 0.046, 0.094];
  const KF: P = [-0.012, 0, -0.048];
  const KB: P = [-0.012, 0, 0.048];
  const KF2 = mirror(KF);
  const KB2 = mirror(KB);
  const RL: P = [-0.04, 0.046, 0];
  const RR = mirror(RL);
  const c: P = [0, 0.022, 0];
  const bow: Tri = [FT, KF2, RR];
  m.solid(
    [[FT, RL, KF], [RL, KB, KF], [RL, BT, KB], bow, [RR, KF2, KB2], [RR, KB2, BT], [KF, KB, KB2], [KF, KB2, KF2], [FT, KF, KF2], [BT, KB2, KB]],
    k.o,
    1,
    c,
  );
  m.solid([[FT, RR, RL], [RL, RR, BT]], k.o, 1.12, c);
  // The tent-shaped sail of a paper boat, white inside out.
  const sail = k.model();
  const sl: P = [-0.007, 0.044, -0.06];
  const sb: P = [-0.007, 0.044, 0.06];
  const top: P = [0, 0.124, 0];
  sail.solid([[sl, sb, top], [mirror(sl), top, mirror(sb)], [sl, mirror(sl), top], [sb, top, mirror(sb)]], k.i, 1, [0, 0.07, 0]);
  const eyes = k.eyes2(bow, [0.3, 0.28, 0.42], c, 0.0062);
  const sailPivot = k.hinge('Sail', [0, 0.046, 0], sail.build());
  body.add(m.build(), sailPivot, ...eyes);
  k.fold(sailPivot, [0, 0, 1], 1.5, 1);
  return { body, tail: sailPivot };
}

function rabbit(k: Kit): Parts {
  const body = new Group();
  const m = k.model();
  const ring: P[] = [
    [0, 0.032, -0.032],
    [0.032, 0.034, -0.012],
    [0.032, 0.038, 0.026],
    [0, 0.042, 0.048],
    [-0.032, 0.038, 0.026],
    [-0.032, 0.034, -0.012],
  ];
  const c: P = [0, 0.036, 0.008];
  m.solid(cone(ring, [0, 0.078, 0.012]), k.o, 1, c);
  m.solid(cone(ring, [0, 0.0, 0.01]), k.o, 0.9, c);
  const tc: P = [0, 0.034, 0.056];
  const puff: P[] = [[0, 0.034, 0.046], [0.012, 0.034, 0.056], [0, 0.034, 0.068], [-0.012, 0.034, 0.056]];
  m.solid([...cone(puff, [0, 0.048, 0.056]), ...cone(puff, [0, 0.02, 0.056])], k.i, 1, tc);
  m.sheet([0.012, 0.016, -0.03], [0.022, 0.001, -0.05], [0.006, 0.001, -0.046], k.o, k.i);
  m.sheet(mirror([0.012, 0.016, -0.03]), mirror([0.006, 0.001, -0.046]), mirror([0.022, 0.001, -0.05]), k.o, k.i);
  body.add(m.build());

  const hm = k.model();
  const Fr: P = [0, 0.084, -0.062];
  const Bk: P = [0, 0.1, 0.006];
  const Tp: P = [0, 0.122, -0.022];
  const Bt: P = [0, 0.07, -0.022];
  const Rt: P = [0.03, 0.096, -0.024];
  const Lt = mirror(Rt);
  const hc = mean([Fr, Bk, Tp, Bt, Rt, Lt]);
  const faceR: Tri = [Tp, Fr, Rt];
  hm.solid([...cone([Fr, Rt, Bk, Lt], Tp), ...cone([Fr, Rt, Bk, Lt], Bt)], k.o, 1.03, hc);
  hm.solid(tetra([-0.006, 0.087, -0.058], [0.006, 0.087, -0.058], [0, 0.092, -0.056], [0, 0.084, -0.066]), k.i, 0.95);
  const ear = (sx: number) => {
    const s = (p: P): P => [p[0] * sx, p[1], p[2]];
    const e = k.model();
    const a = s([0.004, 0.116, -0.02]);
    const b = s([0.024, 0.112, -0.01]);
    const ridge = s([0.016, 0.118, -0.006]);
    const tip = s([0.022, 0.19, 0.004]);
    const f = (p: P, q: P, r: P, col: Color, sh: number) => (sx > 0 ? e.sheet(p, q, r, col, k.o, sh) : e.sheet(p, r, q, col, k.o, sh));
    f(a, ridge, tip, k.o, 1.06);
    f(ridge, b, tip, k.o, 0.96);
    const inner = (p: P): P => [p[0], p[1], p[2] - 0.0014];
    f(inner(mix([a, ridge], [0.6, 0.4])), inner(mix([ridge, b], [0.4, 0.6])), inner(mix([ridge, tip], [0.15, 0.85])), k.i, 1);
    return k.hinge(sx > 0 ? 'EarR' : 'EarL', s([0.014, 0.114, -0.012]), e.build());
  };
  const earR = ear(1);
  const earL = ear(-1);
  const eyes = k.eyes2(faceR, [0.32, 0.3, 0.38], hc, 0.0048);
  const head = k.hinge('Head', [0, 0.074, -0.012], hm.build(), earL, earR, ...eyes);
  head.scale.setScalar(1.2);
  body.add(head);
  k.fold(head, [1, 0, 0], -0.8, 1);
  k.fold(earL, [0, 0, 1], 1.3, 2);
  k.fold(earR, [0, 0, 1], -1.3, 2);
  return { body, head, earL, earR };
}

function whale(k: Kit): Parts {
  const body = new Group();
  const m = k.model();
  const ring: P[] = [
    [0, -0.004, -0.186],
    [0.054, 0.0, -0.13],
    [0.08, 0.002, -0.03],
    [0.04, 0.008, 0.09],
    [0, 0.012, 0.15],
    [-0.04, 0.008, 0.09],
    [-0.08, 0.002, -0.03],
    [-0.054, 0.0, -0.13],
  ];
  const T: P = [0, 0.092, -0.06];
  const D: P = [0, -0.066, -0.07];
  const c = mean([...ring, T, D]);
  const top = cone(ring, T);
  m.solid(top, k.o, 1, c);
  m.solid(cone(ring, D), k.i, 0.95, c);
  m.sheet([0.066, -0.012, -0.074], [0.066, -0.014, -0.034], [0.128, -0.03, -0.03], k.o, k.i);
  m.sheet(mirror([0.066, -0.012, -0.074]), mirror([0.128, -0.03, -0.03]), mirror([0.066, -0.014, -0.034]), k.o, k.i);
  const eyes = k.eyes2(top[1], [0.24, 0.5, 0.26], c, 0.0085);
  body.add(m.build(), ...eyes);
  const t = k.model();
  const root: P = [0, 0.012, 0.146];
  const fr: P = [0.1, 0.034, 0.226];
  const fm: P = [0.012, 0.018, 0.2];
  t.sheet(root, fm, fr, k.o, k.i, 1.04);
  t.sheet(root, mirror(fr), mirror(fm), k.o, k.i, 1.04);
  t.sheet(root, mirror(fm), fm, k.o, k.i, 0.9);
  const tail = k.hinge('Tail', root, t.build());
  body.add(tail);
  k.fold(tail, [1, 0, 0], 0.6, 1);
  return { body, tail };
}

const BUILDERS: Record<CreatureKind, (k: Kit) => Parts> = {
  crane,
  frog,
  fox,
  fish,
  butterfly,
  boat,
  rabbit,
  whale,
};

/** Builds a fresh rig in the given outer (`front`) and inner paper colours. */
export function buildRig(kind: CreatureKind, front: string, back: string): Rig {
  const k = new Kit(new Color(front), new Color(back));
  const parts = BUILDERS[kind](k);
  const root = new Group();
  root.name = `Creature_${kind}`;
  parts.body.name = 'Body';
  root.add(parts.body);
  return {
    root,
    body: parts.body,
    head: parts.head ?? null,
    eyes: k.eyes,
    wingL: parts.wingL,
    wingR: parts.wingR,
    tail: parts.tail,
    legL: parts.legL,
    legR: parts.legR,
    earL: parts.earL,
    earR: parts.earR,
    folds: k.folds,
    lines: k.lines,
    edges: k.edges,
  };
}

export const CREATURE_KINDS: CreatureKind[] = ['crane', 'frog', 'fox', 'fish', 'butterfly', 'boat', 'rabbit', 'whale'];

const PREVIEW_FRONT: Record<CreatureKind, string> = {
  crane: '#e2574c',
  frog: '#3f9a6e',
  fox: '#e8923a',
  fish: '#3d79c2',
  butterfly: '#c75c9a',
  boat: '#3a8d97',
  rabbit: '#d9b23a',
  whale: '#5b5fb0',
};

/** Manifest prototype in the creature's first-level paper. */
export function creaturePrototype(kind: CreatureKind): Group {
  return buildRig(kind, PREVIEW_FRONT[kind], '#f6f0e4').root;
}
