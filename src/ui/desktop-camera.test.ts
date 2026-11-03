/** Real IWSDK pointer forwarding with a DOM event stub; no browser or renderer. */
import { Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, type World } from '@iwsdk/core';
import { forwardHtmlEvents } from '@pmndrs/pointer-events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopCamera } from './desktop-camera.js';

class Mouse extends Event {
  clientX: number;
  clientY: number;
  button: number;
  buttons: number;
  stopped = false;
  constructor(type: string, init: MouseEventInit = {}) {
    super(type, { cancelable: true, bubbles: true });
    this.clientX = init.clientX ?? 200;
    this.clientY = init.clientY ?? 200;
    this.button = init.button ?? 0;
    this.buttons = init.buttons ?? (type === 'pointerup' ? 0 : 1);
  }
  override stopImmediatePropagation() { this.stopped = true; super.stopImmediatePropagation(); }
}
class Pointer extends Mouse {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}
class Wheel extends Mouse {
  deltaY: number;
  deltaX = 0;
  deltaZ = 0;
  deltaMode: number;
  constructor(deltaY: number, deltaMode = 0) {
    super('wheel'); this.deltaY = deltaY; this.deltaMode = deltaMode;
  }
}
class Canvas {
  clientHeight = 400;
  captures = new Set<number>();
  listeners: { type: string; fn: (e: Event) => void; capture: boolean }[] = [];
  addEventListener(type: string, fn: (e: Event) => void, options?: boolean | AddEventListenerOptions) {
    this.listeners.push({ type, fn, capture: typeof options === 'boolean' ? options : !!options?.capture });
  }
  removeEventListener(type: string, fn: (e: Event) => void) {
    this.listeners = this.listeners.filter((l) => l.type !== type || l.fn !== fn);
  }
  dispatchEvent(e: Mouse) {
    for (const capture of [true, false]) {
      for (const listener of this.listeners) {
        if (e.stopped) return false;
        if (listener.type === e.type && listener.capture === capture) listener.fn(e);
      }
    }
    return !e.defaultPrevented;
  }
  setPointerCapture(id: number) { this.captures.add(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  getBoundingClientRect() { return { width: 400, height: 400, top: 0, left: 0 }; }
}

const disposals: (() => void)[] = [];
afterEach(() => { for (const dispose of disposals.splice(0)) dispose(); vi.unstubAllGlobals(); });
function fixture() {
  vi.stubGlobal('MouseEvent', Mouse);
  vi.stubGlobal('PointerEvent', Pointer);
  const windowEvents = Object.assign(new EventTarget(), { matchMedia: () => ({ matches: true }) });
  vi.stubGlobal('window', windowEvents);
  const canvas = new Canvas(), scene = new Group(), mat = new Group();
  const camera = new PerspectiveCamera(60, 1, 0.01, 100);
  camera.position.set(0, 0, 1); camera.updateMatrixWorld(true);
  const authoredPosition = camera.position.clone(), authoredRotation = camera.quaternion.clone();
  const surface = new Mesh(new PlaneGeometry(0.5, 0.5), new MeshBasicMaterial());
  surface.name = 'FoldSurface';
  scene.add(mat); mat.add(surface); scene.updateMatrixWorld(true);
  const down = vi.fn(), move = vi.fn(), up = vi.fn(), cancel = vi.fn();
  const events = surface as unknown as { addEventListener(type: string, listener: () => void): void };
  events.addEventListener('pointerdown', down); events.addEventListener('pointermove', move);
  events.addEventListener('pointerup', up); events.addEventListener('pointercancel', cancel);
  const xr = Object.assign(new EventTarget(), { isPresenting: false });
  const world = { scene, camera, renderer: { domElement: canvas, xr } } as unknown as World;
  const forward = forwardHtmlEvents(canvas as unknown as HTMLCanvasElement, () => camera, scene, { batchEvents: false });
  let active = true;
  const control = new DesktopCamera(world, mat, () => active);
  disposals.push(() => { control.dispose(); forward.destroy(); surface.geometry.dispose(); });
  const send = (type: string, init: PointerEventInit = {}) => canvas.dispatchEvent(new Pointer(type, init));
  return { control, canvas, camera, xr, down, move, up, cancel, send, windowEvents,
    authoredPosition, authoredRotation, setActive: (on: boolean) => { active = on; } };
}

describe('desktop input arbitration through the existing pointer bridge', () => {
  it('preserves primary drag on a hit and freezes the camera until release', () => {
    const f = fixture(), before = f.camera.position.clone();
    f.send('pointerdown');
    f.send('pointermove', { clientX: 210 });
    f.control.update(0.1);
    expect(f.down).toHaveBeenCalledOnce(); expect(f.move).toHaveBeenCalled();
    expect(f.camera.position.equals(before)).toBe(true);
    expect(f.control.orbit.targetYaw).toBe(0);
    f.send('pointerup');
    expect(f.up).toHaveBeenCalledOnce(); expect(f.cancel).not.toHaveBeenCalled();
  });

  it('orbits on empty space and on right-drag without clicking a hit', () => {
    const f = fixture();
    f.send('pointerdown', { button: 2, buttons: 2 });
    f.send('pointermove', { button: 2, buttons: 2, clientX: 250 });
    expect(f.down).not.toHaveBeenCalled();
    expect(f.control.orbit.targetYaw).toBeLessThan(0);
    f.send('pointerup', { button: 2 });
    const yaw = f.control.orbit.targetYaw;
    f.send('pointerdown', { clientX: 390 });
    f.send('pointermove', { clientX: 350 });
    expect(f.down).not.toHaveBeenCalled();
    expect(f.control.orbit.targetYaw).not.toBe(yaw);
    f.send('pointerup', { clientX: 350 });
  });

  it('cancels the forwarded finger before two-finger orbit/pinch and reserves remaining fingers', () => {
    const f = fixture();
    f.send('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 180 });
    expect(f.down).toHaveBeenCalledOnce();
    f.send('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 220 });
    expect(f.down).toHaveBeenCalledOnce(); expect(f.cancel).toHaveBeenCalledOnce();
    const distance = f.control.orbit.targetDistance;
    f.send('pointermove', { pointerType: 'touch', pointerId: 2, clientX: 260, clientY: 220 });
    expect(f.control.orbit.targetYaw).toBeLessThan(0);
    expect(f.control.orbit.targetDistance).toBeLessThan(distance);
    f.send('pointerup', { pointerType: 'touch', pointerId: 2 });
    f.move.mockClear();
    f.send('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 190 });
    expect(f.move).not.toHaveBeenCalled();
    f.send('pointerup', { pointerType: 'touch', pointerId: 1 });
    f.send('pointerdown', { pointerType: 'touch', pointerId: 3 });
    expect(f.down).toHaveBeenCalledTimes(2);
  });

  it('normalizes wheel units and releases gestures on blur or About', () => {
    const f = fixture(), before = f.control.orbit.targetDistance;
    const wheel = new Wheel(4, 1); f.canvas.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(f.control.orbit.targetDistance).toBeGreaterThan(before);
    f.send('pointerdown'); f.windowEvents.dispatchEvent(new Event('blur'));
    expect(f.cancel).toHaveBeenCalledOnce(); expect(f.canvas.captures.size).toBe(0);
    f.send('pointerdown'); f.setActive(false); f.control.update(0.1);
    expect(f.cancel).toHaveBeenCalledTimes(2);
  });

  it('restores the authored pose for XR and never changes a tracked camera', () => {
    const f = fixture(); f.control.update(0.1);
    expect(f.camera.position.equals(f.authoredPosition)).toBe(false);
    f.xr.isPresenting = true; f.xr.dispatchEvent(new Event('sessionstart'));
    expect(f.camera.position.equals(f.authoredPosition)).toBe(true);
    expect(f.camera.quaternion.equals(f.authoredRotation)).toBe(true);
    f.camera.position.set(3, 4, 5);
    f.control.update(1);
    expect(f.camera.position.toArray()).toEqual([3, 4, 5]);
  });
});
