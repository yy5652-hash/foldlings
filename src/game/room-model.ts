/**
 * Your scanned room as a small hologram over the table: every wall, surface and
 * piece of furniture the headset found, turning slowly, with a mark for the table
 * and one for each creature. It is drawn from the live scan, so it is your room.
 */

import {
  AdditiveBlending,
  Box3,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  ShapeUtils,
  Vector2,
  Vector3,
} from '@iwsdk/core';
import { follow } from './glass.js';
import { holoLine } from './holo.js';
import type { MeshInfo, Surface } from './room.js';

const SHOW = 5.2;
/** How wide the model stands, in metres. */
const SPAN = 0.42;

export class RoomModel {
  /** Placed over the table by the game. */
  readonly root = new Group();
  private turn = new Group();
  private lines: LineSegments<BufferGeometry> | null = null;
  private faces: Mesh<BufferGeometry, MeshBasicMaterial> | null = null;
  private marks: Points<BufferGeometry, PointsMaterial> | null = null;
  private t = -1;
  private k = 0;
  /** Facts for the labels. */
  width = 0;
  depth = 0;
  count = 0;

  constructor() {
    this.root.name = 'RoomModel';
    this.root.add(this.turn);
    this.root.visible = false;
  }

  get showing(): boolean {
    return this.t >= 0;
  }

  /** Rebuilds from the scan, then shows it; `marks` are world points to pin. */
  show(surfaces: Surface[], meshes: MeshInfo[], marks: Vector3[]) {
    this.clear();
    const box = new Box3();
    const L: number[] = [];
    const F: number[] = [];
    for (const s of surfaces) {
      const n = s.polygon.length;
      if (n < 3) continue;
      for (let i = 0; i < n; i++) {
        const a = s.polygon[i];
        const b = s.polygon[(i + 1) % n];
        box.expandByPoint(a);
        L.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      // Faces from an ear clip in the plane's own two axes.
      const flat = Math.abs(s.normal.y) > 0.7;
      const contour = s.polygon.map((p) => (flat ? new Vector2(p.x, p.z) : new Vector2(p.x + p.z, p.y)));
      for (const [i, j, k] of ShapeUtils.triangulateShape(contour, [])) {
        for (const v of [s.polygon[i], s.polygon[j], s.polygon[k]]) F.push(v.x, v.y, v.z);
      }
    }
    const c = new Vector3();
    for (const { object, min, max } of meshes) {
      object.updateWorldMatrix(true, false);
      const corner = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
        c.set(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]).clone().applyMatrix4(object.matrixWorld),
      );
      for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) {
        L.push(corner[a].x, corner[a].y, corner[a].z, corner[b].x, corner[b].y, corner[b].z);
      }
      for (const p of corner) box.expandByPoint(p);
    }
    if (box.isEmpty()) return;
    const size = box.getSize(new Vector3());
    const centre = box.getCenter(new Vector3());
    const scale = SPAN / Math.max(size.x, size.y, size.z, 0.5);
    this.width = size.x;
    this.depth = size.z;
    this.count = surfaces.length + meshes.length;
    const local = (arr: number[]) => {
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] = (arr[i] - centre.x) * scale;
        arr[i + 1] = (arr[i + 1] - centre.y) * scale;
        arr[i + 2] = (arr[i + 2] - centre.z) * scale;
      }
      return new Float32BufferAttribute(arr, 3);
    };
    const lg = new BufferGeometry();
    lg.setAttribute('position', local(L));
    this.lines = new LineSegments(lg, holoLine(0x7fe3ff, 0.9));
    const fg = new BufferGeometry();
    fg.setAttribute('position', local(F));
    this.faces = new Mesh(
      fg,
      new MeshBasicMaterial({ color: 0x1f8fc8, transparent: true, opacity: 0.16, depthWrite: false, side: DoubleSide, blending: AdditiveBlending, toneMapped: false }),
    );
    const pg = new BufferGeometry();
    const P: number[] = [];
    for (const m of marks) P.push(m.x, m.y, m.z);
    pg.setAttribute('position', local(P));
    this.marks = new Points(pg, new PointsMaterial({ color: 0xffc266, size: 0.012, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }));
    for (const o of [this.lines, this.faces, this.marks]) {
      o.raycast = () => {};
      o.frustumCulled = false;
      this.turn.add(o);
    }
    this.lines.renderOrder = 64;
    this.faces.renderOrder = 63;
    this.marks.renderOrder = 65;
    this.t = 0;
    this.k = 0;
    this.root.visible = true;
  }

  private clear() {
    for (const o of [this.lines, this.faces, this.marks]) {
      if (!o) continue;
      this.turn.remove(o);
      o.geometry.dispose();
      (o.material as MeshBasicMaterial).dispose();
    }
    this.lines = this.faces = this.marks = null;
  }

  stop() {
    this.t = -1;
    this.root.visible = false;
  }

  update(dt: number) {
    if (this.t < 0) return;
    this.t += dt;
    this.turn.rotation.y += dt * 0.38;
    this.k = follow(this.k, this.t < SHOW - 0.6 ? 1 : 0, this.t < SHOW - 0.6 ? 3 : 8, dt);
    const s = 0.6 + 0.4 * this.k;
    this.root.scale.set(s, this.k, s);
    if (this.lines) (this.lines.material as MeshBasicMaterial).opacity = 0.9 * this.k;
    if (this.faces) this.faces.material.opacity = 0.16 * this.k;
    if (this.marks) this.marks.material.opacity = this.k;
    if (this.t > SHOW) this.stop();
  }
}
