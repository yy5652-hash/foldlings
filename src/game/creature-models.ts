/**
 * Origami creature models, built from the crease patterns baked in
 * ./origami: two-sided paper facets, crease lines along every fold and ink-dot
 * eyes. Pure geometry (no DOM, no audio, no World), so the asset manifest and
 * the game build identical rigs.
 *
 * Units are metres. +Y is up and the creature faces -Z. Animated parts hang
 * from pivot groups; `morph` folds the whole sheet up from flat.
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
  Object3D,
  Quaternion,
  Vector3,
  ShaderMaterial,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Points,
} from '@iwsdk/core';
import { holoBody, holoCloud, holoCore, holoLine } from './holo.js';
import type { CreatureKind } from './levels.js';
import { baked } from './origami/baked.js';
import { FoldUp } from './origami/fold-up.js';
import { bestLine } from './origami/hinge.js';
import type { RigPart } from './origami/definition.js';
import type { BakedOrigami } from './origami/data.js';
import type { Position } from './origami/relax.js';

export type P = [number, number, number];
type Tri = [P, P, P];

/** The widest a seam may open while a part moves, in metres of real paper. */
export const MAX_SEAM = 0.001;
const MAX_TURN = 1.4;

/** A part of the sheet that moves the way paper can: by turning about its crease. */
export class Flex {
  /** Radians it can turn before the seam opens further than MAX_SEAM. */
  readonly limit: number;
  private q = new Quaternion();

  constructor(
    private groups: Object3D[],
    private axis: Vector3,
    residual: number,
  ) {
    this.limit = residual > 1e-6 ? Math.min(MAX_TURN, MAX_SEAM / residual) : MAX_TURN;
  }

  /** Turns by `angle` about the crease, its direction taken from the nearby axis (x, y, z). */
  turn(angle: number, x: number, y: number, z: number) {
    const a = this.axis;
    const signed = a.x * x + a.y * y + a.z * z < 0 ? -angle : angle;
    this.q.setFromAxisAngle(a, Math.max(-this.limit, Math.min(this.limit, signed)));
    for (let i = 0; i < this.groups.length; i++) this.groups[i].quaternion.copy(this.q);
  }
}

export interface Rig {
  /** Parentless; origin at the contact point, facing -Z. */
  root: Group;
  /** Everything visible; idle squash and the fold-up flatten act on it. */
  body: Group;
  head: Object3D | null;
  eyes: Object3D[];
  wingL?: Object3D;
  wingR?: Object3D;
  tail?: Object3D;
  legL?: Object3D;
  legR?: Object3D;
  earL?: Object3D;
  earR?: Object3D;
  /** The parts that can move, each only about the crease it hangs from. */
  flex: Partial<Record<RigPart, Flex>>;
  morph: { stages: number; apply(t: number): void };
  facetCount: number;
  /** Crease lines; brightened while the creature folds itself up. */
  lines: LineBasicMaterial;
  /** The projected body: exploded view, slice and forming edge live on this. */
  holo: ShaderMaterial;
  /** The inner layer, shown only while a creature is being presented. */
  core: ShaderMaterial;
  cores: Mesh[];
  cloud: ShaderMaterial;
  clouds: Points[];
  /** Every crease-line object, hidden on far-away creatures to save draw calls. */
  edges: LineSegments[];
}

const eyeMat = new MeshBasicMaterial({ vertexColors: true });

/** Points scattered over the triangles, deterministically, so the editor agrees. */
function cloudGeometry(pos: number[], normals: Float32Array, col: number[]): BufferGeometry {
  const P: number[] = [];
  const N: number[] = [];
  const C: number[] = [];
  const D: number[] = [];
  let seed = 12345 + pos.length;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let t = 0; t + 8 < pos.length; t += 9) {
    const ex = [pos[t + 3] - pos[t], pos[t + 4] - pos[t + 1], pos[t + 5] - pos[t + 2]];
    const fx = [pos[t + 6] - pos[t], pos[t + 7] - pos[t + 1], pos[t + 8] - pos[t + 2]];
    const cx = ex[1] * fx[2] - ex[2] * fx[1];
    const cy = ex[2] * fx[0] - ex[0] * fx[2];
    const cz = ex[0] * fx[1] - ex[1] * fx[0];
    const area = Math.hypot(cx, cy, cz) / 2;
    // About one point per square centimetre, with a floor so small parts show.
    const n = Math.max(3, Math.min(90, Math.round(area * 16000)));
    for (let i = 0; i < n; i++) {
      let a = rnd();
      let b = rnd();
      if (a + b > 1) {
        a = 1 - a;
        b = 1 - b;
      }
      P.push(pos[t] + ex[0] * a + fx[0] * b, pos[t + 1] + ex[1] * a + fx[1] * b, pos[t + 2] + ex[2] * a + fx[2] * b);
      N.push(normals[t], normals[t + 1], normals[t + 2]);
      C.push(col[t], col[t + 1], col[t + 2]);
      D.push(rnd(), rnd(), rnd());
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new Float32BufferAttribute(N, 3));
  g.setAttribute('color', new Float32BufferAttribute(C, 3));
  g.setAttribute('aDrift', new Float32BufferAttribute(D, 3));
  return g;
}

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
const INK = new Color(0x9fe9ff);

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
const mean = (pts: P[]): P => mix(pts, pts.map(() => 1 / pts.length));

/** Collects coloured triangles; paper is drawn on both sides. */
class Model {
  private pos: number[] = [];
  private col: number[] = [];
  private n = 0;

  constructor(
    private lines: LineBasicMaterial,
    private edgeList: LineSegments[],
    private holo: ShaderMaterial,
    private core: ShaderMaterial,
    private cores: Mesh[],
    private cloud: ShaderMaterial,
    private clouds: Points[],
  ) {}

  private push(t: Tri, color: Color, shade: number) {
    // A faint per-face variation makes flat paper read as separate facets.
    const s = shade * (1 + (((this.n++ * 7919) % 9) - 4) * 0.012);
    for (const p of t) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(color.r * s, color.g * s, color.b * s);
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
    const body = new InstancedBufferGeometry();
    body.setAttribute('position', g.attributes.position);
    body.setAttribute('normal', g.attributes.normal);
    body.setAttribute('color', g.attributes.color);
    body.setAttribute('aLayer', new InstancedBufferAttribute(new Float32Array([-1, -0.5, 0, 0.5, 1]), 1));
    body.instanceCount = 5;
    const mesh = new Mesh(body, this.holo);
    mesh.name = 'Paper';
    const edges = new LineSegments(new EdgesGeometry(g, 14), this.lines);
    edges.name = 'Creases';
    this.edgeList.push(edges);
    const cloud = new Points(cloudGeometry(this.pos, g.attributes.normal.array as Float32Array, this.col), this.cloud);
    cloud.name = 'Cloud';
    cloud.raycast = () => {};
    this.clouds.push(cloud);
    out.add(cloud);
    const core = new Mesh(body, this.core);
    core.name = 'Core';
    core.visible = false;
    core.raycast = () => {};
    this.cores.push(core);
    out.add(mesh, edges, core);
    return out;
  }
}

/** Per-rig state shared by the part builders below. */
class Kit {
  readonly lines = holoLine(INK.getHex(), 0.6);
  readonly holo = holoBody();
  readonly core = holoCore();
  readonly cores: Mesh[] = [];
  readonly cloud = holoCloud();
  readonly clouds: Points[] = [];
  readonly eyes: Object3D[] = [];
  readonly edges: LineSegments[] = [];

  constructor(
    readonly o: Color,
    readonly i: Color,
  ) {}

  model(): Model {
    return new Model(this.lines, this.edges, this.holo, this.core, this.cores, this.cloud, this.clouds);
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
}

interface Parts {
  body: Group;
  flex: Rig['flex'];
  morph: Rig['morph'];
  facetCount: number;
  head?: Object3D;
  wingL?: Object3D;
  wingR?: Object3D;
  tail?: Object3D;
  legL?: Object3D;
  legR?: Object3D;
  earL?: Object3D;
  earR?: Object3D;
}

function origami(k: Kit, data: BakedOrigami): Parts {
  const body = new Group();
  const fold = new FoldUp(data);
  const positions = new Float32Array(data.positions.length * 3);
  const parts = new Map<string, Group>();
  const surfaces: { geometry: BufferGeometry; vertices: number[]; mesh: Mesh }[] = [];
  k.holo.side = k.core.side = FrontSide;
  // Everything a rig part moves together hangs from the crease it shares with the rest.
  const owners = new Map<number, Set<string>>();
  for (const face of data.faces) {
    for (const v of face.vertices) {
      if (!owners.has(v)) owners.set(v, new Set());
      owners.get(v)!.add(face.part);
    }
  }
  const hinges = new Map<RigPart, ReturnType<typeof bestLine>>();
  for (const field of new Set(Object.values(data.rig))) {
    if (field === 'body') continue;
    const inside = new Set(Object.entries(data.rig).filter(([, f]) => f === field).map(([part]) => part));
    const seam: Position[] = [];
    for (const [v, parts] of owners) {
      if ([...parts].some(part => inside.has(part)) && [...parts].some(part => !inside.has(part))) seam.push(data.positions[v]);
    }
    if (seam.length > 1) hinges.set(field, bestLine(seam));
  }
  for (const part of new Set(data.faces.map(face => face.part))) {
    const model = k.model();
    const vertices: number[] = [];
    const creasePositions: number[] = [];
    const creaseEdges = new Set<string>();
    for (const face of data.faces) {
      if (face.part !== part) continue;
      face.vertices.forEach((a, j) => {
        const b = face.vertices[(j + 1) % face.vertices.length];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        if (creaseEdges.has(key)) return;
        creaseEdges.add(key);
        creasePositions.push(...data.positions[a], ...data.positions[b]);
      });
      for (const triangle of face.triangles) {
        const [a, b, c] = face.front ? triangle : [triangle[0], triangle[2], triangle[1]];
        model.sheet(data.positions[a], data.positions[b], data.positions[c], face.front ? k.o : k.i, face.front ? k.i : k.o);
        vertices.push(a, b, c, a, c, b);
      }
    }
    const content = model.build();
    const edges = content.getObjectByName('Creases') as LineSegments;
    edges.geometry.dispose();
    edges.geometry = new BufferGeometry();
    edges.geometry.setAttribute('position', new Float32BufferAttribute(creasePositions, 3));
    const mesh = content.getObjectByName('Paper') as Mesh;
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    surfaces.push({ geometry: mesh.geometry, vertices, mesh });
    const field = data.rig[part];
    const hinge = field && hinges.get(field);
    const group = k.hinge(part[0].toUpperCase() + part.slice(1), hinge ? hinge.centre : data.pivots[part]!, content);
    parts.set(part, group);
    body.add(group);
  }
  for (const eye of data.eyes) {
    const group = parts.get(eye.part);
    if (!group) continue;
    const face = eye.vertices.map(v => data.positions[v]) as Tri;
    const center = mean(face);
    const n = new Vector3().crossVectors(sub(face[1], face[0]), sub(face[2], face[0])).normalize();
    const inside: P = [center[0] - n.x * eye.normalSign * .001, center[1] - n.y * eye.normalSign * .001, center[2] - n.z * eye.normalSign * .001];
    group.children[0].add(k.eye(face, eye.weights, inside, eye.radius));
  }
  const groups = [...parts.values()];
  const morph = {
    stages: data.stages,
    apply(t: number) {
      fold.apply(t, positions);
      body.scale.setScalar(1);
      for (let i = 0; i < groups.length; i++) groups[i].rotation.set(0, 0, 0);
      for (let s = 0; s < surfaces.length; s++) {
        const surface = surfaces[s], geometry = surface.geometry;
        const p = geometry.attributes.position, n = geometry.attributes.normal;
        for (let j = 0; j < surface.vertices.length; j++) {
          const v = surface.vertices[j] * 3;
          p.setXYZ(j, positions[v], positions[v + 1], positions[v + 2]);
        }
        for (let j = 0; j < p.count; j += 3) {
          const ax = p.getX(j + 1) - p.getX(j), ay = p.getY(j + 1) - p.getY(j), az = p.getZ(j + 1) - p.getZ(j);
          const bx = p.getX(j + 2) - p.getX(j), by = p.getY(j + 2) - p.getY(j), bz = p.getZ(j + 2) - p.getZ(j);
          const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
          const length = Math.hypot(nx, ny, nz) || 1;
          n.setXYZ(j, nx / length, ny / length, nz / length);
          n.setXYZ(j + 1, nx / length, ny / length, nz / length);
          n.setXYZ(j + 2, nx / length, ny / length, nz / length);
        }
        p.needsUpdate = n.needsUpdate = true;
        surface.mesh.frustumCulled = t >= 1;
        k.cores[s].frustumCulled = t >= 1;
      }
      for (let i = 0; i < k.edges.length; i++) k.edges[i].visible = t >= 1;
      for (let i = 0; i < k.clouds.length; i++) k.clouds[i].visible = t >= 1;
      for (let i = 0; i < k.eyes.length; i++) k.eyes[i].visible = t >= 1;
    },
  };
  const flex: Rig['flex'] = {};
  for (const [field, hinge] of hinges) {
    const moving = Object.entries(data.rig).filter(([, f]) => f === field).flatMap(([part]) => parts.get(part) ?? []);
    flex[field] = new Flex(moving, new Vector3(...hinge.axis), hinge.residual);
  }
  const result: Parts = { body, flex, morph, facetCount: data.faces.length };
  for (const [part, field] of Object.entries(data.rig)) {
    if (field !== 'body' && parts.has(part)) result[field] = parts.get(part);
  }
  return result;
}

/** Builds a fresh rig in the given outer (`front`) and inner paper colours. */
export function buildRig(kind: CreatureKind, front: string, back: string): Rig {
  const k = new Kit(new Color(front), new Color(back));
  const parts = origami(k, (baked as Record<CreatureKind, BakedOrigami>)[kind]);
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
    flex: parts.flex,
    morph: parts.morph,
    facetCount: parts.facetCount,
    lines: k.lines,
    holo: k.holo,
    core: k.core,
    cores: k.cores,
    cloud: k.cloud,
    clouds: k.clouds,
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
