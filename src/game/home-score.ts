import type { CreatureKind } from './levels.js';

export interface HomeSurface {
  kind: 'floor' | 'table' | 'wall';
  label: string;
  /** Metres above the player's head (negative means below). */
  height: number;
  distance: number;
  crowding: number;
  /** Distance to the nearest scanned window or plant, if any. */
  natureDistance?: number;
}

export function preferredHome(kind: CreatureKind, s: HomeSurface): boolean {
  const label = s.label.toLowerCase().replace(/_/g, ' ');
  switch (kind) {
    case 'crane': return s.kind === 'table' && s.height <= 0.6 && ['shelf', 'storage', 'table', 'desk'].includes(label);
    case 'frog': return s.kind !== 'wall' && (s.kind === 'floor' || s.height < -0.8);
    case 'fox': return s.kind !== 'wall' && (s.kind === 'floor' || ['couch', 'sofa', 'bed'].includes(label));
    case 'rabbit': return s.kind === 'floor' || label === 'rug';
    case 'boat': return s.kind === 'table' && ['table', 'desk'].includes(label);
    case 'butterfly': return s.kind === 'wall';
    default: return false;
  }
}

/** Lower is better. Without preferred furniture, keep the original habitat choice. */
export function homeScore(kind: CreatureKind, s: HomeSurface, preferredAvailable = true): number {
  if (kind === 'fish' || kind === 'whale') return Infinity;
  if (kind === 'butterfly' ? s.kind !== 'wall' : kind === 'crane' ? s.kind !== 'table' : s.kind === 'wall') return Infinity;
  const near = s.distance * 0.6 + s.crowding * 0.45 + (s.kind === 'floor' ? 0.35 : 0);
  if (!preferredAvailable) return kind === 'crane'
    ? (s.height > 0.6 ? 2 : -s.height) + s.crowding * 0.3
    : near;
  if (!preferredHome(kind, s)) return 100 + near;
  switch (kind) {
    case 'crane': return -s.height * 10 + s.crowding * 0.3 + s.distance * 0.02;
    case 'frog': return s.height * 2 + near;
    case 'butterfly': return near + (s.natureDistance ?? 0) * 2;
    default: return near;
  }
}
