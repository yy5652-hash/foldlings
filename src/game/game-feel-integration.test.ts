/** Coordinator tests with render/audio boundaries mocked; no browser or device claims. */
import { Group } from '@iwsdk/core';
import { describe, expect, it, vi } from 'vitest';
import { GameSystem, migrate } from './game-system.js';
import { Combo } from './combo.js';
import type { FlashFold } from './flash-fold.js';
import { dailyLevel, LEVELS, type Level } from './levels.js';
import { initialPaper, type PaperState } from '../fold/paper.js';
import { scoreSolve, type Result } from './score.js';
import type { SavedSheet } from './resume.js';
import { sfx } from './sfx.js';

vi.mock('./sfx.js', () => ({ sfx: { combo: vi.fn(), tick: vi.fn() } }));

function fixture() {
  const state = {
    progress: { level: 9, solved: [LEVELS[0].id, LEVELS[1].id, LEVELS[9].id],
      best: {}, bestCombo: 0, flashBest: 9, version: 2, sheets: [] as SavedSheet[], sheet: null as SavedSheet | null },
    combo: new Combo(), flashRun: null as FlashFold | null, flashResult: false,
    flashReturn: null as { level: Level; index: number; daily: boolean; free: boolean; sheet: SavedSheet } | null,
    flashTickSecond: -1, paused: false, celebrate: null as unknown, demo: null,
    game: { level: LEVELS[9], levelIndex: 9, isDaily: false, isFree: false, solved: false,
      busy: false, inputLocked: false, wasHinted: false, playedFolds: [LEVELS[9].solution[0]],
      loadLevel: vi.fn(), loadFree: vi.fn(), loadDaily: vi.fn(), loadCustom: vi.fn(),
      readyPaper: vi.fn(), restoreSheet: vi.fn(), hidePaper: vi.fn(), pause: vi.fn(), resume: vi.fn(),
      board: { stopImpact: vi.fn() } },
    feel: { clear: vi.fn(), clock: vi.fn(), burst: vi.fn(), showCombo: vi.fn() },
    island: { root: new Group(), celebrate: vi.fn(), setFlashClock: vi.fn(), setProgress: vi.fn() },
    islandUnlocked: [] as number[],
    zoo: { cheer: vi.fn(), reveal: vi.fn() }, title: { playing: false }, roomModel: { showing: false },
    menu: { isOpen: false }, album: { isOpen: false }, levelSelect: { isOpen: false },
    settingsPanel: { isOpen: false }, resultCard: { showing: false, showFlash: vi.fn(), hide: vi.fn() },
    saveProgress: vi.fn(), clearDelivery: vi.fn(),
  };
  const system = Object.assign(Object.create(GameSystem.prototype), state) as typeof state & {
    startFlash(seed?: number): boolean; leaveFlash(): void; updateFlash(dt: number): void;
    onSolve(level: Level, paper: PaperState, result: Result): void;
    saveSheet(): void; afterResult(action: 'next' | 'retry'): void; update(dt: number, time: number): void;
  };
  system.game.loadLevel.mockImplementation((i: number) => { system.game.level = LEVELS[i]; system.game.levelIndex = i; });
  return system;
}

const result = scoreSolve(1, 1, false);
describe('game feel coordination', () => {
  it('only counts campaign combos, persists their best, and feeds shockwave strength', () => {
    const s = fixture();
    s.onSolve(LEVELS[0], initialPaper(), result);
    s.onSolve(LEVELS[1], initialPaper(), result);
    expect(s.combo.value).toBe(2);
    expect(s.progress.bestCombo).toBe(2);
    expect(s.feel.showCombo).toHaveBeenCalledWith(2);
    expect(sfx.combo).toHaveBeenCalledWith(2);
    expect(s.island.celebrate).toHaveBeenLastCalledWith(0, 2);
    s.onSolve(LEVELS[0], initialPaper(), scoreSolve(2, 1, false));
    expect(s.combo.value).toBe(0);
    expect(s.progress.bestCombo).toBe(2);
    s.onSolve(dailyLevel(42), initialPaper(), result);
    expect(s.combo.value).toBe(0);
    expect(s.island.celebrate).toHaveBeenLastCalledWith(0, 0);
  });

  it('skips collection, campaign saves, presentation and combo scoring throughout a run', () => {
    const s = fixture(), before = structuredClone(s.progress);
    expect(s.startFlash(42)).toBe(true);
    const sheet = structuredClone(s.progress.sheet);
    const persisted = structuredClone(s.progress);
    s.saveProgress.mockClear();
    for (let i = 0; i < 3; i++) {
      s.onSolve(s.game.level, initialPaper(), result);
      s.saveSheet();
    }
    expect(s.flashRun?.score).toBe(3);
    expect(s.flashRun?.remaining).toBe(75);
    expect(s.progress).toEqual(persisted);
    expect(s.progress.solved).toEqual(before.solved);
    expect(s.saveProgress).not.toHaveBeenCalled();
    expect(s.zoo.cheer).not.toHaveBeenCalled();
    expect(s.zoo.reveal).not.toHaveBeenCalled();
    expect(s.celebrate).toBeNull();
    expect(s.combo.value).toBe(0);
    expect(s.feel.burst).toHaveBeenCalledTimes(3);
    s.leaveFlash();
    expect(s.flashRun).toBeNull();
    expect(s.progress.flashBest).toBe(9);
    expect(s.progress.sheet).toEqual(sheet);
    expect(s.game.loadLevel).toHaveBeenLastCalledWith(9);
    expect(s.game.restoreSheet).toHaveBeenCalledWith(sheet);
    expect(s.saveProgress).not.toHaveBeenCalled();
  });

  it('counts full active deltas, freezes while paused, saves only on expiry, and supports Retry / Done', () => {
    const s = fixture();
    s.startFlash(7);
    for (let i = 0; i < 10; i++) s.onSolve(s.game.level, initialPaper(), result);
    s.paused = true;
    s.update(500, 500);
    expect(s.flashRun?.remaining).toBe(90);
    s.paused = false;
    s.saveProgress.mockClear();
    s.updateFlash(85);
    expect(s.flashRun?.remaining).toBe(5);
    expect(sfx.tick).toHaveBeenCalled();
    expect(s.saveProgress).not.toHaveBeenCalled();
    s.updateFlash(5);
    expect(s.progress.flashBest).toBe(10);
    expect(s.resultCard.showFlash).toHaveBeenCalledWith(10, 10);
    expect(s.game.inputLocked).toBe(true);
    expect(s.flashResult).toBe(true);
    expect(s.saveProgress).toHaveBeenCalledTimes(1);
    s.updateFlash(1);
    s.onSolve(s.game.level, initialPaper(), result);
    expect(s.flashRun?.score).toBe(10);
    expect(s.saveProgress).toHaveBeenCalledTimes(1);
    s.afterResult('retry');
    expect(s.flashRun?.remaining).toBe(60);
    expect(s.flashRun?.score).toBe(0);
    s.updateFlash(60);
    expect(s.progress.flashBest).toBe(10);
    s.afterResult('next');
    expect(s.flashRun).toBeNull();
    expect(s.game.inputLocked).toBe(false);
  });

  it('does not start over an existing run or a modal', () => {
    const s = fixture();
    s.menu.isOpen = true;
    expect(s.startFlash()).toBe(false);
    s.menu.isOpen = false;
    expect(s.startFlash()).toBe(true);
    const run = s.flashRun;
    expect(s.startFlash()).toBe(false);
    expect(s.flashRun).toBe(run);
  });

  it('migrates old saves and sanitizes persisted records', () => {
    const old = migrate({ level: 0, solved: [] });
    expect(old.bestCombo).toBe(0); expect(old.flashBest).toBe(0);
    const s = fixture();
    s.progress.bestCombo = 99; s.progress.flashBest = NaN;
    const p = migrate(s.progress);
    expect(p.bestCombo).toBe(5); expect(p.flashBest).toBe(0);
  });
});
