/**
 * The inside of a hologram: a small 3D texture of the creature, ray-marched so
 * that you look into it rather than at it. Bright slices run through the volume
 * like the stack of a scan; the shell and the deep interior take different false
 * colours. It is costly, so only the creature on the table has one.
 */

import {
  BackSide,
  BoxGeometry,
  Color,
  Data3DTexture,
  LinearFilter,
  Mesh,
  RGFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
} from '@iwsdk/core';
import { buildRig } from './creature-models.js';
import { HOLO_TIME } from './holo.js';
import type { CreatureKind } from './levels.js';
import { voxelize } from './voxel.js';

const VERT = /* glsl */ `
varying vec3 vLocal;
varying vec3 vOrigin;
void main() {
  vLocal = position;
  vOrigin = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
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
  // World height runs linearly along the ray, so it costs one matrix per pixel.
  vec3 ws = (modelMatrix * vec4(vOrigin + dir * t, 1.0)).xyz;
  vec3 we = (modelMatrix * vec4(vOrigin + dir * (t + dt), 1.0)).xyz;
  float wy = ws.y;
  float dy = we.y - ws.y;
  float seen = length(we - ws) / max(dt, 1e-5);
  vec3 sum = vec3(0.0);
  float mass = 0.0;
  for (int i = 0; i < uSteps; i++) {
    vec3 p = vOrigin + dir * t;
    vec2 v = texture(uVol, p / (2.0 * uHalf) + 0.5).rg;
    if (v.r + v.g > 0.01) {
      // Thin bright slices through the volume, drifting slowly upward.
      float slice = 0.5 + 0.5 * cos(wy * uBands - uTime * 0.9);
      slice = slice * slice * slice;
      // Where the moving slice plane cuts through, the section lights up.
      float cut = exp(-pow((wy - uScanY) * 70.0, 2.0));
      float shell = v.r * v.r;
      sum += uShell * shell * (0.34 + 1.5 * slice);
      sum += uCore * v.g * (0.42 + 1.1 * slice);
      sum += vec3(0.8, 0.97, 1.0) * (shell + v.g) * cut * 2.6;
      mass += shell * 0.5 + v.g * 0.7;
    }
    t += dt;
    wy += dy;
  }
  float k = dt * seen * uGain;
  vec3 col = sum * k;
  gl_FragColor = vec4(col, min(0.55, mass * k * 0.4));
}`;

interface Baked {
  tex: Data3DTexture;
  center: Vector3;
  half: Vector3;
}

const cache = new Map<CreatureKind, Baked>();

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
    tex,
    half: new Vector3(grid.size[0] / 2, grid.size[1] / 2, grid.size[2] / 2),
    center: new Vector3(grid.min[0] + grid.size[0] / 2, grid.min[1] + grid.size[1] / 2, grid.min[2] + grid.size[2] / 2),
  };
  cache.set(kind, b);
  return b;
}

export class HoloVolume {
  readonly mesh: Mesh<BoxGeometry, ShaderMaterial>;
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
          uGain: { value: 50 },
          uTime: HOLO_TIME,
          uScanY: { value: -99 },
          uBands: { value: 150 },
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
  }
}
