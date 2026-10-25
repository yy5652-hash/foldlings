/**
 * Both tracked hands as the creatures see them: palm centre and normal, the
 * index fingertip, whether the hand is open, how fast it moves, and a wave.
 */

import { Matrix4, Vector3, World } from '@iwsdk/core';

export interface HandState {
  tracked: boolean;
  /** Middle of the palm, world space. */
  center: Vector3;
  /** Out of the palm (up when the palm faces up). */
  normal: Vector3;
  tip: Vector3;
  /** Palm velocity, m/s. */
  vel: Vector3;
  open: boolean;
}

const WAVE_SPEED = 0.35;
const WAVE_WINDOW = 1.3;

function blank(): HandState {
  return { tracked: false, center: new Vector3(), normal: new Vector3(0, 1, 0), tip: new Vector3(), vel: new Vector3(), open: false };
}

export class Hands {
  readonly left = blank();
  readonly right = blank();
  /** Set for one update after a hand waves (side to side, palm out). */
  waved = false;
  /** Waves seen this page (tests). */
  waveCount = 0;
  private flips: number[] = [];
  private lastSign = 0;
  private waveCooldown = 0;
  private prev = new Vector3();
  private lastTime = 0;
  private player = new Matrix4();
  private wrist = new Vector3();
  private idx = new Vector3();
  private pinky = new Vector3();
  private mid = new Vector3();
  private a = new Vector3();
  private b = new Vector3();
  private head = new Vector3();
  private clock = 0;
  private both = [this.right, this.left];

  constructor(private world: World) {
    world.onXRFrame((frame) => this.read(frame));
  }

  private read(frame: XRFrame) {
    const ref = this.world.renderer.xr.getReferenceSpace();
    let seenLeft = false;
    let seenRight = false;
    if (!ref) {
      this.left.tracked = this.right.tracked = false;
      return;
    }
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, Math.max(1e-3, now - this.lastTime));
    this.lastTime = now;
    this.world.player.updateWorldMatrix(true, false);
    this.player.copy(this.world.player.matrixWorld);
    for (const src of frame.session.inputSources) {
      if (!src.hand || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
      const h = src.handedness === 'left' ? this.left : this.right;
      if (
        !this.joint(frame, src.hand, 'wrist', ref, this.wrist) ||
        !this.joint(frame, src.hand, 'index-finger-metacarpal', ref, this.idx) ||
        !this.joint(frame, src.hand, 'pinky-finger-metacarpal', ref, this.pinky) ||
        !this.joint(frame, src.hand, 'middle-finger-tip', ref, this.mid) ||
        !this.joint(frame, src.hand, 'index-finger-tip', ref, h.tip)
      ) {
        continue;
      }
      this.prev.copy(h.center);
      const was = h.tracked;
      h.tracked = true;
      if (h === this.left) seenLeft = true;
      else seenRight = true;
      h.center.copy(this.wrist).add(this.idx).add(this.pinky).multiplyScalar(1 / 3);
      this.a.subVectors(this.idx, this.wrist);
      this.b.subVectors(this.pinky, this.wrist);
      if (src.handedness === 'left') h.normal.crossVectors(this.b, this.a);
      else h.normal.crossVectors(this.a, this.b);
      h.normal.normalize();
      h.open = this.mid.distanceTo(this.wrist) > 0.12;
      if (was) h.vel.subVectors(h.center, this.prev).divideScalar(dt);
      else h.vel.set(0, 0, 0);
    }
    this.left.tracked = seenLeft;
    this.right.tracked = seenRight;
  }

  private joint(frame: XRFrame, hand: XRHand, name: XRHandJoint, ref: XRReferenceSpace, out: Vector3): boolean {
    const space = hand.get(name);
    const pose = space ? frame.getJointPose?.(space, ref) : undefined;
    if (!pose) return false;
    const p = pose.transform.position;
    out.set(p.x, p.y, p.z).applyMatrix4(this.player);
    return true;
  }

  /** Looks for a wave: an open hand, raised, palm away, swung side to side. */
  update(dt: number) {
    this.clock += dt;
    this.waved = false;
    this.waveCooldown = Math.max(0, this.waveCooldown - dt);
    this.world.camera.getWorldPosition(this.head);
    let sign = 0;
    for (const h of this.both) {
      if (!h.tracked || !h.open || h.center.y < this.head.y - 0.4) continue;
      this.a.subVectors(this.head, h.center).normalize();
      if (h.normal.dot(this.a) > -0.2) continue;
      if (Math.abs(h.vel.x) > WAVE_SPEED || Math.abs(h.vel.z) > WAVE_SPEED) {
        sign = Math.sign(Math.abs(h.vel.x) > Math.abs(h.vel.z) ? h.vel.x : h.vel.z);
        break;
      }
    }
    if (sign !== 0 && sign !== this.lastSign) {
      this.lastSign = sign;
      this.flips.push(this.clock);
    }
    while (this.flips.length && this.clock - this.flips[0] > WAVE_WINDOW) this.flips.shift();
    if (this.flips.length >= 3 && this.waveCooldown <= 0) {
      this.waved = true;
      this.waveCount++;
      this.waveCooldown = 3;
      this.flips.length = 0;
    }
  }
}
