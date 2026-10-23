/**
 * Round paper-token buttons that lie on the mat. Poke them with a fingertip,
 * point a ray, look and pinch, or click with a mouse.
 */

import {
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SRGBColorSpace,
} from '@iwsdk/core';

export type IconKind = 'undo' | 'restart' | 'hint' | 'next' | 'daily' | 'recenter' | 'sound' | 'mute' | 'back';

const RADIUS = 0.026;

function drawIcon(kind: IconKind): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f7f1e6';
  g.beginPath();
  g.arc(128, 128, 126, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#3b3027';
  g.fillStyle = '#3b3027';
  g.lineWidth = 18;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const arrowHead = (x: number, y: number, a: number) => {
    g.beginPath();
    g.moveTo(x + Math.cos(a) * 34, y + Math.sin(a) * 34);
    g.lineTo(x + Math.cos(a + 2.3) * 30, y + Math.sin(a + 2.3) * 30);
    g.lineTo(x + Math.cos(a - 2.3) * 30, y + Math.sin(a - 2.3) * 30);
    g.closePath();
    g.fill();
  };
  switch (kind) {
    case 'undo':
      g.beginPath();
      g.moveTo(84, 104);
      g.lineTo(150, 104);
      g.arc(150, 142, 38, -Math.PI / 2, Math.PI / 2);
      g.lineTo(96, 180);
      g.stroke();
      arrowHead(78, 104, Math.PI);
      break;
    case 'restart':
      g.beginPath();
      g.arc(128, 132, 54, -Math.PI * 0.35, Math.PI * 1.45);
      g.stroke();
      arrowHead(160, 82, -0.2);
      break;
    case 'hint':
      g.beginPath();
      g.arc(128, 108, 42, Math.PI * 0.8, Math.PI * 2.2);
      g.stroke();
      g.beginPath();
      g.moveTo(106, 150);
      g.lineTo(150, 150);
      g.moveTo(112, 178);
      g.lineTo(144, 178);
      g.stroke();
      break;
    case 'next':
      g.beginPath();
      g.moveTo(96, 80);
      g.lineTo(164, 128);
      g.lineTo(96, 176);
      g.closePath();
      g.fill();
      break;
    case 'daily':
      g.beginPath();
      g.arc(128, 128, 30, 0, Math.PI * 2);
      g.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.beginPath();
        g.moveTo(128 + Math.cos(a) * 48, 128 + Math.sin(a) * 48);
        g.lineTo(128 + Math.cos(a) * 70, 128 + Math.sin(a) * 70);
        g.stroke();
      }
      break;
    case 'sound':
    case 'mute':
      g.beginPath();
      g.moveTo(70, 108);
      g.lineTo(100, 108);
      g.lineTo(136, 76);
      g.lineTo(136, 180);
      g.lineTo(100, 148);
      g.lineTo(70, 148);
      g.closePath();
      g.fill();
      if (kind === 'sound') {
        g.beginPath();
        g.arc(140, 128, 34, -0.8, 0.8);
        g.stroke();
        g.beginPath();
        g.arc(140, 128, 62, -0.8, 0.8);
        g.stroke();
      } else {
        g.beginPath();
        g.moveTo(156, 100);
        g.lineTo(204, 156);
        g.moveTo(204, 100);
        g.lineTo(156, 156);
        g.stroke();
      }
      break;
    case 'back':
      g.beginPath();
      g.moveTo(150, 72);
      g.lineTo(96, 128);
      g.lineTo(150, 184);
      g.stroke();
      break;
    case 'recenter':
      g.beginPath();
      g.arc(128, 128, 50, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(128, 128, 14, 0, Math.PI * 2);
      g.fill();
      break;
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class Button {
  readonly root = new Group();
  private cap = new Group();
  private press = 0;
  private lastFire = -1;
  private clock = 0;
  private face: MeshBasicMaterial;
  private icons = new Map<IconKind, CanvasTexture>();

  constructor(
    readonly kind: IconKind,
    private onPress: () => void,
  ) {
    this.root.name = `Button_${kind}`;
    const base = new Mesh(
      new CylinderGeometry(RADIUS * 1.08, RADIUS * 1.12, 0.004, 32),
      new MeshLambertMaterial({ color: new Color(0x1d2f2b) }),
    );
    base.position.y = 0.002;
    this.root.add(base);
    const body = new Mesh(
      new CylinderGeometry(RADIUS, RADIUS, 0.008, 32),
      new MeshLambertMaterial({ color: new Color(0xe9e0cf) }),
    );
    body.position.y = 0.004;
    const icon = drawIcon(kind);
    this.face = new MeshBasicMaterial({ map: icon });
    this.icons.set(kind, icon);
    const face = new Mesh(new CircleGeometry(RADIUS * 0.98, 32), this.face);
    face.rotation.x = -Math.PI / 2;
    face.position.y = 0.0082;
    this.cap.add(body, face);
    this.cap.position.y = 0.004;
    this.root.add(this.cap);

    const target = this.root as unknown as {
      addEventListener(type: string, fn: () => void): void;
    };
    target.addEventListener('pointerdown', () => this.fire());
    // Light up while a fingertip, ray or gaze is on the token.
    target.addEventListener('pointerenter', () => this.hovers++);
    target.addEventListener('pointerleave', () => (this.hovers = Math.max(0, this.hovers - 1)));
  }

  private fire() {
    if (this.clock - this.lastFire < 0.35) return;
    this.lastFire = this.clock;
    this.press = 1;
    this.onPress();
  }

  /** Swaps the drawn icon (e.g. sound on/off). */
  setIcon(kind: IconKind) {
    let t = this.icons.get(kind);
    if (!t) {
      t = drawIcon(kind);
      this.icons.set(kind, t);
    }
    this.face.map = t;
    this.face.needsUpdate = true;
  }

  setVisible(v: boolean) {
    this.root.visible = v;
  }

  /** Draws the eye with a few gentle bounces. */
  pulse(seconds = 2.4) {
    this.pulseLeft = seconds;
  }
  private pulseLeft = 0;
  private hovers = 0;
  private glow = 0;

  update(dt: number) {
    this.clock += dt;
    this.press = Math.max(0, this.press - dt * 5);
    this.pulseLeft = Math.max(0, this.pulseLeft - dt);
    const bounce = this.pulseLeft > 0 ? Math.abs(Math.sin(this.clock * 7)) * 0.25 : 0;
    this.glow += ((this.hovers > 0 ? 1 : 0) - this.glow) * Math.min(1, dt * 12);
    this.cap.position.y = 0.004 - this.press * 0.004 + bounce * 0.012;
    this.cap.scale.setScalar(1 + bounce * 0.4 + this.glow * 0.08);
    this.face.color.setRGB(1, 1 - this.glow * 0.08, 1 - this.glow * 0.3);
  }
}
