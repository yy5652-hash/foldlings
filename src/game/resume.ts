import { CREASES } from '../fold/creases.js';
import { applyFold, initialPaper, type FoldSpec } from '../fold/paper.js';
import { dailyLevel, dayNumber, LEVELS } from './levels.js';
import { decodeFolds } from './share.js';

export interface SavedSheet {
  id: string;
  played: FoldSpec[];
  hinted: boolean;
}

/** Reject stale puzzles and invalid fold sequences before touching the live sheet. */
export function validateSheet(value: unknown, today = dayNumber()): SavedSheet | null {
  if (!value || typeof value !== 'object') return null;
  const sheet = value as SavedSheet;
  if (typeof sheet.id !== 'string' || typeof sheet.hinted !== 'boolean' || !Array.isArray(sheet.played) || sheet.played.length > 200) return null;
  const known = LEVELS.some((level) => level.id === sheet.id) || sheet.id === dailyLevel(today).id ||
    (sheet.id.startsWith('my-') && decodeFolds(sheet.id.slice(3)) !== null);
  if (!known) return null;
  let paper = initialPaper();
  const played: FoldSpec[] = [];
  for (const fold of sheet.played) {
    if (!fold || !CREASES.some((c) => c.f === fold.f && c.k === fold.k) || (fold.s !== 1 && fold.s !== -1)) return null;
    const next = applyFold(paper, fold);
    if (!next) return null;
    paper = next;
    played.push({ f: fold.f, k: fold.k, s: fold.s });
  }
  return { id: sheet.id, played, hinted: sheet.hinted };
}

export function serialiseSheet(id: string, played: readonly FoldSpec[], hinted: boolean): SavedSheet | null {
  return validateSheet({ id, played, hinted });
}
