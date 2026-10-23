/**
 * Campaign levels. Each goal is defined by one known solution; the player may
 * reach the same picture by any route.
 */

import type { FoldSpec } from '../fold/paper.js';
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

export const LEVELS: Level[] = [
  {
    id: 'crane',
    name: 'Crane',
    creature: 'crane',
    look: LOOKS[0],
    solution: [{ f: 'a', k: 0, s: 1 }],
  },
  {
    id: 'boat',
    name: 'Boat',
    creature: 'boat',
    look: LOOKS[3],
    solution: [{ f: 'v', k: 0, s: 1 }],
  },
  {
    id: 'frog',
    name: 'Frog',
    creature: 'frog',
    look: LOOKS[1],
    solution: [
      { f: 'a', k: 0, s: 1 },
      { f: 'd', k: 0, s: 1 },
    ],
  },
  {
    id: 'fox',
    name: 'Fox',
    creature: 'fox',
    look: LOOKS[2],
    solution: [
      { f: 'v', k: 1, s: 1 },
      { f: 'a', k: 1, s: 1 },
      { f: 'd', k: 1, s: 1 },
    ],
  },
];
