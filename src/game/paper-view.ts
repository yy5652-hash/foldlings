/**
 * Renders a PaperState on the board and animates the flap of a fold in
 * progress. Board-local frame: x = u (right), y = up, z = −v (towards you).
 */

import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';
import { applyAffine, clipConvex, Line, polygonArea, V2 } from '../fold/geom.js';
import { Facet, PAPER_SIZE, PaperState } from '../fold/paper.js';
import type { PaperTextures } from './paper-texture.js';

export const LAYER_GAP = 0.0006;
const BASE_HEIGHT = 0.0012;

const vertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
void main() {
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragment = /* glsl */ `
uniform sampler2D frontMap;
uniform sampler2D backMap;
uniform float flipped;
uniform float glow;
uniform vec3 lightDir;
varying vec2 vUv;
varying vec3 vNormalW;
void main() {
  bool facingUp = gl_FrontFacing;
  bool showFront = facingUp != (flipped > 0.5);
  vec3 n = facingUp ? vNormalW : -vNormalW;
  vec3 base = showFront ? texture2D(frontMap, vUv).rgb : texture2D(backMap, vUv).rgb;
  float diff = max(dot(normalize(n), lightDir), 0.0);
  vec3 col = base * (0.66 + 0.42 * diff);
  col += glow * vec3(0.20, 0.17, 0.08);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

function makePaperMaterial(tex: PaperTextures, flipped: boolean): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    side: DoubleSide,
    uniforms: {
      frontMap: { value: tex.front },
      backMap: { value: tex.back },
      flipped: { value: flipped ? 1 : 0 },
      glow: { value: 0 },
      lightDir: { value: new Vector3(0.3, 1, 0.45).normalize() },
    },
  });
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

function facetGeometry(f: Facet, y: number, expand = 0): BufferGeometry {
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
  private matFront: ShaderMaterial;
  private matBack: ShaderMaterial;
  private edgeMat = new MeshBasicMaterial({
    color: new Color(0x2a2118),
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  private flapSign: 1 | -1 = 1;
  private axis = new Vector3();
  private q = new Quaternion();

  constructor(textures: PaperTextures) {
    this.root.name = 'Paper';
    this.matFront = makePaperMaterial(textures, false);
    this.matBack = makePaperMaterial(textures, true);
    this.root.add(this.stack, this.flapPivot);
    this.flapPivot.add(this.flapInner);
  }

  setGlow(v: number) {
    this.matFront.uniforms.glow.value = v;
    this.matBack.uniforms.glow.value = v;
  }

  /** Static paper, no flap. */
  setPaper(state: PaperState) {
    this.clearGroup(this.stack);
    this.clearGroup(this.flapInner);
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
    this.axis.set(-line.ny, 0, -line.nx).normalize();
    this.flapSign = movingSign;
    this.setFlapAngle(0);
  }

  /** 0 = flat where it started, π = folded flat on top. */
  setFlapAngle(angle: number) {
    this.q.setFromAxisAngle(this.axis, -this.flapSign * angle);
    this.flapPivot.quaternion.copy(this.q);
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
  }
}
