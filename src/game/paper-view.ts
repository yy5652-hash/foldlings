/**
 * Renders a PaperState on the board and animates the flap of a fold in
 * progress. Board-local frame: x = u (right), y = up, z = −v (towards you).
 */

import {
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  Vector2,
  Vector3,
} from '@iwsdk/core';
import { applyAffine, clipConvex, Line, polygonArea, reflectPoint, V2 } from '../fold/geom.js';
import { Facet, PAPER_SIZE, PaperState } from '../fold/paper.js';
import { fiberHeight, heightToNormal, normalTexture } from './normal-maps.js';
import type { PaperTextures } from './paper-texture.js';

export const LAYER_GAP = 0.0006;
export const BASE_HEIGHT = 0.0012;

let fibers: DataTexture | null = null;

/** Fine washi fibre, shared by every sheet. */
function fiberNormals(): DataTexture {
  if (!fibers) {
    const size = 512;
    fibers = normalTexture(heightToNormal(fiberHeight(size, 7), size, 1.6), size);
    fibers.wrapS = fibers.wrapT = RepeatWrapping;
    fibers.anisotropy = 4;
    fibers.generateMipmaps = true;
    fibers.minFilter = LinearMipmapLinearFilter;
    fibers.needsUpdate = true;
  }
  return fibers;
}

/**
 * Physical paper: lit by the room, shadowed by its own flaps, with fibre in the
 * surface and a little light coming through it when it is backlit. The two
 * printed sides are chosen per fragment from which way the facet faces.
 */
function makePaperMaterial(tex: PaperTextures, flipped: boolean): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    side: DoubleSide,
    roughness: 0.86,
    metalness: 0,
    normalMap: fiberNormals(),
    normalScale: new Vector2(0.55, 0.55),
    envMapIntensity: 0.9,
  });
  m.shadowSide = DoubleSide;
  const glow = { value: 0 };
  m.userData.glow = glow;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.frontMap = { value: tex.front };
    shader.uniforms.backMap = { value: tex.back };
    shader.uniforms.flipped = { value: flipped ? 1 : 0 };
    shader.uniforms.glow = glow;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPaperUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPaperUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D frontMap;
        uniform sampler2D backMap;
        uniform float flipped;
        uniform float glow;
        varying vec2 vPaperUv;`,
      )
      .replace(
        '#include <map_fragment>',
        `bool paperFront = gl_FrontFacing != (flipped > 0.5);
        diffuseColor.rgb *= paperFront ? texture2D(frontMap, vPaperUv).rgb : texture2D(backMap, vPaperUv).rgb;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // Light through the sheet, then the warm lift of a fold about to solve.
        totalEmissiveRadiance += diffuseColor.rgb * (0.1 + 0.1 * (1.0 - abs(dot(normal, normalize(vViewPosition)))));
        totalEmissiveRadiance += glow * vec3(0.2, 0.17, 0.08);`,
      );
  };
  m.customProgramCacheKey = () => 'foldlings-paper';
  return m;
}

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
  private flapPivot = new Group();
  private flapInner = new Group();
  private matFront: MeshStandardMaterial;
  private matBack: MeshStandardMaterial;
  private edgeMat = new MeshBasicMaterial({
    color: new Color(0x2a2118),
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  /** Darkens where the flap will land, deepening as it lifts. */
  private landing = new Group();
  private landMat = new MeshBasicMaterial({
    color: new Color(0x1a1410),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: DoubleSide,
  });
  private flapSign: 1 | -1 = 1;
  private axis = new Vector3();
  private q = new Quaternion();

  constructor(textures: PaperTextures) {
    this.root.name = 'Paper';
    this.matFront = makePaperMaterial(textures, false);
    this.matBack = makePaperMaterial(textures, true);
    this.root.add(this.stack, this.landing, this.flapPivot);
    this.flapPivot.add(this.flapInner);
  }

  setGlow(v: number) {
    this.matFront.userData.glow.value = v;
    this.matBack.userData.glow.value = v;
  }

  /** Static paper, no flap. */
  setPaper(state: PaperState) {
    this.clearGroup(this.stack);
    this.clearGroup(this.flapInner);
    this.clearGroup(this.landing);
    this.addFacets(this.stack, state.facets, 0);
  }

  /**
   * Shows the paper split along `line`: `stay` lies flat, `move` hangs on a
   * hinge so setFlapAngle can swing it over.
   */
  setSplit(stay: Facet[], move: Facet[], line: Line, movingSign: 1 | -1) {
    this.clearGroup(this.stack);
    this.clearGroup(this.flapInner);
    const all = [...stay, ...move];
    const heights = stackHeights(all);
    let top = 0;
    for (const h of heights) top = Math.max(top, h);
    const hingeY = BASE_HEIGHT + (top + 0.5) * LAYER_GAP;
    this.addFacetsWithHeights(this.stack, stay, heights.slice(0, stay.length), 0);
    // Hinge sits on the crease line at the top of the stack.
    const fx = line.nx * line.d;
    const fy = line.ny * line.d;
    this.flapPivot.position.set(fx, hingeY, -fy);
    this.flapInner.position.set(-fx, -hingeY, fy);
    this.addFacetsWithHeights(
      this.flapInner,
      move,
      heights.slice(stay.length),
      0,
      false,
    );
    this.clearGroup(this.landing);
    for (const f of move) {
      const land = { ...f, poly: f.poly.map((p) => reflectPoint(line, p)) };
      const m = new Mesh(facetGeometry(land, hingeY + LAYER_GAP * 0.3), this.landMat);
      m.renderOrder = 40;
      this.landing.add(m);
    }
    this.axis.set(-line.ny, 0, -line.nx).normalize();
    this.flapSign = movingSign;
    this.setFlapAngle(0);
  }

  /** 0 = flat where it started, π = folded flat on top. */
  setFlapAngle(angle: number) {
    this.q.setFromAxisAngle(this.axis, -this.flapSign * angle);
    this.flapPivot.quaternion.copy(this.q);
    this.landMat.opacity = 0.2 * Math.max(0, Math.sin(Math.min(Math.PI, angle)));
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
      mesh.castShadow = true;
      group.add(mesh);
      if (!edges) return;
      // A slightly larger dark underlay gives every layer a crisp edge.
      const edge = new Mesh(facetGeometry(f, y - LAYER_GAP * 0.45, 0.0011), this.edgeMat);
      edge.renderOrder = 1 + heights[i];
      group.add(edge);
    });
  }

  private clearGroup(g: Group) {
    for (const child of [...g.children]) {
      g.remove(child);
      (child as Mesh).geometry?.dispose();
    }
  }

  dispose() {
    this.clearGroup(this.stack);
    this.clearGroup(this.flapInner);
    this.matFront.dispose();
    this.matBack.dispose();
    this.edgeMat.dispose();
    this.clearGroup(this.landing);
    this.landMat.dispose();
  }
}
