import type { CreatureKind } from '../levels.js';
import type { Construction } from './construction.js';
import type { FlatState } from './flat.js';
import type { Part } from './pattern.js';
import type { Position } from './relax.js';

export type RigPart = Exclude<Part, 'neck'>;
export interface EyeSelector {
  face: { part: Part; side?: 'left' | 'right' };
  weights: Position;
  normalSign?: number;
  normal?: Position;
  radius: number;
}
export interface Definition {
  kind: CreatureKind;
  construction: ReturnType<Construction['finish']>;
  shape(flat: FlatState): { positions: Position[]; flatPositions: Position[] };
  rig: Partial<Record<Part, RigPart>>;
  eyes: EyeSelector[];
  touchesGround: boolean;
  metrics?(positions: Position[]): Record<string, number | number[]>;
}
