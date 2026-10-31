/**
 * The window that rises over the mat after a solve: stars light one by one,
 * folds against par, and the next step. With no answer it moves on by itself,
 * which the Next button shows as a fill running across it.
 */

import { Entity, Group, Mesh, PokeInteractable, RayInteractable, Shape, ShapeGeometry, MeshBasicMaterial, Color, World } from '@iwsdk/core';
import { Button } from './button.js';
import { CONTROL_GLASS, floatOverRoom, GlassWindow, hitPlane, INK, LAYER, setFont, Spring, Surface, TextLabel } from './glass.js';
import type { Best, Result } from './score.js';
import { sfx } from './sfx.js';

export type ResultAction = 'next' | 'retry' | 'levels';

const W = 0.3;
const H = 0.17;
const PX = 1024;
const AUTO_NEXT = 8;
const GOLD = new Color(0xffd166);
const DIM = new Color(0xffffff);

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
      ...(prominent ? { tint: [1, 1, 1] as [number, number, number], body: 0.24, rim: 0.7, sheen: 0 } : CONTROL_GLASS),
      shadow: 0.3,
      soft: h * 0.4,
      drop: h * 0.1,
      order: LAYER.control,
    });
    this.label = new TextLabel(0.0185, 64, prominent ? 600 : 500, INK.primary);
    this.label.set(text);
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
    this.surface.material.uniforms.uFillTint.value.set(0.42, 0.44, 0.48);
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

  constructor(world: World, parent: Entity, private onAction: (a: ResultAction) => void) {
    this.win = new GlassWindow(world, { name: 'ResultCard', w: W, h: H, px: PX, r: 0.028, parent, autoClose: 1e9 });
    const geo = starGeometry(0.0145);
    for (let i = 0; i < 3; i++) {
      const m = new Mesh(geo, new MeshBasicMaterial({ color: DIM.clone(), transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false }));
      m.position.set((i - 1) * 0.036, H / 2 - 0.03, 0.0012);
      m.renderOrder = LAYER.text;
      this.stars.push(m);
      this.win.content.add(m);
    }
    // "Perfect": a small gold capsule that fades in after the third star.
    this.pill = new Surface({ w: 0.064, h: 0.02, tint: [1, 0.82, 0.4], body: 0, order: LAYER.control });
    this.pill.mesh.position.set(W / 2 - 0.05, H / 2 - 0.03, 0.001);
    this.pillText = new TextLabel(0.0155, 56, 700, 'rgba(36,26,4,0.92)');
    this.pillText.set('Perfect');
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
    this.next = add(new PillButton('Next', 0.11, 0.04, true, () => this.fire('next')), 'Result_next');
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
    this.win.root.position.set(0, 0.2, -0.05);
    this.win.root.rotation.set(-0.3, 0, 0);
    this.win.show();
    this.t = 0;
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
    setFont(g, 78, 700, -1.2);
    g.fillText(title, PX / 2, 205, PX - 120);
    g.fillStyle = gold ? INK.gold : INK.secondary;
    setFont(g, 38, gold ? 600 : 500);
    g.fillText(line, PX / 2, 276, PX - 120);
    g.fillStyle = INK.secondary;
    setFont(g, 34, 500);
    const parts = [`${r.folds} ${r.folds === 1 ? 'fold' : 'folds'}`, `Par ${r.par}`];
    if (r.hinted) parts.push('Hint used');
    if (best) parts.push(`Best ${best.stars} of 3`);
    g.fillText(parts.join('  ·  '), PX / 2, 336, PX - 120);
    this.win.commit();
  }

  update(dt: number) {
    this.win.update(dt);
    for (const c of this.controls) c.update(dt);
    if (this.t < 0) return;
    this.t += dt;
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
