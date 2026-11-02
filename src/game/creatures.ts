/**
 * Living origami creatures: a rig from creature-models.ts plus behaviour.
 * They breathe, blink, turn their heads to the player, answer a poke in
 * their own voice, and can fold themselves up out of a flat sheet.
 */

import { Box3, Color, Euler, Group, LineSegments, Mesh, Object3D, Quaternion, Vector3 } from '@iwsdk/core';
import { buildRig, type Rig } from './creature-models.js';
import { HoloVolume } from './holo-volume.js';
import type { CreatureKind } from './levels.js';
import type { PaperLook } from './paper-texture.js';
import { sfx } from './sfx.js';

export type Habitat = 'perch' | 'ground' | 'wall' | 'air' | 'high-air';

export const HABITAT: Record<CreatureKind, Habitat> = {
  crane: 'perch',
  frog: 'ground',
  fox: 'ground',
  fish: 'air',
  butterfly: 'wall',
  boat: 'ground',
  rabbit: 'ground',
  whale: 'high-air',
};

/** Seconds per fold-up beat; the body opens on beat 0, parts on 1–3. */
export const FOLD_BEAT = 0.36;

const INK = new Color(0x9fe9ff);
const GOLD = new Color(0xffffff);
const easeBack = (x: number) => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};

/** Crease lines show only within this distance of the viewer. */
const DETAIL_RANGE = 1.7;

export class Creature {
  /** The viewer's head, updated each frame by the game. */
  static readonly viewer = new Vector3(0, 1.4, 0);
  readonly root = new Group();
  private detailed = true;
  readonly kind: CreatureKind;
  private rig: Rig;
  private t = Math.random() * 10;
  private react = 0;
  private hop = 0;
  /** Extra motion offset driven by idle loops (not persisted). */
  private bob = new Group();
  private travelling = false;
  private blinkIn = 1 + Math.random() * 3;
  private blinkT = -1;
  private flash = 0;
  private foldT = -1;
  private beat = -1;
  private lastBeat: number;
  private rest: Quaternion[];
  private headRest = new Quaternion();
  private lookTarget: Vector3 | null = null;
  private q = new Quaternion();
  private e = new Euler(0, 0, 0, 'YXZ');
  private v = new Vector3();

  constructor(kind: CreatureKind, private paperLook: PaperLook) {
    this.kind = kind;
    this.root.name = `Creature_${kind}`;
    this.rig = buildRig(kind, paperLook.front, paperLook.back);
    this.bob.add(this.rig.body);
    this.root.add(this.bob);
    this.rest = this.rig.folds.map((f) => f.obj.quaternion.clone());
    this.lastBeat = this.rig.morph ? this.rig.morph.stages - 1 : this.rig.folds.reduce((m, f) => Math.max(m, f.beat), 0);
    if (this.rig.head) this.headRest.copy(this.rig.head.quaternion);
    const target = this.root as unknown as {
      addEventListener(type: string, fn: () => void): void;
    };
    target.addEventListener('pointerdown', () => this.poke());
  }

  get habitat(): Habitat {
    return HABITAT[this.kind];
  }

  /** True while the creature is still folding itself up. */
  get folding(): boolean {
    return this.foldT >= 0;
  }

  /** Length of the fold-up in seconds. */
  get foldDuration(): number {
    return (this.lastBeat + 1) * FOLD_BEAT;
  }

  /** Starts flat, eyes shut; folds itself up beat by beat. */
  startFoldUp() {
    this.foldT = 0;
    this.beat = -1;
    this.applyFold();
  }

  /** World point to turn the head towards (the player), or null. */
  lookAt(p: Vector3 | null) {
    this.lookTarget = p;
  }

  poke() {
    if (this.react > 0.3 || this.folding) return;
    this.react = 1;
    this.hop = 1;
    this.blinkT = 0;
    sfx.voice(this.kind, this.root.getWorldPosition(this.v));
  }

  /** A small unprompted stir, so a resting zoo still looks alive. */
  fidget(withSound: boolean) {
    if (this.react > 0.1 || this.hop > 0.1 || this.folding) return;
    this.react = 0.55;
    this.hop = this.kind === 'frog' || this.kind === 'rabbit' ? 0.7 : 0.3;
    if (withSound) sfx.voice(this.kind, this.root.getWorldPosition(this.v), 0.6);
  }

  /** Flying or swimming kinds flap while travelling. */
  setTravelling(v: boolean) {
    this.travelling = v;
  }

  private applyFold() {
    const t = this.foldT;
    const beat = Math.floor(t / FOLD_BEAT);
    if (this.rig.morph) {
      while (this.beat < Math.min(beat, this.lastBeat)) {
        this.flash = 1;
        sfx.foldBeat(++this.beat);
      }
      this.bob.scale.setScalar(1);
      this.rig.morph.apply(t / this.foldDuration);
      for (let i = 0; i < this.rig.eyes.length; i++) this.rig.eyes[i].scale.y = 0.08;
      return;
    }
    if (beat !== this.beat && beat <= this.lastBeat) {
      this.beat = beat;
      this.flash = 1;
      sfx.foldBeat(beat);
    }
    const p = (b: number) => Math.min(1, Math.max(0, (t - b * FOLD_BEAT) / FOLD_BEAT));
    const open = easeBack(p(0));
    this.bob.scale.set(1 + (1 - open) * 0.3, Math.max(0.04, open), 1 + (1 - open) * 0.3);
    this.rig.folds.forEach((f, i) => {
      const k = 1 - easeBack(p(f.beat));
      f.obj.quaternion.copy(this.rest[i]).multiply(this.q.setFromAxisAngle(f.axis, f.angle * k));
    });
    for (const e of this.rig.eyes) e.scale.y = 0.08;
  }

  update(dt: number) {
    this.t += dt;
    // Far away, the thin crease lines cost draw calls without showing.
    const near = this.foldT >= 0 || this.root.getWorldPosition(this.v).distanceTo(Creature.viewer) < DETAIL_RANGE;
    if (near !== this.detailed) {
      this.detailed = near;
      for (const e of this.rig.edges) e.visible = near;
      for (const e of this.rig.clouds) e.visible = near;
    }
    this.flash = Math.max(0, this.flash - dt * 2.4);
    const lines = this.rig.lines;
    lines.opacity = (this.presenting ? 0.95 : 0.6) + this.flash * 0.4;
    lines.color.lerpColors(INK, GOLD, this.flash);
    if (this.foldT >= 0) {
      this.foldT += dt;
      if (this.foldT >= this.foldDuration) {
        if (this.rig.morph) {
          this.applyFold();
          this.rig.morph.apply(1);
        }
        this.foldT = -1;
        this.bob.scale.setScalar(1);
        this.rig.folds.forEach((f, i) => f.obj.quaternion.copy(this.rest[i]));
        this.blinkT = 0.1; // eyes open as it wakes up
      } else {
        this.applyFold();
        return;
      }
    }
    this.react = Math.max(0, this.react - dt * 1.4);
    this.hop = Math.max(0, this.hop - dt * 2.2);
    this.blink(dt);
    this.look(dt);
    this.idle();
  }

  private blink(dt: number) {
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const s = this.blinkT < 0.07 ? 1 - this.blinkT / 0.07 : Math.min(1, (this.blinkT - 0.07) / 0.09);
      for (const e of this.rig.eyes) e.scale.y = Math.max(0.08, s);
      if (this.blinkT > 0.16) {
        this.blinkT = -1;
        this.blinkIn = 2 + Math.random() * 4;
      }
    } else {
      this.blinkIn -= dt;
      if (this.blinkIn < 0) this.blinkT = 0;
    }
  }

  private look(dt: number) {
    const head = this.rig.head;
    if (!head || !head.parent) return;
    let yaw = 0;
    let pitch = 0;
    if (this.lookTarget) {
      head.parent.updateWorldMatrix(true, false);
      this.v.copy(this.lookTarget);
      head.parent.worldToLocal(this.v).sub(head.position);
      yaw = Math.max(-0.9, Math.min(0.9, Math.atan2(-this.v.x, -this.v.z)));
      pitch = Math.max(-0.4, Math.min(0.5, Math.atan2(this.v.y, Math.hypot(this.v.x, this.v.z))));
    }
    // A curious tilt when poked.
    this.e.set(pitch * 0.7, yaw, Math.sin(this.react * Math.PI) * 0.35);
    this.q.setFromEuler(this.e).premultiply(this.headRest);
    head.quaternion.slerp(this.q, Math.min(1, dt * 5));
  }

  private idle() {
    const t = this.t;
    const r = this.react;
    const { wingL, wingR, tail, legL, legR, earL, earR, body } = this.rig;
    const hopY = Math.sin(this.hop * Math.PI) * 0.05;
    const breathe = 1 + Math.sin(t * 2.2) * 0.018;
    switch (this.kind) {
      case 'crane': {
        const flap = this.travelling || r > 0 ? Math.sin(t * 14) * 0.7 : Math.sin(t * 1.3) * 0.06 + 0.04;
        wingL!.rotation.z = -flap;
        wingR!.rotation.z = flap;
        tail!.rotation.x = Math.sin(t * 0.9) * 0.04;
        this.bob.position.y = hopY * 0.6;
        body.scale.set(1, breathe, 1);
        break;
      }
      case 'butterfly': {
        const flap = this.travelling || r > 0 ? Math.sin(t * 22) * 0.9 : Math.max(0, Math.sin(t * 1.7)) * 0.5;
        wingR!.rotation.z = 0.5 + flap;
        wingL!.rotation.z = -0.5 - flap;
        this.bob.position.y = hopY * 0.4;
        break;
      }
      case 'fish': {
        const k = this.travelling || r > 0 ? 9 : 3;
        tail!.rotation.y = Math.sin(t * k) * 0.45;
        body.rotation.y = Math.sin(t * k + 1.2) * 0.08;
        this.bob.position.y = Math.sin(t * 0.9) * 0.01 + hopY * 0.4;
        break;
      }
      case 'whale': {
        tail!.rotation.x = Math.sin(t * 1.2) * 0.3;
        body.rotation.x = Math.sin(t * 1.2 + 0.8) * 0.05;
        this.bob.position.y = Math.sin(t * 0.5) * 0.02 + hopY * 0.3;
        break;
      }
      case 'fox': {
        tail!.rotation.y = Math.sin(t * 2.2) * 0.25 + r * Math.sin(t * 20) * 0.4;
        // An ear flick now and then.
        const flick = Math.max(0, Math.sin(t * 0.8) - 0.96) * 12;
        earL!.rotation.z = flick * 0.3;
        earR!.rotation.z = -r * 0.3;
        body.scale.set(1, breathe, 1);
        this.bob.position.y = hopY * 0.5;
        break;
      }
      case 'boat': {
        body.rotation.z = Math.sin(t * 1.4) * 0.06 + r * Math.sin(t * 12) * 0.12;
        body.rotation.x = Math.sin(t * 1.1) * 0.03;
        this.bob.position.y = hopY * 0.3;
        break;
      }
      case 'frog': {
        const squash = 1 + Math.sin(t * 2.4) * 0.03 - Math.sin(this.hop * Math.PI) * 0.12;
        body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
        legR!.rotation.z = -Math.sin(this.hop * Math.PI) * 0.5;
        legL!.rotation.z = Math.sin(this.hop * Math.PI) * 0.5;
        this.bob.position.y = hopY;
        break;
      }
      default: {
        // Rabbit: breathing squash, hop on poke, ears that twitch.
        const squash = 1 + Math.sin(t * 2.6) * 0.025 - Math.sin(this.hop * Math.PI) * 0.1;
        body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
        const twitch = Math.max(0, Math.sin(t * 1.1) - 0.95) * 10;
        earL!.rotation.x = -twitch * 0.25 - r * 0.3;
        earR!.rotation.x = -r * 0.3;
        this.bob.position.y = hopY;
      }
    }
  }

  /** Shows the inner layer while the creature is on the projection table. */
  setPresenting(on: boolean) {
    this.presenting = on;
    for (const c of this.rig.cores) c.visible = on;
    if (on && !this.volume) {
      this.volume = new HoloVolume(this.kind, this.paperLook.front, this.paperLook.back);
      this.bob.add(this.volume.mesh, this.volume.sand);
    }
    // Keep real paper thin; the legacy solids retain their presentation depth.
    this.rig.holo.uniforms.uThick.value = this.rig.morph ? 0.0016 : on ? 0.0105 : 0.0058;
    this.rig.core.uniforms.uThick.value = this.rig.morph ? 0.0016 : on ? 0.008 : 0.0058;
    // Thick layers overlap, so each one burns lower to keep the form readable.
    this.rig.holo.uniforms.uGlow.value = on ? 0.6 : 1;
    this.rig.core.uniforms.uGlow.value = on ? 0.52 : 0.8;
    if (!on && this.volume) {
      this.bob.remove(this.volume.mesh, this.volume.sand);
      this.volume.dispose();
      this.volume = null;
    }
    if (!on) {
      this.setExplode(0);
      this.setScan(-99);
    }
  }
  private volume: HoloVolume | null = null;
  private presenting = false;

  /** Metres the facets stand apart, for the exploded view. */
  setExplode(k: number) {
    this.rig.holo.uniforms.uExplode.value = k;
    this.rig.core.uniforms.uExplode.value = -0.006 + k * 0.55;
    this.rig.cloud.uniforms.uExplode.value = k;
  }

  /** World height of the slice passing through the body. */
  setScan(y: number) {
    this.rig.holo.uniforms.uScanY.value = y;
    this.rig.core.uniforms.uScanY.value = y;
    this.volume?.setScan(y);
  }

  /** World height the body has formed up to; anything high means all of it. */
  setForming(y: number) {
    this.rig.holo.uniforms.uReveal.value = y;
    this.rig.core.uniforms.uReveal.value = y;
  }

  /** The scale at which this kind stands about half a metre across on the table. */
  get tableScale(): number {
    const size = new Box3().setFromObject(this.rig.body).getSize(this.v);
    const span = Math.max(size.x, size.y, size.z) / Math.max(this.root.scale.x, 1e-4);
    return Math.max(0.9, Math.min(2.6, 0.5 / Math.max(span, 0.05)));
  }

  /** How many flat faces the model is made of. */
  get facets(): number {
    if (this.rig.facetCount !== undefined) return this.rig.facetCount;
    let n = 0;
    this.root.traverse((o) => {
      if ((o as Mesh).isMesh && o.name === 'Paper') n += (o as Mesh).geometry.attributes.position.count / 3;
    });
    return n;
  }

  /** Points on the body for labels to be tied to. */
  get anchors(): Object3D[] {
    const r = this.rig;
    return [r.head ?? r.body, r.wingR ?? r.tail ?? r.earR ?? r.body, r.wingL ?? r.legL ?? r.earL ?? r.body, r.tail ?? r.legR ?? r.body];
  }

  dispose() {
    this.setPresenting(false);
    this.rig.holo.dispose();
    this.rig.core.dispose();
    this.rig.cloud.dispose();
    this.root.traverse((o) => {
      if ((o as Mesh).isMesh && o.name === 'Paper') (o as Mesh).geometry.dispose();
      if ((o as LineSegments).isLineSegments) (o as LineSegments).geometry.dispose();
    });
    this.rig.lines.dispose();
  }
}
