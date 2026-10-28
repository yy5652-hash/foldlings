import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PokeInteractable,
  RayInteractable,
  SRGBColorSpace,
  Vector3,
  World,
} from '@iwsdk/core';
import { Button, IconKind } from './button.js';
import { safeGet, safeSet } from './room.js';
import { sfx } from './sfx.js';

export interface SettingsState {
  easyFolds: boolean;
  leftHanded: boolean;
  reduceMotion: boolean;
  highContrast: boolean;
  /** Comfort nudges for the mat, in steps (-3..3): 3 cm up, 4 cm away. */
  matHeight: number;
  matDistance: number;
}

/** Centimetres per step of the mat nudges. */
export const MAT_STEP = { matHeight: 3, matDistance: 4 } as const;

const step = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-3, Math.min(3, Math.round(v))) : 0);

const SETTINGS_KEY = 'foldlings.settings.v1';

export function loadSettings(): SettingsState {
  let saved: Partial<SettingsState> | null = null;
  try {
    saved = JSON.parse(safeGet(SETTINGS_KEY) ?? 'null');
  } catch {
    /* invalid settings use the defaults */
  }
  return {
    easyFolds: saved?.easyFolds === true,
    leftHanded: saved?.leftHanded === true,
    reduceMotion: saved?.reduceMotion === true,
    highContrast: saved?.highContrast === true,
    matHeight: step(saved?.matHeight),
    matDistance: step(saved?.matDistance),
  };
}

export function saveSettings(state: SettingsState) {
  safeSet(SETTINGS_KEY, JSON.stringify(state));
}

const ROWS: { key: 'easyFolds' | 'leftHanded' | 'reduceMotion' | 'highContrast'; label: string; icon: IconKind }[] = [
  { key: 'easyFolds', label: 'Easy folds', icon: 'hint' },
  { key: 'leftHanded', label: 'Left handed', icon: 'back' },
  { key: 'reduceMotion', label: 'Reduce motion', icon: 'restart' },
  { key: 'highContrast', label: 'High contrast', icon: 'daily' },
];
const AUTO_CLOSE = 25;

/** Settings stay where they opened, just like the palm menu. */
export class SettingsPanel {
  readonly panel = new Group();
  private buttons: Button[] = [];
  private state: SettingsState;
  private unfold = 0;
  private wantOpen = false;
  private idle = 0;
  private head = new Vector3();
  private fwd = new Vector3();

  constructor(
    private world: World,
    state: SettingsState,
    private onChange: (state: SettingsState) => void,
  ) {
    this.state = { ...state };
    this.panel.name = 'SettingsPanel';
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 960;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(30,46,42,0.94)';
    g.beginPath();
    g.roundRect(4, 4, c.width - 8, c.height - 8, 36);
    g.fill();
    g.strokeStyle = 'rgba(246,240,228,0.35)';
    g.lineWidth = 4;
    g.stroke();
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    const page = new Mesh(new PlaneGeometry(0.32, 0.6), new MeshBasicMaterial({ map: t, transparent: true }));
    page.renderOrder = -5;
    this.panel.add(page);
    const pe = world.createTransformEntity(this.panel);
    ROWS.forEach((row, i) => {
      const b = new Button(row.icon, () => {
        if (!this.wantOpen || this.unfold < 0.9) return;
        this.state[row.key] = !this.state[row.key];
        b.setLabel(`${row.label}: ${this.state[row.key] ? 'On' : 'Off'}`);
        this.idle = 0;
        sfx.click();
        this.onChange({ ...this.state });
      }, `${row.label}: ${this.state[row.key] ? 'On' : 'Off'}`);
      b.root.name = `Settings_${row.key}`;
      b.root.position.set(-0.105, 0.21 - i * 0.085, 0.004);
      b.setLabelBeside(1.7);
      this.buttons.push(b);
    });
    // Two steppers for where the mat sits: lower/higher, nearer/farther.
    const steps: { key: 'matHeight' | 'matDistance'; label: string }[] = [
      { key: 'matHeight', label: 'Mat height' },
      { key: 'matDistance', label: 'Mat distance' },
    ];
    steps.forEach((row, j) => {
      const y = 0.21 - (ROWS.length + j) * 0.085;
      const text = () => {
        const cm = this.state[row.key] * MAT_STEP[row.key];
        return `${row.label}: ${cm > 0 ? '+' : ''}${cm} cm`;
      };
      const plus = new Button('plus', () => nudge(1), text());
      const minus = new Button('minus', () => nudge(-1));
      const nudge = (d: number) => {
        if (!this.wantOpen || this.unfold < 0.9) return;
        this.state[row.key] = Math.max(-3, Math.min(3, this.state[row.key] + d));
        plus.setLabel(text());
        this.idle = 0;
        sfx.click();
        this.onChange({ ...this.state });
      };
      minus.root.name = `Settings_${row.key}_minus`;
      plus.root.name = `Settings_${row.key}_plus`;
      minus.root.position.set(-0.118, y, 0.004);
      plus.root.position.set(-0.058, y, 0.004);
      minus.root.scale.setScalar(0.8);
      plus.root.scale.setScalar(0.8);
      plus.setLabelBeside(1.6);
      this.buttons.push(minus, plus);
    });
    const close = new Button('close', () => {
      if (!this.wantOpen || this.unfold < 0.9) return;
      sfx.click();
      this.close();
    });
    close.root.name = 'Settings_close';
    close.root.position.set(0.128, 0.265, 0.004);
    close.root.scale.setScalar(0.7);
    this.buttons.push(close);
    for (const b of this.buttons) {
      b.root.rotation.x = Math.PI / 2;
      const e = world.createTransformEntity(b.root, pe);
      e.addComponent(RayInteractable);
      e.addComponent(PokeInteractable);
      const target = b.root as unknown as { addEventListener(type: string, fn: () => void): void };
      target.addEventListener('pointerenter', () => { this.idle = 0; });
    }
    this.panel.visible = false;
    this.panel.position.set(0, -50, 0);
  }

  get isOpen(): boolean {
    return this.wantOpen;
  }

  open() {
    this.world.camera.getWorldPosition(this.head);
    this.world.camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-4) this.fwd.set(0, 0, -1);
    this.fwd.normalize();
    this.panel.position.copy(this.head).addScaledVector(this.fwd, 0.45);
    this.panel.position.y -= 0.12;
    this.panel.lookAt(this.head);
    this.panel.visible = true;
    this.wantOpen = true;
    this.idle = 0;
    sfx.pick();
  }

  close() {
    this.wantOpen = false;
  }

  update(dt: number) {
    this.unfold += ((this.wantOpen ? 1 : 0) - this.unfold) * Math.min(1, dt * 12);
    if (this.wantOpen) {
      this.idle += dt;
      if (this.idle > AUTO_CLOSE) this.close();
    }
    this.panel.scale.set(1, Math.max(0.02, this.unfold), 1);
    if (!this.wantOpen && this.unfold < 0.03 && this.panel.visible) {
      this.panel.visible = false;
      this.panel.position.set(0, -50, 0);
    }
    for (const b of this.buttons) b.update(dt);
  }
}
