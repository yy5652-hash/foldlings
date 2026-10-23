/**
 * The ghost guide: a translucent flap and a pair of pinching fingertips that
 * demonstrate the next fold right on the paper. It teaches without a wall of
 * text and doubles as the hint.
 */

import {
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { lineSide, V2 } from '../fold/geom.js';
import { creaseLine, FoldSpec, PaperState, splitPaper } from '../fold/paper.js';
import { stackHeights, facetGeometry, LAYER_GAP, BASE_HEIGHT } from './paper-view.js';

const LOOP = 2.6;

export class Guide {
  readonly root = new Group();
  private flapPivot = new Group();
  private flapInner = new Group();
  private crease: Mesh;
  private thumb: Mesh;
  private index: Mesh;
  private ghostMat = new MeshBasicMaterial({
    color: new Color(0xffffff),
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  private t = 0;
  private active = false;
  private fade = 0;
  private axis = new Vector3();
  private sign: 1 | -1 = 1;
  /** Grab point on the moving part (board space) and its distance to the crease. */
  private grab: V2 = { x: 0, y: 0 };
  private q = new Quaternion();
  private v = new Vector3();
  private caption: Mesh;
  private captionCanvas: HTMLCanvasElement;
  private captionTex: CanvasTexture;
  private captionText = '';

  constructor() {
    this.root.name = 'Guide';
    this.root.add(this.flapPivot);
    this.flapPivot.add(this.flapInner);
    this.flapPivot.renderOrder = 60;
    this.crease = new Mesh(
      new PlaneGeometry(1, 0.004),
      new MeshBasicMaterial({ color: 0xffd166, transparent: true, depthWrite: false }),
    );
    this.crease.renderOrder = 61;
    this.root.add(this.crease);
    const tip = new SphereGeometry(0.0065, 16, 12);
    const tipMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
    this.thumb = new Mesh(tip, tipMat);
    this.index = new Mesh(tip, tipMat);
    this.thumb.renderOrder = this.index.renderOrder = 62;
    this.root.add(this.thumb, this.index);

    this.captionCanvas = document.createElement('canvas');
    this.captionCanvas.width = 1024;
    this.captionCanvas.height = 128;
    this.captionTex = new CanvasTexture(this.captionCanvas);
    this.captionTex.colorSpace = SRGBColorSpace;
    this.caption = new Mesh(
      new PlaneGeometry(0.36, 0.045),
      new MeshBasicMaterial({ map: this.captionTex, transparent: true, depthWrite: false }),
    );
    // Stands at the far edge of the mat, leaning back towards the player.
    this.caption.position.set(0.04, 0.05, -0.245);
    this.caption.rotation.x = -0.45;
    this.caption.renderOrder = 63;
    this.root.add(this.caption);
    this.root.visible = false;
  }

  setCaption(text: string) {
    if (text === this.captionText) return;
    this.captionText = text;
    const g = this.captionCanvas.getContext('2d')!;
    g.clearRect(0, 0, 1024, 128);
    if (text) {
      g.font = '600 52px system-ui, -apple-system, Segoe UI, sans-serif';
      const w = Math.min(1000, g.measureText(text).width + 80);
      g.fillStyle = 'rgba(20,28,26,0.78)';
      g.beginPath();
      g.roundRect((1024 - w) / 2, 14, w, 100, 50);
      g.fill();
      g.fillStyle = '#fbf6ec';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 512, 66);
    }
    this.captionTex.needsUpdate = true;
  }

  /** Starts demonstrating `fold` on `paper`; returns false if it is not a valid fold. */
  show(paper: PaperState, fold: FoldSpec): boolean {
    const line = creaseLine(fold);
    const parts = splitPaper(paper, line, fold.s);
    if (!parts) return false;
    this.sign = fold.s;
    for (const c of [...this.flapInner.children]) {
      this.flapInner.remove(c);
      (c as Mesh).geometry.dispose();
    }
    const heights = stackHeights([...parts.stay, ...parts.move]);
    let top = 0;
    for (const h of heights) top = Math.max(top, h);
    const hingeY = BASE_HEIGHT + (top + 1.5) * LAYER_GAP;
    const fx = line.nx * line.d;
    const fy = line.ny * line.d;
    this.flapPivot.position.set(fx, hingeY, -fy);
    this.flapInner.position.set(-fx, -hingeY, fy);
    for (const f of parts.move) {
      const m = new Mesh(facetGeometry(f, hingeY), this.ghostMat);
      m.renderOrder = 60;
      this.flapInner.add(m);
    }
    this.axis.set(-line.ny, 0, -line.nx).normalize();
    // Grab the moving-part vertex farthest from the crease: usually a corner.
    let best = 0;
    for (const f of parts.move) {
      for (const p of f.poly) {
        const d = fold.s * lineSide(line, p);
        if (d > best) {
          best = d;
          this.grab = { x: p.x, y: p.y };
        }
      }
    }
    this.crease.position.set(fx, hingeY + 0.0005, -fy);
    this.crease.scale.set(0.5, 1, 1);
    this.crease.rotation.set(-Math.PI / 2, 0, Math.atan2(line.nx, -line.ny));
    this.t = 0;
    this.active = true;
    this.root.visible = true;
    return true;
  }

  hide() {
    this.active = false;
  }

  get showing(): boolean {
    return this.active;
  }

  update(dt: number) {
    this.fade = Math.max(0, Math.min(1, this.fade + (this.active ? dt * 3 : -dt * 4)));
    if (this.fade <= 0) {
      this.root.visible = this.captionText !== '';
      this.flapPivot.visible = this.crease.visible = this.thumb.visible = this.index.visible = false;
      (this.caption.material as MeshBasicMaterial).opacity = 1;
      return;
    }
    this.root.visible = true;
    this.flapPivot.visible = this.crease.visible = this.thumb.visible = this.index.visible = true;
    this.t = (this.t + dt) % LOOP;
    // 0–0.35 pinch closes, 0.35–1.55 fold over, then hold and fade.
    const t = this.t;
    const pinch = Math.min(1, t / 0.35);
    const u = Math.max(0, Math.min(1, (t - 0.35) / 1.2));
    const e = u * u * (3 - 2 * u);
    const angle = e * Math.PI * 0.96;
    const hold = t > 1.55 ? 1 - Math.min(1, (t - 1.55) / 0.9) : 1;
    this.q.setFromAxisAngle(this.axis, -this.sign * angle);
    this.flapPivot.quaternion.copy(this.q);
    const a = this.fade * hold;
    this.ghostMat.opacity = 0.42 * a;
    (this.crease.material as MeshBasicMaterial).opacity = 0.9 * this.fade;
    (this.thumb.material as MeshBasicMaterial).opacity = 0.9 * a;
    // Fingertips ride on the grab point as it swings over.
    this.v.set(this.grab.x, 0, -this.grab.y);
    this.v.sub(this.flapPivot.position).setY(0);
    this.v.applyQuaternion(this.q).add(this.flapPivot.position);
    const gap = 0.014 * (1 - pinch) + 0.002;
    this.thumb.position.set(this.v.x, this.v.y + 0.008 + gap, this.v.z);
    this.index.position.set(this.v.x, this.v.y + 0.008 - gap * 0.2, this.v.z + gap * 0.6);
  }
}
