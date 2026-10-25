/**
 * Living origami creatures: a rig from creature-models.ts plus behaviour.
 * They breathe, blink, turn their heads to the player, answer a poke in
 * their own voice, and can fold themselves up out of a flat sheet.
 */

import { Color, Euler, Group, LineSegments, Mesh, Quaternion, Vector3 } from '@iwsdk/core';
import { buildRig, type Rig } from './creature-models.js';
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

const INK = new Color(0x2a2420);
const GOLD = new Color(0xffd166);
const easeBack = (x: number) => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};

export class Creature {
  readonly root = new Group();
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

  constructor(kind: CreatureKind, look: PaperLook) {
    this.kind = kind;
    this.root.name = `Creature_${kind}`;
    this.rig = buildRig(kind, look.front, look.back);
    this.bob.add(this.rig.body);
    this.root.add(this.bob);
    this.rest = this.rig.folds.map((f) => f.obj.quaternion.clone());
    this.lastBeat = this.rig.folds.reduce((m, f) => Math.max(m, f.beat), 0);
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
    this.flash = Math.max(0, this.flash - dt * 2.4);
    const lines = this.rig.lines;
    lines.opacity = 0.3 + this.flash * 0.7;
    lines.color.lerpColors(INK, GOLD, this.flash);
    if (this.foldT >= 0) {
      this.foldT += dt;
      if (this.foldT >= this.foldDuration) {
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

  dispose() {
    this.root.traverse((o) => {
      if ((o as Mesh).isMesh && o.name === 'Paper') (o as Mesh).geometry.dispose();
      if ((o as LineSegments).isLineSegments) (o as LineSegments).geometry.dispose();
    });
    this.rig.lines.dispose();
  }
}
