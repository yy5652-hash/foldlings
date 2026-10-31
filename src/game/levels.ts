/**
 * Campaign levels. Each goal is defined by one known solution; the player may
 * reach the same picture by any route.
 */

import type { FoldSpec } from '../fold/paper.js';
import { CAMPAIGN } from './campaign.js';
import { DAILY_FOLDS } from './daily.js';
import { decodeFolds } from './share.js';
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


/** False colours, as on a scan: the two sides of a sheet always differ in hue. */
export const LOOKS: PaperLook[] = [
  { front: '#2fd2ff', motif: 'waves', ink: '#d9f7ff', back: '#ffb25a' },
  { front: '#2dffb0', motif: 'dots', ink: '#dcfff2', back: '#8a9bff' },
  { front: '#ffb25a', motif: 'stripes', ink: '#fff0d6', back: '#2fd2ff' },
  { front: '#4f9dff', motif: 'waves', ink: '#e4f1ff', back: '#ffb25a' },
  { front: '#ff5fc8', motif: 'dots', ink: '#ffe6f6', back: '#6fe4ff' },
  { front: '#27e4d2', motif: 'checks', ink: '#e8fbff', back: '#ffa05a' },
  { front: '#ffe04d', motif: 'stripes', ink: '#fff8de', back: '#4f9dff' },
  { front: '#a07bff', motif: 'waves', ink: '#ecebff', back: '#3dffc0' },
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

/** The blank sheet of Free fold: no goal to match. */
export const FREE_LEVEL: Level = {
  id: 'free',
  name: 'Free fold',
  creature: 'crane',
  look: LOOKS[4],
  solution: [],
  world: -2,
  slot: 0,
  par: 0,
};

/** A player-made puzzle from its share code; `n` is its place in My puzzles. */
export function customLevel(code: string, n: number): Level {
  const folds = decodeFolds(code) ?? [];
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    id: `my-${code}`,
    name: n >= 0 ? `My puzzle ${n + 1}` : 'Shared puzzle',
    creature: KINDS[h % KINDS.length],
    look: LOOKS[(h >>> 3) % LOOKS.length],
    solution: folds,
    world: -3,
    slot: Math.max(0, n),
    par: folds.length,
  };
}

