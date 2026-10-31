/**
 * Room scan: when the mat looks for a table, every detected surface lights up
 * with a holographic grid swept outwards from the player, labelled with what
 * the headset thinks it is and how big it is. Shown on entering passthrough
 * and whenever the player recentres.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { INK, setFont } from './glass.js';
import type { Surface } from './room.js';

const DURATION = 4.2;

const vertex = /* glsl */ `
attribute vec2 surf;
varying vec2 vSurf;
varying vec3 vWorld;
void main() {
  vSurf = surf;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const fragment = /* glsl */ `
uniform vec3 color;
uniform vec3 origin;
uniform float radius;
uniform float fade;
uniform float boost;
varying vec2 vSurf;
varying vec3 vWorld;
void main() {
  float d = length(vWorld.xz - origin.xz);
  if (d > radius) discard;
  float behind = radius - d;
  float wave = exp(-pow(behind * 4.2, 2.0));
  // Fine dots that catch the light as the wave passes, then settle.
  vec2 g = fract(vSurf * 20.0) - 0.5;
  float dots = 1.0 - smoothstep(0.05, 0.13, length(g));
  float tail = exp(-behind * 1.5);
  float a = (0.13 * wave + dots * (0.07 + 0.8 * tail)) * fade * boost;
  gl_FragColor = vec4(color, a);
}`;

function labelTexture(text: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d')!;
  setFont(g, 44, 500);
  const w = Math.min(500, g.measureText(text).width + 64);
  const x = (512 - w) / 2;
  g.fillStyle = 'rgba(28,29,34,0.66)';
  g.beginPath();
  g.roundRect(x, 12, w, 72, 36);
  g.fill();
  const rim = g.createLinearGradient(0, 12, 0, 84);
  rim.addColorStop(0, 'rgba(255,255,255,0.55)');
  rim.addColorStop(1, 'rgba(255,255,255,0.08)');
  g.strokeStyle = rim;
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = INK.primary;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 49);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function niceLabel(s: Surface): string {
  const raw = (s.label || s.kind).replace(/_/g, ' ');
  return raw[0].toUpperCase() + raw.slice(1);
}

interface Item {
  mesh: Mesh;
  mat: ShaderMaterial;
  label: Sprite | null;
  chosen: boolean;
}

export class RoomScan {
  readonly root = new Group();
  private items: Item[] = [];
  private t = -1;
  private origin = new Vector3();

  constructor() {
    this.root.name = 'RoomScan';
    this.root.renderOrder = 80;
  }

  get active(): boolean {
    return this.t >= 0;
  }

  /** Lights up `surfaces`, sweeping from `origin`; `chosen` stays bright longest. */
  start(surfaces: Surface[], origin: Vector3, chosen: Vector3 | null) {
    this.clear();
    this.origin.copy(origin);
    // Label only the nearest few so a busy room does not become a wall of text.
    const labelled = new Set(
      [...surfaces]
        .filter((s) => s.kind !== 'floor')
        .sort((a, b) => a.center.distanceTo(origin) - b.center.distanceTo(origin))
        .slice(0, 5),
    );
    for (const s of surfaces) {
      if (s.polygon.length < 3) continue;
      const pos: number[] = [];
      const surf: number[] = [];
      // Surface-local 2D coordinates (metres) for the grid.
      const u = s.kind === 'wall' ? new Vector3(-s.normal.z, 0, s.normal.x).normalize() : new Vector3(1, 0, 0);
      const v = s.kind === 'wall' ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
      const lift = s.normal.clone().multiplyScalar(s.kind === 'wall' ? 0.004 : 0.0012);
      const push = (p: Vector3) => {
        pos.push(p.x + lift.x, p.y + lift.y, p.z + lift.z);
        surf.push(p.dot(u), p.dot(v));
      };
      for (let i = 1; i < s.polygon.length - 1; i++) {
        push(s.polygon[0]);
        push(s.polygon[i]);
        push(s.polygon[i + 1]);
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.setAttribute('surf', new Float32BufferAttribute(surf, 2));
      const isChosen =
        chosen !== null &&
        s.kind === 'table' &&
        Math.abs(s.center.y - chosen.y) < 0.05 &&
        s.polygon.some((p) => p.distanceTo(chosen) < 2);
      const mat = new ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
        uniforms: {
          color: { value: new Color(isChosen ? 0xffe2a8 : 0xffffff) },
          origin: { value: this.origin },
          radius: { value: 0 },
          fade: { value: 1 },
          boost: { value: isChosen ? 1.3 : 1 },
        },
      });
      const mesh = new Mesh(g, mat);
      mesh.renderOrder = 80;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      let label: Sprite | null = null;
      if (labelled.has(s) || (s.kind === 'floor' && surfaces.length < 4)) {
        label = new Sprite(
          new SpriteMaterial({ map: labelTexture(niceLabel(s)), transparent: true, depthWrite: false, depthTest: false }),
        );
        label.scale.set(0.26, 0.049, 1);
        label.position.copy(s.center).addScaledVector(s.normal, s.kind === 'wall' ? 0.05 : 0.09);
        label.renderOrder = 81;
        label.visible = false;
        this.root.add(label);
      }
      this.items.push({ mesh, mat, label, chosen: isChosen });
    }
    this.t = 0;
  }

  private clear() {
    for (const it of this.items) {
      this.root.remove(it.mesh);
      it.mesh.geometry.dispose();
      it.mat.dispose();
      if (it.label) {
        this.root.remove(it.label);
        (it.label.material as SpriteMaterial).map?.dispose();
        it.label.material.dispose();
      }
    }
    this.items = [];
  }

  update(dt: number) {
    if (this.t < 0) return;
    this.t += dt;
    const radius = Math.min(8, this.t * 3.2);
    for (const it of this.items) {
      const end = it.chosen ? DURATION : DURATION - 0.8;
      const fade = this.t < end - 1.2 ? 1 : Math.max(0, (end - this.t) / 1.2);
      it.mat.uniforms.radius.value = radius;
      it.mat.uniforms.fade.value = fade;
      if (it.label) {
        const d = Math.hypot(it.label.position.x - this.origin.x, it.label.position.z - this.origin.z);
        it.label.visible = d < radius && fade > 0.02;
        (it.label.material as SpriteMaterial).opacity = fade;
      }
    }
    if (this.t > DURATION) {
      this.clear();
      this.t = -1;
    }
  }
}
