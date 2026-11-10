import { Vector3, type Object3D, type World } from '@iwsdk/core';
import { Orbit } from './orbit.js';

interface Contact {
  x: number;
  y: number;
  touch: boolean;
  forwarded: boolean;
  orbit: boolean;
  /** False until the scene has had a frame to claim the press (fold, buttons). */
  decided: boolean;
  downX: number;
  downY: number;
  downAt: number;
}

/** Uses IWSDK's existing ray events to reserve paper/buttons; no second raycaster. */
export class DesktopCamera {
  readonly orbit: Orbit;
  private canvas: HTMLCanvasElement;
  private motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private target = new Vector3();
  private eye = new Vector3();
  private originalPosition: Vector3;
  private originalRotation;
  private contacts = new Map<number, Contact>();
  private claimed = -1;
  private multiTouch = false;
  private cancelling = false;
  private pairX = 0;
  private pairY = 0;
  private pairDistance = 0;
  private holdingPaper = false;
  private cleanups: (() => void)[] = [];

  constructor(private world: World, private mat: Object3D, private active: () => boolean, private folding: () => boolean = () => false) {
    this.canvas = world.renderer.domElement;
    this.orbit = new Orbit(this.motion.matches, world.camera.aspect);
    this.originalPosition = world.camera.position.clone();
    this.originalRotation = world.camera.quaternion.clone();
    // A hit bubbles through the real scene before the canvas's bubble listener.
    const claim = (event: { nativeEvent: PointerEvent }) => { this.claimed = event.nativeEvent.pointerId; };
    const scene = world.scene as unknown as {
      addEventListener(type: string, listener: typeof claim): void;
      removeEventListener(type: string, listener: typeof claim): void;
    };
    scene.addEventListener('pointerdown', claim);
    this.cleanups.push(() => scene.removeEventListener('pointerdown', claim));
    this.listen('pointerdown', this.downCapture, true);
    this.listen('pointerdown', this.downBubble);
    this.listen('pointermove', this.move, true);
    this.listen('pointerup', this.up, true);
    this.listen('pointercancel', this.up, true);
    this.listen('lostpointercapture', this.lostCapture);
    this.listen('wheel', this.wheel, { capture: true, passive: false });
    this.listen('contextmenu', this.contextMenu);
    const reset = () => {
      this.cancelContacts();
      // Hand tracking owns immersive cameras; restore the authored non-XR pose.
      world.camera.position.copy(this.originalPosition);
      world.camera.quaternion.copy(this.originalRotation);
    };
    const blur = () => this.cancelContacts();
    world.renderer.xr.addEventListener('sessionstart', reset);
    window.addEventListener('blur', blur);
    this.cleanups.push(() => world.renderer.xr.removeEventListener('sessionstart', reset),
      () => window.removeEventListener('blur', blur));
  }

  private get enabled() {
    return !this.world.renderer.xr.isPresenting && this.active();
  }

  private listen<K extends keyof HTMLElementEventMap>(type: K, listener: (event: HTMLElementEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions) {
    this.canvas.addEventListener(type, listener, options);
    this.cleanups.push(() => this.canvas.removeEventListener(type, listener, options));
  }

  private block(event: Event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  private downCapture = (event: PointerEvent) => {
    if (!this.enabled) return;
    this.orbit.hold();
    this.claimed = -1;
    const contact: Contact = {
      x: event.clientX, y: event.clientY, touch: event.pointerType === 'touch', forwarded: false, orbit: false,
      decided: event.button !== 0, downX: event.clientX, downY: event.clientY, downAt: event.timeStamp,
    };
    this.contacts.set(event.pointerId, contact);
    let touches = 0;
    for (const c of this.contacts.values()) if (c.touch) touches++;
    if (contact.touch && (touches > 1 || this.multiTouch)) {
      this.multiTouch = true;
      for (const [id, c] of this.contacts) {
        if (!c.touch) continue;
        if (c.forwarded) this.cancelForwarded(id, c);
        c.orbit = true;
        this.canvas.setPointerCapture(id);
      }
      this.measurePair();
      this.block(event);
    } else if (event.button !== 0) {
      contact.orbit = true;
      this.canvas.setPointerCapture(event.pointerId);
      this.block(event);
    }
  };

  private downBubble = (event: PointerEvent) => {
    if (!this.enabled) return;
    const contact = this.contacts.get(event.pointerId);
    if (!contact) return;
    contact.forwarded = true;
    // Island, hub, capsules, fold surface and all existing windows keep input. IWSDK reports
    // its hit on the next frame, so the orbit decision waits for the first real movement.
    if (contact.touch || this.claimed === event.pointerId) contact.decided = true;
    this.syncHeld();
  };

  private syncHeld() {
    this.holdingPaper = false;
    for (const contact of this.contacts.values()) {
      if (contact.forwarded && !contact.orbit) this.holdingPaper = true;
    }
  }

  private measurePair() {
    let first: Contact | undefined;
    this.pairDistance = 0;
    for (const contact of this.contacts.values()) {
      if (!contact.touch) continue;
      if (!first) { first = contact; continue; }
      this.pairX = (first.x + contact.x) / 2;
      this.pairY = (first.y + contact.y) / 2;
      this.pairDistance = Math.hypot(first.x - contact.x, first.y - contact.y);
      break;
    }
  }

  private move = (event: PointerEvent) => {
    if (!this.enabled) return;
    const contact = this.contacts.get(event.pointerId);
    if (!contact) return;
    const dx = event.clientX - contact.x, dy = event.clientY - contact.y;
    contact.x = event.clientX;
    contact.y = event.clientY;
    if (!contact.decided) {
      if (this.claimed === event.pointerId || this.folding()) {
        contact.decided = true;
      } else if (Math.hypot(event.clientX - contact.downX, event.clientY - contact.downY) > 6 && event.timeStamp - contact.downAt > 60) {
        // Nothing in the scene took the press: this drag turns the view.
        contact.decided = contact.orbit = true;
        if (contact.forwarded) this.cancelForwarded(event.pointerId, contact);
        this.canvas.setPointerCapture(event.pointerId);
      }
      this.syncHeld();
    }
    if (this.multiTouch && contact.touch) {
      const x = this.pairX, y = this.pairY, distance = this.pairDistance;
      this.measurePair();
      if (distance > 0 && this.pairDistance > 0) {
        this.orbit.rotate(this.pairX - x, this.pairY - y);
        this.orbit.zoom(distance / this.pairDistance);
      }
      this.block(event);
    } else if (contact.orbit) {
      this.orbit.rotate(dx, dy);
      this.block(event);
    }
  };

  private up = (event: PointerEvent) => {
    if (this.cancelling) return;
    const contact = this.contacts.get(event.pointerId);
    if (!contact) return;
    this.contacts.delete(event.pointerId);
    if (contact.orbit) {
      if (contact.forwarded) this.cancelForwarded(event.pointerId, contact);
      this.block(event);
    }
    this.syncHeld();
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    if (this.multiTouch) {
      this.measurePair();
      // Remaining fingers stay reserved until all lift; never begin a stray fold.
      let touches = 0;
      for (const c of this.contacts.values()) if (c.touch) touches++;
      if (touches === 0) this.multiTouch = false;
    }
  };

  private lostCapture = (event: PointerEvent) => {
    const contact = this.contacts.get(event.pointerId);
    if (!contact || this.cancelling) return;
    if (contact.forwarded) this.cancelForwarded(event.pointerId, contact);
    this.contacts.delete(event.pointerId);
    this.syncHeld();
    this.measurePair();
    if (this.contacts.size === 0) this.multiTouch = false;
  };

  private cancelForwarded(id: number, contact: Contact) {
    contact.forwarded = false;
    this.cancelling = true;
    this.canvas.dispatchEvent(new PointerEvent('pointercancel', {
      pointerId: id, pointerType: contact.touch ? 'touch' : 'mouse', clientX: contact.x, clientY: contact.y,
      button: 0, bubbles: true,
    }));
    this.cancelling = false;
    this.syncHeld();
  }

  private cancelContacts() {
    for (const [id, contact] of this.contacts) {
      if (contact.forwarded) this.cancelForwarded(id, contact);
      if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    }
    this.contacts.clear();
    this.multiTouch = false;
    this.holdingPaper = false;
  }

  private wheel = (event: WheelEvent) => {
    if (!this.enabled) return;
    if (this.holdingPaper) { this.block(event); return; }
    this.orbit.hold();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.canvas.clientHeight : 1);
    this.orbit.zoom(Math.exp(Math.max(-1, Math.min(1, pixels * 0.0015))));
    this.block(event);
  };

  private contextMenu = (event: MouseEvent) => { if (this.enabled) event.preventDefault(); };

  update(delta: number) {
    if (!this.enabled) {
      if (this.contacts.size) this.cancelContacts();
      return;
    }
    // Freeze the view while the existing paper input is using its screen ray.
    if (this.holdingPaper) return;
    this.orbit.advance(delta, this.motion.matches);
    const pose = this.orbit;
    this.target.set(0, pose.focusY, pose.focusZ);
    this.mat.localToWorld(this.target);
    const horizontal = Math.cos(pose.pitch) * pose.distance;
    this.eye.set(Math.sin(pose.yaw) * horizontal, Math.sin(pose.pitch) * pose.distance, Math.cos(pose.yaw) * horizontal);
    this.eye.add(this.target);
    if (!Number.isFinite(this.eye.x + this.eye.y + this.eye.z + this.target.x + this.target.y + this.target.z)) return;
    const camera = this.world.camera;
    if (camera.parent) camera.parent.worldToLocal(this.eye);
    camera.position.copy(this.eye);
    camera.lookAt(this.target);
    camera.updateMatrixWorld(true);
  }

  dispose() {
    this.cancelContacts();
    for (const cleanup of this.cleanups) cleanup();
  }
}
