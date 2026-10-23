/**
 * The player's room as Foldlings understands it: surfaces from WebXR plane
 * detection, and a room frame tied to a persistent anchor so creatures stay
 * where they settled between visits.
 */

import { Group, Matrix4, Object3D, Vector3, World } from '@iwsdk/core';

export type SurfaceKind = 'floor' | 'table' | 'wall';

export interface Surface {
  kind: SurfaceKind;
  label: string;
  /** World-space outline (horizontal: y is the height). */
  polygon: Vector3[];
  normal: Vector3;
  center: Vector3;
}

export function surfacesFromPlanes(planes: { object: Object3D; plane: XRPlane }[]): Surface[] {
  const out: Surface[] = [];
  const up = new Vector3();
  for (const { object, plane } of planes) {
    object.updateWorldMatrix(true, false);
    up.set(0, 1, 0).transformDirection(object.matrixWorld);
    const polygon = plane.polygon.map((p) =>
      new Vector3(p.x, 0, p.z).applyMatrix4(object.matrixWorld),
    );
    if (polygon.length < 3) continue;
    const center = polygon
      .reduce((a, p) => a.add(p), new Vector3())
      .multiplyScalar(1 / polygon.length);
    const label = (plane as XRPlane & { semanticLabel?: string }).semanticLabel ?? '';
    let kind: SurfaceKind;
    if (plane.orientation === 'horizontal') {
      if (up.y < 0.9) continue; // ceilings face down
      kind = center.y < 0.25 ? 'floor' : 'table';
    } else {
      if (Math.abs(up.y) > 0.3) continue;
      kind = 'wall';
    }
    out.push({ kind, label, polygon, normal: up.clone(), center });
  }
  return out;
}

const ANCHOR_KEY = 'foldlings.roomAnchor.v1';

type AnchorLike = XRAnchor & {
  requestPersistentHandle?: () => Promise<string>;
};
type SessionWithAnchors = XRSession & {
  restorePersistentAnchor?: (uuid: string) => Promise<XRAnchor>;
};

/**
 * A group whose world transform follows one persistent anchor. Children keep
 * their real-world spot across sessions when the runtime can restore it.
 */
export class RoomFrame {
  readonly root = new Group();
  /** True once this session's frame matches a frame from an earlier visit. */
  restored = false;
  /** True once the frame is final for this session (anchor or fallback). */
  ready = false;
  private anchor: AnchorLike | null = null;
  private creating = false;

  /** Positions in this frame will mean the same spot on a later visit. */
  get anchored(): boolean {
    return this.anchor !== null && this.ready;
  }
  private sessionAge = 0;
  private m = new Matrix4();

  constructor(private world: World) {
    this.root.name = 'RoomFrame';
    world.createTransformEntity(this.root);
    world.renderer.xr.addEventListener('sessionstart', () => void this.onStart());
    world.renderer.xr.addEventListener('sessionend', () => {
      this.anchor = null;
      this.ready = false;
      this.restored = false;
      this.root.matrix.identity();
      this.root.position.set(0, 0, 0);
      this.root.quaternion.identity();
    });
  }

  private async onStart() {
    this.sessionAge = 0;
    this.ready = false;
    this.restored = false;
    const session = this.world.renderer.xr.getSession() as SessionWithAnchors | null;
    const uuid = safeGet(ANCHOR_KEY);
    if (session && uuid && session.restorePersistentAnchor) {
      try {
        this.anchor = (await session.restorePersistentAnchor(uuid)) as AnchorLike;
        this.restored = true;
      } catch {
        this.anchor = null;
      }
    }
  }

  private async create(frame: XRFrame, ref: XRReferenceSpace) {
    if (this.creating || !frame.createAnchor) return;
    this.creating = true;
    try {
      const anchor = (await frame.createAnchor(new XRRigidTransform(), ref)) as AnchorLike | undefined;
      if (anchor) {
        this.anchor = anchor;
        if (anchor.requestPersistentHandle) {
          try {
            safeSet(ANCHOR_KEY, await anchor.requestPersistentHandle());
          } catch {
            /* persistence is optional */
          }
        }
      }
    } catch {
      /* anchors are optional */
    } finally {
      this.creating = false;
    }
  }

  update(frame: XRFrame | null, dt: number) {
    if (!frame) return;
    this.sessionAge += dt;
    const ref = this.world.renderer.xr.getReferenceSpace();
    if (!ref) return;
    if (!this.anchor && this.sessionAge > 1.5) {
      // Restore failed or unsupported: start a fresh frame here.
      void this.create(frame, ref);
    }
    if (this.anchor) {
      const pose = frame.getPose(this.anchor.anchorSpace, ref);
      if (pose) {
        this.m.fromArray(pose.transform.matrix);
        this.world.player.updateWorldMatrix(true, false);
        this.m.premultiply(this.world.player.matrixWorld);
        this.m.decompose(this.root.position, this.root.quaternion, this.root.scale);
        this.ready = true;
      }
    } else if (this.sessionAge > 3) {
      // No anchors on this runtime: the session origin is the frame.
      this.ready = true;
    }
  }
}

export function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage may be unavailable */
  }
}
