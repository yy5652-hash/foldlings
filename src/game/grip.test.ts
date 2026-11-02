import { describe, expect, it } from 'vitest';
import { Grip } from './grip.js';

describe('forgiving grip', () => {
  it('engages while closing in reach and releases relative to the grab gap', () => {
    const grip = new Grip();
    expect(grip.update(0.05, true)).toBeUndefined();
    expect(grip.update(0.028, true)).toBe('engage');
    expect(grip.held).toBe(true);
    // Opening a little, even out of reach, keeps hold.
    expect(grip.update(0.045, false)).toBeUndefined();
    expect(grip.update(0.049, false)).toBe('release');
    expect(grip.held).toBe(false);
    expect(grip.update(0.055, false)).toBeUndefined();
  });

  it('does not engage for a closed hand drifting into range', () => {
    const grip = new Grip();
    grip.update(0.02, false);
    expect(grip.update(0.018, true)).toBeUndefined();
    expect(grip.update(0.016, true)).toBeUndefined();
    expect(grip.held).toBe(false);
  });

  it('needs a fresh opening before it can engage again', () => {
    const grip = new Grip();
    grip.update(0.04, true);
    expect(grip.update(0.028, true)).toBe('engage');
    expect(grip.update(0.05, true)).toBe('release');
    expect(grip.update(0.028, true)).toBe('engage');
    grip.reset();
    expect(grip.update(0.028, true)).toBeUndefined();
  });

  it('does not engage while the gap is opening', () => {
    const grip = new Grip();
    grip.update(0.031, true);
    expect(grip.update(0.029, true)).toBe('engage');
    const other = new Grip();
    other.update(0.04, true);
    other.update(0.031, true);
    expect(other.held).toBe(false);
    expect(other.update(0.033, true)).toBeUndefined();
    expect(other.held).toBe(false);
  });
});
