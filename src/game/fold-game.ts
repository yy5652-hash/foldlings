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
  bestMatch,
  symmetricTargets,
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
import { CONTROL_GLASS, fadeTree, floatOverRoom, follow, LAYER, Surface } from './glass.js';
import { Guide } from './guide.js';
import { Result, scoreSolve } from './score.js';
import { HandGrace, HandsMissing } from './hand-grace.js';
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
  /** The fold under the hand would solve the puzzle. */
  solves: boolean;
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
  onSolved?: (level: Level, paper: PaperState, boardRoot: Group, result: Result) => void;
  onRecenter?: () => void;
  onDaily?: () => void;
  onSound?: () => void;
  onMenu?: () => void;
  onLevels?: () => void;
  /** Free fold's Save token: the folds made so far. */
  onSave?: (folds: FoldSpec[]) => void;
  /** Small collection line for the goal card ("Zoo 7 · 3-day streak"). */
  footer?: () => string;
}

/** The capsules beside the mat: size, then where they float and how they tilt. */
const CAPSULE_W = 0.058;
const CAPSULE_H = 0.156;
const CAPSULE_X = 0.3;
const CAPSULE_Y = 0.052;
const CAPSULE_Z = 0.06;
const CAPSULE_TILT = -0.92;

export class FoldGame {
  readonly boardRoot = new Group();
  readonly boardEntity: Entity;
  readonly board = new BoardView();
  private textures: PaperTextures;
  private paperView: PaperView;
  private buttons: Button[] = [];
  private capsules: { root: Group; entity: Entity }[] = [];
  private easyFolds = false;
  private reduceMotion = false;

  levelIndex = 0;
  level: Level = LEVELS[0];
  paper: PaperState = initialPaper();
  private history: PaperState[] = [];
  private creases: [V2, V2][] = [];
  private creaseHistory: number[] = [];
  private target: Uint8Array = new Uint8Array(0);
  /** The goal and its turned or mirrored twins; matching any one solves. */
  private targets: Uint8Array[] = [];
  private targetFacets: Facet[] = [];
  /** Picture after each step of the known solution, for hints. */
  private prefixes: Uint8Array[] = [];
  solved = false;
  inputLocked = false;
  isDaily = false;
  /** Free fold: no goal; the hint token saves the folds as a puzzle. */
  isFree = false;
  /** The folds made on this sheet, in order (undo removes the last). */
  private played: FoldSpec[] = [];
  readonly guide = new Guide();
  readonly xray = new Xray();
  private idle = 0;
  private hintTimer = 0;
  /** How far up the hint ladder the player has gone for this fold. */
  private hintStep = 0;
  /** A new sheet drifting down onto the mat (0..1), or -1. */
  private drop = -1;
  private message = '';
  private messageTimer = 0;
  private folds = 0;
  /** A hint was asked for on this attempt (costs the perfect star). */
  private hinted = false;

  private drag: Drag | null = null;
  private handGrace = new HandGrace();
  private handsMissing = new HandsMissing();
  private handsTracked = false;
  private pinchingHands = new Set<XRInputSource>();
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

    // Two glass capsules float beside the mat, tilted to the player. The most
    // used pair sits on the working hand's side; everything else lives in the
    // menu (palm-up or the menu button).
    this.capsules = [this.addCapsule(1), this.addCapsule(-1)];
    this.addButton('hint', this.capsules[0], 0.031, () => this.hint(), 'Hint');
    this.addButton('undo', this.capsules[0], -0.039, () => this.undo(), 'Undo');
    this.addButton('levels', this.capsules[1], 0.031, () => this.events.onLevels?.(), 'Levels');
    this.addButton('menu', this.capsules[1], -0.039, () => this.events.onMenu?.(), 'Menu');
    for (const c of this.capsules) floatOverRoom(c.root);

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
      if (this.drag?.source?.hand) this.endDrag(true);
      this.handGrace.reset();
      this.handsMissing.reset();
      this.handsTracked = false;
      this.pinchingHands.clear();
    });
    world.onXRFrame((frame) => this.onXRFrame(frame));
  }

  button(kind: IconKind): Button | undefined {
    return this.buttons.find((b) => b.kind === kind);
  }

  setEasyFolds(on: boolean) {
    this.easyFolds = on;
  }

  setLeftHanded(on: boolean) {
    this.placeCapsule(this.capsules[0], on ? -1 : 1);
    this.placeCapsule(this.capsules[1], on ? 1 : -1);
  }

  setReduceMotion(on: boolean) {
    this.reduceMotion = on;
    if (on && this.drop >= 0) this.updateDrop(0);
  }

  setHighContrast(on: boolean) {
    this.textures.setHighContrast(on);
    this.board.setHighContrast(on);
  }

  private placeCapsule(c: { root: Group }, side: number) {
    c.root.position.set(side * CAPSULE_X, CAPSULE_Y, CAPSULE_Z);
    c.root.rotation.set(CAPSULE_TILT, -side * 0.2, 0, 'YXZ');
  }

  private addCapsule(side: number): { root: Group; entity: Entity } {
    const root = new Group();
    root.name = 'Capsule';
    const glass = new Surface({
      w: CAPSULE_W,
      h: CAPSULE_H,
      ...CONTROL_GLASS,
      shadow: 0.36,
      soft: 0.026,
      drop: 0.012,
      order: LAYER.window,
    });
    root.add(glass.mesh);
    const capsule = { root, entity: this.world.createTransformEntity(root, this.boardEntity) };
    this.placeCapsule(capsule, side);
    return capsule;
  }

  private addButton(kind: IconKind, capsule: { entity: Entity }, y: number, action: () => void, label: string) {
    const b = new Button(
      kind,
      () => {
        if (this.inputLocked || this.drag || this.settle) return;
        unlockAudio();
        sfx.click();
        action();
      },
      label,
      { plain: true, r: 0.022, labelSize: 0.0135 },
    );
    b.root.name = `Capsule_${kind}`;
    b.root.position.set(0, y, 0.002);
    b.root.rotation.x = Math.PI / 2;
    const e = this.world.createTransformEntity(b.root, capsule.entity);
    e.addComponent(RayInteractable);
    e.addComponent(PokeInteractable);
    this.buttons.push(b);
  }

  loadLevel(index: number) {
    this.levelIndex = ((index % LEVELS.length) + LEVELS.length) % LEVELS.length;
    this.isDaily = false;
    this.setFree(false);
    this.setLevel(LEVELS[this.levelIndex], `${this.levelIndex + 1} / ${LEVELS.length}`, this.levelIndex + 3);
  }

  loadDaily(level: Level, subtitle: string) {
    this.isDaily = true;
    this.setFree(false);
    this.setLevel(level, subtitle, level.id.length * 17);
  }

  /** A player-made or shared puzzle, scored like any level. */
  loadCustom(level: Level, subtitle: string) {
    this.isDaily = false;
    this.levelIndex = -1;
    this.setFree(false);
    this.setLevel(level, subtitle, level.id.length * 13);
  }

  /** A blank sheet with no goal: fold anything, then save it as a puzzle. */
  loadFree(level: Level) {
    this.isDaily = false;
    this.levelIndex = -1;
    this.setFree(true);
    this.setLevel(level, 'Fold anything, then tap Save', 7);
    this.board.setGhostOpacity(0);
    this.board.setOutlineVisible(false);
  }

  private setFree(on: boolean) {
    this.isFree = on;
    const b = this.button('hint');
    b?.setIcon(on ? 'save' : 'hint');
    b?.setLabel(on ? 'Save' : 'Hint');
  }

  /** The folds made on the current sheet. */
  get playedFolds(): FoldSpec[] {
    return [...this.played];
  }

  private setLevel(level: Level, subtitle: string, seed: number) {
    this.level = level;
    const goal = applyFolds(level.solution);
    if (!goal) throw new Error(`Level ${level.id} has an invalid solution`);
    this.targetFacets = goal.facets;
    this.target = rasterize(goal);
    this.targets = symmetricTargets(goal);
    this.prefixes = [rasterize(initialPaper())];
    let s: PaperState | null = initialPaper();
    for (const f of level.solution) {
      s = s && applyFold(s, f);
      if (s) this.prefixes.push(rasterize(s));
    }
    this.textures.setLook(level.look, seed);
    this.board.setGoal(this.targetFacets, level.look, level.name, subtitle, this.events.footer?.() ?? '', level.creature);
    this.restart();
    this.drop = 0;
    if (this.reduceMotion) this.updateDrop(0);
    sfx.pick();
  }

  /** Teaching levels show the ghost fold on their own. */
  private get tutorial(): boolean {
    return !this.isDaily && !this.isFree && this.levelIndex >= 0 && this.levelIndex < 2;
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
    this.handGrace.reset();
    this.settle = null;
    this.folds = 0;
    this.hinted = false;
    this.idle = 0;
    this.guide.hide();
    this.textures.redraw(this.creases);
    this.paperView.setPaper(this.paper);
    this.board.showCrease(null);
    this.board.setGhostOpacity(this.isFree ? 0 : 0.55);
    this.played = [];
    this.board.setFoldCount(0, this.level.par);
    this.clearHints();
  }

  private clearHints() {
    this.hintStep = 0;
    this.board.showHintCorner(null);
    this.board.showHintLine(null);
  }

  undo() {
    const prev = this.history.pop();
    if (prev) this.played.pop();
    if (!prev) return;
    sfx.undo();
    this.paper = prev;
    this.folds = Math.max(0, this.folds - 1);
    this.creases.length = this.creaseHistory.pop() ?? 0;
    this.textures.redraw(this.creases);
    this.paperView.setPaper(this.paper);
    this.solved = false;
    this.board.setFoldCount(this.folds, this.level.par);
    this.clearHints();
  }

  /** Each press gives a little more: the corner, then the crease, then a demonstration. */
  hint() {
    if (this.isFree) {
      this.events.onSave?.(this.playedFolds);
      return;
    }
    this.hinted = true;
    const next = this.nextFold();
    const pts = next ? this.nextFoldPoints() : null;
    if (next && pts) {
      this.hintStep = Math.min(3, this.hintStep + 1);
      this.board.showHintCorner(pts.grab);
      if (this.hintStep === 1) {
        this.guide.setCaption('Pinch here');
        this.hintTimer = 4;
        return;
      }
      this.board.showHintLine(creaseLine(next));
      if (this.hintStep === 2) {
        this.guide.setCaption('Fold along the gold line');
        this.hintTimer = 4;
        return;
      }
      if (this.guide.show(this.paper, next)) {
        this.hintTimer = 5.2;
        return;
      }
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
    this.handsMissing.reset();
    this.handsTracked = false;
    this.pinchingHands.clear();
    session.addEventListener('selectstart', (e) => this.onSelectStart(e));
    session.addEventListener('selectend', (e) => this.onSelectEnd(e));
    session.addEventListener('inputsourceschange', (e) => {
      for (const source of e.removed) {
        this.pinchingHands.delete(source);
        if (source.hand && this.drag?.source === source) this.handGrace.trackingLost();
      }
    });
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
    return !this.inputLocked && !this.solved && !this.settle && this.drop < 0;
  }

  private onSelectStart(e: XRInputSourceEvent) {
    if (e.inputSource.hand) {
      this.pinchingHands.add(e.inputSource);
      if (this.drag?.source === e.inputSource &&
          (this.handGrace.pendingRelease || this.handGrace.frozen)) {
        this.handGrace.pinchStarted();
        if (this.drag.kind === 'ray') this.board.hitPlane.setPointerCapture?.(this.drag.pointerId);
        return;
      }
    }
    if (!this.canStart()) return;
    if (this.drag?.source?.hand && this.drag.source !== e.inputSource) return;
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
    if (e.inputSource.hand) {
      this.pinchingHands.delete(e.inputSource);
      if (this.drag?.source === e.inputSource) {
        this.handGrace.pinchEnded();
        return;
      }
    }
    if (this.drag?.kind === 'near' && this.drag.source === e.inputSource) {
      this.endDrag();
    }
  }

  private onRayDown(e: PointerLike) {
    const source = this.rayHand(e.pointerId);
    if (source && this.drag?.kind === 'ray' && this.drag.source === source) {
      this.board.hitPlane.setPointerCapture?.(e.pointerId);
      return;
    }
    if (!this.canStart() || this.drag) return;
    unlockAudio();
    const hand: Point3 = { x: 0, y: 0, h: 0 };
    this.toBoard(e.point, hand);
    const p = this.grabPoint(hand);
    if (!p) return;
    this.board.hitPlane.setPointerCapture?.(e.pointerId);
    this.beginDrag('ray', source, e.pointerId, p, { x: p.x, y: p.y, h: 0 });
  }

  private rayHand(pointerId: number): XRInputSource | null {
    if (!this.world.renderer.xr.isPresenting) return null;
    const input = this.world.input.xr;
    const side = input.multiPointers.left.getPointer('ray').id === pointerId ? 'left'
      : input.multiPointers.right.getPointer('ray').id === pointerId ? 'right' : null;
    const source = side ? input.getPrimaryInputSource(side) : null;
    return source?.hand ? source : null;
  }

  private onRayMove(e: PointerLike) {
    const d = this.drag;
    if (!d || d.kind !== 'ray' || d.pointerId !== e.pointerId) return;
    if (d.source?.hand && (this.handGrace.frozen || this.handGrace.pendingRelease)) return;
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
      if (this.drag.source?.hand) {
        this.handGrace.pinchEnded();
        // Pointer-up clears capture; keep receiving moves throughout the grace window.
        this.board.hitPlane.setPointerCapture?.(e.pointerId);
        return;
      }
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
    this.handGrace.reset();
    if (source?.hand) this.handGrace.begin();
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
      solves: false,
    };
    sfx.pick();
  }

  private endDrag(cancel = false) {
    // Settle on where the hand is now, not where it was last frame.
    if (this.drag && !cancel) this.updateDrag(0, true);
    this.xray.hideSolver();
    const d = this.drag;
    this.drag = null;
    this.handGrace.reset();
    if (d?.kind === 'ray' && d.source?.hand) {
      this.board.hitPlane.releasePointerCapture?.(d.pointerId);
    }
    this.board.showCrease(null);
    if (!d || !d.snap) {
      this.paperView.setPaper(this.paper);
      if (d && cancel) sfx.cancel();
      return;
    }
    const commit = !cancel && d.angle > Math.PI / 2;
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
    if (d?.source?.hand) {
      let present = false;
      for (const source of frame.session.inputSources) {
        if (source === d.source) present = true;
      }
      if (!present) {
        this.handGrace.trackingLost();
        // A returning hand may have a new input source; never borrow the other hand.
        for (const source of frame.session.inputSources) {
          if (source.hand && source.handedness !== 'none' && source.handedness === d.source.handedness) {
            d.source = source;
            present = true;
            break;
          }
        }
      }
      const world = present ? this.sourcePoint(frame, d.source, this.tmp) : null;
      if (!world) {
        this.handGrace.trackingLost();
      } else {
        const pinching = d.source.gamepad?.buttons[0]?.pressed ?? this.pinchingHands.has(d.source);
        const action = this.handGrace.trackingFound(pinching);
        if (action === 'cancel') this.endDrag(true);
        // While a release is pending, keep the spot where the pinch let go.
        else if (d.kind === 'near' && !this.handGrace.pendingRelease) this.toBoard(world, d.hand);
        else if (action === 'resume') this.board.hitPlane.setPointerCapture?.(d.pointerId);
      }
    } else if (d && d.kind === 'near' && d.source) {
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
    this.handsTracked = false;
    if (ref) {
      for (const source of session.inputSources) {
        // Controllers count as present hands: no "show your hands" for them.
        if (!source.hand) {
          if (source.gamepad) this.handsTracked = true;
          continue;
        }
        const thumb = source.hand.get('thumb-tip');
        const index = source.hand.get('index-finger-tip');
        if (!thumb || !index || !frame.getJointPose) continue;
        const a = frame.getJointPose(thumb, ref);
        const b = frame.getJointPose(index, ref);
        if (!a || !b) continue;
        this.handsTracked = true;
        if (this.solved || this.inputLocked || used >= this.cursors.length || this.drag?.source === source) continue;
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
    const action = this.handGrace.update(dt);
    if (action === 'end') this.endDrag();
    else if (action === 'cancel') this.endDrag(true);
    if (this.handsMissing.update(dt, this.world.renderer.xr.isPresenting, this.handsTracked, !this.solved)) {
      this.say('Show your hands to keep folding', 3);
    }
    // A long blur (system menu, headset off) must not jump the animations.
    dt = Math.min(dt, 0.1);
    this.time = time;
    for (const b of this.buttons) b.update(dt);
    this.updateStage(dt);
    this.board.update(dt);
    this.updateGuide(dt);
    this.updateVanish(dt);
    this.updateDrop(dt);
    if (this.drag && !this.handGrace.frozen) this.updateDrag(dt);
    if (this.settle) this.updateSettle(dt);
    this.glow = Math.max(0, this.glow - dt * 1.2);
    // A soft pulse while the fold under the hand would solve the puzzle.
    const warm = this.drag?.solves ? 0.22 + 0.12 * Math.sin(this.time * 9) : 0;
    this.paperView.setGlow(this.glow > 0 ? Math.sin(this.glow * Math.PI) : warm);
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
      this.guide.setCaption(this.messageTimer > 0 && this.stageOn && !this.hintsOff ? this.message : '');
      this.guide.update(dt);
      return;
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) {
        this.guide.hide();
        this.guide.setCaption(busy || !this.stageOn || this.hintsOff ? '' : this.captionFor());
      }
    } else {
      this.guide.setCaption(this.solved || !this.stageOn || this.hintsOff ? '' : this.captionFor());
      const wait = this.folds === 0 ? 1.2 : 6;
      if (this.stageOn && !this.hintsOff && this.tutorial && !busy && !this.guide.showing && this.idle > wait) {
        const next = this.nextFold();
        if (next) this.guide.show(this.paper, next);
      }
    }
    this.guide.update(dt);
  }

  private updateDrag(dt: number, immediate = false) {
    const d = this.drag!;
    const raw = rawCrease(d.p, d.hand);
    const snap = raw ? snapCrease(raw, d.p, this.paper, d.snap, this.easyFolds ? 0.09 : 0.05) : null;
    if (this.xray.enabled) this.showSolver(d, raw);
    const changed =
      (snap === null) !== (d.snap === null) ||
      (snap && d.snap && (snap.f !== d.snap.f || snap.k !== d.snap.k || snap.s !== d.snap.s));
    if (changed) {
      d.snap = snap;
      if (snap) {
        const parts = splitPaper(this.paper, snap.line, snap.s)!;
        this.paperView.setSplit(parts.stay, parts.move, snap.line, snap.s);
        const result = foldPaper(this.paper, snap.line, snap.s);
        const solves = !this.isFree && !!result && bestMatch(rasterize(result), this.targets) >= 0.999;
        if (solves && !d.solves) sfx.warm();
        else sfx.snap();
        d.solves = solves;
      } else {
        d.solves = false;
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
    this.board.showCrease(d.snap.line, d.angle > Math.PI / 2, d.solves);
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
    this.played.push({ f: snap.f, k: snap.k, s: snap.s });
    this.paper = next;
    this.folds++;
    this.textures.redraw(this.creases);
    this.paperView.setPaper(this.paper);
    this.board.setFoldCount(this.folds, this.level.par);
    this.clearHints();
    sfx.fold();
    const match = this.isFree ? 0 : bestMatch(rasterize(this.paper), this.targets);
    if (match < 0.999 && match >= 0.85 && this.folds >= this.level.par + 1) {
      // Honest about a near miss: the real per-cell match, and the way back.
      this.say(`So close: ${Math.floor(match * 100)}% match. Undo one fold?`, 4);
      this.button('undo')?.pulse(3);
    }
    if (match >= 0.999) {
      this.solved = true;
      this.glow = 1;
      this.board.setGhostOpacity(0);
      this.board.setOutlineVisible(false);
      sfx.solved();
      this.events.onSolved?.(this.level, this.paper, this.boardRoot, scoreSolve(this.folds, this.level.par, this.hinted));
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

  /** Clears the mat's controls and hints away for the opening, then fades them back. */
  setStage(on: boolean) {
    this.stageOn = on;
    if (!on) this.guide.hide();
    this.board.setHintsVisible(on);
  }
  private stageOn = true;
  /** Film capture: no tutorial lines or goal marks, just the paper. */
  hintsOff = false;
  private stageK = 1;
  private stageShown = 1;

  private updateStage(dt: number) {
    this.stageK = follow(this.stageK, this.stageOn ? 1 : 0, this.stageOn ? 5 : 14, dt);
    if (Math.abs(this.stageK - this.stageShown) < 0.004) return;
    this.stageShown = this.stageK;
    for (const c of this.capsules) {
      c.root.visible = this.stageK > 0.01;
      fadeTree(c.root, this.stageK * this.stageK);
    }
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

  /** The new sheet drifts down like a leaf and settles flat. */
  private updateDrop(dt: number) {
    if (this.drop < 0 || this.vanish >= 0) return;
    this.drop = this.reduceMotion ? 1 : Math.min(1, this.drop + dt / 0.9);
    const e = this.drop;
    const r = this.paperView.root;
    const k = 1 - e;
    r.position.set(Math.sin(e * 7) * 0.025 * k, 0.26 * k * k, Math.cos(e * 5) * 0.012 * k);
    r.rotation.set(Math.cos(e * 8) * 0.22 * k, 0, Math.sin(e * 9) * 0.28 * k);
    if (e >= 1) {
      this.drop = -1;
      r.position.set(0, 0, 0);
      r.rotation.set(0, 0, 0);
      sfx.snap();
    }
  }

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
