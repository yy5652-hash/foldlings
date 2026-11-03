import { describe, expect, it } from 'vitest';
import { clampDistance, clampPitch, clampYaw, damp, Orbit, ORBIT_LIMITS } from './orbit.js';

describe('desktop camera limits and timing', () => {
  it('clamps yaw to ±55°, elevation to 20–65°, and close/wide zoom', () => {
    expect(clampYaw(-100)).toBe(-55 * Math.PI / 180);
    expect(clampYaw(100)).toBe(55 * Math.PI / 180);
    expect(clampPitch(-100)).toBe(20 * Math.PI / 180);
    expect(clampPitch(100)).toBe(65 * Math.PI / 180);
    expect(clampDistance(-100)).toBe(0.48);
    expect(clampDistance(100)).toBe(1.8);
    expect(clampYaw(0.1)).toBe(0.1);
    expect(clampPitch(0.7)).toBe(0.7);
  });

  it('damps consistently across frame rates without overshooting', () => {
    let at60 = 0, at30 = 0;
    for (let n = 0; n < 60; n++) at60 = damp(at60, 1, 1 / 60);
    for (let n = 0; n < 30; n++) at30 = damp(at30, 1, 1 / 30);
    expect(at60).toBeCloseTo(at30, 12);
    expect(at60).toBeLessThan(1);
    expect(damp(0, 1, -1)).toBe(0);
  });

  it('flies from a high wide island view to the seat over 2.5 seconds', () => {
    const pose = new Orbit(false);
    pose.advance(0);
    expect(pose.pitch).toBe(ORBIT_LIMITS.maxPitch);
    expect(pose.distance).toBe(ORBIT_LIMITS.maxDistance);
    expect(pose.focusY).toBe(0.24);
    pose.advance(1.25);
    expect(pose.distance).toBeGreaterThan(pose.targetDistance);
    expect(pose.distance).toBeLessThan(ORBIT_LIMITS.maxDistance);
    pose.advance(1.25);
    expect(pose.opening).toBe(2.5);
    expect(pose.distance).toBeCloseTo(pose.targetDistance);
    expect(pose.pitch).toBeCloseTo(pose.targetPitch);
    expect(pose.focusY).toBeCloseTo(0.06);
  });

  it('skips the fly-in and damping for reduced motion, including a live change', () => {
    const pose = new Orbit(true);
    pose.advance(0);
    expect(pose.opening).toBe(2.5);
    expect(pose.distance).toBe(pose.targetDistance);
    pose.rotate(1000, -1000);
    pose.zoom(1000);
    pose.advance(0.01, true);
    expect(pose.yaw).toBe(-ORBIT_LIMITS.yaw);
    expect(pose.pitch).toBe(ORBIT_LIMITS.minPitch);
    expect(pose.distance).toBe(ORBIT_LIMITS.maxDistance);
    const live = new Orbit(false);
    live.advance(0.5);
    live.advance(0.01, true);
    expect(live.opening).toBe(2.5);
    expect(live.distance).toBe(live.targetDistance);
    expect(live.focusY).toBe(0.06);
  });

  it('holds the displayed pose and focus when a player interrupts the opening', () => {
    const pose = new Orbit(false);
    pose.advance(1);
    const before = [pose.yaw, pose.pitch, pose.distance, pose.focusY, pose.focusZ];
    pose.hold();
    pose.advance(1);
    expect([pose.yaw, pose.pitch, pose.distance, pose.focusY, pose.focusZ]).toEqual(before);
  });

  it('starts farther away on a portrait phone so the mat and island fit', () => {
    expect(new Orbit(true, 375 / 812).distance).toBeGreaterThan(new Orbit(true, 16 / 9).distance);
    expect(new Orbit(true, 0.1).distance).toBeLessThanOrEqual(ORBIT_LIMITS.maxDistance);
  });
});
