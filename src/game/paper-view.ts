/**
 * Renders a PaperState on the board and animates the flap of a fold in
 * progress. Board-local frame: x = u (right), y = up, z = −v (towards you).
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
} from '@iwsdk/core';
import { applyAffine, clipConvex, Line, polygonArea, reflectPoint, V2 } from '../fold/geom.js';
import { Facet, PAPER_SIZE, PaperState } from '../fold/paper.js';
import type { BendPose } from '../fold/bend.js';
import { BendBuffers, createBendBuffers, WallBuffers, writeBentFacet, writeBentWalls } from './paper-bend.js';
import { holoSheet, holoWall } from './holo.js';
import type { PaperTextures } from './paper-texture.js';

export const LAYER_GAP = 0.0003;
export const BASE_HEIGHT = 0.0012;
const WALL_HEIGHT = 0.022;

/** Two convex polygons overlap with positive area. */
function overlaps(a: V2[], b: V2[]): boolean {
  let poly: V2[] = a;
  for (let i = 0; i < b.length && poly.length >= 3; i++) {
    const p = b[i];
    const q = b[(i + 1) % b.length];
    // Inward normal of CCW edge p→q is (-(q.y-p.y), q.x-p.x).
    const nx = -(q.y - p.y);
    const ny = q.x - p.x;
    const len = Math.hypot(nx, ny);
    const line: Line = { nx: nx / len, ny: ny / len, d: (nx * p.x + ny * p.y) / len };
    poly = clipConvex(poly, line, 1);
  }
  return poly.length >= 3 && polygonArea(poly) > 2e-7;
}

/** Visual stack height per facet: one above the highest overlapping facet below. */
export function stackHeights(facets: readonly Facet[]): number[] {
  const order = facets.map((_, i) => i).sort((a, b) => facets[a].layer - facets[b].layer);
  const h = new Array<number>(facets.length).fill(0);
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi];
    let level = 0;
    for (let oj = 0; oj < oi; oj++) {
      const j = order[oj];
      if (h[j] + 1 > level && overlaps(facets[i].poly, facets[j].poly)) level = h[j] + 1;
    }
    h[i] = level;
  }
  return h;
}

export function facetGeometry(f: Facet, y: number, expand = 0): BufferGeometry {
  const n = f.poly.length;
  let cx = 0;
  let cy = 0;
  for (const p of f.poly) {
    cx += p.x / n;
    cy += p.y / n;
  }
  const pts = f.poly.map((p) => {
    if (expand === 0) return p;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const l = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / l) * expand, y: p.y + (dy / l) * expand };
  });
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const push = (p: V2) => {
    pos.push(p.x, y, -p.y);
    const s = applyAffine(f.toSheet, p);
    uv.push(s.x / PAPER_SIZE + 0.5, s.y / PAPER_SIZE + 0.5);
    nor.push(0, 1, 0);
  };
  for (let i = 1; i < n - 1; i++) {
    push(pts[0]);
    push(pts[i]);
    push(pts[i + 1]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  return g;
}

export class PaperView {
  readonly root = new Group();
  private stack = new Group();
  private bendState: PaperState | null = null;
  private bent: { facet: Facet; buffers: BendBuffers; geometry: BufferGeometry; moving: boolean; wall: boolean }[] = [];
  private walls: WallBuffers | null = null;
  private wallGeometryLive: BufferGeometry | null = null;
  hingeY = BASE_HEIGHT;
  private matFront: ShaderMaterial;
  private matBack: ShaderMaterial;
  /** A slightly larger sheet of light under each facet burns as its outline. */
  private edgeMat = new MeshBasicMaterial({
    color: new Color(0xbdf2ff),
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
  /** Darkens where the flap will land, deepening as it lifts. */
  private landing = new Group();
  private landMat = new MeshBasicMaterial({
    color: new Color(0xffa24a),
    transparent: true,
    blending: AdditiveBlending,
    toneMapped: false,
    opacity: 0,
    depthWrite: false,
    side: DoubleSide,
  });
  private wallMat = holoWall();

  constructor(textures: PaperTextures) {
    this.root.name = 'Paper';
    this.matFront = holoSheet(textures.front, textures.back, false);
    this.matBack = holoSheet(textures.front, textures.back, true);
    this.root.add(this.stack, this.landing);
  }

  setGlow(v: number) {
    this.matFront.uniforms.glow.value = v;
    this.matBack.uniforms.glow.value = v;
  }

  /** Static paper, no flap. */
  setPaper(state: PaperState) {
    this.clearGroup(this.stack);
    this.bent.length = 0;
    this.bendState = null;
    this.walls = null;
    this.wallGeometryLive = null;
    this.clearGroup(this.landing);
    this.addFacets(this.stack, state.facets, 0);
  }

  /** Allocate once per drag; switching to an unfold only changes the moving mask. */
  beginBend(state: PaperState, moving: Facet[] | null) {
    if (this.bendState === state) {
      for (const b of this.bent) b.moving = moving === null || moving.includes(b.facet);
      return;
    }
    this.clearGroup(this.stack);
    this.clearGroup(this.landing);
    this.bent.length = 0;
    this.bendState = state;
    const heights = stackHeights(state.facets);
    let top = 0;
    let edges = 0;
    for (const h of heights) top = Math.max(top, h);
    this.hingeY = BASE_HEIGHT + (top + 0.5) * LAYER_GAP;
    state.facets.forEach((f, i) => {
      const y = BASE_HEIGHT + heights[i] * LAYER_GAP;
      for (let edge = 0; edge < 2; edge++) {
        const buffers = createBendBuffers(f, y - edge * LAYER_GAP * 0.45, edge * 0.0011);
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(buffers.positions, 3).setUsage(DynamicDrawUsage));
        geometry.setAttribute('normal', new BufferAttribute(buffers.normals, 3).setUsage(DynamicDrawUsage));
        geometry.setAttribute('uv', new BufferAttribute(buffers.uvs, 2).setUsage(DynamicDrawUsage));
        geometry.setDrawRange(0, 0);
        const mesh = new Mesh(geometry, edge ? this.edgeMat : f.flipped ? this.matBack : this.matFront);
        mesh.renderOrder = (edge ? 1 : 2) + heights[i];
        mesh.frustumCulled = false;
        this.stack.add(mesh);
        this.bent.push({ facet: f, buffers, geometry, moving: moving === null || moving.includes(f), wall: edge === 0 });
      }
      edges += f.poly.length;
    });
    this.walls = { positions: new Float32Array(edges * 60 * 3), aH: new Float32Array(edges * 60) };
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.walls.positions, 3).setUsage(DynamicDrawUsage));
    g.setAttribute('aH', new BufferAttribute(this.walls.aH, 1).setUsage(DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.wallGeometryLive = g;
    const wall = new Mesh(g, this.wallMat);
    wall.renderOrder = 30;
    wall.frustumCulled = false;
    this.stack.add(wall);
  }

  setBend(pose: BendPose) {
    if (!this.walls || !this.wallGeometryLive) return;
    let walls = 0;
    for (const b of this.bent) {
      const count = writeBentFacet(b.facet, b.buffers, pose, this.hingeY, b.moving);
      b.geometry.setDrawRange(0, count);
      b.geometry.attributes.position.needsUpdate = true;
      b.geometry.attributes.normal.needsUpdate = true;
      b.geometry.attributes.uv.needsUpdate = true;
      if (b.wall) walls += writeBentWalls(b.buffers, pose, this.hingeY, WALL_HEIGHT, this.walls, walls, b.moving);
    }
    this.wallGeometryLive.setDrawRange(0, walls);
    this.wallGeometryLive.attributes.position.needsUpdate = true;
    this.wallGeometryLive.attributes.aH.needsUpdate = true;
    this.landMat.opacity = 0.2 * Math.max(0, Math.sin(Math.min(Math.PI, pose.theta)));
  }

  endBend() {
    if (this.bendState) this.setPaper(this.bendState);
  }

  /** The lattice destination remains independent of the live bend. */
  setLanding(move: Facet[] | null, line: Line | null) {
    this.clearGroup(this.landing);
    if (!line || !this.bendState) return;
    for (const f of move ?? this.bendState.facets) {
      const poly = move ? f.poly : clipConvex(f.poly, line, 1);
      if (poly.length < 3) continue;
      const land = { ...f, poly: poly.map((p) => reflectPoint(line, p)) };
      const mesh = new Mesh(facetGeometry(land, this.hingeY + LAYER_GAP * 0.3), this.landMat);
      mesh.renderOrder = 40;
      this.landing.add(mesh);
    }
  }

  private addFacets(group: Group, facets: readonly Facet[], lift: number) {
    this.addFacetsWithHeights(group, facets, stackHeights(facets), lift);
  }

  private addFacetsWithHeights(
    group: Group,
    facets: readonly Facet[],
    heights: number[],
    lift: number,
    edges = true,
  ) {
    facets.forEach((f, i) => {
      const y = BASE_HEIGHT + heights[i] * LAYER_GAP + lift;
      const mesh = new Mesh(facetGeometry(f, y), f.flipped ? this.matBack : this.matFront);
      mesh.renderOrder = 2 + heights[i];
      group.add(mesh);
      if (!edges) return;
      // A slightly larger dark underlay gives every layer a crisp edge.
      const edge = new Mesh(facetGeometry(f, y - LAYER_GAP * 0.45, 0.0011), this.edgeMat);
      edge.renderOrder = 1 + heights[i];
      group.add(edge);
    });
    const wall = new Mesh(this.wallGeometry(facets, heights, lift), this.wallMat);
    wall.renderOrder = 30;
    group.add(wall);
  }

  /** Every facet's edges drawn upward as a curtain of light, in one mesh. */
  private wallGeometry(facets: readonly Facet[], heights: number[], lift: number): BufferGeometry {
    const P: number[] = [];
    const H: number[] = [];
    facets.forEach((f, i) => {
      const y = BASE_HEIGHT + heights[i] * LAYER_GAP + lift;
      const n = f.poly.length;
      for (let k = 0; k < n; k++) {
        const a = f.poly[k];
        const b = f.poly[(k + 1) % n];
        const top = y + WALL_HEIGHT;
        P.push(a.x, y, -a.y, b.x, y, -b.y, b.x, top, -b.y, a.x, y, -a.y, b.x, top, -b.y, a.x, top, -a.y);
        H.push(0, 0, 1, 0, 1, 1);
      }
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(P, 3));
    g.setAttribute('aH', new Float32BufferAttribute(H, 1));
    return g;
  }

  private clearGroup(g: Group) {
    for (const child of [...g.children]) {
      g.remove(child);
      (child as Mesh).geometry?.dispose();
    }
  }

  dispose() {
    this.clearGroup(this.stack);
    this.bent.length = 0;
    this.bendState = null;
    this.walls = null;
    this.wallGeometryLive = null;
    this.matFront.dispose();
    this.matBack.dispose();
    this.edgeMat.dispose();
    this.clearGroup(this.landing);
    this.landMat.dispose();
    this.wallMat.dispose();
  }
}
