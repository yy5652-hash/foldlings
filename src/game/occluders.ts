/**
 * Depth-only room geometry that hides Foldlings behind scanned furniture
 * and walls. Rebuilt only when the room scan changes.
 */

import {
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  ShapeUtils,
  Vector2,
  Vector3,
} from '@iwsdk/core';
import { surfacesFromPlanes } from './room.js';
import type { MeshInfo, PlaneInfo } from './room.js';

const SHRINK = 0.01;
const LOWER = 0.006;

/** Inset a local box, lower its top, then bake its world transform. */
export function boxGeometry(
  min: ArrayLike<number>,
  max: ArrayLike<number>,
  matrix: Matrix4,
  shrink: number = SHRINK,
  lower: number = LOWER,
): BufferGeometry {
  const width = max[0] - min[0] - 2 * shrink;
  const height = max[1] - min[1] - 2 * shrink - lower;
  const depth = max[2] - min[2] - 2 * shrink;
  if (width <= 0 || height <= 0 || depth <= 0) return new BufferGeometry();
  return new BoxGeometry(width, height, depth)
    .translate((min[0] + max[0]) / 2, (min[1] + max[1] - lower) / 2, (min[2] + max[2]) / 2)
    .applyMatrix4(matrix);
}

/** Triangulate a planar world-space outline, including concave outlines. */
export function polygonGeometry(points: Vector3[]): BufferGeometry {
  const geometry = new BufferGeometry();
  if (points.length < 3) return geometry;
  const normal = new Vector3();
  const a = new Vector3();
  const b = new Vector3();
  for (let i = 1; i < points.length - 1; i++) {
    a.subVectors(points[i], points[0]);
    b.subVectors(points[i + 1], points[0]);
    normal.add(a.cross(b));
  }
  if (normal.lengthSq() === 0) return geometry;
  const x = Math.abs(normal.x);
  const y = Math.abs(normal.y);
  const z = Math.abs(normal.z);
  // Drop the dominant normal axis so vertical walls triangulate like tables.
  const contour = points.map((p) => x >= y && x >= z
    ? new Vector2(p.y, p.z)
    : y >= z ? new Vector2(p.x, p.z) : new Vector2(p.x, p.y));
  geometry.setAttribute('position', new Float32BufferAttribute(points.flatMap((p) => [p.x, p.y, p.z]), 3));
  geometry.setIndex(ShapeUtils.triangulateShape(contour, []).flat());
  return geometry;
}

/**
 * The seat the player sits on (or anything their head is over) would sit
 * between their eyes and the mat, so it never occludes.
 */
function underHead(head: Vector3, x0: number, x1: number, z0: number, z1: number): boolean {
  const m = 0.35;
  return head.x > x0 - m && head.x < x1 + m && head.z > z0 - m && head.z < z1 + m;
}

export class Occluders {
  readonly root = new Group();
  private material = new MeshBasicMaterial({
    colorWrite: false,
    depthWrite: true,
    depthTest: true,
    side: DoubleSide,
  });

  constructor() {
    this.root.name = 'Occluders';
  }

  /**
   * Scan-change rebuild; this is not a per-frame update. Keep root in world
   * space. `keepClear` is the mat: the furniture it stands on never hides it.
   */
  update(planes: PlaneInfo[], meshes: MeshInfo[], keepClear: Vector3 | null = null, head: Vector3 | null = null): void {
    for (const child of this.root.children) {
      (child as Mesh).geometry.dispose();
    }
    this.root.clear();
    const tops = surfacesFromPlanes(planes).filter((s) => s.kind === 'table');
    const corner = new Vector3();
    for (const { object, min, max } of meshes) {
      object.updateWorldMatrix(true, false);
      // World footprint and top of the box.
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, top = -Infinity;
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]).applyMatrix4(object.matrixWorld);
        x0 = Math.min(x0, corner.x);
        x1 = Math.max(x1, corner.x);
        z0 = Math.min(z0, corner.z);
        z1 = Math.max(z1, corner.z);
        top = Math.max(top, corner.y);
      }
      if (keepClear && keepClear.x > x0 && keepClear.x < x1 && keepClear.z > z0 && keepClear.z < z1 && top < keepClear.y + 0.2) {
        continue;
      }
      if (head && underHead(head, x0, x1, z0, z1)) continue;
      // A detected tabletop over the same footprint is where things really
      // rest; the box may reach higher (a lip, a backrest), so cut it down.
      let lower = LOWER;
      for (const t of tops) {
        const y = t.center.y;
        if (y >= top || top - y > 0.25) continue;
        let tx0 = Infinity, tx1 = -Infinity, tz0 = Infinity, tz1 = -Infinity;
        for (const p of t.polygon) {
          tx0 = Math.min(tx0, p.x);
          tx1 = Math.max(tx1, p.x);
          tz0 = Math.min(tz0, p.z);
          tz1 = Math.max(tz1, p.z);
        }
        const ox = Math.max(0, Math.min(x1, tx1) - Math.max(x0, tx0));
        const oz = Math.max(0, Math.min(z1, tz1) - Math.max(z0, tz0));
        const smaller = Math.min((x1 - x0) * (z1 - z0), (tx1 - tx0) * (tz1 - tz0));
        if (smaller > 0 && (ox * oz) / smaller > 0.3) lower = Math.max(lower, top - y + LOWER);
      }
      this.add(boxGeometry(min, max, object.matrixWorld, SHRINK, lower));
    }
    for (const surface of surfacesFromPlanes(planes)) {
      if (surface.kind === 'floor') continue;
      if (surface.kind === 'table') {
        if (head) {
          const xs = surface.polygon.map((p) => p.x);
          const zs = surface.polygon.map((p) => p.z);
          if (underHead(head, Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs))) continue;
        }
        for (const point of surface.polygon) point.y -= LOWER;
      }
      this.add(polygonGeometry(surface.polygon));
    }
  }

  private add(geometry: BufferGeometry): void {
    if (!geometry.getAttribute('position')) {
      geometry.dispose();
      return;
    }
    const mesh = new Mesh(geometry, this.material);
    mesh.renderOrder = -10;
    this.root.add(mesh);
  }

  setEnabled(on: boolean): void {
    this.root.visible = on;
  }
}
