/**
 * One folding session on the mat: input from pinching hands, controllers,
 * rays, gaze or a mouse becomes a crease, a swinging flap, and a fold.
 */

import {
  Entity,
  Group,
  Mesh,
  MeshBasicMaterial,
  Plane,
  RingGeometry,
  PokeInteractable,
  Ray,
  RayInteractable,
  Vector3,
  World,
} from '@iwsdk/core';
import { rawCrease, snapCrease, Snap, Point3 } from '../fold/creases.js';
import {
  applyAffine,
  closestOnConvex,
  Line,
  lineChord,
  lineSide,
  reflectPoint,
  V2,
} from '../fold/geom.js';
import {
  applyFold,
  applyFolds,
  creaseLine,
  Facet,
  FoldSpec,
  foldPaper,
  initialPaper,
  paperBounds,
  PaperState,
  rasterize,
  rasterMatch,
  splitPaper,
  topFacetAt,
} from '../fold/paper.js';
import { BoardView } from './board-view.js';
import { Button, IconKind } from './button.js';
import { Guide } from './guide.js';
import { Xray } from './xray.js';
import { Level, LEVELS } from './levels.js';
import { PaperTextures } from './paper-texture.js';
import { PaperView } from './paper-view.js';
import { sfx, unlockAudio } from './sfx.js';

type DragKind = 'near' | 'ray';

interface Drag {
  kind: DragKind;
  source: XRInputSource | null;
  pointerId: number;
  p: V2;
  hand: Point3;
  snap: Snap | null;
  angle: number;
  startedAt: number;
}

interface Settle {
  snap: Snap;
  from: number;
  to: number;
  t: number;
  dur: number;
}

const NEAR_HEIGHT = 0.09;
const NEAR_MARGIN = 0.025;

export interface FoldGameEvents {
  onSolved?: (level: Level, paper: PaperState, boardRoot: Group) => void;
  onRecenter?: () => void;
  onDaily?: () => void;
  onSound?: () => void;
  /** Small collection line for the goal card ("Zoo 7 · 3-day streak"). */
  footer?: () => string;
}

export class FoldGame {
  readonly boardRoot = new Group();
  readonly boardEntity: Entity;
  readonly board = new BoardView();
  private textures: PaperTextures;
  private paperView: PaperView;
  private buttons: Button[] = [];

  levelIndex = 0;
  level: Level = LEVELS[0];
  paper: PaperState = initialPaper();
  private history: PaperState[] = [];
  private creases: [V2, V2][] = [];
  private creaseHistory: number[] = [];
  private target: Uint8Array = new Uint8Array(0);
  private targetFacets: Facet[] = [];
  /** Picture after each step of the known solution, for hints. */
  private prefixes: Uint8Array[] = [];
  solved = false;
  inputLocked = false;
  isDaily = false;
  readonly guide = new Guide();
  readonly xray = new Xray();
  private idle = 0;
  private hintTimer = 0;
  private message = '';
  private messageTimer = 0;
  private folds = 0;

  private drag: Drag | null = null;
  private settle: Settle | null = null;
  private glow = 0;
  private time = 0;

  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private cursors: Mesh[] = [];
  private cursorHand: Point3 = { x: 0, y: 0, h: 0 };
  private plane = new Plane();
  private ray = new Ray();

  constructor(
    private world: World,
    private events: FoldGameEvents = {},
  ) {
    this.boardEntity = world.createTransformEntity(this.boardRoot);
    this.boardRoot.add(this.board.root);
    this.textures = new PaperTextures(LEVELS[0].look, 1);
    this.paperView = new PaperView(this.textures);
    this.boardRoot.add(this.paperView.root);
    this.boardRoot.add(this.guide.root);
    world.createTransformEntity(this.xray.root);

    // The fold surface takes rays, gaze and the desktop mouse.
    const hit = world.createTransformEntity(this.board.hitPlane, this.boardEntity);
    hit.addComponent(RayInteractable);
    const target = this.board.hitPlane as unknown as {
      addEventListener(type: string, fn: (e: PointerLike) => void): void;
    };
    target.addEventListener('pointerdown', (e) => this.onRayDown(e));
    target.addEventListener('pointermove', (e) => this.onRayMove(e));
    target.addEventListener('pointerup', (e) => this.onRayUp(e));
    target.addEventListener('pointercancel', (e) => this.onRayUp(e));

    // Most-used tokens sit nearest the player.
    this.addButton('undo', 0.295, -0.12, () => this.undo());
    this.addButton('hint', 0.295, -0.03, () => this.hint());
    this.addButton('restart', 0.295, 0.06, () => this.restart());
    this.addButton('daily', -0.295, -0.12, () => this.events.onDaily?.());
    this.addButton('sound', -0.295, -0.03, () => this.events.onSound?.());
    this.addButton('recenter', -0.295, 0.06, () => this.events.onRecenter?.());

    const ring = new RingGeometry(0.008, 0.011, 32);
    ring.rotateX(-Math.PI / 2);
    for (let i = 0; i < 2; i++) {
      const c = new Mesh(
        ring,
        new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, depthTest: false }),
      );
      c.renderOrder = 70;
      c.visible = false;
      this.cursors.push(c);
      this.boardRoot.add(c);
    }

    world.renderer.xr.addEventListener('sessionstart', () => this.onSessionStart());
    world.renderer.xr.addEventListener('sessionend', () => {
      for (const c of this.cursors) c.visible = false;
    });
    world.onXRFrame((frame) => this.onXRFrame(frame));
  }

  button(kind: IconKind): Button | undefined {
    return this.buttons.find((b) => b.kind === kind);
  }

  private addButton(kind: IconKind, x: number, y: number, action: () => void) {
    const b = new Button(kind, () => {
      if (this.inputLocked || this.drag || this.settle) return;
      unlockAudio();
      sfx.click();
      action();
    });
    b.root.position.set(x, 0, -y);
    const e = this.world.createTransformEntity(b.root, this.boardEntity);
    e.addComponent(RayInteractable);
    e.addComponent(PokeInteractable);
    this.buttons.push(b);
  }

  loadLevel(index: number) {
    this.levelIndex = ((index % LEVELS.length) + LEVELS.length) % LEVELS.length;
    this.isDaily = false;
    this.setLevel(LEVELS[this.levelIndex], `${this.levelIndex + 1} / ${LEVELS.length}`, this.levelIndex + 3);
  }

  loadDaily(level: Level, subtitle: string) {
    this.isDaily = true;
    this.setLevel(level, subtitle, level.id.length * 17);
  }

  private setLevel(level: Level, subtitle: string, seed: number) {
    this.level = level;
    const goal = applyFolds(level.solution);
    if (!goal) throw new Error(`Level ${level.id} has an invalid solution`);
    this.targetFacets = goal.facets;
    this.target = rasterize(goal);
    this.prefixes = [rasterize(initialPaper())];
    let s: PaperState | null = initialPaper();
    for (const f of level.solution) {
      s = s && applyFold(s, f);
      if (s) this.prefixes.push(rasterize(s));
    }
    this.textures.setLook(level.look, seed);
    this.board.setGoal(this.targetFacets, level.look, level.name, subtitle, this.events.footer?.() ?? '');
    this.restart();
  }

  /** Teaching levels show the ghost fold on their own. */
  private get tutorial(): boolean {
    return !this.isDaily && this.levelIndex < 2;
  }

  private captionFor(): string {
    if (this.isDaily) return '';
    switch (this.levelIndex) {
      case 0:
        return this.folds === 0 ? 'Pinch the corner and fold it over' : '';
      case 1:
        return 'Match the shape on the card';
      case 2:
        return 'Folds snap to the dots';
      default:
        return '';
    }
  }

  /**
   * Where a hand would pinch and where it would set down for the next fold of
   * the known solution (board space). Used by tests and the film recorder.
   */
  nextFoldPoints(): { grab: V2; dest: V2 } | null {
    const next = this.nextFold();
    if (!next) return null;
    const line = creaseLine(next);
    const parts = splitPaper(this.paper, line, next.s);
    if (!parts) return null;
    // Pinch the moving-part vertex that is farthest from the crease, nudged
    // a little inside the paper so the pinch lands on it.
    let best = 0;
    let grab: V2 = { x: 0, y: 0 };
    let cx = 0;
    let cy = 0;
    let n = 0;
    for (const f of parts.move) {
      for (const p of f.poly) {
        cx += p.x;
        cy += p.y;
        n++;
        const d = next.s * lineSide(line, p);
        if (d > best) {
          best = d;
          grab = { x: p.x, y: p.y };
        }
      }
    }
    cx /= n;
    cy /= n;
    grab = { x: grab.x + (cx - grab.x) * 0.06, y: grab.y + (cy - grab.y) * 0.06 };
    const dest = reflectPoint(line, grab);
    return { grab, dest };
  }

  /** The next fold of the known solution, if the paper is still on that path. */
  private nextFold(): FoldSpec | null {
    const r = rasterize(this.paper);
    for (let k = this.prefixes.length - 2; k >= 0; k--) {
      if (rasterMatch(r, this.prefixes[k]) >= 0.999) return this.level.solution[k];
    }
    return null;
  }

  restart() {
    this.paper = initialPaper();
    this.history = [];
    this.creases = [];
    this.creaseHistory = [];
    this.solved = false;
    this.drag = null;
    this.settle = null;
    this.folds = 0;
    this.idle = 0;
    this.guide.hide();
    this.textures.redraw(this.creases);
    this.paperView.setPaper(this.paper);
    this.board.showCrease(null);
    this.board.setGhostOpacity(0.55);
  }

  undo() {
    const prev = this.history.pop();
    if (!prev) return;
    sfx.undo();
    this.paper = prev;
    this.folds = Math.max(0, this.folds - 1);
    this.creases.length = this.creaseHistory.pop() ?? 0;
    this.textures.redraw(this.creases);
    this.paperView.setPaper(this.paper);
    this.solved = false;
  }

  hint() {
    const next = this.nextFold();
    if (next && this.guide.show(this.paper, next)) {
      this.hintTimer = 5.2;
      return;
    }
    // Off the known path: point at undo instead.
    this.guide.setCaption(this.history.length ? 'Undo, then try another fold' : '');
    this.buttons.find((b) => b.kind === 'undo')?.pulse();
    this.hintTimer = 3;
  }

  // ---------------------------------------------------------------- input

  private onSessionStart() {
    unlockAudio();
    const session = this.world.renderer.xr.getSession();
    if (!session) return;
    session.addEventListener('selectstart', (e) => this.onSelectStart(e));
    session.addEventListener('selectend', (e) => this.onSelectEnd(e));
  }

  private toBoard(world: Vector3, out: Point3): Point3 {
    this.tmp2.copy(world);
    this.boardRoot.worldToLocal(this.tmp2);
    out.x = this.tmp2.x;
    out.y = -this.tmp2.z;
    out.h = this.tmp2.y;
    return out;
  }

  /** Pinch point (hands) or controller tip, in world space. */
  private sourcePoint(
    frame: XRFrame,
    source: XRInputSource,
    out: Vector3,
  ): Vector3 | null {
    const ref = this.world.renderer.xr.getReferenceSpace();
    if (!ref) return null;
    if (source.hand) {
      const thumb = source.hand.get('thumb-tip');
      const index = source.hand.get('index-finger-tip');
      if (!thumb || !index || !frame.getJointPose) return null;
      const a = frame.getJointPose(thumb, ref);
      const b = frame.getJointPose(index, ref);
      if (!a || !b) return null;
      out.set(
        (a.transform.position.x + b.transform.position.x) / 2,
        (a.transform.position.y + b.transform.position.y) / 2,
        (a.transform.position.z + b.transform.position.z) / 2,
      );
    } else if (source.gripSpace) {
      const pose = frame.getPose(source.gripSpace, ref);
      if (!pose) return null;
      const m = pose.transform.matrix;
      // A few centimetres ahead of the grip, roughly at the controller tip.
      out.set(m[12] - m[8] * 0.05, m[13] - m[9] * 0.05, m[14] - m[10] * 0.05);
    } else {
      return null;
    }
    this.world.player.updateWorldMatrix(true, false);
    return out.applyMatrix4(this.world.player.matrixWorld);
  }

  private grabPoint(p: V2): V2 | null {
    if (topFacetAt(this.paper, p)) return p;
    let best: V2 | null = null;
    let bestD = NEAR_MARGIN;
    for (const f of this.paper.facets) {
      const q = closestOnConvex(f.poly, p);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    return best;
  }

  private canStart(): boolean {
    return !this.inputLocked && !this.solved && !this.settle;
  }

  private onSelectStart(e: XRInputSourceEvent) {
    if (!this.canStart()) return;
    // A ray drag that began on this same pinch becomes a near drag instead.
    if (this.drag && !(this.drag.kind === 'ray' && this.time - this.drag.startedAt < 0.15)) {
      return;
    }
    const world = this.sourcePoint(e.frame, e.inputSource, this.tmp);
    if (!world) return;
    const hand: Point3 = { x: 0, y: 0, h: 0 };
    this.toBoard(world, hand);
    if (hand.h > NEAR_HEIGHT || hand.h < -0.03) return;
    const p = this.grabPoint(hand);
    if (!p) return;
    // The same pinch may already have started a ray drag through the far
    // pointer; the near drag takes over, so let go of that pointer.
    if (this.drag?.kind === 'ray') this.board.hitPlane.releasePointerCapture?.(this.drag.pointerId);
    this.beginDrag('near', e.inputSource, -1, p, hand);
  }

  private onSelectEnd(e: XRInputSourceEvent) {
    if (this.drag?.kind === 'near' && this.drag.source === e.inputSource) {
      this.endDrag();
    }
  }

  private onRayDown(e: PointerLike) {
    if (!this.canStart() || this.drag) return;
    unlockAudio();
    const hand: Point3 = { x: 0, y: 0, h: 0 };
    this.toBoard(e.point, hand);
    const p = this.grabPoint(hand);
    if (!p) return;
    this.board.hitPlane.setPointerCapture?.(e.pointerId);
    this.beginDrag('ray', null, e.pointerId, p, { x: p.x, y: p.y, h: 0 });
  }

  private onRayMove(e: PointerLike) {
    const d = this.drag;
    if (!d || d.kind !== 'ray' || d.pointerId !== e.pointerId) return;
    const src = e.ray ?? null;
    let hit: Vector3 | null = null;
    if (src) {
      this.boardRoot.updateWorldMatrix(true, false);
      this.tmp.set(0, 1, 0).transformDirection(this.boardRoot.matrixWorld);
      this.tmp2.setFromMatrixPosition(this.boardRoot.matrixWorld);
      this.plane.setFromNormalAndCoplanarPoint(this.tmp, this.tmp2);
      this.ray.copy(src);
      hit = this.ray.intersectPlane(this.plane, this.tmp);
    }
    this.toBoard(hit ?? e.point, d.hand);
    d.hand.h = 0;
  }

  private onRayUp(e: PointerLike) {
    if (this.drag?.kind === 'ray' && this.drag.pointerId === e.pointerId) {
      this.board.hitPlane.releasePointerCapture?.(e.pointerId);
      this.endDrag();
    }
  }

  private beginDrag(
    kind: DragKind,
    source: XRInputSource | null,
    pointerId: number,
    p: V2,
    hand: Point3,
  ) {
    this.guide.hide();
    this.idle = 0;
    this.drag = {
      kind,
      source,
      pointerId,
      p: { x: p.x, y: p.y },
      hand: { ...hand },
      snap: null,
      angle: 0,
      startedAt: this.time,
    };
    sfx.pick();
  }

  private endDrag() {
    // Settle on where the hand is now, not where it was last frame.
    if (this.drag) this.updateDrag(0, true);
    this.xray.hideSolver();
    const d = this.drag;
    this.drag = null;
    this.board.showCrease(null);
    if (!d || !d.snap) {
      this.paperView.setPaper(this.paper);
      return;
    }
    const commit = d.angle > Math.PI / 2;
    this.settle = {
      snap: d.snap,
      from: d.angle,
      to: commit ? Math.PI : 0,
      t: 0,
      dur: commit ? 0.16 + 0.12 * (1 - d.angle / Math.PI) : 0.2,
    };
    if (!commit) sfx.cancel();
  }

  private onXRFrame(frame: XRFrame) {
    const d = this.drag;
    if (d && d.kind === 'near' && d.source) {
      const world = this.sourcePoint(frame, d.source, this.tmp);
      if (world) this.toBoard(world, d.hand);
    }
    this.updateCursors(frame);
    const ref = this.world.renderer.xr.getReferenceSpace();
    if (this.xray.enabled && ref) {
      this.world.player.updateWorldMatrix(true, false);
      this.xray.updateHands(frame, ref, this.world.player.matrixWorld);
    }
  }

  /**
   * A soft ring under each hand shows where a pinch would take hold of the
   * paper; it tightens as the fingers close and turns gold when in reach.
   */
  private updateCursors(frame: XRFrame) {
    const session = frame.session;
    let used = 0;
    const ref = this.world.renderer.xr.getReferenceSpace();
    if (ref && !this.solved && !this.inputLocked) {
      for (const source of session.inputSources) {
        if (!source.hand || used >= this.cursors.length) continue;
        if (this.drag?.source === source) continue;
        const thumb = source.hand.get('thumb-tip');
        const index = source.hand.get('index-finger-tip');
        if (!thumb || !index || !frame.getJointPose) continue;
        const a = frame.getJointPose(thumb, ref);
        const b = frame.getJointPose(index, ref);
        if (!a || !b) continue;
        const ta = a.transform.position;
        const tb = b.transform.position;
        const gap = Math.hypot(ta.x - tb.x, ta.y - tb.y, ta.z - tb.z);
        this.tmp.set((ta.x + tb.x) / 2, (ta.y + tb.y) / 2, (ta.z + tb.z) / 2);
        this.world.player.updateWorldMatrix(true, false);
        this.tmp.applyMatrix4(this.world.player.matrixWorld);
        const hand = this.cursorHand;
        this.toBoard(this.tmp, hand);
        if (hand.h > 0.14 || hand.h < -0.03) continue;
        const p = this.grabPoint(hand);
        if (!p) continue;
        const c = this.cursors[used++];
        c.visible = true;
        c.position.set(p.x, 0.012, -p.y);
        const near = hand.h < NEAR_HEIGHT;
        const s = 0.6 + Math.min(1, gap / 0.06) * 0.9;
        c.scale.setScalar(s);
        const m = c.material as MeshBasicMaterial;
        m.color.set(near ? 0xffd166 : 0xffffff);
        m.opacity = near ? 0.95 : 0.5;
      }
    }
    for (let i = used; i < this.cursors.length; i++) this.cursors[i].visible = false;
  }

  // ---------------------------------------------------------------- update

  update(dt: number, time: number) {
    // A long blur (system menu, headset off) must not jump the animations.
    dt = Math.min(dt, 0.1);
    this.time = time;
    for (const b of this.buttons) b.update(dt);
    this.board.update(dt);
    this.updateGuide(dt);
    this.updateVanish(dt);
    if (this.drag) this.updateDrag(dt);
    if (this.settle) this.updateSettle(dt);
    this.glow = Math.max(0, this.glow - dt * 1.2);
    this.paperView.setGlow(this.glow > 0 ? Math.sin(this.glow * Math.PI) : 0);
  }

  /** Shows a short line on the caption strip for a few seconds. */
  say(text: string, seconds = 3.5) {
    this.message = text;
    this.messageTimer = seconds;
  }

  private boardPoint(x: number, y: number, h: number): Vector3 {
    return this.boardRoot.localToWorld(new Vector3(x, h, -y));
  }

  /** Feeds the X-ray view with the live crease computation. */
  private showSolver(d: Drag, raw: Line | null) {
    const p = this.boardPoint(d.p.x, d.p.y, 0.003);
    const h = this.boardPoint(d.hand.x, d.hand.y, Math.max(0, d.hand.h));
    let ends: [Vector3, Vector3] | null = null;
    if (raw) {
      const fx = raw.nx * raw.d;
      const fy = raw.ny * raw.d;
      const tx = -raw.ny * 0.24;
      const ty = raw.nx * 0.24;
      ends = [this.boardPoint(fx - tx, fy - ty, 0.006), this.boardPoint(fx + tx, fy + ty, 0.006)];
    }
    this.xray.showSolver(p, h, ends);
  }

  private updateGuide(dt: number) {
    const busy = this.drag !== null || this.settle !== null || this.solved || this.inputLocked;
    this.idle = busy ? 0 : this.idle + dt;
    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      this.guide.setCaption(this.messageTimer > 0 ? this.message : '');
      this.guide.update(dt);
      return;
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) {
        this.guide.hide();
        this.guide.setCaption(busy ? '' : this.captionFor());
      }
    } else {
      this.guide.setCaption(this.solved ? '' : this.captionFor());
      const wait = this.folds === 0 ? 1.2 : 6;
      if (this.tutorial && !busy && !this.guide.showing && this.idle > wait) {
        const next = this.nextFold();
        if (next) this.guide.show(this.paper, next);
      }
    }
    this.guide.update(dt);
  }

  private updateDrag(dt: number, immediate = false) {
    const d = this.drag!;
    const raw = rawCrease(d.p, d.hand);
    const snap = raw ? snapCrease(raw, d.p, this.paper, d.snap) : null;
    if (this.xray.enabled) this.showSolver(d, raw);
    const changed =
      (snap === null) !== (d.snap === null) ||
      (snap && d.snap && (snap.f !== d.snap.f || snap.k !== d.snap.k || snap.s !== d.snap.s));
    if (changed) {
      d.snap = snap;
      if (snap) {
        const parts = splitPaper(this.paper, snap.line, snap.s)!;
        this.paperView.setSplit(parts.stay, parts.move, snap.line, snap.s);
        sfx.snap();
      } else {
        this.paperView.setPaper(this.paper);
      }
    }
    if (!d.snap) {
      this.board.showCrease(null);
      return;
    }
    // Angle that swings the grabbed point towards the hand around the crease.
    const across = d.snap.s * lineSide(d.snap.line, { x: d.hand.x, y: d.hand.y });
    const target = Math.atan2(Math.max(0, d.hand.h), across);
    const k = immediate ? 1 : 1 - Math.exp(-dt * 22);
    d.angle += (target - d.angle) * k;
    this.paperView.setFlapAngle(d.angle);
    this.board.showCrease(d.snap.line, d.angle > Math.PI / 2);
  }

  private updateSettle(dt: number) {
    const s = this.settle!;
    s.t = Math.min(1, s.t + dt / s.dur);
    const e = s.t * s.t * (3 - 2 * s.t);
    this.paperView.setFlapAngle(s.from + (s.to - s.from) * e);
    if (s.t < 1) return;
    this.settle = null;
    if (s.to === 0) {
      this.paperView.setPaper(this.paper);
      return;
    }
    this.commitFold(s.snap);
  }

  private commitFold(snap: Snap) {
    const next = foldPaper(this.paper, snap.line, snap.s);
    if (!next) {
      this.paperView.setPaper(this.paper);
      return;
    }
    // Every facet the crease crosses keeps a mark on the sheet.
    this.creaseHistory.push(this.creases.length);
    for (const f of this.paper.facets) {
      const chord = lineChord(snap.line, f.poly);
      if (chord) {
        this.creases.push([
          applyAffine(f.toSheet, chord[0]),
          applyAffine(f.toSheet, chord[1]),
        ]);
      }
    }
    this.history.push(this.paper);
    this.paper = next;
    this.folds++;
    this.textures.redraw(this.creases);
    this.paperView.setPaper(this.paper);
    sfx.fold();
    if (rasterMatch(rasterize(this.paper), this.target) >= 0.999) {
      this.solved = true;
      this.glow = 1;
      this.board.setGhostOpacity(0);
      this.board.setOutlineVisible(false);
      sfx.solved();
      this.events.onSolved?.(this.level, this.paper, this.boardRoot);
    }
  }

  /** True while a fold is being made or animated. */
  get busy(): boolean {
    return this.drag !== null || this.settle !== null;
  }

  /** Paper facets in world space, for the creature reveal. */
  get facets(): readonly Facet[] {
    return this.paper.facets;
  }

  hidePaper(hidden: boolean) {
    this.paperView.root.visible = !hidden;
    this.paperView.root.scale.setScalar(1);
    this.paperView.root.position.set(0, 0, 0);
    this.vanish = -1;
  }

  /** Paper lifts, spins and shrinks into the spot where a creature appears. */
  vanishPaper() {
    this.vanish = 0;
    const b = paperBounds(this.paper);
    this.vanishCenter.set((b.minX + b.maxX) / 2, 0, -(b.minY + b.maxY) / 2);
  }
  private vanish = -1;
  private vanishCenter = new Vector3();

  private updateVanish(dt: number) {
    if (this.vanish < 0) return;
    this.vanish = Math.min(1, this.vanish + dt / 0.35);
    const e = this.vanish * this.vanish;
    const r = this.paperView.root;
    const s = Math.max(0.001, 1 - e);
    r.scale.set(s, 1, s);
    // Shrink towards the centre of the folded shape and rise a little.
    r.position.set(this.vanishCenter.x * (1 - s), e * 0.03, this.vanishCenter.z * (1 - s));
    if (this.vanish >= 1) r.visible = false;
  }
}

/** The bits of a @pmndrs/pointer-events event this game reads. */
interface PointerLike {
  pointerId: number;
  point: Vector3;
  ray?: Ray;
}
