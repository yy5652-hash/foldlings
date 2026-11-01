/**
 * The inside of a hologram: a small 3D texture of the creature, ray-marched so
 * that you look into it rather than at it. Bright slices run through the volume
 * like the stack of a scan; the shell and the deep interior take different false
 * colours. It is costly, so only the creature on the table has one.
 */

import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  Data3DTexture,
  Float32BufferAttribute,
  LinearFilter,
  Mesh,
  Points,
  RGFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
} from '@iwsdk/core';
import { buildRig } from './creature-models.js';
import { HOLO_FINGERS, HOLO_TIME } from './holo.js';
import type { CreatureKind } from './levels.js';
import { VoxelGrid, voxelize } from './voxel.js';

/** Grains of light through the volume. */
const SAND = 15000;

const VERT = /* glsl */ `
varying vec3 vLocal;
varying vec3 vOrigin;
varying vec4 vRowY;
varying float vScale;
void main() {
  vLocal = position;
  vOrigin = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  // The fragment shader needs world height along the ray, and the world scale.
  vRowY = vec4(modelMatrix[0][1], modelMatrix[1][1], modelMatrix[2][1], modelMatrix[3][1]);
  vScale = length(modelMatrix[0].xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp sampler3D;
uniform sampler3D uVol;
uniform vec3 uHalf;
uniform vec3 uShell;
uniform vec3 uCore;
uniform float uGain;
uniform float uTime;
uniform float uScanY;
uniform float uBands;
uniform int uSteps;
varying vec3 vLocal;
varying vec3 vOrigin;
varying vec4 vRowY;
varying float vScale;
void main() {
  vec3 dir = normalize(vLocal - vOrigin);
  vec3 inv = 1.0 / dir;
  vec3 a = (-uHalf - vOrigin) * inv;
  vec3 b = (uHalf - vOrigin) * inv;
  vec3 lo = min(a, b);
  vec3 hi = max(a, b);
  float t0 = max(max(max(lo.x, lo.y), lo.z), 0.0);
  float t1 = min(min(hi.x, hi.y), hi.z);
  if (t1 <= t0) discard;
  float dt = (t1 - t0) / float(uSteps);
  // A different start per pixel turns banding into fine grain.
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float t = t0 + dt * jitter;
  // World height runs linearly along the ray.
  float wy = dot(vRowY, vec4(vOrigin + dir * t, 1.0));
  float dy = dot(vRowY.xyz, dir) * dt;
  float seen = vScale;
  vec3 sum = vec3(0.0);
  float mass = 0.0;
  for (int i = 0; i < uSteps; i++) {
    vec3 p = vOrigin + dir * t;
    vec2 v = texture(uVol, p / (2.0 * uHalf) + 0.5).rg;
    if (v.r + v.g > 0.01) {
      float near = 0.32 + 0.68 * (1.0 - float(i) / float(uSteps));
      // Thin bright slices through the volume, drifting slowly upward.
      float slice = 0.5 + 0.5 * cos(wy * uBands - uTime * 0.9);
      slice = slice * slice * slice;
      // Where the moving slice plane cuts through, the section lights up.
      float cut = exp(-pow((wy - uScanY) * 210.0, 2.0));
      float shell = v.r * v.r;
      // Mostly dark between the slices: a stack of scans, not a fog.
      sum += uShell * shell * (0.07 + 1.5 * slice) * near;
      sum += uCore * v.g * (0.5 + 1.7 * slice) * near;
      sum += vec3(0.8, 0.97, 1.0) * (shell + v.g) * cut * 1.5;
      mass += shell * 0.5 + v.g * 0.7;
      if (mass * dt * seen * uGain > 0.9) break;
    }
    t += dt;
    wy += dy;
  }
  float k = dt * seen * uGain;
  vec3 col = sum * k;
  gl_FragColor = vec4(col, min(0.55, mass * k * 0.4));
}`;

const SAND_VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uFingers[2];
uniform vec3 uShell;
uniform vec3 uCore;
attribute vec4 aSand;
varying vec3 vC;
varying float vA;
void main() {
  // Each grain wanders around its place, in a slow flow up through the body.
  float ph = aSand.x * 6.283;
  vec3 p = position + vec3(sin(uTime * 0.5 + ph), sin(uTime * 0.37 + ph * 2.0), cos(uTime * 0.43 + ph)) * 0.0035;
  vec3 w = (modelMatrix * vec4(p, 1.0)).xyz;
  // Grains shy away from a fingertip, so the volume feels like something you touch.
  for (int i = 0; i < 2; i++) {
    vec3 d = w - uFingers[i];
    w += d * exp(-dot(d, d) / 0.006) * 0.9;
  }
  vec4 mv = viewMatrix * vec4(w, 1.0);
  float z0 = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
  float near = clamp(0.5 + (mv.z - z0) / 0.34, 0.0, 1.0);
  vC = mix(uShell, uCore, aSand.y) * mix(vec3(0.34, 0.52, 0.85), vec3(1.0), near);
  vA = (0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * (0.6 + aSand.z * 2.4) + ph), 4.0)) * (0.35 + 0.65 * near);
  gl_PointSize = clamp((1.4 + aSand.z * 1.1) * 1.25 / -mv.z, 1.0, 3.4);
  gl_Position = projectionMatrix * mv;
}`;

const SAND_FRAG = /* glsl */ `
varying vec3 vC;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  gl_FragColor = vec4(mix(vC, vec3(1.0), 0.2) * (1.0 - d * d) * vA * 0.55, 0.0);
}`;

interface Baked {
  sand: BufferGeometry;
  tex: Data3DTexture;
  center: Vector3;
  half: Vector3;
}

const cache = new Map<CreatureKind, Baked>();

/** Grains scattered through the volume where it has substance. */
function sandGeometry(grid: VoxelGrid): BufferGeometry {
  const { nx, ny, nz, data, min, size } = grid;
  const P: number[] = [];
  const S: number[] = [];
  let seed = 4242;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const sx = size[0] / nx;
  const sy = size[1] / ny;
  const sz = size[2] / nz;
  // Rejection sample, weighted to the interior, up to the point budget.
  for (let tries = 0; tries < 900000 && P.length < SAND * 3; tries++) {
    const i = Math.floor(rnd() * nx);
    const j = Math.floor(rnd() * ny);
    const k = Math.floor(rnd() * nz);
    const o = (i + nx * (j + ny * k)) * 2;
    const shell = data[o] / 255;
    const core = data[o + 1] / 255;
    if (rnd() > Math.max(shell * shell * 0.55, core * 0.9)) continue;
    P.push(min[0] + (i + rnd()) * sx, min[1] + (j + rnd()) * sy, min[2] + (k + rnd()) * sz);
    S.push(rnd(), core > 0.05 ? 1 : 0, rnd(), 0);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(P, 3));
  g.setAttribute('aSand', new Float32BufferAttribute(S, 4));
  return g;
}

/** Bakes the kind once, from its model at rest; the result is shared. */
function bake(kind: CreatureKind): Baked {
  let b = cache.get(kind);
  if (b) return b;
  const rig = buildRig(kind, '#ffffff', '#ffffff');
  rig.root.updateMatrixWorld(true);
  const tris: number[] = [];
  const v = new Vector3();
  rig.root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || o.name !== 'Paper') return;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      tris.push(v.x, v.y, v.z);
    }
  });
  const grid = voxelize(tris, 56, 0.019, 0.03);
  const tex = new Data3DTexture(grid.data, grid.nx, grid.ny, grid.nz);
  tex.format = RGFormat;
  tex.type = UnsignedByteType;
  tex.minFilter = tex.magFilter = LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  b = {
    sand: sandGeometry(grid),
    tex,
    half: new Vector3(grid.size[0] / 2, grid.size[1] / 2, grid.size[2] / 2),
    center: new Vector3(grid.min[0] + grid.size[0] / 2, grid.min[1] + grid.size[1] / 2, grid.min[2] + grid.size[2] / 2),
  };
  cache.set(kind, b);
  return b;
}

export class HoloVolume {
  readonly mesh: Mesh<BoxGeometry, ShaderMaterial>;
  readonly sand: Points<BufferGeometry, ShaderMaterial>;
  /** Fewer steps when a headset is short of frame rate. */
  static steps = 26;

  constructor(kind: CreatureKind, shell: string, core: string) {
    const b = bake(kind);
    this.mesh = new Mesh(
      new BoxGeometry(b.half.x * 2, b.half.y * 2, b.half.z * 2),
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        premultipliedAlpha: true,
        side: BackSide,
        toneMapped: false,
        uniforms: {
          uVol: { value: b.tex },
          uHalf: { value: b.half },
          uShell: { value: new Color(shell) },
          uCore: { value: new Color(core) },
          uGain: { value: 10 },
          uTime: HOLO_TIME,
          uScanY: { value: -99 },
          uBands: { value: 240 },
          uSteps: { value: HoloVolume.steps },
        },
      }),
    );
    // Colors arrive linear; the shader composites in display space.
    for (const c of [this.mesh.material.uniforms.uShell.value, this.mesh.material.uniforms.uCore.value] as Color[]) {
      c.r = Math.pow(c.r, 0.4545);
      c.g = Math.pow(c.g, 0.4545);
      c.b = Math.pow(c.b, 0.4545);
    }
    const uni = this.mesh.material.uniforms;
    this.sand = new Points(
      b.sand,
      new ShaderMaterial({
        vertexShader: SAND_VERT,
        fragmentShader: SAND_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        premultipliedAlpha: true,
        toneMapped: false,
        uniforms: { uTime: HOLO_TIME, uFingers: HOLO_FINGERS, uShell: uni.uShell, uCore: uni.uCore },
      }),
    );
    this.sand.name = 'HoloSand';
    this.sand.frustumCulled = false;
    this.sand.renderOrder = 67;
    this.sand.raycast = () => {};
    (this.sand as unknown as { pointerEvents: string }).pointerEvents = 'none';
    this.mesh.position.copy(b.center);
    this.mesh.name = 'HoloVolume';
    this.mesh.renderOrder = 66;
    this.mesh.raycast = () => {};
    (this.mesh as unknown as { pointerEvents: string }).pointerEvents = 'none';
  }

  setScan(y: number) {
    this.mesh.material.uniforms.uScanY.value = y;
    this.mesh.material.uniforms.uSteps.value = HoloVolume.steps;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.sand.material.dispose();
  }
}
