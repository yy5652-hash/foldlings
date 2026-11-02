import { Object3D, Vector3 } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import { floatingPlacement, tablePlacement, tableYaw } from './placement.js';
import type { Surface } from './room.js';

const radians = (degrees: number) => degrees * Math.PI / 180;
const polygon = [{ x: -1, z: -0.4 }, { x: 1, z: -0.4 }, { x: 1, z: 0.4 }, { x: -1, z: 0.4 }];

describe('table alignment', () => {
  it('uses the longest edge regardless of polygon winding or starting corner', () => {
    expect(tableYaw(polygon, radians(20))).toBeCloseTo(0);
    expect(tableYaw([...polygon].reverse(), radians(20))).toBeCloseTo(0);
    expect(tableYaw([...polygon.slice(1), polygon[0]], radians(20))).toBeCloseTo(0);
  });

  it('chooses the nearest right angle across the yaw wrap', () => {
    expect(tableYaw(polygon, radians(80))).toBeCloseTo(radians(90));
    expect(tableYaw(polygon, radians(-170))).toBeCloseTo(radians(-180));
    expect(tableYaw(polygon, radians(350))).toBeCloseTo(radians(360));
  });

  it('snaps at 30 degrees but preserves the heading beyond that', () => {
    expect(tableYaw(polygon, radians(30))).toBeCloseTo(0);
    expect(tableYaw(polygon, radians(31))).toBeCloseTo(radians(31));
    expect(tableYaw(polygon, radians(-31))).toBeCloseTo(radians(-31));
    expect(tableYaw([], 0.8)).toBe(0.8);
  });

  it('follows a rotated table edge', () => {
    const yaw = radians(15);
    const rotated = polygon.map(({ x, z }) => ({ x: x * Math.cos(yaw) + z * Math.sin(yaw), z: -x * Math.sin(yaw) + z * Math.cos(yaw) }));
    expect(tableYaw(rotated, radians(35))).toBeCloseTo(yaw);
  });

  it('slides using the final mat axes and the full footprint, seating 1 mm above the table', () => {
    const head = new Object3D();
    head.position.y = 1.2;
    head.rotation.y = radians(20);
    const surface: Surface = {
      kind: 'table', label: 'desk', center: new Vector3(0, 0.74, -0.5), normal: new Vector3(0, 1, 0),
      polygon: [new Vector3(-0.28, 0.74, -0.75), new Vector3(0.28, 0.74, -0.75), new Vector3(0.28, 0.74, -0.25), new Vector3(-0.28, 0.74, -0.25)],
    };
    const placement = tablePlacement(head, [surface])!;
    expect(placement.yaw).toBeCloseTo(0);
    expect(placement.position.x).toBeCloseTo(-Math.sin(radians(20)) * 0.42 * 0.2);
    expect(placement.position.y).toBeCloseTo(0.741);
    expect(placement.onSurface).toBe(true);
    for (const x of [-0.25, 0.25]) for (const z of [-0.22, 0.22]) {
      expect(Math.abs(placement.position.x + x)).toBeLessThanOrEqual(0.28);
      expect(Math.abs(placement.position.z + z + 0.5)).toBeLessThanOrEqual(0.25);
    }
    expect(tablePlacement(head, [])).toBeNull();
    const floating = floatingPlacement(head);
    expect(floating.yaw).toBeCloseTo(radians(20));
    expect(floating.position.y).toBeCloseTo(0.78);
  });
});
