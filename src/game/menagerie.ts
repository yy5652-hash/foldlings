/**
 * The paper zoo: every solved puzzle becomes a creature that finds a home in
 * the room (tables, floor, walls, or the air) and is still there next visit.
 */

import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  RingGeometry,
  SphereGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  PokeInteractable,
  Quaternion,
  RayInteractable,
  Vector3,
  World,
  DoubleSide,
  Entity,
} from '@iwsdk/core';
import { Creature, Habitat } from './creatures.js';
import type { CreatureKind } from './levels.js';
import { LOOKS } from './levels.js';
import { RoomFrame, safeGet, safeSet, Surface } from './room.js';
import { sfx } from './sfx.js';

const SAVE_KEY = 'foldlings.zoo.v1';
const MAX_SHOWN = 18;

export interface SavedCreature {
  kind: CreatureKind;
  look: number;
  /** Position in the room frame. */
  p: [number, number, number];
  yaw: number;
  /** Orientation for wall-sitters: surface normal in the room frame. */
  n?: [number, number, number];
  /** Saved while a persistent anchor was active, so `p` is a real spot. */
  anchored?: boolean;
}

interface Live {
  c: Creature;
  entity: Entity;
  saved: SavedCreature;
  travel: Travel | null;
  orbit: { center: Vector3; radius: number; speed: number; phase: number } | null;
  /** Starts circling once it arrives. */
  endAir: boolean;
}

interface Home {
  pos: Vector3;
  normal: Vector3 | null;
  air: boolean;
  /** Where it settled, in words: "couch", "table", "wall", "floor", or "" for mid-air. */
  where: string;
}

interface Travel {
  from: Vector3;
  to: Vector3;
  t: number;
  dur: number;
  mode: 'fly' | 'hop';
  hops: number;
  arc: number;
  endQuat: Quaternion;
}

/** Where a travelling creature is at progress u (room frame). */
function travelPoint(tr: Travel, u: number, out: Vector3): Vector3 {
  const e = tr.mode === 'fly' ? u * u * (3 - 2 * u) : u;
  out.copy(tr.from).lerp(tr.to, e);
  if (tr.mode === 'fly') {
    out.y += Math.sin(Math.PI * e) * tr.arc;
  } else {
    const k = (e * tr.hops) % 1;
    out.y += Math.sin(Math.PI * k) * (tr.arc + 0.04 * (1 - u));
  }
  return out;
}

/**
 * Holographic flight path and landing ring shown while a new creature heads
 * to its home, so the player sees which real surface it chose.
 */
class HomeMarker {
  readonly root = new Group();
  private dots: InstancedMesh;
  private ring: Mesh;
  private life = -1;
  private o = new Object3D();
  private n = 40;

  constructor() {
    this.root.name = 'HomeMarker';
    this.dots = new InstancedMesh(
      new SphereGeometry(0.0045, 8, 6),
      new MeshBasicMaterial({ color: 0x5ee8ff, transparent: true, depthWrite: false, blending: AdditiveBlending }),
      this.n,
    );
    this.dots.frustumCulled = false;
    const ring = new RingGeometry(0.045, 0.055, 40);
    this.ring = new Mesh(
      ring,
      new MeshBasicMaterial({ color: 0x5ee8ff, transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending }),
    );
    this.root.add(this.dots, this.ring);
    this.root.visible = false;
  }

  show(tr: Travel, normal: Vector3 | null) {
    const p = new Vector3();
    for (let i = 0; i < this.n; i++) {
      travelPoint(tr, i / (this.n - 1), p);
      this.o.position.copy(p);
      this.o.updateMatrix();
      this.dots.setMatrixAt(i, this.o.matrix);
    }
    this.dots.instanceMatrix.needsUpdate = true;
    this.ring.position.copy(tr.to);
    this.ring.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal ?? new Vector3(0, 1, 0));
    this.ring.position.addScaledVector(normal ?? new Vector3(0, 1, 0), 0.004);
    this.life = 0;
    this.root.visible = true;
  }

  update(dt: number, total: number) {
    if (this.life < 0) return;
    this.life += dt;
    const fade = this.life < total ? Math.min(1, this.life / 0.3) : Math.max(0, 1 - (this.life - total) / 0.8);
    (this.dots.material as MeshBasicMaterial).opacity = 0.85 * fade;
    const pulse = 1 + 0.25 * Math.sin(this.life * 8);
    this.ring.scale.setScalar(pulse);
    (this.ring.material as MeshBasicMaterial).opacity = 0.9 * fade;
    if (fade <= 0 && this.life > total) {
      this.life = -1;
      this.root.visible = false;
    }
  }
}

/** Plain words for a surface, preferring the room scan's own label. */
function describe(s: Surface): string {
  const label = s.label.toLowerCase().replace(/_/g, ' ');
  const known = ['table', 'desk', 'couch', 'sofa', 'bed', 'shelf', 'storage', 'screen', 'window', 'door', 'floor', 'wall'];
  if (known.includes(label)) return label === 'storage' ? 'shelf' : label;
  return s.kind === 'table' ? 'table' : s.kind;
}

function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}

function pointInPoly(x: number, z: number, poly: Vector3[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export class Menagerie {
  private live: Live[] = [];
  private saved: SavedCreature[] = [];
  private surfaces: Surface[] = [];
  private confetti: Confetti;
  private marker = new HomeMarker();
  private markerTime = 0;
  private placedThisSession = false;
  /** True in passthrough: spots refer to the player's real room. */
  realRoom = false;
  private avoid = new Vector3(0, -10, 0);
  private tmp = new Vector3();

  constructor(
    private world: World,
    private room: RoomFrame,
  ) {
    try {
      this.saved = JSON.parse(safeGet(SAVE_KEY) ?? '[]') as SavedCreature[];
    } catch {
      this.saved = [];
    }
    this.confetti = new Confetti();
    world.createTransformEntity(this.confetti.mesh);
    this.room.root.add(this.marker.root);
    // Each mode (flat page, VR, passthrough) shows its own placement of the
    // zoo, so switching modes starts the creatures afresh.
    const reset = () => {
      this.placedThisSession = false;
      this.clearLive();
    };
    world.renderer.xr.addEventListener('sessionstart', reset);
    world.renderer.xr.addEventListener('sessionend', reset);
  }

  get count(): number {
    return this.saved.length;
  }

  setSurfaces(s: Surface[]) {
    this.surfaces = s;
  }

  private save() {
    safeSet(SAVE_KEY, JSON.stringify(this.saved));
  }

  private clearLive() {
    for (const l of this.live) {
      l.entity.dispose();
      l.c.dispose();
    }
    this.live = [];
  }

  private head(): Vector3 {
    return this.world.camera.getWorldPosition(new Vector3());
  }

  private forward(): Vector3 {
    const f = this.world.camera.getWorldDirection(new Vector3());
    f.y = 0;
    if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
    return f.normalize();
  }

  /** World position for a new home, plus the facing it should rest with. */
  private findHome(habitat: Habitat, avoid: Vector3): Home {
    const head = this.head();
    const fwd = this.forward();
    const others = this.live.map((l) => l.c.root.getWorldPosition(new Vector3()));
    const clear = (p: Vector3, min = 0.16) =>
      p.distanceTo(avoid) > 0.32 && others.every((o) => o.distanceTo(p) > min);
    const inFront = (p: Vector3) => {
      const d = this.tmp.copy(p).sub(head).setY(0);
      const len = d.length();
      return len > 0.3 && len < 3.2 && d.dot(fwd) / len > -0.35;
    };
    const sampleOn = (s: Surface, tries = 24): Vector3 | null => {
      if (s.kind === 'wall') {
        // Walls: sample along the outline's horizontal span at eye-ish height.
        const a = s.polygon[0];
        let far = s.polygon[1];
        for (const p of s.polygon) if (p.distanceTo(a) > far.distanceTo(a)) far = p;
        for (let i = 0; i < tries; i++) {
          const t = rand(0.15, 0.85);
          const p = a.clone().lerp(far, t);
          p.y = rand(Math.max(0.9, head.y - 0.5), head.y + 0.25);
          p.addScaledVector(s.normal, 0.01);
          if (clear(p) && inFront(p)) return p;
        }
        return null;
      }
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const p of s.polygon) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
      for (let i = 0; i < tries; i++) {
        const x = rand(minX, maxX);
        const z = rand(minZ, maxZ);
        if (!pointInPoly(x, z, s.polygon)) continue;
        // Keep away from the edge so nobody hangs off a shelf.
        const margin = [0.06, -0.06].every(
          (dx) => pointInPoly(x + dx, z, s.polygon) && pointInPoly(x, z + dx, s.polygon),
        );
        if (!margin) continue;
        const p = new Vector3(x, s.center.y + 0.002, z);
        if (clear(p) && inFront(p)) return p;
      }
      return null;
    };
    const pick = (kinds: Surface['kind'][], prefer: (s: Surface) => number) => {
      const list = this.surfaces
        .filter((s) => kinds.includes(s.kind))
        .map((s) => ({ s, score: prefer(s) }))
        .sort((a, b) => a.score - b.score)
        .map((x) => x.s);
      for (const s of list) {
        const p = sampleOn(s);
        if (p) {
          return {
            pos: p,
            normal: s.kind === 'wall' ? s.normal.clone() : null,
            air: false,
            where: describe(s),
          };
        }
      }
      return null;
    };
    // Prefer close surfaces that are not already crowded, with some chance.
    const crowd = (s: Surface) =>
      others.filter((o) =>
        s.kind === 'wall'
          ? Math.abs(this.tmp.copy(o).sub(s.center).dot(s.normal)) < 0.08
          : Math.abs(o.y - s.center.y) < 0.12 && pointInPoly(o.x, o.z, s.polygon),
      ).length;
    const near = (s: Surface) =>
      s.center.distanceTo(head) * 0.6 + crowd(s) * 0.45 + Math.random() * 0.5 + (s.kind === 'floor' ? 0.35 : 0);
    let home: Home | null = null;
    switch (habitat) {
      case 'ground':
        home = pick(['table', 'floor'], near);
        break;
      case 'perch':
        home = pick(['table'], (s) => -s.center.y + crowd(s) * 0.3 + Math.random() * 0.3);
        break;
      case 'wall':
        home = pick(['wall'], near);
        break;
      default:
        break;
    }
    if (home) return home;
    // Air, or no suitable surface: a spot floating around the player.
    const high = habitat === 'high-air';
    for (let i = 0; i < 30; i++) {
      const ang = rand(-1.1, 1.1);
      const r = high ? rand(1.4, 2.2) : rand(0.8, 1.5);
      const dir = fwd.clone().applyAxisAngle(new Vector3(0, 1, 0), ang);
      const p = head.clone().addScaledVector(dir, r);
      p.y = high ? head.y + rand(0.35, 0.7) : head.y + rand(-0.45, 0.1);
      if (habitat === 'ground') p.y = Math.max(0.02, head.y - 1.1);
      if (clear(p, 0.3)) {
        return { pos: p, normal: null, air: habitat !== 'ground', where: habitat === 'ground' ? 'floor' : '' };
      }
    }
    return {
      pos: head.clone().addScaledVector(fwd, 1.2).setY(head.y),
      normal: null,
      air: true,
      where: '',
    };
  }

  private spawnEntity(kind: CreatureKind, look: number): { c: Creature; entity: Entity } {
    const c = new Creature(kind, LOOKS[look % LOOKS.length]);
    if (c.habitat === 'ground' || c.habitat === 'perch') c.root.add(blobShadow(kind === 'whale' ? 0.2 : 0.09));
    const entity = this.world.createTransformEntity(c.root);
    this.room.root.attach(c.root);
    entity.addComponent(RayInteractable);
    entity.addComponent(PokeInteractable);
    return { c, entity };
  }

  /** Shows creatures saved on earlier visits, re-homing them if needed. */
  /**
   * `persist` false (VR, flat screen): homes are temporary and saved spots
   * from the real room are neither used nor overwritten.
   */
  restore(avoid: Vector3, persist: boolean): number | null {
    if (this.placedThisSession) return null;
    this.avoid.copy(avoid);
    this.placedThisSession = true;
    const shown = this.saved.slice(-MAX_SHOWN);
    for (const orig of shown) {
      // On a flat screen, homes are temporary: never overwrite real spots.
      const s = persist ? orig : { ...orig };
      const { c, entity } = this.spawnEntity(s.kind, s.look);
      const live: Live = { c, entity, saved: s, travel: null, orbit: null, endAir: false };
      this.live.push(live);
      if (persist && this.room.restored && s.anchored) {
        c.root.position.fromArray(s.p);
        if (s.n) {
          c.root.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3().fromArray(s.n));
        } else {
          c.root.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), s.yaw);
        }
        if (c.habitat === 'air' || c.habitat === 'high-air') this.startOrbit(live);
      } else {
        c.root.visible = false;
      }
    }
    // A new room, no anchors, or saved on a flat screen: find a fresh home.
    let moved = false;
    for (const l of this.live) {
      if (l.c.root.visible) continue;
      const home = this.findHome(l.c.habitat, this.avoid);
      this.settleAt(l, home.pos, home.normal, home.air);
      l.saved.anchored = this.room.anchored;
      l.c.root.visible = true;
      moved = true;
    }
    if (moved && persist) this.save();
    return this.live.length;
  }

  private toRoom(world: Vector3): Vector3 {
    this.room.root.updateWorldMatrix(true, false);
    return this.room.root.worldToLocal(world.clone());
  }

  /** Room-frame resting transform at a world spot, facing the player. */
  private restPose(
    worldPos: Vector3,
    worldNormal: Vector3 | null,
  ): { p: [number, number, number]; yaw: number; n?: [number, number, number]; quat: Quaternion } {
    const head = this.head();
    const local = this.toRoom(worldPos);
    const yawWorld = Math.atan2(worldPos.x - head.x, worldPos.z - head.z);
    const roomFwd = new Vector3(0, 0, -1).applyQuaternion(this.room.root.quaternion);
    const yaw = yawWorld - Math.atan2(-roomFwd.x, -roomFwd.z);
    const quat = new Quaternion();
    let n: [number, number, number] | undefined;
    if (worldNormal) {
      const ln = worldNormal.clone().applyQuaternion(this.room.root.quaternion.clone().invert());
      n = [ln.x, ln.y, ln.z];
      quat.setFromUnitVectors(new Vector3(0, 1, 0), ln);
    } else {
      quat.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    }
    return { p: [local.x, local.y, local.z], yaw, n, quat };
  }

  private settleAt(l: Live, worldPos: Vector3, worldNormal: Vector3 | null, air: boolean) {
    const rest = this.restPose(worldPos, worldNormal);
    l.saved.p = rest.p;
    l.saved.yaw = rest.yaw;
    if (rest.n) l.saved.n = rest.n;
    else delete l.saved.n;
    l.c.root.position.fromArray(rest.p);
    l.c.root.quaternion.copy(rest.quat);
    if (air) this.startOrbit(l);
  }

  private startOrbit(l: Live) {
    l.orbit = {
      center: l.c.root.position.clone(),
      radius: l.c.kind === 'whale' ? 0.45 : 0.18,
      speed: l.c.kind === 'whale' ? 0.12 : 0.35,
      phase: Math.random() * Math.PI * 2,
    };
  }

  /** A new creature pops out of the paper at `from` and goes home. */
  reveal(kind: CreatureKind, look: number, from: Vector3, avoid: Vector3): string {
    const { c, entity } = this.spawnEntity(kind, look);
    const home = this.findHome(c.habitat, avoid);
    const rest = this.restPose(home.pos, home.normal);
    const saved: SavedCreature = {
      kind,
      look,
      p: rest.p,
      yaw: rest.yaw,
      anchored: this.realRoom && this.room.anchored,
    };
    if (rest.n) saved.n = rest.n;
    const live: Live = { c, entity, saved, travel: null, orbit: null, endAir: home.air };
    this.live.push(live);

    const fromLocal = this.toRoom(from);
    const toLocal = new Vector3().fromArray(rest.p);
    c.root.position.copy(fromLocal);
    c.root.scale.setScalar(0.001);
    this.confetti.burst(from, LOOKS[look % LOOKS.length].front);
    sfx.pop();

    const flying = c.habitat !== 'ground';
    const dist = fromLocal.distanceTo(toLocal);
    live.travel = {
      from: fromLocal,
      to: toLocal,
      t: -1.4, // grow and look around first
      dur: Math.min(4.5, 1.4 + dist * (flying ? 0.9 : 1.3)),
      mode: flying ? 'fly' : 'hop',
      hops: Math.max(2, Math.round(dist / 0.28)),
      arc: flying ? 0.25 + dist * 0.15 : 0.07,
      endQuat: rest.quat,
    };
    const localNormal = rest.n ? new Vector3().fromArray(rest.n) : null;
    this.marker.show(live.travel, localNormal);
    this.markerTime = live.travel.dur + 1.4;
    this.saved.push(saved);
    this.save();
    return home.where;
  }

  update(dt: number) {
    this.confetti.update(dt);
    this.marker.update(dt, this.markerTime);
    const head = this.head();
    for (const l of this.live) {
      l.c.update(dt);
      if (l.travel) this.stepTravel(l, dt, head);
      else if (l.orbit) {
        const o = l.orbit;
        o.phase += dt * o.speed;
        const p = l.c.root.position;
        p.set(
          o.center.x + Math.cos(o.phase) * o.radius,
          o.center.y + Math.sin(o.phase * 2.1) * 0.02,
          o.center.z + Math.sin(o.phase) * o.radius,
        );
        // Swim along the circle.
        l.c.root.rotation.set(0, -o.phase + Math.PI, 0);
        l.c.setTravelling(false);
      }
    }
  }

  private stepTravel(l: Live, dt: number, head: Vector3) {
    const tr = l.travel!;
    const root = l.c.root;
    tr.t += dt;
    if (tr.t < 0) {
      // Pop in, then turn to look at the player.
      const g = Math.min(1, (tr.t + 1.4) / 0.45);
      const s = g < 1 ? 1 - Math.pow(1 - g, 3) * Math.cos(g * 9) : 1;
      root.scale.setScalar(Math.max(0.001, s));
      root.position.y = tr.from.y + Math.sin(Math.min(1, g) * Math.PI) * 0.04;
      const local = this.toRoom(head);
      const yaw = Math.atan2(local.x - root.position.x, local.z - root.position.z) + Math.PI;
      root.rotation.set(0, yaw, 0);
      if (tr.t > -0.6 && tr.t - dt <= -0.6) l.c.poke();
      const sh = root.getObjectByName('Shadow');
      if (sh) sh.visible = false;
      return;
    }
    root.scale.setScalar(1);
    const u = Math.min(1, tr.t / tr.dur);
    const shadow = root.getObjectByName('Shadow');
    if (shadow) shadow.visible = u >= 1;
    l.c.setTravelling(tr.mode === 'fly' && u < 1);
    root.position.copy(travelPoint(tr, u, this.tmp));
    if (u < 0.9) {
      const yaw = Math.atan2(tr.to.x - tr.from.x, tr.to.z - tr.from.z) + Math.PI;
      root.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    } else {
      root.quaternion.slerp(tr.endQuat, Math.min(1, dt * 8));
    }
    if (u >= 1) {
      l.travel = null;
      root.quaternion.copy(tr.endQuat);
      l.c.setTravelling(false);
      if (l.endAir) this.startOrbit(l);
    }
  }

  /** World positions of the creatures on show (tests, film). */
  positions(): { kind: CreatureKind; p: [number, number, number] }[] {
    return this.live.map((l) => {
      const v = l.c.root.getWorldPosition(new Vector3());
      return { kind: l.c.kind, p: [v.x, v.y, v.z] };
    });
  }

  /** Wipes the zoo (settings: start over). */
  reset() {
    this.clearLive();
    this.saved = [];
    this.save();
  }
}

let shadowTex: CanvasTexture | null = null;

/** Soft round contact shadow that grounds a creature on its surface. */
function blobShadow(size: number): Mesh {
  if (!shadowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(0,0,0,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    shadowTex = new CanvasTexture(c);
  }
  const m = new Mesh(
    new PlaneGeometry(size, size),
    new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.0015;
  m.renderOrder = 5;
  m.name = 'Shadow';
  return m;
}

/** A burst of tiny paper triangles. */
class Confetti {
  readonly mesh: InstancedMesh;
  private n = 36;
  private pos: Vector3[] = [];
  private vel: Vector3[] = [];
  private rot: Vector3[] = [];
  private spin: Vector3[] = [];
  private life = 0;
  private o = new Object3D();

  constructor() {
    const g = new PlaneGeometry(0.012, 0.009);
    this.mesh = new InstancedMesh(
      g,
      new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide, transparent: true }),
      this.n,
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    for (let i = 0; i < this.n; i++) {
      this.pos.push(new Vector3());
      this.vel.push(new Vector3());
      this.rot.push(new Vector3());
      this.spin.push(new Vector3());
    }
  }

  burst(at: Vector3, color: string) {
    const a = new Color(color);
    const b = new Color(0xf6f0e4);
    const gold = new Color(0xffd166);
    for (let i = 0; i < this.n; i++) {
      this.pos[i].copy(at);
      const ang = Math.random() * Math.PI * 2;
      const sp = 0.25 + Math.random() * 0.45;
      this.vel[i].set(Math.cos(ang) * sp * 0.6, 0.6 + Math.random() * 0.7, Math.sin(ang) * sp * 0.6);
      this.rot[i].set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.spin[i].set(rand(-12, 12), rand(-12, 12), rand(-12, 12));
      this.mesh.setColorAt(i, i % 3 === 0 ? b : i % 5 === 0 ? gold : a);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.life = 1.6;
    this.mesh.visible = true;
  }

  update(dt: number) {
    if (this.life <= 0) return;
    this.life -= dt;
    const mat = this.mesh.material as MeshBasicMaterial;
    mat.opacity = Math.min(1, this.life / 0.5);
    for (let i = 0; i < this.n; i++) {
      this.vel[i].y -= 2.2 * dt;
      this.vel[i].multiplyScalar(1 - dt * 1.8);
      this.pos[i].addScaledVector(this.vel[i], dt);
      this.rot[i].addScaledVector(this.spin[i], dt);
      this.o.position.copy(this.pos[i]);
      this.o.rotation.set(this.rot[i].x, this.rot[i].y, this.rot[i].z);
      this.o.updateMatrix();
      this.mesh.setMatrixAt(i, this.o.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.life <= 0) this.mesh.visible = false;
  }
}

