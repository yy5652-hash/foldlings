/**
 * The menu. Turn your menu-hand palm towards your face and a paper token
 * appears above it; touch it with the other index finger to open a panel that
 * stays where it opened (it never follows the wrist). The mat's menu token
 * opens the same panel for rays, gaze and the mouse.
 */

import {
  CanvasTexture,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PokeInteractable,
  RayInteractable,
  SRGBColorSpace,
  Vector3,
  World,
} from '@iwsdk/core';
import { Button, IconKind } from './button.js';
import type { Hands } from './hands.js';
import { sfx } from './sfx.js';

export interface MenuItem {
  icon: IconKind;
  label: string;
  run: () => void;
}

const COLS = 3;
const CELL_X = 0.082;
const CELL_Y = 0.09;
const UP = new Vector3(0, 1, 0);
/** Seconds the palm must face the player before the token shows. */
const PALM_HOLD = 0.3;
const AUTO_CLOSE = 12;

function backing(w: number, h: number): Mesh {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = Math.round((512 * h) / w);
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(30,46,42,0.94)';
  g.beginPath();
  g.roundRect(4, 4, c.width - 8, c.height - 8, 36);
  g.fill();
  g.strokeStyle = 'rgba(246,240,228,0.35)';
  g.lineWidth = 4;
  g.stroke();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map: t, transparent: true }));
  // Drawn first so the token labels in front of it stay visible.
  m.renderOrder = -5;
  m.name = 'MenuBacking';
  return m;
}

export class PalmMenu {
  readonly panel = new Group();
  private buttons: Button[] = [];
  private token: Button;
  private unfold = 0;
  private wantOpen = false;
  private idle = 0;
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
  private fwd = new Vector3();
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
    this.panel.name = 'MenuPanel';
    const rows = Math.ceil(items.length / COLS);
    const w = COLS * CELL_X + 0.03;
    const h = rows * CELL_Y + 0.02;
    this.panel.add(backing(w, h));
    const pe = world.createTransformEntity(this.panel);
    items.forEach((item, i) => {
      const b = new Button(
        item.icon,
        () => {
          // Ignore a fingertip that was already passing through as it opened.
          if (this.unfold < 0.9 || this.idle < 0.4) return;
          sfx.click();
          this.close();
          item.run();
        },
        item.label,
      );
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      b.root.position.set((col - (COLS - 1) / 2) * CELL_X, (rows - 1) / 2 * CELL_Y - row * CELL_Y + 0.012, 0.004);
      b.root.rotation.x = Math.PI / 2;
      const e = world.createTransformEntity(b.root, pe);
      e.addComponent(RayInteractable);
      e.addComponent(PokeInteractable);
      this.buttons.push(b);
    });
    this.panel.visible = false;
    this.panel.position.set(0, -50, 0);

    this.token = new Button('menu', () => this.toggle());
    this.token.root.name = 'PalmToken';
    this.token.root.scale.setScalar(0.62);
    this.token.root.visible = false;
    world.scene.add(this.token.root);
    world.onXRFrame((frame) => this.onXRFrame(frame));
  }

  get isOpen(): boolean {
    return this.wantOpen;
  }

  toggle() {
    if (this.clock - this.lastToggle < 0.6) return;
    this.lastToggle = this.clock;
    if (this.wantOpen) this.close();
    else this.open();
  }

  /** Opens the panel in front of the player, where it then stays. */
  open() {
    this.world.camera.getWorldPosition(this.head);
    this.world.camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-4) this.fwd.set(0, 0, -1);
    this.fwd.normalize();
    // At chest height and a forearm away, above the mat where hands work.
    this.panel.position.copy(this.head).addScaledVector(this.fwd, 0.45);
    this.panel.position.y -= 0.1;
    this.panel.lookAt(this.head);
    this.panel.visible = true;
    this.wantOpen = true;
    this.idle = 0;
    sfx.pick();
  }

  close() {
    this.wantOpen = false;
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
    this.unfold += ((this.wantOpen ? 1 : 0) - this.unfold) * Math.min(1, dt * 12);
    if (this.wantOpen) {
      this.idle += dt;
      if (this.idle > AUTO_CLOSE) this.close();
    }
    this.panel.scale.set(1, Math.max(0.02, this.unfold), 1);
    if (!this.wantOpen && this.unfold < 0.03 && this.panel.visible) {
      // Park it far away so a hidden panel never catches rays.
      this.panel.visible = false;
      this.panel.position.set(0, -50, 0);
    }
    for (const b of this.buttons) b.update(dt);

    if (this.blocked && this.wantOpen) this.close();
    this.palm = inXR && this.palmFacing && !this.blocked ? this.palm + dt : Math.max(0, this.palm - dt * 3);
    const on = this.palm > PALM_HOLD && !this.wantOpen ? 1 : 0;
    this.tokenOn += (on - this.tokenOn) * Math.min(1, dt * 10);
    this.token.root.visible = this.tokenOn > 0.05;
    this.token.root.scale.setScalar(0.62 * this.tokenOn);
    this.token.update(dt);
  }
}
