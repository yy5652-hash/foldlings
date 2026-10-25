/** Room occluder geometry and scan-change lifecycle, without a renderer. */

import { DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Object3D, Vector3 } from '@iwsdk/core';
import { describe, expect, it, vi } from 'vitest';
import { boxGeometry, Occluders, polygonGeometry } from './occluders.js';
import type { MeshInfo, PlaneInfo } from './room.js';

function planeInfo(height: number, orientation: XRPlane['orientation'], rotation = 0): PlaneInfo {
  const object = new Object3D();
  object.position.set(2, height, -3);
  object.rotation.x = rotation;
  return {
    object,
    plane: {
      orientation,
      polygon: [
        { x: -1, z: -1 }, { x: 1, z: -1 },
        { x: 1, z: 1 }, { x: -1, z: 1 },
      ],
    } as XRPlane,
  };
}

describe('occluder geometry', () => {
  it('shrinks a unit box by 1 cm on each side and lowers its top another 6 mm', () => {
    const geometry = boxGeometry([0, 0, 0], [1, 1, 1], new Matrix4(), 0.01, 0.006);
    geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox!;
    for (const value of min.toArray()) expect(value).toBeCloseTo(0.01, 6);
    expect(max.x).toBeCloseTo(0.99, 6);
    expect(max.y).toBeCloseTo(0.984, 6);
    expect(max.z).toBeCloseTo(0.99, 6);
    expect(geometry.index!.count).toBe(36);
    geometry.dispose();
  });

  it('transforms the inset local box into world space without changing inputs', () => {
    const min = [0, 0, 0];
    const max = [1, 1, 1];
    const matrix = new Matrix4().makeRotationY(Math.PI / 2).setPosition(2, 3, 4);
    const original = matrix.clone();
    const geometry = boxGeometry(min, max, matrix);
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    expect(bounds.min.x).toBeCloseTo(2.01, 6);
    expect(bounds.max.x).toBeCloseTo(2.99, 6);
    expect(bounds.min.y).toBeCloseTo(3.01, 6);
    expect(bounds.max.y).toBeCloseTo(3.984, 6);
    expect(bounds.min.z).toBeCloseTo(3.01, 6);
    expect(bounds.max.z).toBeCloseTo(3.99, 6);
    expect(min).toEqual([0, 0, 0]);
    expect(max).toEqual([1, 1, 1]);
    expect(matrix.equals(original)).toBe(true);
    geometry.dispose();
  });

  it.each(['horizontal', 'vertical'])('makes two triangles with the given %s world positions', (orientation) => {
    const points = orientation === 'horizontal'
      ? [new Vector3(2, 1, 3), new Vector3(3, 1, 3), new Vector3(3, 1, 4), new Vector3(2, 1, 4)]
      : [new Vector3(2, 1, 3), new Vector3(2, 2, 3), new Vector3(2, 2, 4), new Vector3(2, 1, 4)];
    const positions = points.flatMap((p) => p.toArray());
    const geometry = polygonGeometry(points);
    expect(Array.from(geometry.getAttribute('position').array)).toEqual(positions);
    expect(geometry.index!.count).toBe(6);
    expect(new Set(geometry.index!.array)).toEqual(new Set([0, 1, 2, 3]));
    expect(points.flatMap((p) => p.toArray())).toEqual(positions);
    geometry.dispose();
  });

  it('triangulates a concave outline without filling its missing corner', () => {
    const points = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]
      .map(([x, z]) => new Vector3(x, 1, z));
    const geometry = polygonGeometry(points);
    const indices = geometry.index!.array;
    let area = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const a = points[indices[i]];
      const b = points[indices[i + 1]];
      const c = points[indices[i + 2]];
      area += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
    }
    expect(area).toBeCloseTo(3, 6);
    geometry.dispose();
  });
});

describe('room occluders', () => {
  it('skips floor and downward ceiling planes, keeps walls, and lowers tables', () => {
    const occluders = new Occluders();
    const wall = planeInfo(1.5, 'vertical', Math.PI / 2);
    const table = planeInfo(0.8, 'horizontal');
    occluders.update([
      planeInfo(0.1, 'horizontal'), wall, table,
      planeInfo(2.5, 'horizontal', Math.PI),
    ], []);
    expect(occluders.root.name).toBe('Occluders');
    expect(occluders.root.children).toHaveLength(2);
    const wallPositions = (occluders.root.children[0] as Mesh).geometry.getAttribute('position');
    wall.plane.polygon.forEach((p, i) => {
      const expected = new Vector3(p.x, 0, p.z).applyMatrix4(wall.object.matrixWorld);
      expect(wallPositions.getX(i)).toBeCloseTo(expected.x, 6);
      expect(wallPositions.getY(i)).toBeCloseTo(expected.y, 6);
      expect(wallPositions.getZ(i)).toBeCloseTo(expected.z, 6);
    });
    const tablePositions = (occluders.root.children[1] as Mesh).geometry.getAttribute('position');
    for (let i = 0; i < tablePositions.count; i++) {
      expect(tablePositions.getY(i)).toBeCloseTo(0.794, 6);
    }
    occluders.update([], []);
  });

  it('rebuilds furniture boxes, disposes old geometry, and reuses depth-only material', () => {
    const occluders = new Occluders();
    const parent = new Object3D();
    parent.position.set(2, 3, 4);
    const object = new Object3D();
    parent.add(object);
    const furniture: MeshInfo = { object, label: 'couch', min: [0, 0, 0], max: [1, 1, 1] };
    occluders.update([planeInfo(1, 'vertical', Math.PI / 2)], [furniture]);
    const old = occluders.root.children as Mesh[];
    const disposals = old.map((mesh) => vi.spyOn(mesh.geometry, 'dispose'));
    const material = old[0].material as MeshBasicMaterial;
    const materialDispose = vi.spyOn(material, 'dispose');
    expect(old[1].material).toBe(material);
    expect(material).toMatchObject({ colorWrite: false, depthWrite: true, depthTest: true, side: DoubleSide });
    expect(old.every((mesh) => mesh.renderOrder === -10)).toBe(true);
    old[0].geometry.computeBoundingBox();
    expect(old[0].geometry.boundingBox!.max.y).toBeCloseTo(3.984, 6);
    occluders.setEnabled(false);
    occluders.update([], [furniture]);
    expect(occluders.root.visible).toBe(false);
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
    expect(occluders.root.children).toHaveLength(1);
    expect((occluders.root.children[0] as Mesh).material).toBe(material);
    expect(materialDispose).not.toHaveBeenCalled();
    occluders.setEnabled(true);
    expect(occluders.root.visible).toBe(true);
    occluders.update([], []);
    expect(occluders.root.children).toHaveLength(0);
  });
});
