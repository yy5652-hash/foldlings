/**
 * Wires the folding game into the IWSDK world: creates it, keeps the mat in
 * a comfortable place, and steps it every frame.
 */

import {
  Color,
  createSystem,
  DirectionalLight,
  HemisphereLight,
  Vector3,
  VisibilityState,
  XRPlane,
} from '@iwsdk/core';
import { FoldGame } from './fold-game.js';
import {
  floatingPlacement,
  Placement,
  PlaneInfo,
  tablePlacement,
} from './placement.js';

/** Where the mat rests in the flat browser view. */
const DESKTOP_POSITION = new Vector3(0, 0.74, -0.42);

export class GameSystem extends createSystem({
  planes: { required: [XRPlane] },
}) {
  game!: FoldGame;
  private sessionTime = -1;
  private placed: Placement | null = null;
  private moveFrom = new Vector3();
  private moveTo = new Vector3();
  private yawFrom = 0;
  private yawTo = 0;
  private moveT = 1;
  private up = new Vector3(0, 1, 0);

  init(): void {
    // Soft room light for the mat, buttons and creatures.
    const hemi = new HemisphereLight(new Color(0xfff4e6), new Color(0x6b5a4a), 1.6);
    const sun = new DirectionalLight(new Color(0xffffff), 1.4);
    sun.position.set(0.6, 2, 0.8);
    this.world.scene.add(hemi, sun);

    this.game = new FoldGame(this.world, {
      onRecenter: () => this.place(true),
    });
    this.game.boardRoot.position.copy(DESKTOP_POSITION);
    if (import.meta.env.DEV) {
      // Test hook: board point (u, v, height) → world position.
      (window as unknown as Record<string, unknown>).__foldlings = {
        game: this.game,
        boardWorld: (u: number, v: number, h = 0) => {
          this.game.boardRoot.updateWorldMatrix(true, false);
          return new Vector3(u, h, -v).applyMatrix4(this.game.boardRoot.matrixWorld).toArray();
        },
      };
    }
    this.world.renderer.xr.addEventListener('sessionstart', () => {
      this.sessionTime = 0;
      this.placed = null;
    });
    this.world.renderer.xr.addEventListener('sessionend', () => {
      this.sessionTime = -1;
      this.placed = null;
      this.game.boardRoot.position.copy(DESKTOP_POSITION);
      this.game.boardRoot.quaternion.identity();
    });
  }

  private planeInfos(): PlaneInfo[] {
    const out: PlaneInfo[] = [];
    for (const e of this.queries.planes.entities) {
      const plane = e.getValue(XRPlane, '_plane') as XRPlane | undefined;
      if (plane && e.object3D) out.push({ object: e.object3D, plane });
    }
    return out;
  }

  /** Picks a spot; `force` re-places even if already on a table. */
  private place(force: boolean) {
    if (!force && this.placed?.onSurface) return;
    const head = this.player.head;
    const table = tablePlacement(head, this.planeInfos());
    const next = table ?? (force || !this.placed ? floatingPlacement(head) : null);
    if (!next) return;
    const root = this.game.boardRoot;
    this.moveFrom.copy(root.position);
    this.yawFrom = this.placed ? this.yawTo : next.yaw;
    if (!this.placed) this.moveFrom.copy(next.position).y -= 0.05;
    this.moveTo.copy(next.position);
    this.yawTo = next.yaw;
    this.moveT = 0;
    this.placed = next;
    console.info('[foldlings] mat placed:', next.label, next.position.toArray().map((v) => v.toFixed(2)).join(', '));
  }

  update(delta: number, time: number): void {
    if (this.world.visibilityState.peek() === VisibilityState.VisibleBlurred) return;
    if (this.sessionTime >= 0) {
      this.sessionTime += delta;
      // First placement once the head pose has settled, then upgrade to a
      // real table when the room scan arrives.
      if (!this.placed && this.sessionTime > 0.3) this.place(false);
      else if (this.placed && !this.placed.onSurface && this.sessionTime < 10) {
        const table = tablePlacement(this.player.head, this.planeInfos());
        if (table) this.place(false);
      }
    }
    if (this.moveT < 1) {
      this.moveT = Math.min(1, this.moveT + delta / 0.6);
      const e = 1 - Math.pow(1 - this.moveT, 3);
      const root = this.game.boardRoot;
      root.position.lerpVectors(this.moveFrom, this.moveTo, e);
      root.quaternion.setFromAxisAngle(this.up, this.yawFrom + (this.yawTo - this.yawFrom) * e);
    }
    this.game.update(delta, time);
  }
}
