/**
 * A small warm study for VR mode and the flat browser view: wooden floor,
 * window, shelves for creatures to live on. Hidden in passthrough, where the
 * player's own room takes its place.
 */

import {
  BoxGeometry,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import type { Surface } from './room.js';

const ROOM = 5.2;
const HEIGHT = 2.7;

function planks(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const tones = ['#b98a5e', '#a97b52', '#c29466', '#b08156'];
  for (let i = 0; i < 8; i++) {
    g.fillStyle = tones[i % tones.length];
    g.fillRect(0, i * 64, 512, 64);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, i * 64, 512, 2);
    const off = (i * 197) % 512;
    g.fillRect(off, i * 64, 2, 64);
    g.globalAlpha = 0.06;
    for (let k = 0; k < 30; k++) {
      g.fillStyle = k % 2 ? '#000' : '#fff';
      g.fillRect(Math.random() * 512, i * 64 + Math.random() * 64, 40 + Math.random() * 80, 1);
    }
    g.globalAlpha = 1;
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(4, 4);
  return t;
}

function sky(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#8fc3ea');
  grad.addColorStop(0.7, '#f7d9b0');
  grad.addColorStop(1, '#f2b880');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  // Distant hills.
  g.fillStyle = '#7da37e';
  g.beginPath();
  g.moveTo(0, 210);
  for (let x = 0; x <= 256; x += 16) g.lineTo(x, 200 - Math.sin(x / 40) * 18 - Math.cos(x / 23) * 8);
  g.lineTo(256, 256);
  g.lineTo(0, 256);
  g.fill();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class VirtualRoom {
  readonly root = new Group();
  private shelves: { center: Vector3; w: number; d: number }[] = [];

  constructor() {
    this.root.name = 'VirtualRoom';
    const wall = new MeshLambertMaterial({ color: new Color(0xefe4d2) });
    const trim = new MeshLambertMaterial({ color: new Color(0xd9c7ab) });
    const wood = new MeshLambertMaterial({ color: new Color(0x9b6f48) });

    const floor = new Mesh(new PlaneGeometry(ROOM, ROOM), new MeshLambertMaterial({ map: planks() }));
    floor.rotation.x = -Math.PI / 2;
    this.root.add(floor);
    const ceiling = new Mesh(new PlaneGeometry(ROOM, ROOM), new MeshLambertMaterial({ color: 0xf6efe4 }));
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
      const w = new Mesh(new PlaneGeometry(ROOM, HEIGHT), wall);
      w.position.set(x, HEIGHT / 2, z);
      w.rotation.y = ry;
      this.root.add(w);
      const skirting = new Mesh(new BoxGeometry(ROOM, 0.1, 0.02), trim);
      skirting.position.set(x, 0.05, z);
      skirting.rotation.y = ry;
      skirting.translateZ(0.01);
      this.root.add(skirting);
    }

    // Window on the front wall, with a soft sunset outside.
    const win = new Mesh(new PlaneGeometry(1.6, 1.0), new MeshBasicMaterial({ map: sky() }));
    win.position.set(0, 1.55, -h + 0.01);
    this.root.add(win);
    const frameParts: [number, number, number, number][] = [
      [0, 2.07, 1.7, 0.06],
      [0, 1.03, 1.7, 0.06],
      [-0.82, 1.55, 0.06, 1.06],
      [0.82, 1.55, 0.06, 1.06],
      [0, 1.55, 0.04, 1.0],
    ];
    for (const [x, y, w, hh] of frameParts) {
      const f = new Mesh(new BoxGeometry(w, hh, 0.05), trim);
      f.position.set(x, y, -h + 0.025);
      this.root.add(f);
    }

    // Shelves: homes for creatures that like to perch.
    const shelf = (x: number, y: number, z: number, ry: number, w: number) => {
      const s = new Mesh(new BoxGeometry(w, 0.03, 0.22), wood);
      s.position.set(x, y, z);
      s.rotation.y = ry;
      this.root.add(s);
      this.shelves.push({ center: new Vector3(x, y + 0.016, z), w, d: 0.22 });
    };
    shelf(-1.55, 1.25, -h + 0.12, 0, 0.9);
    shelf(1.55, 1.05, -h + 0.12, 0, 0.9);
    shelf(1.55, 1.6, -h + 0.12, 0, 0.9);
    shelf(-h + 0.12, 1.15, -0.9, Math.PI / 2, 0.22);
    // Low cabinet on the right.
    const cab = new Mesh(new BoxGeometry(0.5, 0.6, 1.3), wood);
    cab.position.set(h - 0.28, 0.3, -0.6);
    this.root.add(cab);
    this.shelves.push({ center: new Vector3(h - 0.28, 0.601, -0.6), w: 0.42, d: 1.2 });
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

/** A wooden desk that sits under the mat when there is no real table. */
export function makeDesk(): Group {
  const g = new Group();
  g.name = 'Desk';
  const wood = new MeshLambertMaterial({ color: new Color(0x8a5f3c) });
  const top = new Mesh(new BoxGeometry(1.0, 0.035, 0.62), wood);
  top.receiveShadow = true;
  top.position.y = -0.02;
  g.add(top);
  const legGeo = new BoxGeometry(0.045, 1, 0.045);
  for (const [x, z] of [
    [-0.46, -0.27],
    [0.46, -0.27],
    [-0.46, 0.27],
    [0.46, 0.27],
  ]) {
    const leg = new Mesh(legGeo, wood);
    leg.position.set(x, -0.5, z);
    leg.name = 'DeskLeg';
    g.add(leg);
  }
  return g;
}
