/**
 * The window that rises over the mat after a solve: stars light one by one,
 * folds against par, and the next step. With no answer it moves on by itself,
 * which the Next button shows as a fill running across it.
 */

import { Entity, Group, Mesh, PokeInteractable, RayInteractable, Shape, ShapeGeometry, MeshBasicMaterial, Color, Vector3, World } from '@iwsdk/core';
import { viewFov } from './view-fov.js';
import { Button } from './button.js';
import { CONTROL_GLASS, DISPLAY, floatOverRoom, GlassWindow, hitPlane, INK, LAYER, setFont, Spring, Surface, TextLabel } from './glass.js';
import type { Best, Result } from './score.js';
import type { HandBodies } from './hand-bodies.js';
import { PINCH_REACH, PinchPull } from './pinch-pull.js';
import { sfx } from './sfx.js';

export type ResultAction = 'next' | 'retry' | 'levels';

const W = 0.3;
const H = 0.17;
const PX = 1024;
const AUTO_NEXT = 8;
const GOLD = new Color(0xffc266);
const DIM = new Color(0x8fe6ff);

function starGeometry(r: number): ShapeGeometry {
  const s = new Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.5 : r;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.closePath();
  return new ShapeGeometry(s);
}

/** A wide pill button: the white one is what you probably want next. */
class PillButton {
  readonly root = new Group();
  readonly surface: Surface;
  private label: TextLabel;
  private lift = new Spring(0, 300, 30);
  private press = new Spring(0, 420, 34);
  private hovers = 0;
  private glow = 0;

  constructor(
    text: string,
    private w: number,
    private h: number,
    prominent: boolean,
    private onPress: () => void,
  ) {
    this.surface = new Surface({
      w,
      h,
      r: 0.002,
      cut: 0.008,
      ...(prominent ? { tint: [0.1, 0.45, 0.6] as [number, number, number], body: 0.4, rim: 1, sheen: 0 } : CONTROL_GLASS),
      shadow: 0.3,
      soft: h * 0.4,
      drop: h * 0.1,
      order: LAYER.control,
    });
    this.label = new TextLabel(0.0175, 64, prominent ? 600 : 500, INK.primary);
    this.label.set(text.toUpperCase());
    this.label.mesh.position.z = 0.0006;
    this.root.add(this.surface.mesh, this.label.mesh, hitPlane(w, h));
    const t = this.root as unknown as { addEventListener(type: string, fn: () => void): void };
    t.addEventListener('pointerdown', () => {
      this.press.x = 1;
      this.onPress();
    });
    t.addEventListener('pointerenter', () => this.hovers++);
    t.addEventListener('pointerleave', () => (this.hovers = Math.max(0, this.hovers - 1)));
  }

  /** The white fill, 0..1. */
  setFill(k: number) {
    this.surface.setFill(k, [1, 1, 1]);
    // Dark text would be right on the fill, but it runs under white text: keep
    // the fill below the label's contrast by holding it translucent.
    this.surface.material.uniforms.uFillTint.value.set(0.12, 0.62, 0.82);
  }

  update(dt: number) {
    this.press.to(0, dt);
    const on = this.hovers > 0;
    this.glow += ((on ? 1 : 0) - this.glow) * Math.min(1, dt * (on ? 40 : 14));
    const lift = this.lift.to(on ? 1 : 0, dt);
    this.root.position.z = this.baseZ + lift * 0.004 - this.press.x * 0.003;
    const s = 1 + lift * 0.03 - this.press.x * 0.04;
    this.root.scale.setScalar(s);
    this.surface.setHover(this.glow * 0.8);
  }

  baseZ = 0.003;
}

export class ResultCard {
  private win: GlassWindow;
  private pulls = [
    new PinchPull(W / 2, { minX: 0, maxX: W / 2, minY: -H / 2, maxY: H / 2 }),
    new PinchPull(W / 2, { minX: 0, maxX: W / 2, minY: -H / 2, maxY: H / 2 }),
  ];
  private pullHand = -1;
  private local = new Vector3();
  private pullProgress = 0;
  private stars: Mesh[] = [];
  private next: PillButton;
  private controls: { update(dt: number): void }[] = [];
  private t = -1;
  private earned = 0;
  private popped = 0;
  private perfect = false;
  private pill: Surface;
  private pillText: TextLabel;
  private pillOn = 0;

  constructor(private world: World, parent: Entity, private onAction: (a: ResultAction) => void) {
    this.win = new GlassWindow(world, { name: 'ResultCard', w: W, h: H, px: PX, parent, autoClose: 1e9 });
    const geo = starGeometry(0.0145);
    for (let i = 0; i < 3; i++) {
      const m = new Mesh(geo, new MeshBasicMaterial({ color: DIM.clone(), transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false }));
      m.position.set((i - 1) * 0.036, H / 2 - 0.03, 0.0012);
      m.renderOrder = LAYER.text;
      this.stars.push(m);
      this.win.content.add(m);
    }
    // "Perfect": a small gold capsule that fades in after the third star.
    this.pill = new Surface({ w: 0.074, h: 0.02, r: 0.002, cut: 0.005, tint: [1, 0.76, 0.4], body: 0, order: LAYER.control });
    this.pill.mesh.position.set(W / 2 - 0.05, H / 2 - 0.03, 0.001);
    this.pillText = new TextLabel(0.0145, 56, 700, 'rgba(36,20,2,0.95)');
    this.pillText.set('PERFECT');
    this.pillText.mesh.position.set(W / 2 - 0.05, H / 2 - 0.03, 0.0016);
    this.win.content.add(this.pill.mesh, this.pillText.mesh);

    const add = <T extends { root: Group; update(dt: number): void }>(c: T, name: string): T => {
      c.root.name = name;
      const e = world.createTransformEntity(c.root, this.win.entity);
      e.addComponent(RayInteractable);
      e.addComponent(PokeInteractable);
      this.controls.push(c);
      return c;
    };
    // An ornament row in front of the window's lower edge.
    const y = -H / 2 + 0.002;
    this.next = add(new PillButton('Next', 0.11, 0.036, true, () => this.fire('next')), 'Result_next');
    this.next.root.position.set(0, y, 0.012);
    this.next.baseZ = 0.012;
    const retry = add(new Button('restart', () => this.fire('retry'), '', { r: 0.02 }), 'Result_retry');
    const levels = add(new Button('levels', () => this.fire('levels'), '', { r: 0.02 }), 'Result_levels');
    retry.root.position.set(-0.084, y, 0.012);
    levels.root.position.set(0.084, y, 0.012);
    retry.root.rotation.x = levels.root.rotation.x = Math.PI / 2;
    floatOverRoom(this.win.root);
    this.hide();
  }

  get panel() {
    return this.win.root;
  }

  get showing(): boolean {
    return this.t >= 0;
  }

  show(title: string, sub: string, r: Result, best: Best | undefined, banner = '') {
    this.earned = r.stars;
    this.perfect = r.perfect;
    this.popped = 0;
    this.pillOn = 0;
    for (const s of this.stars) {
      const m = s.material as MeshBasicMaterial;
      m.color.copy(DIM);
      m.opacity = 0.22;
      s.scale.setScalar(1);
    }
    this.draw(title, banner || sub, banner !== '', r, best);
    this.win.root.scale.setScalar(1);
    this.win.root.position.set(0, 0.2, -0.05);
    this.win.root.rotation.set(-0.3, 0, 0);
    if (viewFov(this.world).mode === 'narrow') this.win.open(0.45, 0.06);
    else this.win.show();
    this.t = 0;
    this.pullHand = -1;
    this.pullProgress = 0;
    for (const pull of this.pulls) pull.reset(true);
    this.win.content.scale.x = this.win.content.scale.y;
    this.win.content.position.x = 0;
  }

  hide() {
    this.t = -1;
    this.win.close();
  }

  private fire(action: ResultAction) {
    if (this.t < 0.6) return;
    sfx.click();
    this.hide();
    this.onAction(action);
  }

  private draw(title: string, line: string, gold: boolean, r: Result, best: Best | undefined) {
    const g = this.win.clear();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = INK.primary;
    setFont(g, 54, 400, 2, DISPLAY);
    g.fillText(title.toUpperCase(), PX / 2, 205, PX - 120);
    g.fillStyle = gold ? INK.gold : INK.secondary;
    setFont(g, 33, gold ? 600 : 500);
    g.fillText(line.toUpperCase(), PX / 2, 276, PX - 120);
    g.fillStyle = INK.secondary;
    setFont(g, 30, 500);
    const parts = [`${r.folds} ${r.folds === 1 ? 'FOLD' : 'FOLDS'}`, `PAR ${r.par}`];
    if (r.hinted) parts.push('HINT USED');
    if (best) parts.push(`BEST ${best.stars}/3`);
    g.fillText(parts.join('  ·  '), PX / 2, 336, PX - 120);
    this.win.commit();
  }

  update(dt: number, hands?: HandBodies['pinch']) {
    this.win.update(dt);
    for (const c of this.controls) c.update(dt);
    if (this.t < 0) return;
    this.t += dt;
    if (hands && this.t >= 0.6) {
      for (let i = 0; i < 2; i++) {
        const hand = i === 0 ? hands.left : hands.right;
        const pull = this.pulls[i];
        if (!hand.tracked || (this.pullHand >= 0 && this.pullHand !== i)) {
          pull.reset(hand.on);
          if (this.pullHand === i) this.pullHand = -1;
          continue;
        }
        // Use the unchanged panel frame while the visible card closes.
        this.local.copy(hand.at);
        this.win.root.worldToLocal(this.local);
        if (!pull.active) pull.distance = Math.max(0.01, this.local.x * 2);
        pull.update(hand.on, this.local.x, this.local.y, -this.local.x, dt, Math.abs(this.local.z) < PINCH_REACH);
        if (pull.active && this.pullHand < 0) {
          this.pullHand = i;
          sfx.pick();
        }
        if (this.pullHand === i) {
          this.pullProgress = pull.progress;
          if (pull.commit) {
            this.fire('next');
            return;
          }
          if (!pull.active && pull.progress === 0) this.pullHand = -1;
        }
      }
    }
    if (this.pullHand < 0) this.pullProgress *= Math.exp(-18 * dt);
    const scale = this.win.content.scale.y;
    this.win.content.scale.x = scale * (1 - this.pullProgress * 0.95);
    this.win.content.position.x = -W / 2 * scale * this.pullProgress * 0.95;
    // Stars light one by one, each with its own note.
    const due = Math.min(this.earned, Math.floor((this.t - 0.3) / 0.32) + 1);
    while (this.popped < due) {
      const s = this.stars[this.popped];
      const m = s.material as MeshBasicMaterial;
      m.color.copy(GOLD);
      m.opacity = 1;
      sfx.star(this.popped);
      this.popped++;
      if (this.popped === 3 && this.perfect) sfx.perfect();
    }
    for (let i = 0; i < this.popped; i++) {
      const age = this.t - 0.3 - i * 0.32;
      const k = Math.min(1, age / 0.35);
      this.stars[i].scale.setScalar(1 + Math.sin(k * Math.PI) * 0.32);
    }
    if (this.perfect && this.popped >= 3) this.pillOn = Math.min(1, this.pillOn + dt * 4);
    this.pill.setBody(this.pillOn);
    this.pill.mesh.visible = this.pillText.mesh.visible = this.pillOn > 0.01;
    this.pillText.surface.fade = this.pillOn;
    this.next.setFill(Math.min(1, this.t / AUTO_NEXT));
    if (this.t > AUTO_NEXT) {
      this.hide();
      this.onAction('next');
    }
  }
}
