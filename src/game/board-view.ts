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
  Group,
  LineBasicMaterial,
  LinearMipmapLinearFilter,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  RingGeometry,
  ShadowMaterial,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from '@iwsdk/core';
import { Line, unionOutline } from '../fold/geom.js';
import { BOARD, Facet, GRID } from '../fold/paper.js';
import { buildRig } from './creature-models.js';
import type { CreatureKind } from './levels.js';
import { contentTexture, fadeTree, floatOverRoom, follow, INK, LAYER, setFont, Surface, WINDOW_GLASS } from './glass.js';
import { feltHeight, heightToNormal, normalTexture } from './normal-maps.js';
import type { PaperLook } from './paper-texture.js';

const DOT_USED = new Color(0xffffff);
const DOT_OVER = new Color(0xff8a6a);
const MAX_DOTS = 8;

const MINI_Y = 0.235;

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

let beam: CanvasTexture | null = null;

/** A line of light: soft across its width, fading out at both ends. */
function lightBeam(): CanvasTexture {
  if (!beam) {
    const [c, t] = canvasTexture(512, 32);
    const g = c.getContext('2d')!;
    const across = g.createLinearGradient(0, 0, 0, 32);
    across.addColorStop(0, 'rgba(255,255,255,0)');
    across.addColorStop(0.36, 'rgba(255,255,255,0.28)');
    across.addColorStop(0.46, 'rgba(255,255,255,1)');
    across.addColorStop(0.54, 'rgba(255,255,255,1)');
    across.addColorStop(0.64, 'rgba(255,255,255,0.28)');
    across.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = across;
    g.fillRect(0, 0, 512, 32);
    g.globalCompositeOperation = 'destination-in';
    const along = g.createLinearGradient(0, 0, 512, 0);
    along.addColorStop(0, 'rgba(0,0,0,0)');
    along.addColorStop(0.22, 'rgba(0,0,0,1)');
    along.addColorStop(0.78, 'rgba(0,0,0,1)');
    along.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = along;
    g.fillRect(0, 0, 512, 32);
    beam = t;
  }
  return beam;
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
  private matMesh!: Mesh;
  private catcher!: Mesh;
  private highContrast = false;
  private goalFacets: readonly Facet[] = [];
  private creaseColor = 0xfff6d8;
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
    const base = m.createRadialGradient(512, 470, 120, 512, 512, 760);
    base.addColorStop(0, '#3a3d43');
    base.addColorStop(1, '#2a2c31');
    m.fillStyle = base;
    m.fillRect(0, 0, 1024, 1024);
    const matPx = (x: number, y: number): [number, number] => [
      (x / MAT_W + 0.5) * 1024,
      (0.5 - y / MAT_D) * 1024,
    ];
    // Lattice dots every GRID metres show where creases can land.
    m.fillStyle = 'rgba(255,255,255,0.3)';
    for (let x = BOARD.minX + GRID; x < BOARD.maxX - 1e-9; x += GRID) {
      for (let y = BOARD.minY + GRID; y < BOARD.maxY - 1e-9; y += GRID) {
        const [px, py] = matPx(x, y);
        m.beginPath();
        m.ellipse(px, py, 2.6 * (MAT_D / MAT_W), 2.6, 0, 0, Math.PI * 2);
        m.fill();
      }
    }
    const matGeo = new ShapeGeometry(roundedRect(MAT_W, MAT_D, 0.025));
    const uv = matGeo.attributes.uv;
    const pos = matGeo.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, pos.getX(i) / MAT_W + 0.5, pos.getY(i) / MAT_D + 0.5);
    }
    const feltSize = 512;
    const felt = normalTexture(heightToNormal(feltHeight(feltSize, 11), feltSize, 2.4), feltSize);
    felt.wrapS = felt.wrapT = RepeatWrapping;
    felt.repeat.set(3, 3);
    felt.generateMipmaps = true;
    felt.minFilter = LinearMipmapLinearFilter;
    felt.needsUpdate = true;
    const mat = new Mesh(
      matGeo,
      new MeshStandardMaterial({ map: matTex, normalMap: felt, normalScale: new Vector2(0.8, 0.8), roughness: 0.96, metalness: 0, envMapIntensity: 0.6 }),
    );
    mat.rotation.x = -Math.PI / 2;
    mat.name = 'Mat';
    mat.receiveShadow = true;
    this.root.add(mat);
    this.matMesh = mat;

    // In passthrough, a shadow-only sheet around the mat lets the paper and
    // the creatures cast soft shadows onto the real table.
    this.catcher = new Mesh(new PlaneGeometry(1.3, 1.1), new ShadowMaterial({ opacity: 0.32 }));
    this.catcher.rotation.x = -Math.PI / 2;
    this.catcher.position.y = -0.001;
    this.catcher.receiveShadow = true;
    this.catcher.renderOrder = -1;
    this.catcher.visible = false;
    this.catcher.name = 'ShadowCatcher';
    this.root.add(this.catcher);

    // Thin rim so the mat reads as an object on the table.
    const rim = new Mesh(
      new ShapeGeometry(roundedRect(MAT_W + 0.008, MAT_D + 0.008, 0.028)),
      new MeshBasicMaterial({ color: new Color(0x17181b) }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = -0.0006;
    this.root.add(rim);

    // A soft contact shadow grounds the mat on whatever it lies on.
    const contact = new Surface({ w: MAT_W, h: MAT_D, r: 0.028, body: 0, shadow: 0.55, soft: 0.034, drop: 0, order: -2 });
    contact.mesh.rotation.x = -Math.PI / 2;
    contact.mesh.position.y = -0.0012;
    contact.mesh.name = 'MatContact';
    this.root.add(contact.mesh);

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
      map: lightBeam(),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      toneMapped: false,
    });
    this.crease = new Mesh(new PlaneGeometry(1, 0.007), this.creaseMat);
    this.crease.rotation.x = -Math.PI / 2;
    this.crease.renderOrder = 50;
    this.crease.visible = false;
    this.root.add(this.crease);

    // Dashed goal outline drawn over the paper so the target is always visible.
    this.outline = new Mesh(new BufferGeometry(), this.outlineMat);
    this.outline.renderOrder = 45;
    this.outline.name = 'GoalOutline';
    this.root.add(this.outline);

    // Goal card floating over the far edge of the mat, tilted to the player.
    this.cardCanvas = document.createElement('canvas');
    this.cardCanvas.width = 512;
    this.cardCanvas.height = 640;
    this.cardTex = contentTexture(this.cardCanvas);
    this.card = new Group();
    this.card.name = 'GoalCard';
    const cardGlass = new Surface({
      w: 0.12,
      h: 0.15,
      r: 0.016,
      ...WINDOW_GLASS,
      shadow: 0.34,
      soft: 0.022,
      drop: 0.007,
      map: this.cardTex,
      order: LAYER.window - 1,
    });
    cardGlass.mesh.position.y = 0.075;
    this.card.add(cardGlass.mesh);
    this.card.position.set(-0.205, 0.03, -0.185);
    this.card.rotation.set(-0.42, 0.3, 0);
    this.root.add(this.card);

    const gold = { color: 0xffd166, transparent: true, depthWrite: false, depthTest: false, toneMapped: false };
    this.hintRing = new Mesh(new RingGeometry(0.0125, 0.0145, 48), new MeshBasicMaterial(gold));
    this.hintRing.rotation.x = -Math.PI / 2;
    this.hintRing.renderOrder = 72;
    this.hintRing.visible = false;
    this.hintLine = new Mesh(new PlaneGeometry(0.56, 0.009), new MeshBasicMaterial({ ...gold, map: lightBeam() }));
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
        m.position.set(0, 0.0445, 0.0015);
        m.visible = false;
        m.renderOrder = LAYER.window + 1;
        this.card.add(m);
      }
      this.dots.push({ disc, ring });
    }
    floatOverRoom(this.card);
  }

  /** Hides the crease, hint and goal marks during the opening. */
  setHintsVisible(on: boolean) {
    for (const m of [this.crease, this.hintRing, this.hintLine, this.outline, this.ghost]) {
      if (on) m.layers.enable(0);
      else m.layers.disable(0);
    }
  }

  /** Fades the goal card and its creature away while a window is in front. */
  setCardAway(away: boolean, dt: number) {
    this.cardK = follow(this.cardK, away ? 0 : 1, 9, dt);
    if (Math.abs(this.cardK - this.cardShown) < 0.004) return;
    this.cardShown = this.cardK;
    fadeTree(this.card, this.cardK * this.cardK);
    this.card.visible = this.cardK > 0.01;
    if (this.mini) this.mini.visible = this.cardK > 0.5;
  }
  private cardK = 1;
  private cardShown = 1;

  /** Shadows onto the real table, for passthrough only. */
  setShadowCatcher(on: boolean) {
    this.catcher.visible = on;
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
    holder.position.set(-0.215, MINI_Y, -0.215);
    // Drawn before the room's occluders, so real furniture never cuts it off.
    holder.traverse((o) => {
      o.renderOrder = -20;
    });
    this.root.add(holder);
    this.mini = holder;
  }

  private buildOutline(facets: readonly Facet[]) {
    const segs = unionOutline(facets.map((f) => f.poly));
    const pos: number[] = [];
    const w = this.highContrast ? 0.0024 : 0.0012;
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

  setHighContrast(on: boolean) {
    if (this.highContrast === on) return;
    this.highContrast = on;
    this.buildOutline(this.goalFacets);
    this.outlineMat.opacity = on || this.warm ? 1 : 0.8;
    this.creaseMat.color.set(on ? 0xffffff : this.creaseColor);
    this.creaseMat.opacity = on ? 1 : 0.95;
    (this.hintLine.material as MeshBasicMaterial).color.set(on ? 0xffffff : 0xffd166);
  }

  /** Gentle breathing of the goal outline. */
  update(dt: number) {
    this.clock += dt;
    this.outlineMat.opacity = this.highContrast || this.warm ? 1 : 0.55 + 0.3 * (0.5 + 0.5 * Math.sin(this.clock * 2.4));
    this.hintT += dt;
    if (this.hintRing.visible) {
      const k = (this.hintT * 1.4) % 1;
      this.hintRing.scale.setScalar(1 + k * 0.9);
      (this.hintRing.material as MeshBasicMaterial).opacity = 1 - k;
    }
    if (this.hintLine.visible) {
      (this.hintLine.material as MeshBasicMaterial).opacity = this.highContrast ? 1 : 0.55 + 0.4 * Math.sin(this.clock * 5);
    }
    if (this.mini) {
      this.miniSpin += dt * 0.6;
      this.mini.rotation.y = this.miniSpin;
      this.mini.position.y = MINI_Y + Math.sin(this.clock * 1.6) * 0.005;
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
    this.goalFacets = facets;
    this.buildOutline(facets);
    this.outline.visible = true;
    const g = this.ghostCanvas.getContext('2d')!;
    g.clearRect(0, 0, 1024, 1024);
    drawShape(g, facets, look, 1024, 'rgba(255,255,255,0.95)', 7);
    this.ghostTex.needsUpdate = true;

    const c = this.cardCanvas.getContext('2d')!;
    c.clearRect(0, 0, 512, 640);
    // The goal drawn at card scale, cropped to the paper area.
    c.save();
    c.beginPath();
    c.roundRect(26, 26, 460, 400, 36);
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.fill();
    c.clip();
    c.translate(26 + 230 - 480 * 0.9, 26 + 200 - 480 * 0.9);
    drawShape(c, facets, look, 960 * 0.9, 'rgba(255,255,255,0.92)', 6);
    c.restore();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = INK.primary;
    setFont(c, 50, 700, -0.5);
    c.fillText(title, 256, 508, 460);
    c.fillStyle = INK.secondary;
    setFont(c, 30, 500);
    c.fillText(subtitle, 256, 556, 460);
    if (footer) {
      // Collection line, e.g. "Zoo 7 · 3-day streak".
      c.fillStyle = INK.tertiary;
      setFont(c, 24, 500);
      c.fillText(footer, 256, 598, 460);
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
    this.crease.scale.set(span, solves ? 1.8 : 1, 1);
    this.crease.position.set(fx, 0.0035, -fy);
    // Plane's long axis is local x; rotate around world up to the line direction.
    const angle = Math.atan2(line.nx, -line.ny);
    this.crease.rotation.set(-Math.PI / 2, 0, angle);
    this.creaseColor = solves ? 0xffc53d : highlight ? 0xffd166 : 0xfff6d8;
    this.creaseMat.color.set(this.highContrast ? 0xffffff : this.creaseColor);
  }

  boardToLocal(x: number, y: number, h: number, out: Vector3): Vector3 {
    return out.set(x, h, -y);
  }
}
