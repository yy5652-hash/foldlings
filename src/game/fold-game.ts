/**
 * One folding session on the mat: input from pinching hands, controllers,
 * rays, gaze or a mouse becomes a crease, a swinging flap, and a fold.
 */

import {
  Entity,
  Group,
  Plane,
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
  lineChord,
  lineSide,
  V2,
} from '../fold/geom.js';
import {
  applyFolds,
  Facet,
  foldPaper,
  initialPaper,
  PaperState,
  rasterize,
  rasterMatch,
  splitPaper,
  topFacetAt,
} from '../fold/paper.js';
import { BoardView } from './board-view.js';
import { Button, IconKind } from './button.js';
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

const NEAR_HEIGHT = 0.07;
const NEAR_MARGIN = 0.025;

export interface FoldGameEvents {
  onSolved?: (level: Level, paper: PaperState, boardRoot: Group) => void;
  onRecenter?: () => void;
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
  solved = false;
  inputLocked = false;

  private drag: Drag | null = null;
  private settle: Settle | null = null;
  private glow = 0;
  private time = 0;

  private tmp = new Vector3();
  private tmp2 = new Vector3();
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

    this.addButton('undo', 0.29, 0.1, () => this.undo());
    this.addButton('restart', 0.29, 0.02, () => this.restart());
    this.addButton('hint', 0.29, -0.06, () => this.hint());
    this.addButton('recenter', 0.29, -0.14, () => this.events.onRecenter?.());

    world.renderer.xr.addEventListener('sessionstart', () => this.onSessionStart());
    world.onXRFrame((frame) => this.onXRFrame(frame));

    this.loadLevel(0);
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
    this.level = LEVELS[this.levelIndex];
    const goal = applyFolds(this.level.solution);
    if (!goal) throw new Error(`Level ${this.level.id} has an invalid solution`);
    this.targetFacets = goal.facets;
    this.target = rasterize(goal);
    this.textures.setLook(this.level.look, this.levelIndex + 3);
    this.board.setGoal(
      this.targetFacets,
      this.level.look,
      this.level.name,
      `${this.levelIndex + 1} / ${LEVELS.length}`,
    );
    this.restart();
  }

  restart() {
    this.paper = initialPaper();
    this.history = [];
    this.creases = [];
    this.creaseHistory = [];
    this.solved = false;
    this.drag = null;
    this.settle = null;
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
    this.creases.length = this.creaseHistory.pop() ?? 0;
    this.textures.redraw(this.creases);
    this.paperView.setPaper(this.paper);
    this.solved = false;
  }

  hint() {
    // Placeholder until the guided hint lands: flash the goal outline.
    this.board.setGhostOpacity(1);
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
    if (!d || d.kind !== 'near' || !d.source) return;
    const world = this.sourcePoint(frame, d.source, this.tmp);
    if (world) this.toBoard(world, d.hand);
  }

  // ---------------------------------------------------------------- update

  update(dt: number, time: number) {
    this.time = time;
    for (const b of this.buttons) b.update(dt);
    if (this.drag) this.updateDrag(dt);
    if (this.settle) this.updateSettle(dt);
    this.glow = Math.max(0, this.glow - dt * 1.2);
    this.paperView.setGlow(this.glow > 0 ? Math.sin(this.glow * Math.PI) : 0);
  }

  private updateDrag(dt: number, immediate = false) {
    const d = this.drag!;
    const raw = rawCrease(d.p, d.hand);
    const snap = raw ? snapCrease(raw, d.p, this.paper, d.snap) : null;
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
    this.textures.redraw(this.creases);
    this.paperView.setPaper(this.paper);
    sfx.fold();
    if (rasterMatch(rasterize(this.paper), this.target) >= 0.999) {
      this.solved = true;
      this.glow = 1;
      this.board.setGhostOpacity(0);
      sfx.solved();
      this.events.onSolved?.(this.level, this.paper, this.boardRoot);
    }
  }

  /** Paper facets in world space, for the creature reveal. */
  get facets(): readonly Facet[] {
    return this.paper.facets;
  }

  hidePaper(hidden: boolean) {
    this.paperView.root.visible = !hidden;
  }
}

/** The bits of a @pmndrs/pointer-events event this game reads. */
interface PointerLike {
  pointerId: number;
  point: Vector3;
  ray?: Ray;
}
