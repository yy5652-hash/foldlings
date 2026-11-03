/** Deterministic metre-scale terrain; XZ footprint, +Y up, creature contact at TOP. */
import { BufferGeometry, Color, Float32BufferAttribute } from '@iwsdk/core';
import { WORLDS } from './levels.js';

export const ISLAND_RADIUS = .29;
export const ISLAND_INNER = .035;
export const ISLAND_SECTOR = Math.PI * 2 / WORLDS.length;
export const ISLAND_GAP = .025;
export const REGION_RADIUS = .18;
export const REGION_TOP = .07;
// Over the far half of the mat, so it never reaches into a monitor behind the desk.
export const ISLAND_PLACEMENT = { height: .32, beyondMat: -.14, tilt: 25 * Math.PI / 180, scale: .72 } as const;
export type P = [number, number, number];
type Footprint = [number, number][];
const PALETTE = [0xffb65b, 0x55e8a1, 0x4acdf5, 0x9189ff, 0x47cbaa, 0xff83cf, 0xbedb76, 0x4088e8];
export const polar = (r: number, a: number, y: number): P => [r * Math.cos(a), y, r * Math.sin(a)];

/** Single non-indexed batch, with region/level IDs retained for GPU feedback. */
export class Facets {
  positions: number[] = [];
  terraces: number[] = [];
  worlds: number[] = [];
  colors: number[] = [];
  triangle(a: P, b: P, c: P, terrace: number, world: number, color = PALETTE[world], shade = 1) {
    const tint = new Color(color);
    // Ten campaign steps reveal a mosaic of facets across the four physical tiers.
    terrace = terrace < 0 ? terrace : this.positions.length / 9 % 10;
    this.positions.push(...a, ...b, ...c);
    this.terraces.push(terrace, terrace, terrace);
    this.worlds.push(world, world, world);
    for (let i = 0; i < 3; i++) this.colors.push(tint.r * shade, tint.g * shade, tint.b * shade);
  }
  append(f: Facets) {
    this.positions.push(...f.positions);
    this.terraces.push(...f.terraces);
    this.worlds.push(...f.worlds);
    this.colors.push(...f.colors);
  }
  geometry() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    g.setAttribute('aTerrace', new Float32BufferAttribute(this.terraces, 1));
    g.setAttribute('aWorld', new Float32BufferAttribute(this.worlds, 1));
    g.setAttribute('aLayer', new Float32BufferAttribute(new Float32Array(this.terraces.length), 1));
    g.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    g.computeVertexNormals();
    // The GPU adds at most 2.5 cm of lift and 4 mm of shake.
    g.computeBoundingSphere();
    g.boundingSphere!.radius += .03;
    return g;
  }
}

/** Closed extrusion of a convex polygon. Wall colour carries the faceted relief. */
function prism(f: Facets, w: number, footprint: Footprint, bottom: number, top: number, color?: number) {
  let area = 0;
  for (let i = 0; i < footprint.length; i++) {
    const p = footprint[i], q = footprint[(i + 1) % footprint.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  const ring = area > 0 ? footprint.slice().reverse() : footprint;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const lowA: P = [a[0], bottom, a[1]], lowB: P = [b[0], bottom, b[1]];
    const highA: P = [a[0], top, a[1]], highB: P = [b[0], top, b[1]];
    const band = Math.floor(i * 10 / n);
    f.triangle(lowA, lowB, highA, band, w, color, .48 + .055 * (i % 4));
    f.triangle(highA, lowB, highB, band, w, color, .48 + .055 * (i % 4));
    if (i > 0 && i < n - 1) {
      const first = ring[0];
      f.triangle([first[0], top, first[1]], highA, highB, band, w, color, .94 + .025 * (i % 3));
      f.triangle([first[0], bottom, first[1]], lowB, lowA, band, w, color, .4);
    }
  }
}

/** All terrain detail is authored in the same radial/tangential surface frame. */
export function terrain(w: number): Facets {
  const f = new Facets();
  const a = (w + .5) * ISLAND_SECTOR, ca = Math.cos(a), sa = Math.sin(a);
  const frame = (u: number, v: number): [number, number] => [(REGION_RADIUS + u) * ca - v * sa, (REGION_RADIUS + u) * sa + v * ca];
  const shape = (points: Footprint, bottom: number, top: number, color?: number) =>
    prism(f, w, points.map(([u, v]) => frame(u, v)), bottom, top, color);
  const disk = (u: number, v: number, rx: number, rz: number, bottom: number, top: number, color?: number, sides = 7) => {
    const points: Footprint = [];
    for (let j = 0; j < sides; j++) {
      const angle = j * Math.PI * 2 / sides;
      points.push([u + rx * Math.cos(angle), v + rz * Math.sin(angle)]);
    }
    shape(points, bottom, top, color);
  };
  const box = (u: number, v: number, rx: number, rz: number, bottom: number, top: number, color?: number) =>
    shape([[u-rx,v-rz],[u+rx,v-rz],[u+rx,v+rz],[u-rx,v+rz]], bottom, top, color);
  const hill = (u: number, v: number, rx: number, rz: number, color?: number) => {
    disk(u, v, rx, rz, .012, .03, color);
    disk(u, v, rx * .72, rz * .72, .03, .05, color);
    disk(u, v, rx * .44, rz * .44, .05, REGION_TOP, color);
  };
  // A thick, broken coastline; separate solids leave dark channels between worlds.
  const a0 = w * ISLAND_SECTOR + ISLAND_GAP, a1 = (w + 1) * ISLAND_SECTOR - ISLAND_GAP;
  for (let j = 0; j < 5; j++) {
    const s = a0 + (a1-a0)*j/5, t = a0 + (a1-a0)*(j+1)/5;
    const p = polar(ISLAND_RADIUS, s, 0), q = polar(ISLAND_RADIUS, t, 0);
    const r = polar(ISLAND_INNER, t, 0), k = polar(ISLAND_INNER, s, 0);
    prism(f, w, [[p[0],p[2]],[q[0],q[2]],[r[0],r[2]],[k[0],k[2]]], -.014, .012, 0x286b96);
  }
  switch (WORLDS[w].kind) {
    case 'crane': // A square pagoda staircase with a reflecting pond beside it.
      disk(.069, -.018, .031, .021, .012, .016, 0x4be2ef);
      box(0, 0, .068, .042, .012, .03);
      box(0, 0, .051, .037, .03, .05);
      box(0, 0, .034, .027, .05, REGION_TOP);
      break;
    case 'frog': // Three thick lily pads rise out of a turquoise pond.
      disk(.025, 0, .072, .05, .012, .018, 0x228dce);
      disk(-.014, .005, .059, .041, .018, .03);
      disk(-.006, .002, .043, .032, .03, .05);
      disk(0, 0, .03, .026, .05, REGION_TOP);
      disk(.059, -.025, .018, .014, .018, .025, 0x9cffa5);
      break;
    case 'boat': // Harbour wall and quays surround open water, with wave crests.
      disk(.024, 0, .074, .047, .012, .018, 0x2588df);
      box(-.025, -.028, .051, .01, .018, .034);
      box(-.025, .028, .051, .01, .018, .034);
      box(-.032, 0, .039, .029, .018, .05, 0x6acbd5);
      box(0, 0, .03, .026, .05, REGION_TOP);
      for (let j = 0; j < 3; j++) disk(.052+j*.013, .014-j*.018, .016, .004, .018, .023, 0xa4f5ff, 5);
      break;
    case 'fish': // Violet reef shelves and irregular coral heads.
      hill(0, 0, .073, .05);
      for (let j = 0; j < 3; j++) {
        disk(.047+j*.014, -.026+j*.019, .014, .01, .012, .032, 0xff87bc, 5);
        disk(.047+j*.014, -.026+j*.019, .008, .006, .032, .051, 0xe7b5ff, 5);
      }
      break;
    case 'fox': // Forested, faceted hills; trunks meet their stepped canopies.
      hill(0, 0, .076, .049);
      for (const [u,v] of [[-.046,.026],[.05,.028],[.055,-.029]]) {
        box(u, v, .003, .003, .03, .043, 0x9be2b7);
        disk(u, v, .017, .013, .04, .052, 0x3cc697, 5);
        disk(u, v, .01, .008, .052, .066, 0x85f2b4, 5);
      }
      break;
    case 'butterfly': // Flower meadow with thick, readable five-petal patches.
      hill(0, 0, .077, .049, 0x77c9aa);
      for (const [u,v] of [[-.047,.027],[.052,.024],[.055,-.026],[-.037,-.029]]) {
        disk(u, v, .015, .012, .03, .037, 0xff83d4, 5);
        disk(u, v, .005, .005, .037, .042, 0xffe38c, 5);
      }
      break;
    case 'rabbit': // Grassy burrow terraces and a dark recessed mouth in the hill.
      hill(0, 0, .078, .052);
      box(.044, 0, .025, .024, .012, .028, 0x77784c);
      box(.047, -.019, .022, .006, .028, .048);
      box(.047, .019, .022, .006, .028, .048);
      box(.047, 0, .022, .025, .048, .055);
      break;
    case 'whale': // An exposed deep channel between the ocean shelves.
      box(.061, 0, .028, .013, .012, .014, 0x133b94);
      box(.025, -.031, .062, .012, .012, .033, 0x3174cc);
      box(.025, .031, .062, .012, .012, .033, 0x3174cc);
      disk(-.016, 0, .055, .033, .012, .05, 0x4499e4);
      disk(0, 0, .029, .026, .05, REGION_TOP, 0x79d8fc);
      break;
  }
  return f;
}

/** Highest upward-facing triangle at XZ, or -Infinity outside the terrain. */
export function surfaceHeight(g: BufferGeometry, x: number, z: number): number {
  const p = g.getAttribute('position');
  let height = -Infinity;
  for (let i = 0; i < p.count; i += 3) {
    const ax = p.getX(i), az = p.getZ(i), bx = p.getX(i+1), bz = p.getZ(i+1), cx = p.getX(i+2), cz = p.getZ(i+2);
    const det = (bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
    if (det >= -1e-10) continue; // upward winding in XZ; skip walls and bottoms
    const a = ((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/det;
    const b = ((cz-az)*(x-cx)+(ax-cx)*(z-cz))/det;
    const c = 1-a-b;
    if (a >= -1e-6 && b >= -1e-6 && c >= -1e-6) height = Math.max(height, a*p.getY(i)+b*p.getY(i+1)+c*p.getY(i+2));
  }
  return height;
}
