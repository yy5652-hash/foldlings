/**
 * Round glass buttons. On the mat they float over the table; on a window they
 * sit on the glass. Poke them with a fingertip, point a ray, look and pinch, or
 * click with a mouse. A soft light follows whatever is pointing at them.
 */

import { CanvasTexture, Group, Vector3 } from '@iwsdk/core';
import {
  CONTROL_GLASS,
  contentTexture,
  drawIcon,
  follow,
  hitDisc,
  IconKind,
  INK,
  LAYER,
  Spring,
  Surface,
  TextLabel,
} from './glass.js';

export type { IconKind };

const RADIUS = 0.026;

const iconCache = new Map<string, CanvasTexture>();

/** Icons are shared: one small texture per kind and colour. */
function iconTexture(kind: IconKind, color: string): CanvasTexture {
  const key = `${kind}|${color}`;
  let t = iconCache.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = 192;
    drawIcon(c.getContext('2d')!, kind, 96, 96, 92, color, 1.9);
    t = contentTexture(c);
    iconCache.set(key, t);
  }
  return t;
}

export interface ButtonOptions {
  /** Radius in metres. */
  r?: number;
  /** No glass of its own, for buttons that sit on a window or an ornament. */
  plain?: boolean;
  /** White with a dark icon: the one thing you probably want to press next. */
  prominent?: boolean;
  /** Caption size in metres of line height. */
  labelSize?: number;
}

interface PointerLike {
  point?: Vector3;
}

export class Button {
  readonly root = new Group();
  /** Lies in the root's XZ plane and faces +Y, so a token can lie on the mat. */
  private cap = new Group();
  readonly surface: Surface;
  private r: number;
  private plain: boolean;
  private iconColor: string;
  private press = new Spring(0, 420, 34);
  private lift = new Spring(0, 300, 30);
  private lastFire = -1;
  private clock = 0;
  private hoverX = 0;
  private hoverY = 0;
  private tmp = new Vector3();
  private label: TextLabel | null = null;
  private labelSize: number;

  constructor(
    public kind: IconKind,
    private onPress: () => void,
    label = '',
    opts: ButtonOptions = {},
  ) {
    this.root.name = `Button_${kind}`;
    this.r = opts.r ?? RADIUS;
    this.plain = !!opts.plain;
    this.labelSize = opts.labelSize ?? 0.0155;
    this.iconColor = opts.prominent ? '#15161a' : INK.primary;
    const d = this.r * 2;
    const glass = this.plain
      ? { tint: [1, 1, 1] as [number, number, number], body: 0, rim: 0, sheen: 0 }
      : opts.prominent
        ? { tint: [0.97, 0.97, 0.96] as [number, number, number], body: 1, rim: 0, sheen: 0 }
        : CONTROL_GLASS;
    this.surface = new Surface({
      w: d,
      h: d,
      ...glass,
      shadow: this.plain ? 0 : 0.34,
      soft: this.r * 0.55,
      drop: this.r * 0.14,
      map: iconTexture(kind, this.iconColor),
      order: LAYER.control,
    });
    this.surface.material.uniforms.uSpot.value = this.r * 1.6;
    this.cap.rotation.x = -Math.PI / 2;
    this.cap.add(this.surface.mesh, hitDisc(this.r * 1.08));
    this.root.add(this.cap);
    if (label) this.setLabel(label);

    const target = this.root as unknown as {
      addEventListener(type: string, fn: (e: PointerLike) => void): void;
    };
    target.addEventListener('pointerdown', () => this.fire());
    // Light up while a fingertip, ray or gaze is on the button.
    target.addEventListener('pointerenter', (e) => {
      this.hovers++;
      this.track(e);
    });
    target.addEventListener('pointermove', (e) => this.track(e));
    target.addEventListener('pointerleave', () => (this.hovers = Math.max(0, this.hovers - 1)));
  }

  private track(e: PointerLike) {
    if (!e.point) return;
    this.tmp.copy(e.point);
    this.surface.mesh.worldToLocal(this.tmp);
    const q = this.surface.mesh.scale;
    this.hoverX = this.tmp.x * q.x;
    this.hoverY = this.tmp.y * q.y;
  }

  private fire() {
    if (this.clock - this.lastFire < 0.35) return;
    this.lastFire = this.clock;
    this.press.x = 1;
    this.onPress();
  }

  /** Swaps the drawn icon (e.g. sound on/off). */
  setIcon(kind: IconKind) {
    this.surface.setMap(iconTexture(kind, this.iconColor));
  }

  setVisible(v: boolean) {
    this.root.visible = v;
  }

  setLabel(text: string) {
    if (!this.label) {
      this.label = new TextLabel(this.labelSize);
      this.label.mesh.position.set(0, -this.r - this.labelSize * 0.62, 0.0006);
      this.cap.add(this.label.mesh);
    }
    this.label.set(text);
  }

  /** Draws the eye: the button breathes for a few seconds. */
  pulse(seconds = 2.4) {
    this.pulseLeft = seconds;
  }
  private pulseLeft = 0;
  private hovers = 0;
  private glow = 0;

  update(dt: number) {
    this.clock += dt;
    this.press.to(0, dt);
    this.pulseLeft = Math.max(0, this.pulseLeft - dt);
    const breath = this.pulseLeft > 0 ? 0.5 + 0.5 * Math.sin(this.clock * 5) : 0;
    const on = this.hovers > 0;
    // On at once, off in about 180 ms.
    this.glow = follow(this.glow, on ? 1 : 0, on ? 40 : 14, dt);
    const lift = this.lift.to(on ? 1 : 0, dt);
    this.cap.position.y = lift * 0.004 - this.press.x * 0.003;
    this.cap.scale.setScalar(1 + lift * 0.04 + breath * 0.05 - this.press.x * 0.05);
    const k = Math.max(this.glow, breath * 0.6);
    this.surface.setHover(k, this.pulseLeft > 0 && !on ? 0 : this.hoverX, this.pulseLeft > 0 && !on ? 0 : this.hoverY);
    if (this.plain) this.surface.setBody(this.glow * 0.14);
  }
}
