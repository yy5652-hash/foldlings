import { describe, expect, it } from 'vitest';
import { applyFold, FoldSpec, initialPaper } from '../fold/paper.js';
import { isUndo, unfoldFlap } from './unfold.js';

describe('laying a flap back', () => {
  const last: FoldSpec = { f: 'u', k: 0, s: 1 };
  it('recognizes a real engine fold and its reflected flap', () => {
    const previous = initialPaper();
    const paper = applyFold(previous, last)!;
    const back = unfoldFlap(paper, previous, last, { x: -0.05, y: 0 });
    expect(back).not.toBeNull();
    expect(isUndo(last, last, back!.result, previous)).toBe(true);
  });

  it('rejects the same crease with a different silhouette', () => {
    const previous = initialPaper();
    expect(isUndo(last, last, applyFold(previous, last), previous)).toBe(false);
    expect(isUndo({ f: 'v', k: 0 }, last, previous, previous)).toBe(false);
    expect(isUndo(last, undefined, previous, previous)).toBe(false);
  });

  it('does not pick up stationary paper outside the last flap', () => {
    const partial: FoldSpec = { f: 'u', k: 1, s: 1 };
    const previous = initialPaper();
    const paper = applyFold(previous, partial)!;
    expect(unfoldFlap(paper, previous, partial, { x: -0.08, y: 0 })).toBeNull();
    expect(unfoldFlap(paper, previous, partial, { x: 0.025, y: 0 })).not.toBeNull();
  });
});
