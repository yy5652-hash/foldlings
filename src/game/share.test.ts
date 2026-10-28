/** Share-code compatibility, validation and display formatting. */

import { describe, expect, it } from 'vitest';
import { applyFolds } from '../fold/paper.js';
import { parseFolds } from './levels.js';
import { decodeFolds, encodeFolds, formatCode } from './share.js';

describe('share codes', () => {
  it('round trips single folds and campaign-style sequences', () => {
    for (const sequence of ['u0+', 'u0-', 'v0+', 'u0+ v0-', 'd-2- a2+ v0+']) {
      const folds = parseFolds(sequence);
      expect(applyFolds(folds)).not.toBeNull();
      expect(decodeFolds(encodeFolds(folds))).toEqual(folds);
    }
  });

  it('uses two base32 characters per fold and the specified checksum', () => {
    expect(encodeFolds(parseFolds('u0+'))).toBe('078');
    expect(encodeFolds(parseFolds('u0-'))).toBe('067');
    expect(encodeFolds(parseFolds('d-2- a2+ v0+'))).toBe('14270N3');
    expect(encodeFolds(parseFolds('a6+'))).toBe('2FG');
    expect(encodeFolds(parseFolds('u0+ u0+ u0+ u0+ u0+ u0+'))).toBe('070707070707G');
  });

  it('rejects a one-character typo in the payload or checksum', () => {
    expect(decodeFolds('15270N3')).toBeNull();
    expect(decodeFolds('14270N4')).toBeNull();
  });

  it('accepts lower case, dashes and spaces', () => {
    expect(decodeFolds(' 1427-0n3 ')).toEqual(parseFolds('d-2- a2+ v0+'));
    expect(decodeFolds(formatCode('14270N3'))).toEqual(decodeFolds('14270N3'));
  });

  it('accepts O, I and L look-alikes in either case', () => {
    for (const code of ['I427ON3', 'L427ON3', 'i427on3', 'l427on3']) {
      expect(decodeFolds(code)).toEqual(parseFolds('d-2- a2+ v0+'));
    }
  });

  it('throws for zero or seven folds and creases outside the lattice', () => {
    expect(() => encodeFolds([])).toThrow();
    expect(() => encodeFolds(parseFolds('u0+ u0+ u0+ u0+ u0+ u0+ u0+'))).toThrow();
    expect(() => encodeFolds([{ f: 'u', k: 4, s: 1 }])).toThrow();
    expect(() => encodeFolds([{ f: 'd', k: 0.5, s: -1 }])).toThrow();
  });

  it('rejects wrong lengths, bad characters and values at or above 80', () => {
    for (const code of ['', '0', '07', '0780', '070707070707070', '07!', '07U', '0_8', '2GH', 'ZZ0']) {
      expect(decodeFolds(code)).toBeNull();
    }
  });

  it('rejects a valid-checksum sequence that cannot fold', () => {
    const folds = parseFolds('u0+ u0+');
    expect(applyFolds(folds)).toBeNull();
    expect(encodeFolds(folds)).toBe('0707G');
    expect(decodeFolds('0707G')).toBeNull();
  });

  it('groups display codes in fours without a trailing dash', () => {
    expect(formatCode('')).toBe('');
    expect(formatCode('078')).toBe('078');
    expect(formatCode('K3F9')).toBe('K3F9');
    expect(formatCode('K3F9A2QX')).toBe('K3F9-A2QX');
    expect(formatCode('K3F9A2QX7')).toBe('K3F9-A2QX-7');
  });
});
