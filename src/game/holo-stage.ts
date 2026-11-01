/**
 * The projection table's machinery: turning reticles on the mat, a shaft of light
 * rising from them, a slice plane that travels through whatever is being shown,
 * and labels tethered to it by thin leader lines.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  Object3D,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Vector3,
  World,
} from '@iwsdk/core';
import { MONO, setFont, TextLabel } from './glass.js';
import { HOLO_TIME, holoLine } from './holo.js';

const CYAN = 'rgba(120,225,255,';

/** Tick rings and arcs, drawn once and turned as a whole. */
function reticle(size: number, ringR: number, seed: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const m = size / 2;
  const r = ringR * m;
  g.translate(m, m);
  g.strokeStyle = `${CYAN}0.9)`;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    const major = i % 15 === 0;
    const mid = i % 5 === 0;
    const len = major ? 26 : mid ? 15 : 8;
    g.globalAlpha = major ? 1 : mid ? 0.75 : 0.42;
    g.lineWidth = major ? 2.4 : 1.2;
    g.beginPath();
    g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    g.lineTo(Math.cos(a) * (r + len), Math.sin(a) * (r + len));
    g.stroke();
  }
  g.globalAlpha = 0.9;
  setFont(g, Math.round(size * 0.0125), 500, 1, MONO);
  g.fillStyle = `${CYAN}0.95)`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.save();
    g.rotate(a);
    g.translate(0, -(r + 44));
    g.fillText(String(i * 30).padStart(3, '0'), 0, 0);
    g.restore();
  }
  // Heavier arcs, different on each ring, so the rings read as machinery.
  g.lineCap = 'round';
  const arcs = seed === 0 ? [[0.1, 0.62], [2.2, 2.75], [4.1, 4.9]] : [[0.8, 1.9], [3.3, 3.55], [5.2, 6.0]];
  for (const [a0, a1] of arcs) {
    g.globalAlpha = 0.95;
    g.lineWidth = seed === 0 ? 7 : 4;
    g.beginPath();
    g.arc(0, 0, r - 16, a0, a1);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = NoColorSpace;
  t.anisotropy = 8;
  return t;
}

function additive(map: CanvasTexture, opacity = 1): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map,
    opacity,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
    side: DoubleSide,
  });
}

const MOTE_VERT = /* glsl */ `
uniform float uTime;
uniform float uHeight;
attribute vec3 aSeed;
varying float vA;
void main() {
  float h = fract(aSeed.x + uTime * (0.05 + aSeed.y * 0.07));
  float a = aSeed.z * 6.283 + uTime * 0.12;
  float r = (0.05 + 0.15 * sqrt(aSeed.y)) * (0.7 + 0.55 * h);
  vec3 p = vec3(cos(a) * r, h * uHeight, sin(a) * r);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vA = sin(h * 3.14159) * (0.4 + 0.6 * aSeed.z);
  gl_PointSize = clamp(3.2 / -mv.z, 1.0, 5.0);
  gl_Position = projectionMatrix * mv;
}`;

const MOTE_FRAG = /* glsl */ `
uniform float uPower;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  gl_FragColor = vec4(vec3(0.5, 0.88, 1.0) * (1.0 - d * d) * vA * uPower, 0.0);
}`;

const SHAFT_VERT = /* glsl */ `
varying float vH;
varying vec3 vN;
varying vec3 vV;
varying float vA;
void main() {
  vH = uv.y;
  vA = uv.x;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const SHAFT_FRAG = /* glsl */ `
uniform float uTime;
uniform float uPower;
varying float vH;
varying vec3 vN;
varying vec3 vV;
varying float vA;
void main() {
  float facing = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
  float streak = 0.72 + 0.28 * sin(vA * 80.0 + uTime * 0.6) * sin(vA * 31.0 - uTime * 0.35);
  float a = pow(1.0 - vH, 1.8) * smoothstep(0.0, 0.12, vH) * facing * streak * uPower;
  gl_FragColor = vec4(vec3(0.22, 0.72, 1.0) * a, 0.0);
}`;

const SLICE_FRAG = /* glsl */ `
uniform float uPower;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = max(abs(p.x), abs(p.y));
  vec2 g = abs(fract(vUv * 26.0) - 0.5);
  float w = max(fwidth(vUv.x * 26.0), 0.02);
  float grid = 1.0 - smoothstep(0.0, w * 1.2, min(g.x, g.y));
  float border = smoothstep(0.985, 0.992, d) * (1.0 - smoothstep(0.996, 1.0, d));
  float corners = step(0.8, abs(p.x)) * step(0.8, abs(p.y));
  float fall = 1.0 - smoothstep(0.35, 1.0, length(p));
  float a = (0.05 * fall + 0.16 * grid * fall + border * (0.28 + 0.72 * corners)) * uPower;
  gl_FragColor = vec4(vec3(0.42, 0.88, 1.0) * a, 0.0);
}`;

const TRACE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAwake;
uniform float uPower;
varying vec2 vUv;
float beat(float p) {
  float v = 0.1 * exp(-pow((p - 0.18) / 0.035, 2.0));
  v -= 0.12 * exp(-pow((p - 0.3) / 0.012, 2.0));
  v += 0.85 * exp(-pow((p - 0.335) / 0.014, 2.0));
  v -= 0.25 * exp(-pow((p - 0.37) / 0.012, 2.0));
  v += 0.22 * exp(-pow((p - 0.58) / 0.05, 2.0));
  return v;
}
void main() {
  float x = vUv.x * 2.1 - uTime * 0.9;
  float w = beat(fract(x)) * uAwake * 0.62;
  float y = vUv.y - 0.3;
  // Distance to the curve, corrected for how steep it runs.
  float slope = abs(dFdx(w)) / max(abs(dFdx(vUv.x)), 1e-5);
  float d = abs(y - w) / sqrt(1.0 + slope * slope * 0.12);
  float line = 1.0 - smoothstep(0.012, 0.034, d);
  float glow = exp(-d * 26.0) * 0.28;
  float ends = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
  vec3 c = mix(vec3(0.3, 0.72, 0.95), vec3(0.35, 1.0, 0.62), uAwake);
  gl_FragColor = vec4(c * (line + glow) * ends * uPower, 0.0);
}`;

interface Callout {
  /** What the line is tied to, with an offset in its own frame. */
  anchor: Object3D | null;
  offset: Vector3;
  /** Where the label sits relative to the anchor, in the view's right and up. */
  right: number;
  up: number;
  main: TextLabel;
  sub: TextLabel;
  dot: Mesh;
}

const MAX_CALLOUTS = 4;

export class HoloStage {
  /** In the mat's frame. */
  readonly root = new Group();
  /** In the world, because the labels face the viewer. */
  readonly labels = new Group();
  private ringA: Mesh;
  private ringB: Mesh;
  /** Rings standing in the air around the body, and flat ones up the shaft. */
  private gimbal: Group;
  private gimbalRings: { mesh: Mesh; speed: number; tilt: [number, number] }[] = [];
  private levels: Mesh[] = [];
  private frame: LineSegments<BufferGeometry>;
  private motes: Points<BufferGeometry, ShaderMaterial>;
  private shaft: Mesh<CylinderGeometry, ShaderMaterial>;
  private slice: Mesh<PlaneGeometry, ShaderMaterial>;
  private sliceLabel: TextLabel;
  private leaders: LineSegments<BufferGeometry>;
  private leaderPos: Float32Array;
  private callouts: Callout[] = [];
  private trace: Mesh<PlaneGeometry, ShaderMaterial>;
  private awake = 0;
  private wantAwake = false;
  private traceAnchor = -1;
  private power = 0;
  private want = 0;
  private height = 0.34;
  private baseY = 0.05;
  private clock = 0;
  private a = new Vector3();
  private b = new Vector3();
  private c = new Vector3();
  private head = new Vector3();
  private rightV = new Vector3();
  private upV = new Vector3(0, 1, 0);
  /** Gives up the shaft of light when a headset is short of frame rate. */
  lowPower = false;
  /** The world height of the slice, for the body it passes through. */
  scanY = -99;

  constructor(private world: World) {
    this.root.name = 'HoloStage';
    this.labels.name = 'HoloLabels';
    this.ringA = new Mesh(new PlaneGeometry(0.5, 0.5), additive(reticle(1536, 0.76, 0), 0.62));
    this.ringB = new Mesh(new PlaneGeometry(0.42, 0.42), additive(reticle(1024, 0.8, 1), 0.5));
    for (const r of [this.ringA, this.ringB]) {
      r.rotation.x = -Math.PI / 2;
      r.position.y = 0.0007;
      r.renderOrder = 0;
      r.raycast = () => {};
      this.root.add(r);
    }
    this.shaft = new Mesh(
      new CylinderGeometry(0.26, 0.15, 0.62, 64, 1, true),
      new ShaderMaterial({
        vertexShader: SHAFT_VERT,
        fragmentShader: SHAFT_FRAG,
        transparent: true,
        depthWrite: false,
        premultipliedAlpha: true,
        side: DoubleSide,
        toneMapped: false,
        uniforms: { uTime: HOLO_TIME, uPower: { value: 0 } },
      }),
    );
    this.shaft.position.y = 0.31;
    this.shaft.renderOrder = 60;
    this.shaft.raycast = () => {};
    this.shaft.visible = false;
    this.root.add(this.shaft);

    this.slice = new Mesh(
      new PlaneGeometry(0.44, 0.44),
      new ShaderMaterial({
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: SLICE_FRAG,
        transparent: true,
        depthWrite: false,
        premultipliedAlpha: true,
        side: DoubleSide,
        toneMapped: false,
        uniforms: { uPower: { value: 0 } },
      }),
    );
    this.slice.rotation.x = -Math.PI / 2;
    this.slice.renderOrder = 62;
    this.slice.visible = false;
    this.slice.raycast = () => {};
    this.root.add(this.slice);

    this.gimbal = new Group();
    this.gimbal.name = 'Gimbal';
    const ringTex = reticle(1024, 0.8, 1);
    const ringTex2 = reticle(1024, 0.8, 0);
    const tilts: [number, number, number, CanvasTexture, number][] = [
      [1.25, 0.2, 0.46, ringTex, 0.09],
      [1.95, -0.55, 0.52, ringTex2, -0.065],
      [0.45, 1.1, 0.4, ringTex, 0.12],
    ];
    for (const [rx, ry, size, tex, speed] of tilts) {
      const m = new Mesh(new PlaneGeometry(size, size), additive(tex, 0));
      m.renderOrder = 61;
      m.raycast = () => {};
      this.gimbal.add(m);
      this.gimbalRings.push({ mesh: m, speed, tilt: [rx, ry] });
    }
    this.gimbal.visible = false;
    this.root.add(this.gimbal);
    for (const [y, size] of [[0.1, 0.34], [0.2, 0.38], [0.33, 0.44]] as const) {
      const m = new Mesh(new PlaneGeometry(size, size), additive(ringTex2, 0));
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      m.renderOrder = 60;
      m.raycast = () => {};
      m.visible = false;
      this.levels.push(m);
      this.root.add(m);
    }
    // A measuring frame: corner brackets of a box, and a ruler up one edge.
    const F: number[] = [];
    const hx = 0.2;
    const hz = 0.2;
    const y0 = 0.03;
    const y1 = 0.45;
    const L = 0.05;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const y of [y0, y1]) {
          const dy = y === y0 ? L : -L;
          const x = sx * hx;
          const z = sz * hz;
          F.push(x, y, z, x - sx * L, y, z, x, y, z, x, y, z - sz * L, x, y, z, x, y + dy, z);
        }
      }
    }
    for (let i = 0; i <= 21; i++) {
      const y = y0 + i * 0.02;
      const w = i % 5 === 0 ? 0.016 : 0.008;
      F.push(hx, y, hz, hx + w, y, hz);
    }
    F.push(hx, y0, hz, hx, y1, hz);
    const fg = new BufferGeometry();
    fg.setAttribute('position', new Float32BufferAttribute(F, 3));
    this.frame = new LineSegments(fg, holoLine(0x7fdcff, 0));
    this.frame.renderOrder = 61;
    this.frame.raycast = () => {};
    this.frame.visible = false;
    this.root.add(this.frame);
    const seeds = new Float32Array(420 * 3);
    let r = 7;
    for (let i = 0; i < seeds.length; i++) {
      r = (r * 16807) % 2147483647;
      seeds[i] = r / 2147483647;
    }
    const mg = new BufferGeometry();
    mg.setAttribute('position', new Float32BufferAttribute(new Float32Array(420 * 3), 3));
    mg.setAttribute('aSeed', new Float32BufferAttribute(seeds, 3));
    this.motes = new Points(
      mg,
      new ShaderMaterial({
        vertexShader: MOTE_VERT,
        fragmentShader: MOTE_FRAG,
        transparent: true,
        depthWrite: false,
        premultipliedAlpha: true,
        toneMapped: false,
        uniforms: { uTime: HOLO_TIME, uHeight: { value: 0.5 }, uPower: { value: 0 } },
      }),
    );
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 63;
    this.motes.raycast = () => {};
    this.motes.visible = false;
    this.root.add(this.motes);

    this.sliceLabel = new TextLabel(0.0125, 40, 500, 'rgba(170,235,255,0.95)', 120, MONO);
    this.labels.add(this.sliceLabel.mesh);

    this.leaderPos = new Float32Array(MAX_CALLOUTS * 4 * 3);
    const lg = new BufferGeometry();
    lg.setAttribute('position', new Float32BufferAttribute(this.leaderPos, 3));
    this.leaders = new LineSegments(lg, holoLine(0x8fe6ff, 0.85));
    this.leaders.frustumCulled = false;
    this.leaders.renderOrder = 119;
    this.leaders.raycast = () => {};
    this.labels.add(this.leaders);
    const dotGeo = new PlaneGeometry(0.009, 0.009);
    const dotTex = (() => {
      const k = document.createElement('canvas');
      k.width = k.height = 64;
      const g = k.getContext('2d')!;
      g.strokeStyle = '#a5ecff';
      g.lineWidth = 5;
      g.beginPath();
      g.arc(32, 32, 24, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(32, 32, 8, 0, Math.PI * 2);
      g.fill();
      const t = new CanvasTexture(k);
      t.colorSpace = NoColorSpace;
      return t;
    })();
    for (let i = 0; i < MAX_CALLOUTS; i++) {
      const main = new TextLabel(0.021, 64, 500, 'rgba(225,250,255,1)', 120, MONO);
      const sub = new TextLabel(0.0135, 44, 400, 'rgba(140,220,255,0.92)', 120, MONO);
      const dot = new Mesh(dotGeo, additive(dotTex));
      dot.renderOrder = 120;
      dot.raycast = () => {};
      this.labels.add(main.mesh, sub.mesh, dot);
      this.callouts.push({ anchor: null, offset: new Vector3(), right: 0, up: 0, main, sub, dot });
    }
    this.trace = new Mesh(
      new PlaneGeometry(0.15, 0.05),
      new ShaderMaterial({
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: TRACE_FRAG,
        transparent: true,
        depthWrite: false,
        premultipliedAlpha: true,
        side: DoubleSide,
        toneMapped: false,
        uniforms: { uTime: HOLO_TIME, uAwake: { value: 0 }, uPower: { value: 0 } },
      }),
    );
    this.trace.renderOrder = 120;
    this.trace.raycast = () => {};
    this.trace.visible = false;
    this.labels.add(this.trace);
    this.labels.visible = false;
  }

  /** Runs a vitals trace under callout `i`: flat, then beating once awake. */
  showTrace(i: number) {
    this.traceAnchor = i;
    this.awake = 0;
    this.wantAwake = false;
  }

  setAwake(on: boolean) {
    this.wantAwake = on;
  }

  /** Tethers callout `i` to a point on `anchor`, with its label out to one side. */
  setCallout(i: number, anchor: Object3D | null, offset: Vector3 | [number, number, number], right: number, up: number, main: string, sub: string) {
    const c = this.callouts[i];
    c.anchor = anchor;
    if (offset instanceof Vector3) c.offset.copy(offset);
    else c.offset.fromArray(offset);
    c.right = right;
    c.up = up;
    c.main.set(main);
    c.sub.set(sub);
  }

  /** Raises the shaft and slice around a body `height` metres tall. */
  present(baseY: number, height: number) {
    this.baseY = baseY;
    this.height = height;
    this.want = 1;
  }

  /** Lets them fade; the reticles keep turning. */
  dismiss() {
    this.want = 0;
    for (const c of this.callouts) c.anchor = null;
    this.traceAnchor = -1;
  }

  update(dt: number) {
    this.clock += dt;
    this.ringA.rotation.z = this.clock * 0.05;
    this.ringB.rotation.z = -this.clock * 0.09;
    this.power += (this.want - this.power) * Math.min(1, dt * (this.want ? 2.6 : 5));
    const on = this.power > 0.01;
    this.slice.visible = this.labels.visible = on;
    this.shaft.visible = on && !this.lowPower;
    if (!on) {
      this.scanY = -99;
      return;
    }
    this.shaft.material.uniforms.uPower.value = this.power * 0.5;
    this.slice.material.uniforms.uPower.value = this.power;
    const full = !this.lowPower;
    this.gimbal.visible = this.frame.visible = this.motes.visible = on;
    this.gimbal.position.y = this.baseY + this.height * 0.42;
    for (const g of this.gimbalRings) {
      g.mesh.rotation.set(g.tilt[0], g.tilt[1], this.clock * g.speed);
      (g.mesh.material as MeshBasicMaterial).opacity = this.power * (full ? 0.5 : 0.3);
    }
    for (const m of this.levels) {
      m.visible = on && full;
      (m.material as MeshBasicMaterial).opacity = this.power * 0.3;
    }
    this.levels[0].rotation.z = this.clock * 0.14;
    this.levels[1].rotation.z = -this.clock * 0.1;
    this.levels[2].rotation.z = this.clock * 0.07;
    (this.frame.material as MeshBasicMaterial).opacity = this.power * 0.62;
    this.motes.material.uniforms.uPower.value = this.power;

    // The slice travels up and down through the body, easing at each end.
    const u = 0.5 - 0.5 * Math.cos(this.clock * 0.72);
    const y = this.baseY + u * this.height;
    this.slice.position.y = y;
    this.root.updateWorldMatrix(true, false);
    this.a.set(0.22, y, 0.22);
    this.root.localToWorld(this.a);
    this.scanY = this.a.y;

    const camera = this.world.camera;
    camera.getWorldPosition(this.head);
    this.camRight();
    this.sliceLabel.set(`SLICE ${String(Math.round((y - this.baseY) * 1000)).padStart(3, '0')} MM`);
    this.sliceLabel.mesh.position.copy(this.a).addScaledVector(this.rightV, 0.05);
    this.face(this.sliceLabel.mesh);
    this.sliceLabel.surface.fade = this.power;

    let n = 0;
    for (const c of this.callouts) {
      const live = !!c.anchor;
      c.main.mesh.visible = c.sub.mesh.visible = c.dot.visible = live;
      if (!c.anchor) continue;
      // Anchor, then an elbow out to the side, then along under the label.
      this.a.copy(c.offset);
      c.anchor.localToWorld(this.a);
      this.b.copy(this.a).addScaledVector(this.rightV, c.right * 0.55).addScaledVector(this.upV, c.up);
      this.c.copy(this.b).addScaledVector(this.rightV, c.right * 0.45);
      const p = this.leaderPos;
      p.set([this.a.x, this.a.y, this.a.z, this.b.x, this.b.y, this.b.z, this.b.x, this.b.y, this.b.z, this.c.x, this.c.y, this.c.z], n);
      n += 12;
      c.dot.position.copy(this.a);
      this.face(c.dot);
      const side = Math.sign(c.right);
      const reach = Math.abs(c.right) * 0.45;
      c.main.mesh.position.copy(this.b).addScaledVector(this.rightV, side * (reach * 0 + c.main.width / 2)).addScaledVector(this.upV, 0.0125);
      c.sub.mesh.position.copy(this.b).addScaledVector(this.rightV, side * (c.sub.width / 2)).addScaledVector(this.upV, -0.0095);
      this.face(c.main.mesh);
      this.face(c.sub.mesh);
      c.main.surface.fade = c.sub.surface.fade = this.power;
    }
    this.awake += ((this.wantAwake ? 1 : 0) - this.awake) * Math.min(1, dt * 6);
    this.trace.visible = this.traceAnchor >= 0;
    if (this.traceAnchor >= 0) {
      const t = this.callouts[this.traceAnchor];
      const side = Math.sign(t.right);
      this.trace.position.copy(t.sub.mesh.position);
      this.trace.position.addScaledVector(this.rightV, side * (0.075 - t.sub.width / 2)).addScaledVector(this.upV, -0.036);
      this.face(this.trace);
      this.trace.material.uniforms.uAwake.value = this.awake;
      this.trace.material.uniforms.uPower.value = this.power;
    }
    this.leaderPos.fill(0, n);
    this.leaders.geometry.attributes.position.needsUpdate = true;
    (this.leaders.material as MeshBasicMaterial).opacity = 0.85 * this.power;
  }

  private camRight() {
    this.rightV.set(1, 0, 0).applyQuaternion(this.world.camera.getWorldQuaternion(this.world.camera.quaternion.clone()));
    this.rightV.y = 0;
    this.rightV.normalize();
  }

  private face(o: Object3D) {
    o.lookAt(this.head);
  }
}
