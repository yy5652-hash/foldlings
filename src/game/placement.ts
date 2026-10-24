/**
 * Finds a comfortable spot for the mat: on a real table within reach when
 * the room has been scanned, otherwise floating at seated-desk height.
 */

import { Object3D, Vector3 } from '@iwsdk/core';
import { MAT_D, MAT_W } from './board-view.js';
import type { Surface } from './room.js';

export interface Placement {
  position: Vector3;
  yaw: number;
  onSurface: boolean;
  label: string;
}

const REACH = 0.42;
const DESK_DROP = 0.42;

function pointInPolygon(x: number, z: number, poly: { x: number; z: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function headPose(head: Object3D): { pos: Vector3; fwd: Vector3; yaw: number } {
  head.updateWorldMatrix(true, false);
  const pos = new Vector3().setFromMatrixPosition(head.matrixWorld);
  const fwd = new Vector3(0, 0, -1).transformDirection(head.matrixWorld);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  fwd.normalize();
  return { pos, fwd, yaw: Math.atan2(-fwd.x, -fwd.z) };
}

export function floatingPlacement(head: Object3D): Placement {
  const { pos, fwd, yaw } = headPose(head);
  const y = Math.min(Math.max(pos.y - DESK_DROP, 0.45), 1.3);
  return {
    position: new Vector3(pos.x + fwd.x * REACH, y, pos.z + fwd.z * REACH),
    yaw,
    onSurface: false,
    label: 'float',
  };
}

/** Best table-like surface under the reach zone, or null. */
export function tablePlacement(head: Object3D, surfaces: Surface[]): Placement | null {
  const { pos, fwd, yaw } = headPose(head);
  let best: Placement | null = null;
  let bestScore = Infinity;
  for (const s of surfaces) {
    if (s.kind !== 'table' || s.polygon.length < 3) continue;
    const height = s.center.y;
    // Tables sit well below the eyes and well above the floor.
    if (height < 0.35 || height > pos.y - 0.15 || height < pos.y - 1.0) continue;
    const poly = s.polygon.map((p) => ({ x: p.x, z: p.z }));
    let cx = 0;
    let cz = 0;
    for (const p of poly) {
      cx += p.x / poly.length;
      cz += p.z / poly.length;
    }
    const want = { x: pos.x + fwd.x * REACH, z: pos.z + fwd.z * REACH };
    // Slide from the ideal spot towards the surface centre until the mat fits.
    const right = { x: -fwd.z, z: fwd.x };
    let spot: { x: number; z: number } | null = null;
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const x = want.x + (cx - want.x) * t;
      const z = want.z + (cz - want.z) * t;
      const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([a, b]) => ({
        x: x + right.x * a * MAT_W * 0.45 + fwd.x * b * MAT_D * 0.45,
        z: z + right.z * a * MAT_W * 0.45 + fwd.z * b * MAT_D * 0.45,
      }));
      if (corners.every((c) => pointInPolygon(c.x, c.z, poly))) {
        spot = { x, z };
        break;
      }
    }
    let fits = spot !== null;
    if (!spot) {
      // Smaller surface: its centre will do if most of the mat still lands on it.
      if (!pointInPolygon(cx, cz, poly)) continue;
      const xs = poly.map((p) => p.x);
      const zs = poly.map((p) => p.z);
      const w = Math.max(...xs) - Math.min(...xs);
      const d = Math.max(...zs) - Math.min(...zs);
      if (Math.min(w, d) < 0.38 || Math.max(w, d) < 0.45) continue;
      spot = { x: cx, z: cz };
      fits = false;
    }
    const reach = Math.hypot(spot.x - pos.x, spot.z - pos.z);
    if (reach > 0.85) continue;
    const label = s.label;
    const score =
      Math.hypot(spot.x - want.x, spot.z - want.z) +
      0.5 * Math.abs(height - (pos.y - DESK_DROP)) +
      (fits ? 0 : 0.3) +
      // Unlabelled boxes are often chairs or stools; real tables win.
      (label === 'other' || label === '' ? 0.5 : 0) -
      (label === 'table' || label === 'desk' ? 0.15 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = {
        position: new Vector3(spot.x, height + 0.003, spot.z),
        yaw,
        onSurface: true,
        label: label || 'surface',
      };
    }
  }
  return best;
}
