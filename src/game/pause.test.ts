import { describe, expect, it } from 'vitest';
import { Pause } from './pause.js';

describe('visibility pause', () => {
  it('pauses on loss of visibility and resumes after a short absence', () => {
    const pause = new Pause();
    expect(pause.transition(true, false, 10)).toBe('pause');
    expect(pause.transition(false, true, 14)).toBe('resume');
  });

  it('does not restart the clock between blurred and hidden', () => {
    const pause = new Pause();
    expect(pause.transition(true, false, 10)).toBe('pause');
    expect(pause.transition(false, false, 14)).toBe('keep');
    expect(pause.transition(false, true, 15.01)).toBe('remind');
    expect(pause.transition(true, true, 20)).toBe('keep');
  });

  it('reminds only when an absence is longer than five seconds', () => {
    const pause = new Pause();
    pause.transition(true, false, 0);
    expect(pause.transition(false, true, 5)).toBe('resume');
    pause.transition(true, false, 8);
    expect(pause.transition(false, true, 13.001)).toBe('remind');
  });

  it('starts a fresh clock after each resume', () => {
    const pause = new Pause();
    pause.transition(true, false, 0);
    expect(pause.transition(false, true, 20)).toBe('remind');
    pause.transition(true, false, 25);
    expect(pause.transition(false, true, 26)).toBe('resume');
  });

  it('does not report desktop time before the first visible session as a pause', () => {
    const pause = new Pause();
    expect(pause.transition(false, false, 0)).toBe('keep');
    expect(pause.transition(false, true, 100)).toBe('resume');
  });
});
