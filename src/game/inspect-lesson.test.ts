import { describe, expect, it } from 'vitest';
import { InspectLesson } from './inspect-lesson.js';

describe('first inspection lesson', () => {
  it('waits for both a deliberate turn and a pull, then two seconds', () => {
    const lesson = new InspectLesson();
    expect(lesson.update(12, 0.4, 0)).toBe(false);
    expect(lesson.update(0.1, 0, 0.3)).toBe(false);
    expect(lesson.update(1.8, 0, 0)).toBe(false);
    expect(lesson.update(0.11, 0, 0)).toBe(true);
  });

  it('accepts either gesture order and accumulates turns in both directions', () => {
    const lesson = new InspectLesson();
    expect(lesson.update(10, 0, 0.5)).toBe(false);
    expect(lesson.update(0.1, 0.2, 0)).toBe(false);
    expect(lesson.update(0.1, -0.2, 0)).toBe(false);
    expect(lesson.update(1.91, 0, 0)).toBe(true);
  });

  it('does not mistake an idle spin or small hand jitter for completing the lesson', () => {
    const lesson = new InspectLesson();
    expect(lesson.update(100, 0, 1)).toBe(false);
    expect(lesson.update(100, 0.01, 0)).toBe(false);
  });
});
