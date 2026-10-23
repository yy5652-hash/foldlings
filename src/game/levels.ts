/**
 * Campaign levels. Each goal is defined by one known solution; the player may
 * reach the same picture by any route.
 */

import type { FoldSpec } from '../fold/paper.js';
import { DAILY_FOLDS } from './daily.js';
import type { PaperLook } from './paper-texture.js';

export type CreatureKind =
  | 'crane'
  | 'frog'
  | 'fox'
  | 'fish'
  | 'butterfly'
  | 'boat'
  | 'rabbit'
  | 'whale';

export interface Level {
  id: string;
  name: string;
  creature: CreatureKind;
  look: PaperLook;
  solution: FoldSpec[];
}

const BACK = '#f6f0e4';

export const LOOKS: PaperLook[] = [
  { front: '#e2574c', motif: 'waves', ink: '#fff3e8', back: BACK },
  { front: '#3f9a6e', motif: 'dots', ink: '#e9ffe9', back: BACK },
  { front: '#e8923a', motif: 'stripes', ink: '#fff0d6', back: BACK },
  { front: '#3d79c2', motif: 'waves', ink: '#e4f1ff', back: BACK },
  { front: '#c75c9a', motif: 'dots', ink: '#ffe6f6', back: BACK },
  { front: '#3a8d97', motif: 'checks', ink: '#e8fbff', back: BACK },
  { front: '#d9b23a', motif: 'stripes', ink: '#fff8de', back: BACK },
  { front: '#5b5fb0', motif: 'waves', ink: '#ecebff', back: BACK },
];

/** Parses "d-2- a2+" style fold lists (family, offset, moving side). */
export function parseFolds(src: string): FoldSpec[] {
  return src
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const m = /^([uvda])(-?\d+)([+-])$/.exec(tok);
      if (!m) throw new Error(`Bad fold "${tok}"`);
      return { f: m[1] as FoldSpec['f'], k: Number(m[2]), s: m[3] === '+' ? 1 : -1 };
    });
}

const level = (id: string, name: string, creature: CreatureKind, look: number, folds: string): Level => ({
  id,
  name,
  creature,
  look: LOOKS[look],
  solution: parseFolds(folds),
});

/** Twelve hand-picked goals, from one fold up to four. */
export const LEVELS: Level[] = [
  level('crane', 'Crane', 'crane', 0, 'a0+'),
  level('frog', 'Frog', 'frog', 1, 'v0+'),
  level('boat', 'Boat', 'boat', 3, 'd-2- a2+'),
  level('fish', 'Fish', 'fish', 5, 'd-2- a-2-'),
  level('fox', 'Fox', 'fox', 2, 'd2+ a-2-'),
  level('butterfly', 'Butterfly', 'butterfly', 4, 'd-2- a-2- u0-'),
  level('rabbit', 'Rabbit', 'rabbit', 6, 'd-2- a2+ v0+'),
  level('whale', 'Whale', 'whale', 7, 'd-2- d3+ a-2-'),
  level('crane-2', 'Night Crane', 'crane', 7, 'd2+ a-2- v0-'),
  level('frog-2', 'Leaf Frog', 'frog', 6, 'v-1- d-3- a3+'),
  level('fox-2', 'Snow Fox', 'fox', 3, 'd2+ a-2- a3+ d-3-'),
  level('whale-2', 'Deep Whale', 'whale', 5, 'd-2- a-2- a3+ d3+'),
];

const KINDS: CreatureKind[] = ['crane', 'frog', 'fox', 'fish', 'butterfly', 'boat', 'rabbit', 'whale'];

/** Local calendar day number, so the daily fold changes at midnight. */
export function dayNumber(d = new Date()): number {
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
}

/** Today's fold: same for everyone on the same date. */
export function dailyLevel(day = dayNumber()): Level {
  const i = ((day * 7919) % DAILY_FOLDS.length + DAILY_FOLDS.length) % DAILY_FOLDS.length;
  const kind = KINDS[((day * 31) % KINDS.length + KINDS.length) % KINDS.length];
  const look = ((day * 13) % LOOKS.length + LOOKS.length) % LOOKS.length;
  return {
    id: `daily-${day}`,
    name: 'Daily Fold',
    creature: kind,
    look: LOOKS[look],
    solution: parseFolds(DAILY_FOLDS[i]),
  };
}
