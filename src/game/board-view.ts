/**
 * The folding mat on the table: felt surface with lattice dots, the ghost of
 * the goal shape, the live crease guide and the goal card.
 */

import {
  Box3,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  Float32BufferAttribute,
  CylinderGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { Line, unionOutline } from '../fold/geom.js';
import { BOARD, Facet, GRID } from '../fold/paper.js';
import { buildRig } from './creature-models.js';
import type { CreatureKind } from './levels.js';
import type { PaperLook } from './paper-texture.js';

const DOT_USED = new Color(0xf6f0e4);
const DOT_OVER = new Color(0xff8a6a);
const MAX_DOTS = 8;

export const MAT_W = 0.5;
export const MAT_D = 0.44;

function canvasTexture(w: number, h: number): [HTMLCanvasElement, CanvasTexture] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return [c, t];
}

function roundedRect(w: number, d: number, r: number): Shape {
  const s = new Shape();
  const x = -w / 2;
  const y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Board metres → canvas pixels for a canvas that spans BOARD. */
function boardPx(x: number, y: number, size: number): [number, number] {
  return [
    ((x - BOARD.minX) / (BOARD.maxX - BOARD.minX)) * size,
    ((BOARD.maxY - y) / (BOARD.maxY - BOARD.minY)) * size,
  ];
}

export function drawShape(
  ctx: CanvasRenderingContext2D,
  facets: readonly Facet[],
  look: PaperLook,
  size: number,
  outline: string,
  outlineWidth: number,
) {
  const sorted = [...facets].sort((a, b) => a.layer - b.layer);
  const path = (f: Facet) => {
    ctx.beginPath();
    f.poly.forEach((p, i) => {
      const [x, y] = boardPx(p.x, p.y, size);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  ctx.strokeStyle = outline;
  ctx.lineWidth = outlineWidth;
  for (const f of sorted) {
    path(f);
    ctx.stroke();
  }
  for (const f of sorted) {
    path(f);
    ctx.fillStyle = f.flipped ? look.back : look.front;
    ctx.fill();
  }
}

export class BoardView {
  readonly root = new Group();
  readonly hitPlane: Mesh;
  private ghostCanvas: HTMLCanvasElement;
  private ghostTex: CanvasTexture;
  private ghost: Mesh;
  private cardCanvas: HTMLCanvasElement;
  private cardTex: CanvasTexture;
  readonly card: Group;
  /** The creature this puzzle becomes, turning slowly above the card. */
  private mini: Group | null = null;
  private miniSpin = 0;
  /** One dot per fold the solution needs, filled as folds are made. */
  private dots: { disc: Mesh; ring: Mesh }[] = [];
  private dotGeo = new CircleGeometry(0.0042, 20);
  private ringGeo = new RingGeometry(0.003, 0.0044, 24);
  private warm = false;
  /** Hint step 1: a pulsing ring on the corner to pinch. */
  private hintRing: Mesh;
  /** Hint step 2: the crease to fold along. */
  private hintLine: Mesh;
  private hintT = 0;
  private crease: Mesh;
  private creaseMat: MeshBasicMaterial;
  private outline: Mesh;
  private outlineMat = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.8,
    depthTest: false,
    depthWrite: false,
  });
  private clock = 0;

  constructor() {
    this.root.name = 'Board';

    // Felt mat; the texture spans the whole mat.
    const [matCanvas, matTex] = canvasTexture(1024, 1024);
    const m = matCanvas.getContext('2d')!;
    m.fillStyle = '#2f4a45';
    m.fillRect(0, 0, 1024, 1024);
    m.globalAlpha = 0.05;
    for (let i = 0; i < 5000; i++) {
      m.fillStyle = Math.random() > 0.5 ? '#fff' : '#000';
      m.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2);
    }
    m.globalAlpha = 1;
    const matPx = (x: number, y: number): [number, number] => [
      (x / MAT_W + 0.5) * 1024,
      (0.5 - y / MAT_D) * 1024,
    ];
    // Lattice dots every GRID metres show where creases can land.
    m.fillStyle = 'rgba(235,245,240,0.32)';
    for (let x = BOARD.minX + GRID; x < BOARD.maxX - 1e-9; x += GRID) {
      for (let y = BOARD.minY + GRID; y < BOARD.maxY - 1e-9; y += GRID) {
        const [px, py] = matPx(x, y);
        m.beginPath();
        m.ellipse(px, py, 3.4 * (MAT_D / MAT_W), 3.4, 0, 0, Math.PI * 2);
        m.fill();
      }
    }
    const matGeo = new ShapeGeometry(roundedRect(MAT_W, MAT_D, 0.025));
    const uv = matGeo.attributes.uv;
    const pos = matGeo.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, pos.getX(i) / MAT_W + 0.5, pos.getY(i) / MAT_D + 0.5);
    }
    const mat = new Mesh(matGeo, new MeshLambertMaterial({ map: matTex }));
    mat.rotation.x = -Math.PI / 2;
    mat.name = 'Mat';
    this.root.add(mat);

    // Thin rim so the mat reads as an object on the table.
    const rim = new Mesh(
      new ShapeGeometry(roundedRect(MAT_W + 0.008, MAT_D + 0.008, 0.028)),
      new MeshBasicMaterial({ color: new Color(0x1d2f2b) }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = -0.0006;
    this.root.add(rim);

    // Ghost of the goal shape.
    [this.ghostCanvas, this.ghostTex] = canvasTexture(1024, 1024);
    this.ghost = new Mesh(
      new PlaneGeometry(BOARD.maxX - BOARD.minX, BOARD.maxY - BOARD.minY),
      new MeshBasicMaterial({
        map: this.ghostTex,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    this.ghost.rotation.x = -Math.PI / 2;
    this.ghost.position.y = 0.0004;
    this.ghost.renderOrder = 1;
    this.ghost.name = 'GoalGhost';
    this.root.add(this.ghost);

    // Invisible surface that catches rays, gaze and mouse.
    this.hitPlane = new Mesh(
      new PlaneGeometry(MAT_W, MAT_D),
      new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
    );
    this.hitPlane.rotation.x = -Math.PI / 2;
    this.hitPlane.position.y = 0.002;
    this.hitPlane.name = 'FoldSurface';

    // Live crease guide.
    this.creaseMat = new MeshBasicMaterial({
      color: new Color(0xfff6d8),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.crease = new Mesh(new PlaneGeometry(1, 0.0028), this.creaseMat);
    this.crease.rotation.x = -Math.PI / 2;
    this.crease.renderOrder = 50;
    this.crease.visible = false;
    this.root.add(this.crease);

    // Dashed goal outline drawn over the paper so the target is always visible.
    this.outline = new Mesh(new BufferGeometry(), this.outlineMat);
    this.outline.renderOrder = 45;
    this.outline.name = 'GoalOutline';
    this.root.add(this.outline);

    // Goal card on a little easel at the far edge of the mat.
    [this.cardCanvas, this.cardTex] = canvasTexture(512, 640);
    this.card = new Group();
    this.card.name = 'GoalCard';
    const cardMesh = new Mesh(
      new PlaneGeometry(0.12, 0.15),
      new MeshBasicMaterial({ map: this.cardTex, transparent: true }),
    );
    cardMesh.position.y = 0.075;
    this.card.add(cardMesh);
    const foot = new Mesh(
      new CylinderGeometry(0.004, 0.004, 0.11, 8),
      new MeshLambertMaterial({ color: 0x8a6a4a }),
    );
    foot.rotation.z = Math.PI / 2;
    foot.position.set(0, 0.002, 0.004);
    this.card.add(foot);
    this.card.position.set(-0.17, 0, -0.245);
    this.card.rotation.set(-0.38, 0.32, 0);
    this.root.add(this.card);

    const gold = { color: 0xffd166, transparent: true, depthWrite: false, depthTest: false };
    this.hintRing = new Mesh(new RingGeometry(0.011, 0.0155, 40), new MeshBasicMaterial(gold));
    this.hintRing.rotation.x = -Math.PI / 2;
    this.hintRing.renderOrder = 72;
    this.hintRing.visible = false;
    this.hintLine = new Mesh(new PlaneGeometry(0.56, 0.0042), new MeshBasicMaterial(gold));
    this.hintLine.renderOrder = 71;
    this.hintLine.visible = false;
    this.root.add(this.hintRing, this.hintLine);

    for (let i = 0; i < MAX_DOTS; i++) {
      const disc = new Mesh(this.dotGeo, new MeshBasicMaterial({ color: DOT_USED.clone() }));
      const ring = new Mesh(
        this.ringGeo,
        new MeshBasicMaterial({ color: DOT_USED, transparent: true, opacity: 0.55, depthWrite: false }),
      );
      // Along the bottom of the goal picture on the card.
      for (const m of [disc, ring]) {
        m.position.set(0, 0.041, 0.0015);
        m.visible = false;
        m.renderOrder = 3;
        this.card.add(m);
      }
      this.dots.push({ disc, ring });
    }
  }

  /** Hint: ring around the board point to pinch (null hides it). */
  showHintCorner(p: { x: number; y: number } | null) {
    this.hintRing.visible = !!p;
    if (p) this.hintRing.position.set(p.x, 0.007, -p.y);
    this.hintT = 0;
  }

  /** Hint: the crease to fold along (null hides it). */
  showHintLine(line: Line | null) {
    this.hintLine.visible = !!line;
    if (!line) return;
    this.hintLine.position.set(line.nx * line.d, 0.0045, -line.ny * line.d);
    this.hintLine.rotation.set(-Math.PI / 2, 0, Math.atan2(line.nx, -line.ny));
  }

  /** Fold dots: `used` of the `total` the solution needs; extra folds show in coral. */
  setFoldCount(used: number, total: number) {
    for (let i = 0; i < MAX_DOTS; i++) {
      const { disc, ring } = this.dots[i];
      const x = (i - (Math.max(total, used) - 1) / 2) * 0.012;
      disc.position.x = ring.position.x = x;
      ring.visible = i < total;
      disc.visible = i < Math.min(used, MAX_DOTS);
      (disc.material as MeshBasicMaterial).color.copy(i < total ? DOT_USED : DOT_OVER);
    }
  }

  /** The creature that this puzzle becomes, shown small above the card. */
  private setMini(kind: CreatureKind, look: PaperLook) {
    if (this.mini) {
      this.root.remove(this.mini);
      this.mini.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh && m.name === 'Paper') m.geometry.dispose();
        if ((o as LineSegments).isLineSegments) {
          (o as LineSegments).geometry.dispose();
          ((o as LineSegments).material as LineBasicMaterial).dispose();
        }
      });
    }
    const rig = buildRig(kind, look.front, look.back).root;
    const size = new Box3().setFromObject(rig).getSize(new Vector3());
    const holder = new Group();
    holder.name = 'GoalCreature';
    rig.scale.setScalar(0.085 / Math.max(size.x, size.y, size.z));
    holder.add(rig);
    holder.position.set(-0.17, 0.18, -0.29);
    this.root.add(holder);
    this.mini = holder;
  }

  private buildOutline(facets: readonly Facet[]) {
    const segs = unionOutline(facets.map((f) => f.poly));
    const pos: number[] = [];
    const w = 0.0012;
    const y = 0.008;
    const dash = 0.008;
    const gap = 0.005;
    for (const [a, b] of segs) {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const dx = (b.x - a.x) / len;
      const dy = (b.y - a.y) / len;
      const nx = -dy * w;
      const ny = dx * w;
      for (let t = 0; t < len; t += dash + gap) {
        const e = Math.min(len, t + dash);
        const p0 = { x: a.x + dx * t, y: a.y + dy * t };
        const p1 = { x: a.x + dx * e, y: a.y + dy * e };
        // Board (u, v) → local (x, y, -z); two triangles per dash.
        const q = [
          [p0.x - nx, p0.y - ny],
          [p1.x - nx, p1.y - ny],
          [p1.x + nx, p1.y + ny],
          [p0.x + nx, p0.y + ny],
        ];
        for (const i of [0, 1, 2, 0, 2, 3]) pos.push(q[i][0], y, -q[i][1]);
      }
    }
    this.outline.geometry.dispose();
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.outline.geometry = g;
  }

  /** Gentle breathing of the goal outline. */
  update(dt: number) {
    this.clock += dt;
    this.outlineMat.opacity = this.warm ? 1 : 0.55 + 0.3 * (0.5 + 0.5 * Math.sin(this.clock * 2.4));
    this.hintT += dt;
    if (this.hintRing.visible) {
      const k = (this.hintT * 1.4) % 1;
      this.hintRing.scale.setScalar(1 + k * 0.9);
      (this.hintRing.material as MeshBasicMaterial).opacity = 1 - k;
    }
    if (this.hintLine.visible) {
      (this.hintLine.material as MeshBasicMaterial).opacity = 0.55 + 0.4 * Math.sin(this.clock * 5);
    }
    if (this.mini) {
      this.miniSpin += dt * 0.6;
      this.mini.rotation.y = this.miniSpin;
      this.mini.position.y = 0.18 + Math.sin(this.clock * 1.6) * 0.006;
    }
  }

  setOutlineVisible(v: boolean) {
    this.outline.visible = v;
  }

  setGoal(
    facets: readonly Facet[],
    look: PaperLook,
    title: string,
    subtitle: string,
    footer = '',
    kind?: CreatureKind,
  ) {
    if (kind) this.setMini(kind, look);
    this.buildOutline(facets);
    this.outline.visible = true;
    const g = this.ghostCanvas.getContext('2d')!;
    g.clearRect(0, 0, 1024, 1024);
    drawShape(g, facets, look, 1024, 'rgba(255,255,255,0.95)', 7);
    this.ghostTex.needsUpdate = true;

    const c = this.cardCanvas.getContext('2d')!;
    c.clearRect(0, 0, 512, 640);
    c.fillStyle = '#f7f1e6';
    c.beginPath();
    c.roundRect(4, 4, 504, 632, 28);
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.12)';
    c.lineWidth = 4;
    c.stroke();
    c.save();
    c.translate(16, 16);
    // The goal drawn at card scale, cropped to the paper area.
    c.beginPath();
    c.roundRect(0, 0, 480, 480, 18);
    c.fillStyle = '#2f4a45';
    c.fill();
    c.clip();
    c.translate(-240, -240);
    drawShape(c, facets, look, 960, 'rgba(255,255,255,0.9)', 6);
    c.restore();
    c.fillStyle = '#3b3027';
    c.textAlign = 'center';
    c.font = '600 54px system-ui, -apple-system, Segoe UI, sans-serif';
    c.fillText(title, 256, 560);
    c.fillStyle = '#8a7a6a';
    c.font = '500 34px system-ui, -apple-system, Segoe UI, sans-serif';
    c.fillText(subtitle, 256, footer ? 600 : 612);
    if (footer) {
      // Collection line, e.g. "Zoo 7 · 3-day streak".
      c.fillStyle = '#b0795a';
      c.font = '600 24px system-ui, -apple-system, Segoe UI, sans-serif';
      c.fillText(footer.toUpperCase(), 256, 630);
    }
    this.cardTex.needsUpdate = true;
  }

  setGhostOpacity(v: number) {
    (this.ghost.material as MeshBasicMaterial).opacity = v;
  }

  /** Shows the crease guide along `line`, clipped to [lo, hi] along the line. */
  showCrease(line: Line | null, highlight = false, solves = false) {
    this.warm = !!line && solves;
    this.outlineMat.color.set(this.warm ? 0xffd166 : 0xffffff);
    if (!line) {
      this.crease.visible = false;
      return;
    }
    const fx = line.nx * line.d;
    const fy = line.ny * line.d;
    // Span the board square.
    const span = 0.56;
    this.crease.visible = true;
    this.crease.scale.set(span, solves ? 2.4 : 1, 1);
    this.crease.position.set(fx, 0.0035, -fy);
    // Plane's long axis is local x; rotate around world up to the line direction.
    const angle = Math.atan2(line.nx, -line.ny);
    this.crease.rotation.set(-Math.PI / 2, 0, angle);
    this.creaseMat.color.set(solves ? 0xffc53d : highlight ? 0xffd166 : 0xfff6d8);
  }

  boardToLocal(x: number, y: number, h: number, out: Vector3): Vector3 {
    return out.set(x, h, -y);
  }
}
