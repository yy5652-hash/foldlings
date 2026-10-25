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

  /** Scan-change rebuild; this is not a per-frame update. Keep root in world space. */
  update(planes: PlaneInfo[], meshes: MeshInfo[]): void {
    for (const child of this.root.children) {
      (child as Mesh).geometry.dispose();
    }
    this.root.clear();
    for (const { object, min, max } of meshes) {
      object.updateWorldMatrix(true, false);
      this.add(boxGeometry(min, max, object.matrixWorld));
    }
    for (const surface of surfacesFromPlanes(planes)) {
      if (surface.kind === 'floor') continue;
      if (surface.kind === 'table') {
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
