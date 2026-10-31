/**
 * A quiet study at dusk for VR mode and the flat browser view: the last light
 * through a wide window, dust drifting in the beam, shelves for creatures to
 * live on. The light is painted into the walls, so the room costs almost nothing
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
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
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
  t.anisotropy = 4;
  return t;
}

function planks(): CanvasTexture {
  const [c, g] = canvas(1024, 1024);
  const tones = ['#4a3628', '#433024', '#513b2b', '#463326'];
  for (let i = 0; i < 8; i++) {
    g.fillStyle = tones[i % tones.length];
    g.fillRect(0, i * 128, 1024, 128);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(0, i * 128, 1024, 2);
    g.fillRect((i * 397) % 1024, i * 128, 2, 128);
    g.globalAlpha = 0.05;
    for (let k = 0; k < 60; k++) {
      g.fillStyle = k % 2 ? '#000' : '#fff';
      g.fillRect(Math.random() * 1024, i * 128 + Math.random() * 128, 80 + Math.random() * 200, 1);
    }
    g.globalAlpha = 1;
  }
  const t = texture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

/** Dusk through the window: deep blue overhead, a low sun, ridges fading away. */
function sky(): CanvasTexture {
  const [c, g] = canvas(1024, 720);
  const grad = g.createLinearGradient(0, 0, 0, 720);
  grad.addColorStop(0, '#1f2d55');
  grad.addColorStop(0.38, '#5b4f86');
  grad.addColorStop(0.62, '#d9778a');
  grad.addColorStop(0.8, '#ffb778');
  grad.addColorStop(1, '#ffd9a0');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 720);
  const sun = g.createRadialGradient(380, 560, 8, 380, 560, 340);
  sun.addColorStop(0, 'rgba(255,240,205,1)');
  sun.addColorStop(0.08, 'rgba(255,214,150,0.85)');
  sun.addColorStop(1, 'rgba(255,170,110,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, 1024, 720);
  const ridges: [string, number, number][] = [
    ['#a76a7c', 590, 30],
    ['#70506f', 625, 42],
    ['#3e3454', 668, 34],
  ];
  ridges.forEach(([col, y, amp], i) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, 720);
    for (let x = 0; x <= 1024; x += 8) {
      g.lineTo(x, y - Math.sin(x / (120 + i * 40) + i * 2) * amp - Math.cos(x / (47 + i * 11) + i) * amp * 0.28);
    }
    g.lineTo(1024, 720);
    g.fill();
  });
  return texture(c);
}

/** Plaster with the room's light painted in; `beam` adds the window's glow. */
function plaster(beam: 'none' | 'left' | 'floor'): CanvasTexture {
  const [c, g] = canvas(1024, 532);
  const v = g.createLinearGradient(0, 0, 0, 532);
  v.addColorStop(0, '#6f6159');
  v.addColorStop(0.55, '#7d6c60');
  v.addColorStop(1, '#4b4039');
  g.fillStyle = v;
  g.fillRect(0, 0, 1024, 532);
  // Corners fall into shade.
  for (const [x0, x1] of [[0, 170], [1024, 854]]) {
    const h = g.createLinearGradient(x0, 0, x1, 0);
    h.addColorStop(0, 'rgba(20,14,12,0.42)');
    h.addColorStop(1, 'rgba(20,14,12,0)');
    g.fillStyle = h;
    g.fillRect(0, 0, 1024, 532);
  }
  if (beam === 'left') {
    // The window's light lands on this wall as two skewed panes.
    g.filter = 'blur(16px)';
    g.fillStyle = 'rgba(255,176,112,0.62)';
    for (const [x, w] of [[300, 118], [440, 118]]) {
      g.beginPath();
      g.moveTo(x, 120 + (x - 300) * 0.18);
      g.lineTo(x + w, 150 + (x - 300) * 0.18);
      g.lineTo(x + w, 400 + (x - 300) * 0.06);
      g.lineTo(x, 380 + (x - 300) * 0.06);
      g.fill();
    }
    g.filter = 'none';
  }
  g.globalAlpha = 0.014;
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = i % 2 ? '#fff' : '#000';
    g.fillRect(Math.random() * 1024, Math.random() * 532, 2, 2);
  }
  g.globalAlpha = 1;
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

/** Motes of dust hanging in the window's light, moved entirely in the shader. */
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
        gl_FragColor = vec4(vec3(1.0, 0.82, 0.62) * max(vA, 0.0) * (1.0 - d * d), 1.0);
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
    const painted = (map: CanvasTexture) => new MeshBasicMaterial({ map, toneMapped: false });
    const plain = painted(plaster('none'));
    const lit = painted(plaster('left'));
    const trim = new MeshBasicMaterial({ color: new Color(0x3a312b), toneMapped: false });
    const wood = new MeshStandardMaterial({ color: new Color(0x5b4230), roughness: 0.7 });

    const floor = new Mesh(new PlaneGeometry(ROOM, ROOM), new MeshStandardMaterial({ map: planks(), color: new Color(0x8f8f8f), roughness: 0.55 }));
    floor.rotation.x = -Math.PI / 2;
    this.root.add(floor);
    const ceiling = new Mesh(new PlaneGeometry(ROOM, ROOM), new MeshBasicMaterial({ color: 0x2f2925, toneMapped: false }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = HEIGHT;
    this.root.add(ceiling);

    const h = ROOM / 2;
    const walls: [number, number, number, MeshBasicMaterial][] = [
      [0, -h, 0, plain],
      [h, 0, -Math.PI / 2, lit],
      [0, h, Math.PI, plain],
      [-h, 0, Math.PI / 2, plain],
    ];
    for (const [x, z, ry, mat] of walls) {
      const w = new Mesh(new PlaneGeometry(ROOM, HEIGHT), mat);
      w.position.set(x, HEIGHT / 2, z);
      w.rotation.y = ry;
      this.root.add(w);
      const skirting = new Mesh(new BoxGeometry(ROOM, 0.09, 0.02), trim);
      skirting.position.set(x, 0.045, z);
      skirting.rotation.y = ry;
      skirting.translateZ(0.01);
      this.root.add(skirting);
    }

    // A wide window on the front wall, the room's one source of light.
    const win = new Mesh(new PlaneGeometry(2.1, 1.48), new MeshBasicMaterial({ map: sky(), toneMapped: false }));
    win.position.set(0, 1.5, -h + 0.01);
    this.root.add(win);
    const frameParts: [number, number, number, number][] = [
      [0, 2.25, 2.16, 0.035],
      [0, 0.75, 2.16, 0.035],
      [-1.06, 1.5, 0.035, 1.53],
      [1.06, 1.5, 0.035, 1.53],
      [0, 1.5, 0.022, 1.48],
    ];
    for (const [x, y, w, hh] of frameParts) {
      const f = new Mesh(new BoxGeometry(w, hh, 0.05), trim);
      f.position.set(x, y, -h + 0.025);
      this.root.add(f);
    }
    // The evening's glow pooling on the floor below the window.
    const pool = new Mesh(
      new PlaneGeometry(2.8, 2.4),
      new MeshBasicMaterial({ map: softDisc('rgba(255,172,110,0.3)'), transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.002, -1.5);
    this.root.add(pool);
    const halo = new Mesh(
      new PlaneGeometry(3.6, 3),
      new MeshBasicMaterial({ map: softDisc('rgba(255,180,120,0.3)'), transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }),
    );
    halo.position.set(-0.2, 1.3, -h + 0.03);
    this.root.add(halo);

    // Shelves: homes for creatures that like to perch.
    const shelf = (x: number, y: number, z: number, ry: number, w: number) => {
      const s = new Mesh(new BoxGeometry(w, 0.03, 0.22), wood);
      s.position.set(x, y, z);
      s.rotation.y = ry;
      this.root.add(s);
      this.shelves.push({ center: new Vector3(x, y + 0.016, z), w, d: 0.22 });
    };
    shelf(-1.75, 1.25, -h + 0.12, 0, 0.9);
    shelf(1.75, 1.05, -h + 0.12, 0, 0.9);
    shelf(1.75, 1.6, -h + 0.12, 0, 0.9);
    shelf(-h + 0.12, 1.15, -0.9, Math.PI / 2, 0.22);
    // A few books at one end of each wall shelf; creatures take the rest.
    const spines = [0x8e3b32, 0x2f4858, 0xc9a35f, 0x4f6a57, 0xd8cdbd, 0x3a3a44];
    const bookGeo = new BoxGeometry(1, 1, 1);
    const books: [number, number, number][] = [[-2.1, 1.267, -h + 0.12], [2.1, 1.067, -h + 0.12], [1.42, 1.617, -h + 0.12]];
    books.forEach(([x0, y, z], k) => {
      let x = x0;
      for (let i = 0; i < 5; i++) {
        const bh = 0.17 + ((i * 37 + k * 11) % 7) * 0.012;
        const bw = 0.026 + ((i * 13) % 3) * 0.006;
        const b = new Mesh(bookGeo, new MeshStandardMaterial({ color: spines[(i + k * 2) % spines.length], roughness: 0.75 }));
        b.scale.set(bw, bh, 0.15);
        b.position.set(x, y + bh / 2, z);
        this.root.add(b);
        x += bw + 0.002;
      }
    });
    // Low cabinet on the right.
    const cab = new Mesh(new BoxGeometry(0.5, 0.6, 1.3), wood);
    cab.position.set(h - 0.28, 0.3, -0.6);
    this.root.add(cab);
    this.shelves.push({ center: new Vector3(h - 0.28, 0.601, -0.6), w: 0.42, d: 1.2 });

    // A pendant lamp, warm against the dusk.
    const cord = new Mesh(new CylinderGeometry(0.003, 0.003, 0.72, 6), trim);
    cord.position.set(0.9, HEIGHT - 0.36, -1.15);
    const globe = new Mesh(new SphereGeometry(0.075, 24, 16), new MeshBasicMaterial({ color: new Color(1.0, 0.86, 0.66), toneMapped: false }));
    globe.position.set(0.9, HEIGHT - 0.78, -1.15);
    const glow = new Mesh(
      new PlaneGeometry(1.1, 1.1),
      new MeshBasicMaterial({ map: softDisc('rgba(255,200,140,0.5)'), transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }),
    );
    glow.position.copy(globe.position);
    glow.position.z -= 0.09;
    this.root.add(cord, globe, glow, this.dust);
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

function walnut(): CanvasTexture {
  const [c, g] = canvas(1024, 640);
  g.fillStyle = '#54392a';
  g.fillRect(0, 0, 1024, 640);
  g.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const y = Math.random() * 640;
    g.strokeStyle = i % 3 ? 'rgba(25,14,8,0.14)' : 'rgba(170,120,80,0.08)';
    g.lineWidth = 0.6 + Math.random() * 1.8;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(340, y + Math.random() * 18 - 9, 680, y + Math.random() * 18 - 9, 1024, y + Math.random() * 10 - 5);
    g.stroke();
  }
  return texture(c);
}

/** A walnut desk that sits under the mat when there is no real table. */
export function makeDesk(): Group {
  const g = new Group();
  g.name = 'Desk';
  const wood = new MeshStandardMaterial({ map: walnut(), roughness: 0.48, metalness: 0 });
  const steel = new MeshStandardMaterial({ color: new Color(0x18181b), roughness: 0.42, metalness: 0.6 });
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
