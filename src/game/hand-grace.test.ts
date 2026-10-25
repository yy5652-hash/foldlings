import { describe, expect, it } from 'vitest';
import { HandGrace, HandsMissing } from './hand-grace.js';

describe('hand fold grace', () => {
  it('keeps the same drag when re-pinching inside the release window', () => {
    const grace = new HandGrace();
    grace.begin();
    expect(grace.pinchEnded()).toBe('keep');
    expect(grace.update(0.24)).toBe('keep');
    expect(grace.pinchStarted()).toBe('keep');
    expect(grace.update(1)).toBe('keep');
    expect(grace.pendingRelease).toBe(false);
  });

  it('ends once at 0.25 seconds, even with duplicate release events', () => {
    const grace = new HandGrace();
    grace.begin();
    grace.pinchEnded();
    expect(grace.update(0.2)).toBe('keep');
    grace.pinchEnded();
    expect(grace.update(0.05)).toBe('end');
    expect(grace.update(1)).toBe('keep');
  });

  it('resumes when tracking returns within one second while still pinching', () => {
    const grace = new HandGrace();
    grace.begin();
    expect(grace.trackingLost()).toBe('freeze');
    expect(grace.update(0.99)).toBe('freeze');
    expect(grace.trackingFound()).toBe('resume');
    expect(grace.frozen).toBe(false);
    expect(grace.update(1)).toBe('keep');
  });

  it('cancels once after one second without tracking; repeated loss cannot extend it', () => {
    const grace = new HandGrace();
    grace.begin();
    grace.trackingLost();
    grace.update(0.6);
    grace.trackingLost();
    expect(grace.update(0.41)).toBe('cancel');
    expect(grace.trackingFound()).toBe('keep');
    expect(grace.update(1)).toBe('keep');
  });

  it('cancels at the exact tracking deadline', () => {
    const grace = new HandGrace();
    grace.begin();
    grace.trackingLost();
    expect(grace.update(1)).toBe('cancel');
  });

  it('cancels when tracking returns with an open hand', () => {
    const grace = new HandGrace();
    grace.begin();
    grace.trackingLost();
    grace.pinchEnded();
    expect(grace.update(0.3)).toBe('freeze');
    expect(grace.trackingFound()).toBe('cancel');
  });

  it('lets tracking loss override release, without re-pinch unfreezing an untracked hand', () => {
    const grace = new HandGrace();
    grace.begin();
    grace.pinchEnded();
    grace.update(0.2);
    grace.trackingLost();
    expect(grace.update(0.3)).toBe('freeze');
    expect(grace.pinchStarted()).toBe('freeze');
    expect(grace.frozen).toBe(true);
    expect(grace.trackingFound()).toBe('resume');
    expect(grace.update(1)).toBe('keep');
  });

  it('uses a fresh release window after a recovered drag', () => {
    const grace = new HandGrace();
    grace.begin();
    grace.trackingLost();
    grace.update(0.8);
    grace.trackingFound();
    grace.pinchEnded();
    expect(grace.update(0.24)).toBe('keep');
    expect(grace.update(0.02)).toBe('end');
  });

  it('clears pending timers on reset and a new drag', () => {
    const grace = new HandGrace();
    grace.begin();
    grace.trackingLost();
    grace.reset();
    expect(grace.update(5)).toBe('keep');
    grace.begin();
    expect(grace.frozen).toBe(false);
    expect(grace.update(5)).toBe('keep');
  });
});

describe('hands missing reminder', () => {
  it('fires once after three seconds and resets when any hand is tracked', () => {
    const prompt = new HandsMissing();
    expect(prompt.update(3, true, false, true)).toBe(false);
    expect(prompt.update(0.01, true, false, true)).toBe(true);
    expect(prompt.update(10, true, false, true)).toBe(false);
    expect(prompt.update(0.1, true, true, true)).toBe(false);
    expect(prompt.update(3.01, true, false, true)).toBe(true);
  });

  it('does not prompt on desktop, in the first two seconds, or on solved levels', () => {
    const prompt = new HandsMissing();
    expect(prompt.update(10, false, false, true)).toBe(false);
    expect(prompt.update(1.99, true, false, true)).toBe(false);
    expect(prompt.update(10, true, false, false)).toBe(false);
    expect(prompt.update(0.1, true, false, true)).toBe(true);
  });

  it('resets session age and absence across sessions', () => {
    const prompt = new HandsMissing();
    expect(prompt.update(4, true, false, true)).toBe(true);
    prompt.reset();
    expect(prompt.update(1, true, false, true)).toBe(false);
    expect(prompt.update(2.1, true, false, true)).toBe(true);
    expect(prompt.update(1, false, false, true)).toBe(false);
    expect(prompt.update(1, true, false, true)).toBe(false);
  });
});
