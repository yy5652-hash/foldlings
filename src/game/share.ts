/** Compact share codes for one to six lattice folds, with a check character. */

import { CREASES } from '../fold/creases.js';
import { applyFolds, type FoldSpec } from '../fold/paper.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function encodeFolds(folds: readonly FoldSpec[]): string {
  if (folds.length < 1 || folds.length > 6) throw new Error('Expected 1 to 6 folds');
  let code = '';
  let sum = folds.length;
  for (const fold of folds) {
    const index = CREASES.findIndex((c) => c.f === fold.f && c.k === fold.k);
    if (index < 0) throw new Error('Fold is not in CREASES');
    const value = index * 2 + (fold.s > 0 ? 1 : 0);
    code += ALPHABET[Math.floor(value / 32)] + ALPHABET[value % 32];
    sum += value;
  }
  return code + ALPHABET[sum % 32];
}

export function decodeFolds(code: string): FoldSpec[] | null {
  const normalized = code.toUpperCase().replace(/[- ]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (normalized.length < 3 || normalized.length > 13 || normalized.length % 2 !== 1) return null;
  const values = [...normalized].map((char) => ALPHABET.indexOf(char));
  if (values.some((value) => value < 0)) return null;
  const folds: FoldSpec[] = [];
  let sum = (values.length - 1) / 2;
  for (let i = 0; i < values.length - 1; i += 2) {
    const value = values[i] * 32 + values[i + 1];
    if (value >= 80) return null;
    folds.push({ ...CREASES[Math.floor(value / 2)], s: value % 2 === 1 ? 1 : -1 });
    sum += value;
  }
  if (sum % 32 !== values[values.length - 1]) return null;
  return applyFolds(folds) === null ? null : folds;
}

export function formatCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? '';
}
