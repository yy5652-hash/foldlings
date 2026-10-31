/**
 * How hands look. In passthrough your real hands are there to see: simple bodies
 * built from the tracked joints only write depth, so your fingers stay in front
 * of the paper and the glass instead of being painted over. In the virtual study,
 * where they cannot be seen, the SDK's hand model is dressed in frosted glass.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  CapsuleGeometry,
  Float32BufferAttribute,
  FrontSide,
  InstancedMesh,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  World,
} from '@iwsdk/core';
import { holoLine } from './holo.js';

const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const JOINTS: XRHandJoint[] = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
];
for (const f of FINGERS) {
  for (const part of ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip']) {
    JOINTS.push(`${f}-${part}` as XRHandJoint);
  }
}
const at = (name: string) => JOINTS.indexOf(name as XRHandJoint);

/** Joint pairs joined by a capsule: the fingers, then webs that fill the palm. */
const LINKS: [number, number][] = [
  [at('wrist'), at('thumb-metacarpal')],
  [at('thumb-metacarpal'), at('thumb-phalanx-proximal')],
  [at('thumb-phalanx-proximal'), at('thumb-phalanx-distal')],
  [at('thumb-phalanx-distal'), at('thumb-tip')],
  [at('thumb-metacarpal'), at('index-finger-metacarpal')],
];
FINGERS.forEach((f, i) => {
  LINKS.push(
    [at('wrist'), at(`${f}-metacarpal`)],
    [at(`${f}-metacarpal`), at(`${f}-phalanx-proximal`)],
    [at(`${f}-phalanx-proximal`), at(`${f}-phalanx-intermediate`)],
    [at(`${f}-phalanx-intermediate`), at(`${f}-phalanx-distal`)],
    [at(`${f}-phalanx-distal`), at(`${f}-tip`)],
  );
  if (i > 0) {
    LINKS.push(
      [at(`${FINGERS[i - 1]}-metacarpal`), at(`${f}-metacarpal`)],
      [at(`${FINGERS[i - 1]}-phalanx-proximal`), at(`${f}-phalanx-proximal`)],
    );
  }
});

const MAX = LINKS.length * 2;
const Y = new Vector3(0, 1, 0);
const FALLBACK_RADIUS = 0.008;

function frostedGlass(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: 0xeef0f4,
    roughness: 0.42,
    metalness: 0,
    transparent: true,
    opacity: 1,
    envMapIntensity: 1.1,
  });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float handRim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 1.8);
      outgoingLight = vec3(0.16, 0.62, 0.86) * (0.2 + 1.7 * handRim);
      diffuseColor.a = 0.16 + 0.6 * handRim;
      #include <opaque_fragment>`,
    );
  };
  return m;
}

export class HandBodies {
  private mesh: InstancedMesh;
  /** The tracked skeleton, drawn over the hand as light. */
  private joints: InstancedMesh;
  private bones: LineSegments<BufferGeometry>;
  private bonePos = new Float32Array(MAX * 6);
  private ghost = false;
  private frosted = frostedGlass();
  private sdkFill: Mesh[] = [];
  private sdkOutline: Mesh[] = [];
  private clock = 0;
  private player = new Matrix4();
  private pos = JOINTS.map(() => new Vector3());
  private rad = new Float32Array(JOINTS.length);
  private m = new Matrix4();
  private q = new Quaternion();
  private dir = new Vector3();
  private mid = new Vector3();
  private s = new Vector3();

  constructor(private world: World) {
    // Written first, so the room and the paper are not drawn behind real fingers.
    this.mesh = new InstancedMesh(new CapsuleGeometry(1, 2, 3, 10), new MeshBasicMaterial({ colorWrite: false }), MAX);
    this.mesh.name = 'HandBodies';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
    this.mesh.renderOrder = -10;
    this.joints = new InstancedMesh(
      new SphereGeometry(0.0034, 8, 6),
      new MeshBasicMaterial({ color: 0xbdf2ff, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }),
      JOINTS.length * 2,
    );
    this.joints.count = 0;
    this.joints.frustumCulled = false;
    this.joints.renderOrder = 130;
    this.joints.raycast = () => {};
    const bg = new BufferGeometry();
    bg.setAttribute('position', new Float32BufferAttribute(this.bonePos, 3));
    this.bones = new LineSegments(bg, holoLine(0x62d6ff, 0.8));
    this.bones.frustumCulled = false;
    this.bones.renderOrder = 130;
    this.bones.raycast = () => {};
    world.scene.add(this.mesh, this.joints, this.bones);
    world.onXRFrame((frame) => this.onXRFrame(frame));
  }

  /** Frosted glass hands when real ones cannot be seen; a depth mask otherwise. */
  setGhost(on: boolean) {
    this.ghost = on;
    this.mesh.visible = !on && !this.hidden;
    this.dress();
  }

  /** Film capture: no hands at all, not even a depth mask. */
  hideAll(on: boolean) {
    this.hidden = on;
    this.mesh.visible = !on && !this.ghost;
    this.dress();
  }
  private hidden = false;

  /** The SDK loads its hand models when input starts; pick them up as they come. */
  update(dt: number) {
    this.clock += dt;
    if (this.clock < 0.7) return;
    this.clock = 0;
    if (this.sdkFill.length >= 2) return;
    this.sdkFill = [];
    this.sdkOutline = [];
    this.world.scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !m.name.endsWith('handMeshNode')) return;
      if (m.renderOrder === 999) this.sdkOutline.push(m);
      else this.sdkFill.push(m);
    });
    this.dress();
  }

  private dress() {
    for (const m of this.sdkOutline) m.visible = false;
    for (const m of this.sdkFill) {
      m.visible = this.ghost && !this.hidden;
      m.material = this.frosted;
      (m.material as MeshStandardMaterial).side = FrontSide;
    }
  }

  private onXRFrame(frame: XRFrame) {
    const ref = this.world.renderer.xr.getReferenceSpace();
    if (!ref) return;
    this.world.player.updateWorldMatrix(true, false);
    this.player.copy(this.world.player.matrixWorld);
    let n = 0;
    let jn = 0;
    let bn = 0;
    for (const src of frame.session.inputSources) {
      if (!src.hand) continue;
      let ok = true;
      for (let i = 0; i < JOINTS.length; i++) {
        const space = src.hand.get(JOINTS[i]);
        const pose = space ? frame.getJointPose?.(space, ref) : undefined;
        if (!pose) {
          ok = false;
          break;
        }
        const p = pose.transform.position;
        this.pos[i].set(p.x, p.y, p.z).applyMatrix4(this.player);
        this.rad[i] = pose.radius ?? FALLBACK_RADIUS;
      }
      if (!ok) continue;
      for (let i = 0; i < JOINTS.length; i++) {
        this.m.makeTranslation(this.pos[i].x, this.pos[i].y, this.pos[i].z);
        if (jn < JOINTS.length * 2) this.joints.setMatrixAt(jn++, this.m);
      }
      for (const [a, b] of LINKS) {
        if (n >= MAX) break;
        this.write(n++, a, b);
        const pa = this.pos[a];
        const pb = this.pos[b];
        this.bonePos[bn++] = pa.x;
        this.bonePos[bn++] = pa.y;
        this.bonePos[bn++] = pa.z;
        this.bonePos[bn++] = pb.x;
        this.bonePos[bn++] = pb.y;
        this.bonePos[bn++] = pb.z;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.joints.count = this.hidden ? 0 : jn;
    this.joints.instanceMatrix.needsUpdate = true;
    this.bonePos.fill(0, bn);
    this.bones.visible = !this.hidden;
    this.bones.geometry.attributes.position.needsUpdate = true;
  }

  private write(index: number, a: number, b: number) {
    const pa = this.pos[a];
    const pb = this.pos[b];
    this.dir.subVectors(pb, pa);
    const len = this.dir.length();
    const r = (this.rad[a] + this.rad[b]) * 0.5;
    this.mid.addVectors(pa, pb).multiplyScalar(0.5);
    this.q.setFromUnitVectors(Y, len > 1e-5 ? this.dir.divideScalar(len) : Y);
    // The unit capsule is 4 long, 2 of them straight: stretch it end to end.
    this.s.set(r, (len + 2 * r) / 4, r);
    this.m.compose(this.mid, this.q, this.s);
    this.mesh.setMatrixAt(index, this.m);
  }
}
