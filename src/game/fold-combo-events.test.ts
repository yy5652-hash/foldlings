import { describe, expect, it, vi } from 'vitest';
import { FoldGame } from './fold-game.js';
import { Combo } from './combo.js';
import { initialPaper } from '../fold/paper.js';

vi.mock('./sfx.js', () => ({ sfx: { undo: vi.fn() } }));

function fixture() {
  const combo = new Combo();
  combo.solve(1, 1, false); combo.solve(1, 1, false);
  const state = {
    history: [initialPaper(), initialPaper()], played: [{}, {}], folds: 2,
    creases: [], creaseHistory: [0, 0], level: { par: 2 }, solved: false,
    textures: { redraw: vi.fn() }, paperView: { setPaper: vi.fn() },
    board: { setFoldCount: vi.fn() }, clearHints: vi.fn(),
    events: { onComboBreak: vi.fn(() => combo.break()), onChanged: vi.fn(), onSave: vi.fn() },
    isFree: false, hinted: false, nextFold: () => null,
    guide: { setCaption: vi.fn() }, buttons: [], hintTimer: 0,
  };
  const game = Object.assign(Object.create(FoldGame.prototype), state) as typeof state & { undo(): void; hint(): void };
  return { game, combo };
}

describe('fold loop combo break events', () => {
  it('breaks only when a real undo empties the sheet', () => {
    const { game, combo } = fixture();
    game.undo(); expect(combo.value).toBe(2);
    game.undo(); expect(combo.value).toBe(0);
    expect(game.events.onComboBreak).toHaveBeenCalledTimes(1);
    game.undo(); expect(game.events.onComboBreak).toHaveBeenCalledTimes(1);
  });
  it('breaks immediately on a hint, while free fold Save remains a save', () => {
    const { game, combo } = fixture();
    game.hint(); expect(combo.value).toBe(0); expect(game.hinted).toBe(true);
    combo.solve(1, 1, false); game.isFree = true;
    game.hint(); expect(combo.value).toBe(1);
    expect(game.events.onSave).toHaveBeenCalled();
  });
});
