/**
 * Campaign levels. Each goal is defined by one known solution; the player may
 * reach the same picture by any route.
 */

import type { FoldSpec } from '../fold/paper.js';
import { CAMPAIGN } from './campaign.js';
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
  /** Campaign world (0-7), or -1 for the daily fold. */
  world: number;
  slot: number;
  /** Fewest folds that make the picture. */
  par: number;
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

const level = (id: string, name: string, creature: CreatureKind, look: number, folds: string) => ({
  id,
  name,
  creature,
  look: LOOKS[look],
  solution: parseFolds(folds),
});

/** One world per creature, in campaign order. */
export const WORLDS: { kind: CreatureKind; name: string }[] = [
  { kind: 'crane', name: 'Crane' },
  { kind: 'frog', name: 'Frog' },
  { kind: 'boat', name: 'Boat' },
  { kind: 'fish', name: 'Fish' },
  { kind: 'fox', name: 'Fox' },
  { kind: 'butterfly', name: 'Butterfly' },
  { kind: 'rabbit', name: 'Rabbit' },
  { kind: 'whale', name: 'Whale' },
];
export const PER_WORLD = 10;

/** The original twelve keep their names and paper. */
const NAMED: Record<string, [string, number]> = {
  crane: ['Crane', 0],
  frog: ['Frog', 1],
  boat: ['Boat', 3],
  fish: ['Fish', 5],
  fox: ['Fox', 2],
  butterfly: ['Butterfly', 4],
  rabbit: ['Rabbit', 6],
  whale: ['Whale', 7],
  'crane-2': ['Night Crane', 7],
  'frog-2': ['Leaf Frog', 6],
  'fox-2': ['Snow Fox', 3],
  'whale-2': ['Deep Whale', 5],
};

/** Eighty levels: eight worlds of ten, from one fold up to four. */
export const LEVELS: Level[] = CAMPAIGN.map(([id, world, folds, par], i) => {
  const slot = i % PER_WORLD;
  const [name, look] = NAMED[id] ?? [`${WORLDS[world].name} ${slot + 1}`, (world * 3 + slot * 5) % LOOKS.length];
  return { ...level(id, name, WORLDS[world].kind, look, folds), world, slot, par };
});

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
    world: -1,
    slot: 0,
    par: parseFolds(DAILY_FOLDS[i]).length,
  };
}
