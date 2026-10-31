import { World } from '@iwsdk/core';
import { Button } from './button.js';
import { GlassWindow, INK, setFont, TextLabel, Toggle } from './glass.js';
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

const ROWS: { key: 'easyFolds' | 'leftHanded' | 'reduceMotion' | 'highContrast'; label: string; hint: string }[] = [
  { key: 'easyFolds', label: 'Easy folds', hint: 'More forgiving creases' },
  { key: 'leftHanded', label: 'Left-handed', hint: 'Swaps the controls' },
  { key: 'reduceMotion', label: 'Reduce motion', hint: 'Calmer animation' },
  { key: 'highContrast', label: 'High contrast', hint: 'Stronger paper and lines' },
];
const STEPS: { key: 'matHeight' | 'matDistance'; label: string }[] = [
  { key: 'matHeight', label: 'Mat height' },
  { key: 'matDistance', label: 'Mat distance' },
];
const AUTO_CLOSE = 25;

const W = 0.34;
const PX = 1024;
/** Metres per canvas pixel. */
const M = W / PX;
const PAD = 44;
const TOP = 132;
const ROW_H = 112;
const GAP = 30;
const SECTION_W = PX - PAD * 2;
const PY = TOP + ROWS.length * ROW_H + GAP + STEPS.length * ROW_H + PAD;
const H = PY * M;

/** Settings stay where they opened, just like the menu. */
export class SettingsPanel {
  private win: GlassWindow;
  private state: SettingsState;

  constructor(
    world: World,
    state: SettingsState,
    private onChange: (state: SettingsState) => void,
  ) {
    this.state = { ...state };
    this.win = new GlassWindow(world, { name: 'SettingsPanel', w: W, h: H, px: PX, r: 0.03, autoClose: AUTO_CLOSE });
    this.drawPage();
    const rowY = (i: number) => TOP + i * ROW_H;

    ROWS.forEach((row, i) => {
      const y = rowY(i);
      const [, ly] = this.win.toLocal(0, y + ROW_H / 2);
      const toggle = new Toggle(this.state[row.key], 0.019);
      toggle.root.position.set(W / 2 - PAD * M - 0.018 - 0.0155, ly, 0.0015);
      this.win.content.add(toggle.root);
      this.win.addTick(toggle);
      this.win.addHit(PAD, y, SECTION_W, ROW_H, 28, () => {
        this.state[row.key] = !this.state[row.key];
        toggle.on = this.state[row.key];
        sfx.click();
        this.onChange({ ...this.state });
      }, `Settings_${row.key}`);
    });

    // Two steppers for where the mat sits: lower/higher, nearer/farther.
    STEPS.forEach((row, j) => {
      const y = rowY(ROWS.length + j) + GAP;
      const [, ly] = this.win.toLocal(0, y + ROW_H / 2);
      const right = W / 2 - PAD * M - 0.018;
      const value = new TextLabel(0.0155, 56, 500, INK.secondary);
      value.mesh.position.set(right - 0.092, ly, 0.0015);
      this.win.content.add(value.mesh);
      const text = () => {
        const cm = this.state[row.key] * MAT_STEP[row.key];
        return `${cm > 0 ? '+' : ''}${cm} cm`;
      };
      value.set(text());
      const nudge = (d: number) => {
        if (!this.win.ready) return;
        this.state[row.key] = Math.max(-3, Math.min(3, this.state[row.key] + d));
        value.set(text());
        this.win.touch();
        sfx.click();
        this.onChange({ ...this.state });
      };
      const minus = new Button('minus', () => nudge(-1), '', { r: 0.0155 });
      const plus = new Button('plus', () => nudge(1), '', { r: 0.0155 });
      minus.root.name = `Settings_${row.key}_minus`;
      plus.root.name = `Settings_${row.key}_plus`;
      minus.root.position.set(right - 0.0155 - 0.038, ly, 0.0025);
      plus.root.position.set(right - 0.0155 + 0.002, ly, 0.0025);
      for (const b of [minus, plus]) {
        b.root.rotation.x = Math.PI / 2;
        this.win.addControl(b.root, b);
      }
    });

    const close = new Button('close', () => {
      if (!this.win.ready) return;
      sfx.click();
      this.close();
    }, '', { r: 0.015 });
    close.root.name = 'Settings_close';
    close.root.position.set(0, -H / 2 - 0.024, 0.006);
    close.root.rotation.x = Math.PI / 2;
    this.win.addControl(close.root, close);
  }

  private drawPage() {
    const g = this.win.clear();
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = INK.primary;
    setFont(g, 58, 700, -0.8);
    g.fillText('Settings', PAD + 8, 76);

    const section = (y: number, rows: number) => {
      g.fillStyle = INK.section;
      g.beginPath();
      g.roundRect(PAD, y, SECTION_W, rows * ROW_H, 28);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.09)';
      for (let i = 1; i < rows; i++) g.fillRect(PAD + 32, y + i * ROW_H - 1, SECTION_W - 32, 2);
    };
    section(TOP, ROWS.length);
    section(TOP + ROWS.length * ROW_H + GAP, STEPS.length);

    ROWS.forEach((row, i) => {
      const y = TOP + i * ROW_H;
      g.fillStyle = INK.primary;
      setFont(g, 34, 500);
      g.fillText(row.label, PAD + 32, y + ROW_H / 2 - 17);
      g.fillStyle = INK.secondary;
      setFont(g, 25, 400);
      g.fillText(row.hint, PAD + 32, y + ROW_H / 2 + 22);
    });
    STEPS.forEach((row, j) => {
      const y = TOP + (ROWS.length + j) * ROW_H + GAP;
      g.fillStyle = INK.primary;
      setFont(g, 34, 500);
      g.fillText(row.label, PAD + 32, y + ROW_H / 2);
    });
    this.win.commit();
  }

  get isOpen(): boolean {
    return this.win.isOpen;
  }

  open() {
    this.win.open(0.46, 0.1);
    sfx.pick();
  }

  close() {
    this.win.close();
  }

  update(dt: number) {
    this.win.update(dt);
  }
}
