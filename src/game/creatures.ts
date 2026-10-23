/**
 * Low-poly origami creatures, built from paper "sheets": every triangle has a
 * coloured outer side and the paper's white inner side, like real origami.
 * Each kind has an idle loop and a reaction to being poked.
 */

import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  FrontSide,
  Group,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  Vector3,
} from '@iwsdk/core';
import type { CreatureKind } from './levels.js';
import type { PaperLook } from './paper-texture.js';
import { sfx } from './sfx.js';

type P = [number, number, number];
type Tri = [P, P, P];

/**
 * Collects coloured triangles. Solids orient every face away from their
 * centre; sheets (wings, fins, ears) are drawn on both sides.
 */
class Model {
  private pos: number[] = [];
  private col: number[] = [];
  private a = new Vector3();
  private b = new Vector3();
  private n = new Vector3();
  private c = new Vector3();

  constructor(
    readonly outer: Color,
    readonly inner: Color,
  ) {}

  private push(t: Tri, color: Color, shade: number) {
    for (const p of t) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(color.r * shade, color.g * shade, color.b * shade);
    }
  }

  solid(center: P, faces: Tri[], color: Color = this.outer, shade = 1) {
    for (const f of faces) {
      this.a.set(f[1][0] - f[0][0], f[1][1] - f[0][1], f[1][2] - f[0][2]);
      this.b.set(f[2][0] - f[0][0], f[2][1] - f[0][1], f[2][2] - f[0][2]);
      this.n.crossVectors(this.a, this.b);
      this.c.set(
        (f[0][0] + f[1][0] + f[2][0]) / 3 - center[0],
        (f[0][1] + f[1][1] + f[2][1]) / 3 - center[1],
        (f[0][2] + f[1][2] + f[2][2]) / 3 - center[2],
      );
      const t: Tri = this.n.dot(this.c) >= 0 ? f : [f[0], f[2], f[1]];
      this.push(t, color, shade);
    }
  }

  sheet(a: P, b: P, c: P, color: Color = this.outer, shade = 1) {
    this.push([a, b, c], color, shade);
    this.push([a, c, b], color, shade * 0.86);
  }

  /** Sheet plus its mirror across x = 0. */
  sheetX(a: P, b: P, c: P, color: Color = this.outer, shade = 1) {
    this.sheet(a, b, c, color, shade);
    const m = (p: P): P => [-p[0], p[1], p[2]];
    this.sheet(m(a), m(b), m(c), color, shade);
  }

  mesh(): Mesh {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return new Mesh(g, material);
  }
}

/** Eight faces of a (possibly squashed) octahedron. */
function octa(front: P, back: P, top: P, bottom: P, left: P, right: P): Tri[] {
  return [
    [top, front, left],
    [top, left, back],
    [top, back, right],
    [top, right, front],
    [bottom, left, front],
    [bottom, back, left],
    [bottom, right, back],
    [bottom, front, right],
  ];
}

const material = new MeshLambertMaterial({ vertexColors: true, side: FrontSide });

export type Habitat = 'perch' | 'ground' | 'wall' | 'air' | 'high-air';

export const HABITAT: Record<CreatureKind, Habitat> = {
  crane: 'perch',
  frog: 'ground',
  fox: 'ground',
  fish: 'air',
  butterfly: 'wall',
  boat: 'ground',
  rabbit: 'ground',
  whale: 'high-air',
};

interface Parts {
  body: Object3D;
  wingL?: Object3D;
  wingR?: Object3D;
  tail?: Object3D;
}

function pivot(mesh: Mesh, at: P): Object3D {
  const g = new Group();
  g.position.set(at[0], at[1], at[2]);
  mesh.position.set(-at[0], -at[1], -at[2]);
  g.add(mesh);
  return g;
}

function buildCrane(o: Color, i: Color): Parts {
  const body = new Group();
  const m = new Model(o, i);
  m.solid(
    [0, 0.02, 0],
    octa([0, 0.022, -0.03], [0, 0.022, 0.03], [0, 0.036, 0], [0, 0.002, 0], [-0.015, 0.02, 0], [0.015, 0.02, 0]),
  );
  m.sheet([0, 0.022, -0.026], [0, 0.032, -0.014], [0, 0.088, -0.05]);
  m.sheet([0, 0.088, -0.05], [0, 0.081, -0.046], [0, 0.08, -0.074]);
  m.sheet([0, 0.022, 0.026], [0, 0.032, 0.014], [0, 0.086, 0.052]);
  body.add(m.mesh());
  const wl = new Model(o, i);
  wl.sheet([0, 0.034, -0.018], [0, 0.034, 0.018], [-0.085, 0.056, 0.004], o, 1.05);
  const wr = new Model(o, i);
  wr.sheet([0, 0.034, -0.018], [0, 0.034, 0.018], [0.085, 0.056, 0.004], o, 1.05);
  const wingL = pivot(wl.mesh(), [0, 0.034, 0]);
  const wingR = pivot(wr.mesh(), [0, 0.034, 0]);
  body.add(wingL, wingR);
  return { body, wingL, wingR };
}

function buildFrog(o: Color, i: Color): Parts {
  const body = new Group();
  const m = new Model(o, i);
  const c: P = [0, 0.016, 0];
  const F: P = [0, 0.014, -0.036];
  const K: P = [0, 0.016, 0.03];
  const T: P = [0, 0.038, -0.002];
  const B: P = [0, 0.0, 0];
  const L: P = [-0.03, 0.01, 0.004];
  const R: P = [0.03, 0.01, 0.004];
  m.solid(c, [[T, F, L], [T, L, K], [T, K, R], [T, R, F]]);
  m.solid(c, [[B, L, F], [B, K, L], [B, R, K], [B, F, R]], i, 0.9);
  for (const sx of [-1, 1]) {
    const e: P = [0.012 * sx, 0.03, -0.016];
    m.solid(e, [
      [[0.006 * sx, 0.028, -0.022], [0.018 * sx, 0.028, -0.02], [0.012 * sx, 0.046, -0.016]],
      [[0.018 * sx, 0.028, -0.02], [0.012 * sx, 0.028, -0.008], [0.012 * sx, 0.046, -0.016]],
      [[0.012 * sx, 0.028, -0.008], [0.006 * sx, 0.028, -0.022], [0.012 * sx, 0.046, -0.016]],
    ]);
  }
  m.sheetX([0.024, 0.008, 0.012], [0.052, 0.001, 0.0], [0.042, 0.003, 0.036]);
  m.sheetX([0.016, 0.006, -0.024], [0.032, 0.001, -0.036], [0.014, 0.001, -0.034]);
  body.add(m.mesh());
  return { body };
}

function buildFox(o: Color, i: Color): Parts {
  const body = new Group();
  const m = new Model(o, i);
  const T: P = [0, 0.064, 0.004];
  const F: P = [0, 0.0, -0.012];
  const L: P = [-0.023, 0.0, 0.012];
  const R: P = [0.023, 0.0, 0.012];
  const K: P = [0, 0.0, 0.03];
  m.solid([0, 0.015, 0.01], [[T, F, L], [T, R, F], [T, L, K], [T, K, R]]);
  // Chest patch.
  m.sheet([0, 0.044, -0.0035], [-0.008, 0.014, -0.0085], [0.008, 0.014, -0.0085], i);
  const HL: P = [-0.027, 0.074, -0.006];
  const HR: P = [0.027, 0.074, -0.006];
  const HB: P = [0, 0.076, 0.014];
  const S: P = [0, 0.044, -0.032];
  const C: P = [0, 0.054, 0.006];
  m.solid([0, 0.064, -0.004], [[HL, HR, S], [HL, S, C], [HR, C, S], [HL, HB, HR], [HL, C, HB], [HR, HB, C]]);
  m.sheetX([0.008, 0.074, -0.006], [0.027, 0.074, -0.006], [0.024, 0.102, -0.002], o, 1.1);
  body.add(m.mesh());
  const t = new Model(o, i);
  t.sheet([0.0, 0.008, 0.026], [0.05, 0.004, 0.044], [0.022, 0.03, 0.034]);
  t.sheet([0.05, 0.004, 0.044], [0.064, 0.006, 0.05], [0.042, 0.016, 0.046], i);
  const tail = pivot(t.mesh(), [0, 0.008, 0.026]);
  body.add(tail);
  return { body, tail };
}

function buildFish(o: Color, i: Color): Parts {
  const body = new Group();
  const m = new Model(o, i);
  const N: P = [0, 0, -0.05];
  const T: P = [0, 0.026, -0.004];
  const B: P = [0, -0.02, 0];
  const K: P = [0, 0.0, 0.032];
  const L: P = [-0.011, 0.002, -0.008];
  const R: P = [0.011, 0.002, -0.008];
  const c: P = [0, 0.002, -0.006];
  m.solid(c, [[T, N, L], [T, L, K], [T, K, R], [T, R, N]]);
  m.solid(c, [[B, L, N], [B, K, L], [B, R, K], [B, N, R]], i, 0.95);
  m.sheet([0, 0.024, -0.008], [0, 0.022, 0.012], [0, 0.038, 0.012]);
  body.add(m.mesh());
  const t = new Model(o, i);
  t.sheet([0, 0.0, 0.028], [0, 0.026, 0.062], [0, -0.022, 0.058]);
  const tail = pivot(t.mesh(), [0, 0.0, 0.028]);
  body.add(tail);
  return { body, tail };
}

function buildButterfly(o: Color, i: Color): Parts {
  const body = new Group();
  const m = new Model(o, i);
  m.solid(
    [0, 0.004, 0],
    octa([0, 0.004, -0.024], [0, 0.004, 0.024], [0, 0.008, 0], [0, 0.0, 0], [-0.003, 0.004, 0], [0.003, 0.004, 0]),
    new Color(0x3b3027),
  );
  m.sheetX([0.001, 0.006, -0.022], [0.006, 0.01, -0.04], [0.002, 0.007, -0.024], new Color(0x3b3027));
  body.add(m.mesh());
  const make = (sx: number) => {
    const w = new Model(o, i);
    w.sheet([0, 0.004, -0.008], [0.058 * sx, 0.006, -0.042], [0.05 * sx, 0.004, 0.004], o, 1.05);
    w.sheet([0, 0.004, -0.002], [0.044 * sx, 0.004, 0.006], [0.032 * sx, 0.004, 0.038], o, 0.92);
    w.sheet([0.034 * sx, 0.0045, -0.024], [0.046 * sx, 0.0045, -0.03], [0.042 * sx, 0.0045, -0.014], i);
    return pivot(w.mesh(), [0, 0.004, 0]);
  };
  const wingR = make(1);
  const wingL = make(-1);
  body.add(wingL, wingR);
  return { body, wingL, wingR };
}

function buildBoat(o: Color, i: Color): Parts {
  const body = new Group();
  const m = new Model(o, i);
  const FT: P = [0, 0.03, -0.068];
  const BT: P = [0, 0.03, 0.068];
  const KF: P = [-0.008, 0.0, -0.034];
  const KB: P = [-0.008, 0.0, 0.034];
  const KF2: P = [0.008, 0.0, -0.034];
  const KB2: P = [0.008, 0.0, 0.034];
  const RL: P = [-0.028, 0.03, 0];
  const RR: P = [0.028, 0.03, 0];
  m.solid([0, 0.015, 0], [
    [FT, RL, KF],
    [RL, KB, KF],
    [RL, BT, KB],
    [FT, KF2, RR],
    [RR, KF2, KB2],
    [RR, KB2, BT],
    [KF, KB, KB2],
    [KF, KB2, KF2],
    [FT, KF, KF2],
    [BT, KB2, KB],
  ]);
  m.sheet([0, 0.028, -0.042], [0, 0.028, 0.042], [0, 0.082, 0], i);
  body.add(m.mesh());
  return { body };
}

function buildRabbit(o: Color, i: Color): Parts {
  const body = new Group();
  const m = new Model(o, i);
  m.solid(
    [0, 0.02, 0.008],
    octa([0, 0.016, -0.018], [0, 0.018, 0.034], [0, 0.044, 0.006], [0, 0.0, 0.008], [-0.024, 0.016, 0.01], [0.024, 0.016, 0.01]),
  );
  m.solid(
    [0, 0.046, -0.01],
    octa([0, 0.04, -0.032], [0, 0.048, 0.006], [0, 0.062, -0.01], [0, 0.032, -0.01], [-0.016, 0.046, -0.01], [0.016, 0.046, -0.01]),
  );
  m.sheetX([0.002, 0.058, -0.012], [0.017, 0.056, -0.004], [0.014, 0.112, 0.004], o, 1.05);
  m.sheetX([0.006, 0.062, -0.0105], [0.0135, 0.061, -0.0055], [0.0125, 0.1, 0.0025], i);
  m.solid([0, 0.018, 0.036], octa([0, 0.018, 0.03], [0, 0.018, 0.044], [0, 0.026, 0.037], [0, 0.01, 0.037], [-0.007, 0.018, 0.037], [0.007, 0.018, 0.037]), i);
  body.add(m.mesh());
  return { body };
}

function buildWhale(o: Color, i: Color): Parts {
  const body = new Group();
  const m = new Model(o, i);
  const N: P = [0, 0.0, -0.1];
  const T: P = [0, 0.045, -0.02];
  const B: P = [0, -0.034, -0.026];
  const K: P = [0, 0.01, 0.075];
  const L: P = [-0.04, 0.002, -0.03];
  const R: P = [0.04, 0.002, -0.03];
  const c: P = [0, 0.004, -0.02];
  m.solid(c, [[T, N, L], [T, L, K], [T, K, R], [T, R, N]]);
  m.solid(c, [[B, L, N], [B, K, L], [B, R, K], [B, N, R]], i, 0.95);
  m.sheetX([0.03, -0.01, -0.046], [0.07, -0.028, -0.02], [0.03, -0.012, -0.022]);
  body.add(m.mesh());
  const t = new Model(o, i);
  t.sheetX([0, 0.01, 0.07], [0.058, 0.024, 0.118], [0.004, 0.014, 0.1]);
  const tail = pivot(t.mesh(), [0, 0.01, 0.074]);
  body.add(tail);
  return { body, tail };
}

const BUILDERS: Record<CreatureKind, (o: Color, i: Color) => Parts> = {
  crane: buildCrane,
  frog: buildFrog,
  fox: buildFox,
  fish: buildFish,
  butterfly: buildButterfly,
  boat: buildBoat,
  rabbit: buildRabbit,
  whale: buildWhale,
};

/** Scale per kind so each reads well at a distance. */
const SCALE: Record<CreatureKind, number> = {
  crane: 1.0,
  frog: 1.15,
  fox: 1.1,
  fish: 1.2,
  butterfly: 1.05,
  boat: 1.15,
  rabbit: 1.1,
  whale: 1.5,
};

export class Creature {
  readonly root = new Group();
  readonly kind: CreatureKind;
  private parts: Parts;
  private t = Math.random() * 10;
  private react = 0;
  private hop = 0;
  /** Extra motion offset driven by idle loops (not persisted). */
  private bob = new Group();

  constructor(kind: CreatureKind, look: PaperLook) {
    this.kind = kind;
    this.root.name = `Creature_${kind}`;
    this.parts = BUILDERS[kind](new Color(look.front), new Color(look.back));
    this.root.add(this.bob);
    this.bob.add(this.parts.body);
    this.bob.scale.setScalar(SCALE[kind]);
    const target = this.root as unknown as {
      addEventListener(type: string, fn: () => void): void;
    };
    target.addEventListener('pointerdown', () => this.poke());
  }

  get habitat(): Habitat {
    return HABITAT[this.kind];
  }

  poke() {
    if (this.react > 0.3) return;
    this.react = 1;
    this.hop = 1;
    switch (this.kind) {
      case 'frog':
        sfx.croak();
        break;
      case 'crane':
      case 'butterfly':
        sfx.flutter();
        break;
      case 'fish':
      case 'whale':
      case 'boat':
        sfx.splash();
        break;
      default:
        sfx.chirp(this.kind === 'rabbit' ? 1.3 : 0.9);
    }
  }

  /** Flying or swimming kinds flap while travelling. */
  setTravelling(v: boolean) {
    this.travelling = v;
  }
  private travelling = false;

  update(dt: number) {
    this.t += dt;
    this.react = Math.max(0, this.react - dt * 1.4);
    this.hop = Math.max(0, this.hop - dt * 2.2);
    const t = this.t;
    const r = this.react;
    const { wingL, wingR, tail, body } = this.parts;
    const hopY = Math.sin(this.hop * Math.PI) * 0.05;
    switch (this.kind) {
      case 'crane': {
        const flap = this.travelling || r > 0
          ? Math.sin(t * 14) * 0.7
          : Math.sin(t * 1.3) * 0.08 + 0.1;
        wingL!.rotation.z = -flap;
        wingR!.rotation.z = flap;
        this.bob.position.y = hopY * 0.6;
        body.rotation.x = Math.sin(t * 0.7) * 0.04;
        break;
      }
      case 'butterfly': {
        const flap = this.travelling || r > 0
          ? Math.sin(t * 22) * 0.9
          : Math.max(0, Math.sin(t * 1.7)) * 0.6;
        wingL!.rotation.z = flap;
        wingR!.rotation.z = -flap;
        this.bob.position.y = hopY * 0.4;
        break;
      }
      case 'fish': {
        const k = this.travelling || r > 0 ? 9 : 3;
        tail!.rotation.y = Math.sin(t * k) * 0.45;
        body.rotation.y = Math.sin(t * k + 1.2) * 0.08;
        this.bob.position.y = Math.sin(t * 0.9) * 0.01 + hopY * 0.4;
        break;
      }
      case 'whale': {
        tail!.rotation.x = Math.sin(t * 1.2) * 0.3;
        body.rotation.x = Math.sin(t * 1.2 + 0.8) * 0.05;
        this.bob.position.y = Math.sin(t * 0.5) * 0.02 + hopY * 0.3;
        break;
      }
      case 'fox': {
        tail!.rotation.y = Math.sin(t * 2.2) * 0.25 + r * Math.sin(t * 20) * 0.4;
        this.bob.position.y = hopY * 0.5;
        break;
      }
      case 'boat': {
        body.rotation.z = Math.sin(t * 1.4) * 0.06 + r * Math.sin(t * 12) * 0.12;
        body.rotation.x = Math.sin(t * 1.1) * 0.03;
        this.bob.position.y = hopY * 0.3;
        break;
      }
      default: {
        // Frog and rabbit: little breathing squash, hop on poke.
        const squash = 1 + Math.sin(t * 2.4) * 0.025 - Math.sin(this.hop * Math.PI) * 0.1;
        body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
        this.bob.position.y = hopY;
      }
    }
  }

  dispose() {
    this.root.traverse((o) => (o as Mesh).geometry?.dispose());
  }
}
