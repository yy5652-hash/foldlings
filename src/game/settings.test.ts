import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSettings, saveSettings } from './settings.js';

const KEY = 'foldlings.settings.v1';
const DEFAULTS = { easyFolds: false, leftHanded: false, reduceMotion: false, highContrast: false, matHeight: 0, matDistance: 0 };

describe('settings persistence', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('starts with every setting off and returns independent defaults', () => {
    expect(loadSettings()).toEqual(DEFAULTS);
    loadSettings().easyFolds = true;
    expect(loadSettings()).toEqual(DEFAULTS);
  });

  it('round-trips all settings using the versioned key', () => {
    const state = { easyFolds: true, leftHanded: true, reduceMotion: true, highContrast: true, matHeight: 2, matDistance: -1 };
    saveSettings(state);
    expect(localStorage.setItem).toHaveBeenCalledWith(KEY, JSON.stringify(state));
    expect(loadSettings()).toEqual(state);
    saveSettings(DEFAULTS);
    expect(loadSettings()).toEqual(DEFAULTS);
  });

  it.each(['{broken', '', 'null', '[]', '42', '"true"', 'true'])('tolerates invalid settings: %s', (value) => {
    localStorage.setItem(KEY, value);
    expect(loadSettings()).toEqual(DEFAULTS);
  });

  it('defaults missing and non-boolean fields without losing valid settings', () => {
    localStorage.setItem(KEY, JSON.stringify({ easyFolds: true, leftHanded: 'true', reduceMotion: 1, unknown: true }));
    expect(loadSettings()).toEqual({ ...DEFAULTS, easyFolds: true });
  });

  it('tolerates unavailable storage on both read and write', () => {
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('Storage blocked'); },
      setItem() { throw new Error('Storage blocked'); },
    });
    expect(loadSettings()).toEqual(DEFAULTS);
    expect(() => saveSettings(DEFAULTS)).not.toThrow();
  });

  it('keeps mat nudges whole and within three steps', () => {
    localStorage.setItem(KEY, JSON.stringify({ matHeight: 7.6, matDistance: -2.4 }));
    expect(loadSettings()).toMatchObject({ matHeight: 3, matDistance: -2 });
    localStorage.setItem(KEY, JSON.stringify({ matHeight: 'up', matDistance: null }));
    expect(loadSettings()).toMatchObject({ matHeight: 0, matDistance: 0 });
  });
});
