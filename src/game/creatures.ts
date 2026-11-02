/**
 * Living origami creatures: a rig from creature-models.ts plus behaviour.
 * They breathe, blink, turn their heads to the player, answer a poke in
 * their own voice, and can fold themselves up out of a flat sheet.
 */

import { Box3, Color, Group, LineSegments, Mesh, MeshBasicMaterial, Object3D, Vector3 } from '@iwsdk/core';
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

/** Seconds per stage of the fold-up. */
export const FOLD_BEAT = 0.36;

const INK = new Color(0x9fe9ff);
const GOLD = new Color(0xffffff);

/** Crease lines show only within this distance of the viewer. */
const DETAIL_RANGE = 1.7;

export class Creature {
  /** The viewer's head, updated each frame by the game. */
  static readonly viewer = new Vector3(0, 1.4, 0);
  readonly root = new Group();
  private detailed = true;
  readonly kind: CreatureKind;
  private rig: Rig;
  private modelSpan: number;
  private scanScale: number;
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
  private lookTarget: Vector3 | null = null;
  private lookYaw = 0;
  private lookPitch = 0;
  private v = new Vector3();

  constructor(kind: CreatureKind, private paperLook: PaperLook) {
    this.kind = kind;
    this.root.name = `Creature_${kind}`;
    this.rig = buildRig(kind, paperLook.front, paperLook.back);
    const bounds = new Box3().setFromObject(this.rig.body);
    const size = bounds.getSize(this.v);
    this.modelSpan = Math.max(size.x, size.y, size.z);
    this.scanScale = Math.max(0.9, Math.min(2.6, 0.4 / Math.max(this.modelSpan, 0.05)));
    if (this.habitat === 'ground' || this.habitat === 'perch') this.rig.body.position.y -= bounds.min.y;
    this.bob.add(this.rig.body);
    this.root.add(this.bob);
    this.root.scale.setScalar(this.restScale);
    this.lastBeat = this.rig.morph.stages - 1;
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
    while (this.beat < Math.min(beat, this.lastBeat)) {
      this.flash = 1;
      sfx.foldBeat(++this.beat);
    }
    this.rig.morph.apply(t / this.foldDuration);
    for (let i = 0; i < this.rig.eyes.length; i++) this.rig.eyes[i].scale.y = 0.08;
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
        this.applyFold();
        this.rig.morph.apply(1);
        this.foldT = -1;
        this.blinkT = 0.1; // eyes open as it wakes up
      } else {
        this.applyFold();
        return;
      }
    }
    this.react = Math.max(0, this.react - dt * 1.4);
    this.hop = Math.max(0, this.hop - dt * 2.2);
    this.blink(dt);
    // A specimen under the scanner holds still, so the volume inside it stays true.
    if (this.presenting) return;
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
    // Paper can't twist at the neck: the whole creature turns, and the head only nods about its crease.
    let yaw = 0;
    let pitch = 0;
    if (this.lookTarget) {
      this.v.copy(this.lookTarget);
      this.root.worldToLocal(this.v);
      yaw = Math.max(-0.7, Math.min(0.7, Math.atan2(-this.v.x, -this.v.z)));
      pitch = Math.max(-0.4, Math.min(0.5, Math.atan2(this.v.y, Math.hypot(this.v.x, this.v.z))));
    }
    this.lookYaw += (yaw - this.lookYaw) * Math.min(1, dt * 3);
    this.lookPitch += (pitch - this.lookPitch) * Math.min(1, dt * 5);
    if (this.habitat !== 'wall') this.bob.rotation.y = this.lookYaw;
    this.rig.flex.head?.turn(this.lookPitch * 0.7 + Math.sin(this.react * Math.PI) * 0.35, 1, 0, 0);
  }

  /** Back to the pose it was folded into. */
  private holdStill() {
    const f = this.rig.flex;
    f.head?.turn(0, 1, 0, 0);
    f.wingL?.turn(0, 0, 0, 1);
    f.wingR?.turn(0, 0, 0, 1);
    f.tail?.turn(0, 1, 0, 0);
    f.legL?.turn(0, 0, 0, 1);
    f.legR?.turn(0, 0, 0, 1);
    f.earL?.turn(0, 1, 0, 0);
    f.earR?.turn(0, 1, 0, 0);
    this.rig.body.rotation.set(0, 0, 0);
    this.bob.position.y = 0;
    this.bob.rotation.y = 0;
    this.lookYaw = this.lookPitch = 0;
  }

  /** Life without stretching: rigid motion of the whole sheet, and parts turning about their creases. */
  private idle() {
    const t = this.t;
    const r = this.react;
    const { body, flex: f } = this.rig;
    const hopY = Math.sin(this.hop * Math.PI) * 0.05;
    const leap = Math.sin(this.hop * Math.PI);
    switch (this.kind) {
      case 'crane': {
        const flap = this.travelling || r > 0 ? Math.sin(t * 14) * 0.7 : Math.sin(t * 1.3) * 0.06 + 0.04;
        f.wingL?.turn(-flap, 0, 0, 1);
        f.wingR?.turn(flap, 0, 0, 1);
        f.tail?.turn(Math.sin(t * 0.9) * 0.04, 1, 0, 0);
        this.bob.position.y = hopY * 0.6;
        break;
      }
      case 'butterfly': {
        const flap = this.travelling || r > 0 ? 0.25 + Math.sin(t * 22) * 0.65 : Math.max(0, Math.sin(t * 1.7)) * 0.5;
        f.wingR?.turn(flap, 0, 0, 1);
        f.wingL?.turn(-flap, 0, 0, 1);
        this.bob.position.y = hopY * 0.4;
        break;
      }
      case 'fish': {
        const k = this.travelling || r > 0 ? 9 : 3;
        f.tail?.turn(Math.sin(t * k) * 0.45, 0, 1, 0);
        body.rotation.y = Math.sin(t * k + 1.2) * 0.16;
        this.bob.position.y = Math.sin(t * 0.9) * 0.01 + hopY * 0.4;
        break;
      }
      case 'whale': {
        f.tail?.turn(Math.sin(t * 1.2) * 0.3, 1, 0, 0);
        body.rotation.x = Math.sin(t * 1.2 + 0.8) * 0.08;
        this.bob.position.y = Math.sin(t * 0.5) * 0.02 + hopY * 0.3;
        break;
      }
      case 'fox': {
        f.tail?.turn(Math.sin(t * 2.2) * 0.25 + r * Math.sin(t * 20) * 0.4, 0, 1, 0);
        // An ear flick now and then.
        const flick = Math.max(0, Math.sin(t * 0.8) - 0.96) * 12;
        f.earL?.turn(flick * 0.3, 0, 0, 1);
        f.earR?.turn(-r * 0.3, 0, 0, 1);
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
        // The back legs are its spring.
        const spring = Math.sin(t * 2.4) * 0.03 + leap * 0.5;
        f.legR?.turn(spring, 0, 0, 1);
        f.legL?.turn(-spring, 0, 0, 1);
        this.bob.position.y = hopY;
        break;
      }
      default: {
        const twitch = Math.max(0, Math.sin(t * 1.1) - 0.95) * 10;
        f.earL?.turn(-twitch * 0.25 - r * 0.3, 1, 0, 0);
        f.earR?.turn(-r * 0.3, 1, 0, 0);
        this.bob.position.y = hopY;
      }
    }
  }

  /** Shows the inner layer while the creature is on the projection table. */
  setPresenting(on: boolean) {
    this.presenting = on;
    if (on) this.holdStill();
    // Real paper has its inner side to show; there is no solid core to reveal.
    for (const c of this.rig.cores) c.visible = false;
    if (on && !this.volume) {
      this.volume = new HoloVolume(this.kind, this.paperLook.front, this.paperLook.back);
      this.volume.mesh.position.y += this.rig.body.position.y;
      this.volume.sand.position.y += this.rig.body.position.y;
      this.bob.add(this.volume.mesh, this.volume.sand);
    }
    this.rig.holo.uniforms.uThick.value = 0.0016;
    this.rig.core.uniforms.uThick.value = 0.0016;
    // Thick layers overlap, so each one burns lower to keep the form readable.
    this.rig.holo.uniforms.uGlow.value = on && !this.rig.morph ? 0.6 : 1;
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

  /** The scale at which this kind stands about half a metre across on the table. */
  get tableScale(): number {
    return this.scanScale;
  }

  /** A baked model already is what the 20 cm sheet folds into. */
  get restScale(): number {
    return 1;
  }

  get realSpanCm(): number {
    return Math.round(this.modelSpan * 1000) / 10;
  }

  get magnification(): number {
    return this.tableScale / this.restScale;
  }

  /** How many flat faces the model is made of. */
  get facets(): number {
    return this.rig.facetCount;
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
      if ((o as Mesh).isMesh && o.name === 'Touch') {
        const touch = o as Mesh;
        touch.geometry.dispose();
        (touch.material as MeshBasicMaterial).dispose();
      }
      if ((o as LineSegments).isLineSegments) (o as LineSegments).geometry.dispose();
    });
    this.rig.lines.dispose();
  }
}
