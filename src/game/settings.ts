import { World } from '@iwsdk/core';
import { Button } from './button.js';
import { DISPLAY, GlassWindow, INK, setFont, TextLabel, Toggle } from './glass.js';
import { safeGet, safeSet } from './room.js';
import { sfx } from './sfx.js';

export interface SettingsState {
  easyFolds: boolean;
  leftHanded: boolean;
  reduceMotion: boolean;
  highContrast: boolean;
  /** Keeps the real room dimmed so the projection reads. */
  dimRoom: boolean;
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
    dimRoom: saved?.dimRoom !== false,
    matHeight: step(saved?.matHeight),
    matDistance: step(saved?.matDistance),
  };
}

export function saveSettings(state: SettingsState) {
  safeSet(SETTINGS_KEY, JSON.stringify(state));
}

const ROWS: { key: 'easyFolds' | 'leftHanded' | 'reduceMotion' | 'highContrast' | 'dimRoom'; label: string; hint: string }[] = [
  { key: 'easyFolds', label: 'Easy folds', hint: 'More forgiving creases' },
  { key: 'leftHanded', label: 'Left-handed', hint: 'Swaps the controls' },
  { key: 'reduceMotion', label: 'Reduce motion', hint: 'Calmer animation' },
  { key: 'highContrast', label: 'High contrast', hint: 'Stronger paper and lines' },
  { key: 'dimRoom', label: 'Dim the room', hint: 'Lets the projection glow' },
];
const STEPS: { key: 'matHeight' | 'matDistance'; label: string }[] = [
  { key: 'matHeight', label: 'Mat height' },
  { key: 'matDistance', label: 'Mat distance' },
];
const AUTO_CLOSE = 25;

/** Two columns, so the panel stays below eye level and hands stay low. */
const W = 0.63;
const PX = 1575;
const M = W / PX;
const PAD = 40;
const GAP = 30;
const COL_W = (PX - PAD * 2 - GAP) / 2;
const TOP = 138;
const ROW_H = 75;
const ROW_STEP = 110;
const H = 0.29;
const PER_COLUMN = 5;
/** Canvas position of the i-th row, filling the left column first. */
const cell = (i: number) => ({
  x: PAD + (i < PER_COLUMN ? 0 : COL_W + GAP),
  y: TOP + (i % PER_COLUMN) * ROW_STEP,
});
/** Panel-space x of a row's right edge. */
const rightEdge = (i: number) => (cell(i).x + COL_W) * M - W / 2;

interface SettingsActions {
  sound: () => boolean;
  toggleSound: () => void;
  restart: () => void;
  moveMat: () => void;
}

/** Settings stay where they opened, just like the menu. */
export class SettingsPanel {
  private win: GlassWindow;
  private state: SettingsState;
  private sound: Toggle;

  constructor(
    world: World,
    state: SettingsState,
    private onChange: (state: SettingsState) => void,
    private actions: SettingsActions,
  ) {
    this.state = { ...state };
    this.win = new GlassWindow(world, { name: 'SettingsPanel', w: W, h: H, px: PX, r: 0.03, autoClose: AUTO_CLOSE });
    ROWS.forEach((row, i) => {
      const { x, y } = cell(i);
      const [, ly] = this.win.toLocal(0, y + ROW_H / 2);
      const toggle = new Toggle(this.state[row.key], 0.019);
      toggle.root.position.set(rightEdge(i) - 0.03, ly, 0.0015);
      this.win.content.add(toggle.root);
      this.win.addTick(toggle);
      this.win.addHit(x, y, COL_W, ROW_H, 8, () => {
        this.state[row.key] = !this.state[row.key];
        toggle.on = this.state[row.key];
        sfx.click();
        this.onChange({ ...this.state });
      }, `Settings_${row.key}`);
    });
    STEPS.forEach((row, j) => {
      const i = ROWS.length + j;
      const edge = rightEdge(i);
      const [, ly] = this.win.toLocal(0, cell(i).y + ROW_H / 2);
      const value = new TextLabel(0.018, 56, 500, INK.secondary);
      value.mesh.position.set(edge - 0.114, ly, 0.0015);
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
      const minus = new Button('minus', () => nudge(-1), '', { r: 0.012 });
      const plus = new Button('plus', () => nudge(1), '', { r: 0.012 });
      minus.root.name = `Settings_${row.key}_minus`;
      plus.root.name = `Settings_${row.key}_plus`;
      minus.root.position.set(edge - 0.06, ly, 0.0025);
      plus.root.position.set(edge - 0.018, ly, 0.0025);
      for (const b of [minus, plus]) {
        b.root.rotation.x = Math.PI / 2;
        this.win.addControl(b.root, b);
      }
    });
    const [, sy] = this.win.toLocal(0, cell(7).y + ROW_H / 2);
    this.sound = new Toggle(actions.sound(), 0.019);
    this.sound.root.position.set(rightEdge(7) - 0.03, sy, 0.0015);
    this.win.content.add(this.sound.root);
    this.win.addTick(this.sound);
    this.win.addHit(cell(7).x, cell(7).y, COL_W, ROW_H, 8, () => {
      actions.toggleSound();
      this.sound.on = actions.sound();
      sfx.click();
    }, 'Settings_sound');
    [actions.restart, actions.moveMat].forEach((run, i) => {
      this.win.addHit(cell(8 + i).x, cell(8 + i).y, COL_W, ROW_H, 8, () => {
        sfx.click();
        this.close();
        run();
      }, i === 0 ? 'Settings_restart' : 'Settings_recenter');
    });
    const close = new Button('close', () => {
      if (!this.win.ready) return;
      sfx.click();
      this.close();
    }, '', { r: 0.015 });
    close.root.name = 'Settings_close';
    close.root.position.set(0, -H / 2 - 0.03, 0.006);
    close.root.rotation.x = Math.PI / 2;
    this.win.addControl(close.root, close);
    this.drawPage();
  }

  private drawPage() {
    const g = this.win.clear();
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = INK.primary;
    setFont(g, 40, 400, 2, DISPLAY);
    g.fillText('SETTINGS', PAD + 20, 76);
    const labels = [...ROWS.map((row) => row.label), ...STEPS.map((row) => row.label), 'Sound on / off', 'Restart this sheet', 'Move mat here'];
    labels.forEach((label, i) => {
      const { x, y } = cell(i);
      g.fillStyle = INK.section;
      g.beginPath();
      g.roundRect(x, y, COL_W, ROW_H, 8);
      g.fill();
      g.fillStyle = INK.primary;
      setFont(g, 29, 500);
      g.fillText(label.toUpperCase(), x + 20, y + ROW_H / 2 - (i < ROWS.length ? 18 : 0));
      if (i < ROWS.length) {
        g.fillStyle = INK.secondary;
        setFont(g, 28, 400);
        g.fillText(ROWS[i].hint, x + 20, y + ROW_H / 2 + 18);
      }
    });
    this.win.commit();
  }

  get isOpen(): boolean {
    return this.win.isOpen;
  }

  open() {
    this.sound.on = this.actions.sound();
    this.win.open(0.53, 0.1);
    sfx.pick();
  }

  close() {
    this.win.close();
  }

  update(dt: number) {
    this.win.update(dt);
  }
}
