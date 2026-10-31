/**
 * The opening. The room dims, sheets of paper drift down through the air and
 * gather on the mat, and the name appears above them. Then the room comes back
 * and the top sheet is your first puzzle. Shown once per session.
 */

import {
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector3,
} from '@iwsdk/core';
import { PAPER_SIZE } from '../fold/paper.js';
import { contentTexture, follow, INK, LAYER, setFont, Surface } from './glass.js';
import { LOOKS } from './levels.js';
import { sfx } from './sfx.js';

const SHEETS = 5;
/** Seconds a sheet takes to fall, and the gap between sheets. */
const FALL = 2.1;
const STAGGER = 0.42;
const GATHER = FALL + (SHEETS - 1) * STAGGER;
const TEXT_ON = 0.9;
const TEXT_OFF = GATHER + 1.3;
const END = TEXT_OFF + 0.55;

const W = 0.5;
const H = 0.135;

interface Sheet {
  mesh: Mesh;
  from: Vector3;
  spin: number;
  roll: number;
  fan: number;
  landed: boolean;
}

function ease(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export class TitleCard {
  /** The name, placed in the room facing the player. */
  readonly root = new Group();
  /** The falling paper, in the mat's frame. */
  readonly paper = new Group();
  /** Asks for the room to dim (0..1), read by the game each frame. */
  dim = 0;
  /** Told when the sheets have gathered, so the real paper can take over. */
  onGathered: (() => void) | null = null;
  private text: Surface;
  private tex: CanvasTexture;
  private sheets: Sheet[] = [];
  private t = -1;
  private k = 0;
  private gathered = false;

  constructor() {
    this.root.name = 'Title';
    this.paper.name = 'TitlePaper';
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = Math.round((2048 * H) / W);
    const g = c.getContext('2d')!;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = INK.primary;
    setFont(g, 268, 600, -7);
    g.fillText('Foldlings', c.width / 2, 212);
    g.fillStyle = 'rgba(255,255,255,0.78)';
    setFont(g, 66, 500, 0);
    g.fillText('Fold paper. Bring it to life.', c.width / 2, 450);
    this.tex = contentTexture(c);
    this.text = new Surface({ w: W, h: H, r: 0, body: 0, map: this.tex, order: LAYER.overlay });
    this.text.fade = 0;
    this.root.add(this.text.mesh);
    this.root.visible = false;

    const geo = new PlaneGeometry(PAPER_SIZE, PAPER_SIZE);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < SHEETS; i++) {
      const look = LOOKS[(i * 3 + 1) % LOOKS.length];
      const mat = new MeshStandardMaterial({ color: new Color(look.front), roughness: 0.86, side: DoubleSide });
      const mesh = new Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.visible = false;
      this.paper.add(mesh);
      const a = (i / SHEETS) * Math.PI * 2 + 0.6;
      this.sheets.push({
        mesh,
        from: new Vector3(Math.cos(a) * 0.32, 0.62 + i * 0.05, Math.sin(a) * 0.26),
        spin: (i % 2 ? 1 : -1) * (1.5 + i * 0.25),
        roll: (i % 2 ? -1 : 1) * 0.75,
        fan: (i - (SHEETS - 1) / 2) * 0.13,
        landed: false,
      });
    }
    this.paper.visible = false;
  }

  /** Dresses the top sheet in the first puzzle's colour, then begins. */
  play(topColor: string) {
    (this.sheets[SHEETS - 1].mesh.material as MeshStandardMaterial).color.set(topColor);
    this.t = 0;
    this.k = 0;
    this.gathered = false;
    this.root.visible = this.paper.visible = true;
    for (const s of this.sheets) s.landed = false;
    sfx.awaken();
  }

  get playing(): boolean {
    return this.t >= 0;
  }

  stop() {
    if (this.t >= 0 && !this.gathered) this.onGathered?.();
    this.t = -1;
    this.dim = 0;
    this.root.visible = this.paper.visible = false;
  }

  update(dt: number) {
    if (this.t < 0) return;
    this.t += dt;
    const t = this.t;

    this.dim = t < TEXT_OFF ? Math.min(1, t / 0.8) : Math.max(0, 1 - (t - TEXT_OFF) / 0.8);
    const on = t > TEXT_ON && t < TEXT_OFF;
    this.k = follow(this.k, on ? 1 : 0, on ? 3.4 : 7, dt);
    this.text.fade = this.k * this.k;
    this.text.mesh.position.y = (1 - this.k) * -0.012;
    this.text.mesh.scale.set(W * (0.97 + 0.03 * this.k), H * (0.97 + 0.03 * this.k), 1);

    for (let i = 0; i < SHEETS; i++) {
      const s = this.sheets[i];
      const u = Math.min(1, Math.max(0, (t - i * STAGGER) / FALL));
      s.mesh.visible = t > i * STAGGER && !this.gathered;
      if (!s.mesh.visible) continue;
      const e = ease(u);
      // Falls in a slow spiral, swaying less as it nears the mat.
      const sway = (1 - e) * Math.sin(u * 7 + i) * 0.05;
      const h = 0.0014 + i * 0.0006;
      s.mesh.position.set(s.from.x * (1 - e) + sway, h + s.from.y * (1 - e) * (1 - e), s.from.z * (1 - e) + sway * 0.6);
      const gather = Math.min(1, Math.max(0, (t - GATHER) / 0.5));
      s.mesh.rotation.set(
        Math.sin(u * 5 + i) * 0.55 * (1 - e),
        s.spin * (1 - e) + s.fan * (1 - gather * gather),
        s.roll * Math.sin(u * 4) * (1 - e),
      );
      if (u >= 1 && !s.landed) {
        s.landed = true;
        sfx.foldBeat(i + 1);
      }
    }
    if (!this.gathered && t > GATHER + 0.55) {
      this.gathered = true;
      this.onGathered?.();
      for (const s of this.sheets) s.mesh.visible = false;
    }
    if (t > END) this.stop();
  }
}
