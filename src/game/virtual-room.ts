/**
 * A dark operating theatre for VR mode and the flat browser view: a gridded
 * floor, light strips in the walls, a surgical lamp overhead and shelves for
 * creatures to live on. The light is painted in, so the room costs almost nothing
 * to draw. Hidden in passthrough, where the player's own room takes its place.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  RingGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import type { Surface } from './room.js';

const ROOM = 5.2;
const HEIGHT = 2.7;
const DUST = 70;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A polished dark floor: a fine grid, and a pool of light under the table. */
function floorMap(): CanvasTexture {
  const [c, g] = canvas(2048, 2048);
  g.fillStyle = '#04080c';
  g.fillRect(0, 0, 2048, 2048);
  const pool = g.createRadialGradient(1024, 880, 40, 1024, 880, 900);
  pool.addColorStop(0, 'rgba(40,130,180,0.42)');
  pool.addColorStop(0.5, 'rgba(20,70,100,0.16)');
  pool.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = pool;
  g.fillRect(0, 0, 2048, 2048);
  const step = 2048 / 26;
  for (let i = 0; i <= 26; i++) {
    g.strokeStyle = i % 5 === 0 ? 'rgba(90,200,250,0.2)' : 'rgba(90,200,250,0.07)';
    g.lineWidth = i % 5 === 0 ? 2 : 1;
    g.beginPath();
    g.moveTo(i * step, 0);
    g.lineTo(i * step, 2048);
    g.moveTo(0, i * step);
    g.lineTo(2048, i * step);
    g.stroke();
  }
  return texture(c);
}

/** A wall of dark panels with a strip of light running through it. */
function wallMap(): CanvasTexture {
  const [c, g] = canvas(2048, 1064);
  const v = g.createLinearGradient(0, 0, 0, 1064);
  v.addColorStop(0, '#060c12');
  v.addColorStop(0.55, '#0a151d');
  v.addColorStop(1, '#040709');
  g.fillStyle = v;
  g.fillRect(0, 0, 2048, 1064);
  g.strokeStyle = 'rgba(100,190,235,0.13)';
  g.lineWidth = 2;
  for (let x = 0; x <= 2048; x += 2048 / 8) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 1064);
    g.stroke();
  }
  // The strip, with light spilling from it onto the panels.
  const y = 372;
  const spill = g.createLinearGradient(0, y - 150, 0, y + 150);
  spill.addColorStop(0, 'rgba(50,160,220,0)');
  spill.addColorStop(0.5, 'rgba(50,160,220,0.3)');
  spill.addColorStop(1, 'rgba(50,160,220,0)');
  g.fillStyle = spill;
  g.fillRect(0, y - 150, 2048, 300);
  g.fillStyle = 'rgba(170,235,255,0.95)';
  g.fillRect(0, y - 3, 2048, 6);
  // Corners fall into shade.
  for (const [x0, x1] of [[0, 300], [2048, 1748]]) {
    const h = g.createLinearGradient(x0, 0, x1, 0);
    h.addColorStop(0, 'rgba(0,0,0,0.72)');
    h.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = h;
    g.fillRect(0, 0, 2048, 1064);
  }
  return texture(c);
}

function softDisc(inner: string): CanvasTexture {
  const [c, g] = canvas(128, 128);
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, inner);
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return texture(c);
}

/** Motes of dust hanging in the projector's light, moved entirely in the shader. */
function makeDust(): Points<BufferGeometry, ShaderMaterial> {
  const pos: number[] = [];
  const seed: number[] = [];
  for (let i = 0; i < DUST; i++) {
    pos.push(-1.6 + Math.random() * 2.6, 0.5 + Math.random() * 1.9, -2.3 + Math.random() * 2.6);
    seed.push(Math.random() * 6.28, 0.5 + Math.random());
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('seed', new Float32BufferAttribute(seed, 2));
  const m = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec2 seed;
      uniform float uTime;
      varying float vA;
      void main() {
        vec3 p = position;
        float t = uTime * 0.12 * seed.y;
        p += vec3(sin(t + seed.x) * 0.16, sin(t * 0.7 + seed.x * 2.0) * 0.1, cos(t * 0.9 + seed.x) * 0.16);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(4.5 * seed.y / -mv.z, 1.0, 4.5);
        vA = 0.22 + 0.2 * sin(uTime * 0.5 * seed.y + seed.x);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(vec3(0.5, 0.85, 1.0) * max(vA, 0.0) * (1.0 - d * d), 1.0);
      }`,
  });
  const points = new Points(g, m);
  points.frustumCulled = false;
  points.name = 'Dust';
  return points;
}

export class VirtualRoom {
  readonly root = new Group();
  private shelves: { center: Vector3; w: number; d: number }[] = [];
  private dust = makeDust();
  private clock = 0;

  constructor() {
    this.root.name = 'VirtualRoom';
    const panels = new MeshBasicMaterial({ map: wallMap(), toneMapped: false });
    const trim = new MeshBasicMaterial({ color: new Color(0x0a1218), toneMapped: false });
    const steel = new MeshStandardMaterial({ color: new Color(0x1a2a34), roughness: 0.45, metalness: 0.5 });
    const strip = new MeshBasicMaterial({ color: new Color(0.6, 0.92, 1), toneMapped: false });

    const floor = new Mesh(new PlaneGeometry(ROOM, ROOM), new MeshBasicMaterial({ map: floorMap(), toneMapped: false }));
    floor.rotation.x = -Math.PI / 2;
    this.root.add(floor);
    const ceiling = new Mesh(new PlaneGeometry(ROOM, ROOM), new MeshBasicMaterial({ color: 0x05090d, toneMapped: false }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = HEIGHT;
    this.root.add(ceiling);

    const h = ROOM / 2;
    const walls: [number, number, number][] = [
      [0, -h, 0],
      [h, 0, -Math.PI / 2],
      [0, h, Math.PI],
      [-h, 0, Math.PI / 2],
    ];
    for (const [x, z, ry] of walls) {
      const w = new Mesh(new PlaneGeometry(ROOM, HEIGHT), panels);
      w.position.set(x, HEIGHT / 2, z);
      w.rotation.y = ry;
      this.root.add(w);
      const skirting = new Mesh(new BoxGeometry(ROOM, 0.05, 0.02), trim);
      skirting.position.set(x, 0.025, z);
      skirting.rotation.y = ry;
      skirting.translateZ(0.01);
      this.root.add(skirting);
    }

    // The surgical lamp overhead: rings of light, with a soft cone below.
    const lamp = new Group();
    lamp.position.set(0, HEIGHT - 0.42, -1.1);
    const disc = new Mesh(new CylinderGeometry(0.42, 0.46, 0.05, 48), new MeshBasicMaterial({ color: 0x0c151c, toneMapped: false }));
    lamp.add(disc);
    for (const [r0, r1] of [[0.34, 0.385], [0.2, 0.24], [0.07, 0.11]]) {
      const ring = new Mesh(new RingGeometry(r0, r1, 64), strip);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.028;
      lamp.add(ring);
    }
    const stem = new Mesh(new CylinderGeometry(0.018, 0.018, 0.44, 12), trim);
    stem.position.y = 0.22;
    lamp.add(stem);
    this.root.add(lamp);
    const halo = new Mesh(
      new PlaneGeometry(1.6, 1.6),
      new MeshBasicMaterial({ map: softDisc('rgba(90,190,250,0.3)'), transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.set(0, HEIGHT - 0.5, -1.1);
    this.root.add(halo);

    // Shelves: homes for creatures that like to perch, each lit from beneath.
    const shelf = (x: number, y: number, z: number, ry: number, w: number) => {
      const s = new Mesh(new BoxGeometry(w, 0.03, 0.22), steel);
      s.position.set(x, y, z);
      s.rotation.y = ry;
      this.root.add(s);
      const glow = new Mesh(new BoxGeometry(w * 0.96, 0.004, 0.012), strip);
      glow.position.set(x, y - 0.017, z);
      glow.rotation.y = ry;
      glow.translateZ(0.1);
      this.root.add(glow);
      this.shelves.push({ center: new Vector3(x, y + 0.016, z), w, d: 0.22 });
    };
    shelf(-1.75, 1.25, -h + 0.12, 0, 0.9);
    shelf(1.75, 1.05, -h + 0.12, 0, 0.9);
    shelf(1.75, 1.6, -h + 0.12, 0, 0.9);
    shelf(-h + 0.12, 1.15, -0.9, Math.PI / 2, 0.22);
    // Low cabinet on the right.
    const cab = new Mesh(new BoxGeometry(0.5, 0.6, 1.3), steel);
    cab.position.set(h - 0.28, 0.3, -0.6);
    this.root.add(cab);
    this.shelves.push({ center: new Vector3(h - 0.28, 0.601, -0.6), w: 0.42, d: 1.2 });
    this.root.add(this.dust);
  }

  update(dt: number) {
    if (!this.root.visible) return;
    this.clock += dt;
    this.dust.material.uniforms.uTime.value = this.clock;
  }

  /** Surfaces creatures can settle on, like a scanned room provides. */
  surfaces(): Surface[] {
    const out: Surface[] = [];
    const up = new Vector3(0, 1, 0);
    const rect = (c: Vector3, w: number, d: number) => [
      new Vector3(c.x - w / 2, c.y, c.z - d / 2),
      new Vector3(c.x + w / 2, c.y, c.z - d / 2),
      new Vector3(c.x + w / 2, c.y, c.z + d / 2),
      new Vector3(c.x - w / 2, c.y, c.z + d / 2),
    ];
    for (const s of this.shelves) {
      const wide = s.w > s.d ? s.w : s.d;
      const narrow = s.w > s.d ? s.d : s.w;
      const alongX = s.w >= s.d;
      out.push({
        kind: 'table',
        label: 'shelf',
        polygon: rect(s.center, alongX ? wide : narrow, alongX ? narrow : wide),
        normal: up.clone(),
        center: s.center.clone(),
      });
    }
    const fc = new Vector3(0, 0.001, 0);
    out.push({ kind: 'floor', label: 'floor', polygon: rect(fc, ROOM - 0.4, ROOM - 0.4), normal: up.clone(), center: fc });
    const h = ROOM / 2;
    const wallZ = new Vector3(0, 1.4, -h + 0.005);
    out.push({
      kind: 'wall',
      label: 'wall',
      polygon: [
        new Vector3(-h + 0.3, 0.2, wallZ.z),
        new Vector3(h - 0.3, 0.2, wallZ.z),
        new Vector3(h - 0.3, 2.4, wallZ.z),
        new Vector3(-h + 0.3, 2.4, wallZ.z),
      ],
      normal: new Vector3(0, 0, 1),
      center: wallZ,
    });
    return out;
  }
}

/** A dark steel table that sits under the mat when there is no real one. */
export function makeDesk(): Group {
  const g = new Group();
  g.name = 'Desk';
  const wood = new MeshStandardMaterial({ color: new Color(0x0d171e), roughness: 0.38, metalness: 0.6 });
  const steel = new MeshStandardMaterial({ color: new Color(0x12202a), roughness: 0.42, metalness: 0.6 });
  const top = new Mesh(new BoxGeometry(1.0, 0.03, 0.62), wood);
  top.receiveShadow = true;
  top.position.y = -0.0175;
  g.add(top);
  const legGeo = new BoxGeometry(0.022, 1, 0.022);
  for (const [x, z] of [
    [-0.46, -0.27],
    [0.46, -0.27],
    [-0.46, 0.27],
    [0.46, 0.27],
  ]) {
    const leg = new Mesh(legGeo, steel);
    leg.position.set(x, -0.5, z);
    leg.name = 'DeskLeg';
    g.add(leg);
  }
  return g;
}
