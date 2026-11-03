/** Transient labels and sheet-to-island light. Buffers are allocated once. */
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Group, Points, PointsMaterial, Vector3 } from '@iwsdk/core';
import type { PaperState } from '../fold/paper.js';
import { MONO, TextLabel } from './glass.js';

const COUNT = 96;
export class GameFeel {
  readonly root = new Group();
  private combo = new TextLabel(.045, 96, 700);
  private timer = new TextLabel(.042, 96, 600, 'rgba(170,240,255,1)', 120, MONO);
  private particles = new Points(new BufferGeometry(), new PointsMaterial({
    color: 0xc3f7ff, size: .006, transparent: true, opacity: 0, depthWrite: false,
    blending: AdditiveBlending, toneMapped: false,
  }));
  private starts = new Float32Array(COUNT * 3);
  private positions = new Float32Array(COUNT * 3);
  private target = new Vector3();
  private comboAge = 1;
  private particleAge = 1;
  private seconds = -1;
  private urgent = false;
  private motion = true;
  private time = 0;
  private comboY = .46;

  constructor() {
    this.root.name = 'GameFeel';
    this.combo.mesh.name = 'Combo_burst';
    this.timer.mesh.name = 'Flash_clock';
    this.particles.name = 'Flash_sheet_light';
    this.combo.mesh.position.set(0, this.comboY, -.08);
    this.timer.mesh.position.set(0, .23, .08);
    this.timer.mesh.rotation.x = -.4;
    this.combo.mesh.rotation.x = -.25;
    this.combo.mesh.raycast = this.timer.mesh.raycast = this.particles.raycast = () => {};
    this.particles.geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    this.particles.frustumCulled = false;
    this.combo.mesh.visible = this.timer.mesh.visible = this.particles.visible = false;
    this.root.add(this.combo.mesh, this.timer.mesh, this.particles);
  }

  anchorIsland(at: Vector3) {
    this.comboY = at.y + .14;
    this.combo.mesh.position.set(at.x, this.comboY, at.z);
  }

  setReduceMotion(on: boolean) {
    this.motion = !on;
    if (on) { this.particleAge = 1; this.particles.visible = false; }
    this.combo.mesh.scale.setScalar(1);
  }

  showCombo(n: number) {
    this.combo.set(`COMBO x${n}`);
    this.comboAge = 0;
    this.combo.mesh.visible = true;
  }

  clock(remaining: number | null) {
    this.timer.mesh.visible = remaining !== null;
    if (remaining === null) { this.seconds = -1; return; }
    const seconds = Math.ceil(remaining);
    if (seconds === this.seconds) return;
    this.seconds = seconds;
    this.urgent = seconds <= 10;
    this.timer.set(`${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`,
      this.urgent ? 'rgba(255,165,80,1)' : 'rgba(170,240,255,1)');
  }

  burst(paper: PaperState, target: Vector3) {
    if (!this.motion) return;
    this.target.copy(target);
    for (let i = 0; i < COUNT; i++) {
      const poly = paper.facets[i % paper.facets.length].poly;
      const a = poly[i % poly.length], b = poly[(i + 1) % poly.length];
      const k = (i * .61803398875) % 1;
      this.starts[i * 3] = a.x + (b.x - a.x) * k;
      this.starts[i * 3 + 1] = .01;
      this.starts[i * 3 + 2] = -(a.y + (b.y - a.y) * k);
    }
    this.particleAge = 0;
    this.particles.visible = true;
  }

  clear() {
    this.comboAge = this.particleAge = 1;
    this.combo.mesh.visible = this.particles.visible = false;
    this.clock(null);
  }

  update(dt: number) {
    this.time += dt;
    this.comboAge += dt;
    this.combo.mesh.visible = this.comboAge < .7;
    if (this.combo.mesh.visible) {
      const t = this.comboAge / .7;
      this.combo.surface.fade = Math.min(1, (1 - t) * 4);
      this.combo.mesh.position.y = this.comboY + (this.motion ? .04 * t : 0);
      this.combo.mesh.scale.setScalar(this.motion ? 1 + Math.sin(t * Math.PI) * .12 : 1);
    }
    this.timer.surface.fade = this.urgent && this.motion ? .75 + .25 * Math.cos(this.time * 12) : 1;
    this.particleAge += dt;
    if (this.particleAge >= .65) { this.particles.visible = false; return; }
    const t = this.particleAge / .65, ease = t * t * (3 - 2 * t);
    const p = this.particles.geometry.getAttribute('position');
    for (let i = 0; i < COUNT; i++) {
      p.setXYZ(i,
        this.starts[i * 3] * (1 - ease) + this.target.x * ease,
        this.starts[i * 3 + 1] * (1 - ease) + this.target.y * ease + Math.sin(t * Math.PI) * .06,
        this.starts[i * 3 + 2] * (1 - ease) + this.target.z * ease);
    }
    p.needsUpdate = true;
    this.particles.material.opacity = Math.sin(Math.PI * t);
  }
}
