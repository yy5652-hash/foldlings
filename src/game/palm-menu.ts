/**
 * The menu. Turn your menu-hand palm towards your face and a glass token
 * appears above it; touch it with the other index finger and a small home view
 * of round buttons floats up where it stays (it never follows the wrist). The
 * mat's menu button opens the same view for rays, gaze and the mouse.
 */

import { Matrix4, Vector3, World } from '@iwsdk/core';
import { Button, IconKind } from './button.js';
import { GlassWindow } from './glass.js';
import type { Hands } from './hands.js';
import { sfx } from './sfx.js';

export interface MenuItem {
  icon: IconKind;
  label: string;
  run: () => void;
}

/** A honeycomb, as on the visionOS home view: 4 over 3. */
const ROW_LEN = 4;
const CELL_X = 0.086;
const CELL_Y = 0.092;
const R = 0.03;
const UP = new Vector3(0, 1, 0);
/** Seconds the palm must face the player before the token shows. */
const PALM_HOLD = 0.3;
const AUTO_CLOSE = 12;

export class PalmMenu {
  private win: GlassWindow;
  private buttons: Button[] = [];
  private token: Button;
  private openedAt = -1;
  private palm = 0;
  private tokenOn = 0;
  private lastToggle = -1;
  private clock = 0;
  /** Which hand shows the token; the other one touches it. */
  menuHand: XRHandedness = 'left';
  /** Hand speeds, so a palm swinging past does not raise the token. */
  hands: Hands | null = null;
  /** True while the player is folding: no token, and the panel closes. */
  blocked = false;
  private head = new Vector3();
  private wrist = new Vector3();
  private idx = new Vector3();
  private pinky = new Vector3();
  private tip = new Vector3();
  private center = new Vector3();
  private normal = new Vector3();
  private poke = new Vector3();
  private a = new Vector3();
  private b = new Vector3();
  private player = new Matrix4();

  constructor(
    private world: World,
    items: MenuItem[],
  ) {
    const rows = Math.ceil(items.length / ROW_LEN);
    this.win = new GlassWindow(world, {
      name: 'MenuPanel',
      w: ROW_LEN * CELL_X + 0.03,
      h: rows * CELL_Y + 0.03,
      glass: false,
      autoClose: AUTO_CLOSE,
    });
    items.forEach((item, i) => {
      const b = new Button(
        item.icon,
        () => {
          // Ignore a fingertip that was already passing through as it opened.
          if (!this.win.ready || this.clock - this.openedAt < 0.4) return;
          sfx.click();
          this.close();
          item.run();
        },
        item.label,
        { r: R, labelSize: 0.018 },
      );
      const row = Math.floor(i / ROW_LEN);
      const inRow = Math.min(ROW_LEN, items.length - row * ROW_LEN);
      const col = i - row * ROW_LEN;
      b.root.position.set((col - (inRow - 1) / 2) * CELL_X, ((rows - 1) / 2 - row) * CELL_Y + 0.008, 0.004);
      b.root.rotation.x = Math.PI / 2;
      this.win.addControl(b.root, b);
      this.buttons.push(b);
    });

    this.token = new Button('menu', () => this.toggle());
    this.token.root.name = 'PalmToken';
    this.token.root.scale.setScalar(0.62);
    this.token.root.visible = false;
    world.scene.add(this.token.root);
    world.onXRFrame((frame) => this.onXRFrame(frame));
  }

  get panel() {
    return this.win.root;
  }

  get isOpen(): boolean {
    return this.win.isOpen;
  }

  toggle() {
    if (this.clock - this.lastToggle < 0.6) return;
    this.lastToggle = this.clock;
    if (this.win.isOpen) this.close();
    else this.open();
  }

  /** Opens at chest height and a forearm away, above the mat where hands work. */
  open() {
    this.win.open(0.45, 0.1);
    this.openedAt = this.clock;
    sfx.pick();
  }

  close() {
    this.win.close();
  }

  private palmFacing = false;
  private armed = false;

  private onXRFrame(frame: XRFrame) {
    const ref = this.world.renderer.xr.getReferenceSpace();
    if (!ref) return;
    this.world.player.updateWorldMatrix(true, false);
    this.player.copy(this.world.player.matrixWorld);
    this.world.camera.getWorldPosition(this.head);
    let facing = false;
    let poking = false;
    for (const src of frame.session.inputSources) {
      const hand = src.hand;
      if (!hand) continue;
      if (src.handedness !== this.menuHand) {
        poking = this.joint(frame, hand, 'index-finger-tip', ref, this.poke) || poking;
        continue;
      }
      if (
        !this.joint(frame, hand, 'wrist', ref, this.wrist) ||
        !this.joint(frame, hand, 'index-finger-metacarpal', ref, this.idx) ||
        !this.joint(frame, hand, 'pinky-finger-metacarpal', ref, this.pinky) ||
        !this.joint(frame, hand, 'middle-finger-tip', ref, this.tip)
      ) {
        continue;
      }
      // Palm normal from the wrist and two knuckles; the sign depends on the hand.
      this.a.subVectors(this.idx, this.wrist);
      this.b.subVectors(this.pinky, this.wrist);
      if (this.menuHand === 'left') this.normal.crossVectors(this.b, this.a);
      else this.normal.crossVectors(this.a, this.b);
      this.normal.normalize();
      this.center.copy(this.wrist).add(this.idx).add(this.pinky).multiplyScalar(1 / 3);
      this.a.subVectors(this.head, this.center).normalize();
      const open = this.tip.distanceTo(this.wrist) > 0.12;
      const state = this.menuHand === 'left' ? this.hands?.left : this.hands?.right;
      const still = !state || state.vel.length() < 0.35;
      // Raised, still and turned to the face: a resting or working hand never counts.
      facing = open && still && this.center.y > this.head.y - 0.45 && this.normal.dot(this.a) > 0.6;
      this.token.root.position.copy(this.center).addScaledVector(this.normal, 0.065);
      this.token.root.quaternion.setFromUnitVectors(UP, this.a);
    }
    this.palmFacing = facing;
    // A touch counts only when the fingertip comes to the token from outside it.
    const dist = poking ? this.poke.distanceTo(this.token.root.position) : Infinity;
    if (this.tokenOn < 0.05) this.armed = false;
    else if (dist > 0.05) this.armed = true;
    if (this.armed && this.tokenOn > 0.6 && dist < 0.03) {
      this.armed = false;
      this.toggle();
    }
  }

  private joint(frame: XRFrame, hand: XRHand, name: XRHandJoint, ref: XRReferenceSpace, out: Vector3): boolean {
    const space = hand.get(name);
    const pose = space ? frame.getJointPose?.(space, ref) : undefined;
    if (!pose) return false;
    const p = pose.transform.position;
    out.set(p.x, p.y, p.z).applyMatrix4(this.player);
    return true;
  }

  update(dt: number, inXR: boolean) {
    this.clock += dt;
    this.win.update(dt);
    if (this.blocked && this.win.isOpen) this.close();
    this.palm = inXR && this.palmFacing && !this.blocked ? this.palm + dt : Math.max(0, this.palm - dt * 3);
    const on = this.palm > PALM_HOLD && !this.win.isOpen ? 1 : 0;
    this.tokenOn += (on - this.tokenOn) * Math.min(1, dt * 10);
    this.token.root.visible = this.tokenOn > 0.05;
    this.token.root.scale.setScalar(0.62 * this.tokenOn);
    this.token.update(dt);
  }
}
