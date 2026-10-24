/**
 * X-ray view (open the game with ?xray=1): shows what the game reads and
 * computes — tracked hand joints, and while folding, the grab point, the
 * pinch point, the perpendicular bisector plane between them and the raw
 * crease before it snaps to the lattice.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';

const CYAN = 0x5ee8ff;
const GOLD = 0xffd166;

const CHAINS = [
  ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  ['wrist', 'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'],
  ['wrist', 'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'],
  ['wrist', 'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip'],
  ['wrist', 'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'],
] as const;

function tag(text: string, color: string): Sprite {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 80;
  const g = c.getContext('2d')!;
  g.font = '600 34px ui-monospace, SFMono-Regular, Menlo, monospace';
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.8)';
  g.shadowBlur = 8;
  g.fillText(text, 256, 40);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  const s = new Sprite(new SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false }));
  s.scale.set(0.24, 0.0375, 1);
  s.renderOrder = 95;
  return s;
}

export class Xray {
  enabled: boolean;
  readonly root = new Group();
  private joints: InstancedMesh;
  private bones: LineSegments;
  private bonePos: Float32Array;
  private plane: Mesh;
  private grab: Mesh;
  private pinch: Mesh;
  private link: LineSegments;
  private raw: LineSegments;
  private tags: Record<'grab' | 'pinch' | 'plane' | 'crease', Sprite>;
  private o = new Object3D();
  private v = new Vector3();
  private q = new Quaternion();

  constructor() {
    let on = false;
    try {
      on = new URLSearchParams(location.search).has('xray');
    } catch {
      on = false;
    }
    this.enabled = on;
    this.root.name = 'Xray';
    this.root.visible = on;
    const glow = { transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending } as const;
    this.joints = new InstancedMesh(new SphereGeometry(0.0042, 8, 6), new MeshBasicMaterial({ color: CYAN, ...glow }), 52);
    this.joints.frustumCulled = false;
    this.joints.renderOrder = 90;
    const segs = CHAINS.reduce((n, c) => n + c.length - 1, 0) * 2;
    this.bonePos = new Float32Array(segs * 2 * 3);
    const bg = new BufferGeometry();
    bg.setAttribute('position', new Float32BufferAttribute(this.bonePos, 3));
    this.bones = new LineSegments(bg, new LineBasicMaterial({ color: CYAN, opacity: 0.7, ...glow }));
    this.bones.frustumCulled = false;
    this.bones.renderOrder = 90;
    this.plane = new Mesh(
      new PlaneGeometry(0.26, 0.2),
      new MeshBasicMaterial({ color: CYAN, opacity: 0.16, side: DoubleSide, ...glow }),
    );
    this.plane.renderOrder = 91;
    const dot = new SphereGeometry(0.007, 12, 8);
    this.grab = new Mesh(dot, new MeshBasicMaterial({ color: GOLD, ...glow }));
    this.pinch = new Mesh(dot, new MeshBasicMaterial({ color: CYAN, ...glow }));
    const lg = new BufferGeometry();
    lg.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
    this.link = new LineSegments(lg, new LineBasicMaterial({ color: 0xffffff, opacity: 0.8, ...glow }));
    const rg = new BufferGeometry();
    rg.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
    this.raw = new LineSegments(rg, new LineBasicMaterial({ color: CYAN, ...glow }));
    for (const x of [this.link, this.raw]) x.frustumCulled = false;
    this.tags = {
      grab: tag('GRAB POINT P', '#ffd166'),
      pinch: tag('PINCH H', '#9ff3ff'),
      plane: tag('BISECTOR OF P–H', '#9ff3ff'),
      crease: tag('RAW CREASE', '#9ff3ff'),
    };
    this.root.add(this.joints, this.bones, this.plane, this.grab, this.pinch, this.link, this.raw, ...Object.values(this.tags));
    this.hideSolver();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.root.visible = on;
    if (!on) this.hideSolver();
  }

  /** Draws every tracked hand joint and finger bone. */
  updateHands(frame: XRFrame, ref: XRReferenceSpace, player: Matrix4) {
    if (!this.enabled) return;
    let n = 0;
    let b = 0;
    for (const source of frame.session.inputSources) {
      const hand = source.hand;
      if (!hand || !frame.getJointPose) continue;
      const pos = new Map<string, Vector3>();
      for (const [name, space] of hand.entries()) {
        const pose = frame.getJointPose(space, ref);
        if (!pose || n >= 52) continue;
        const p = new Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z).applyMatrix4(player);
        pos.set(name, p);
        this.o.position.copy(p);
        this.o.updateMatrix();
        this.joints.setMatrixAt(n++, this.o.matrix);
      }
      for (const chain of CHAINS) {
        for (let i = 0; i < chain.length - 1; i++) {
          const a = pos.get(chain[i]);
          const c = pos.get(chain[i + 1]);
          if (!a || !c || b + 6 > this.bonePos.length) continue;
          this.bonePos.set([a.x, a.y, a.z, c.x, c.y, c.z], b);
          b += 6;
        }
      }
    }
    this.joints.count = n;
    this.joints.instanceMatrix.needsUpdate = true;
    this.bonePos.fill(0, b);
    this.bones.geometry.attributes.position.needsUpdate = true;
  }

  /** P and H in world space; raw crease end points in world space (or null). */
  showSolver(p: Vector3, h: Vector3, raw: [Vector3, Vector3] | null) {
    if (!this.enabled) return;
    for (const x of [this.grab, this.pinch, this.link, this.plane, ...Object.values(this.tags)]) x.visible = true;
    this.grab.position.copy(p);
    this.pinch.position.copy(h);
    const lp = this.link.geometry.attributes.position as Float32BufferAttribute;
    lp.setXYZ(0, p.x, p.y, p.z);
    lp.setXYZ(1, h.x, h.y, h.z);
    lp.needsUpdate = true;
    // The bisector plane: centred between P and H, facing along P→H.
    this.v.copy(h).sub(p);
    const len = this.v.length();
    this.plane.visible = len > 0.012;
    if (len > 1e-4) {
      this.plane.position.copy(p).add(h).multiplyScalar(0.5);
      this.q.setFromUnitVectors(new Vector3(0, 0, 1), this.v.normalize());
      this.plane.quaternion.copy(this.q);
    }
    this.tags.grab.position.copy(p).y += 0.025;
    this.tags.pinch.position.copy(h).y += 0.03;
    this.tags.plane.position.copy(this.plane.position).y += 0.11;
    this.tags.plane.visible = this.plane.visible;
    this.raw.visible = raw !== null;
    this.tags.crease.visible = raw !== null;
    if (raw) {
      const rp = this.raw.geometry.attributes.position as Float32BufferAttribute;
      rp.setXYZ(0, raw[0].x, raw[0].y, raw[0].z);
      rp.setXYZ(1, raw[1].x, raw[1].y, raw[1].z);
      rp.needsUpdate = true;
      this.tags.crease.position.copy(raw[1]).y += 0.02;
    }
  }

  hideSolver() {
    for (const x of [this.grab, this.pinch, this.link, this.plane, this.raw, ...Object.values(this.tags)]) x.visible = false;
  }
}
