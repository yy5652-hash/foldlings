import { describe, expect, it } from 'vitest';
import { homeScore, preferredHome, type HomeSurface } from './home-score.js';

const surface = (label: string, height = -0.6, kind: HomeSurface['kind'] = 'table'): HomeSurface =>
  ({ label, kind, height, distance: 1, crowding: 0 });

describe('creature homes', () => {
  it('puts cranes on the highest suitable shelf, storage or table', () => {
    expect(homeScore('crane', surface('shelf', 0.4))).toBeLessThan(homeScore('crane', surface('table', -0.4)));
    expect(homeScore('crane', surface('storage', 0.5))).toBeLessThan(homeScore('crane', surface('shelf', 0.7)));
    expect(preferredHome('crane', surface('shelf', 0.6))).toBe(true);
  });

  it('puts frogs low, foxes on couches or beds, rabbits on floors or rugs, boats on tables', () => {
    for (const [kind, preferred, other] of [
      ['frog', surface('floor', -1.6, 'floor'), surface('table')],
      ['fox', surface('couch'), surface('shelf')],
      ['fox', surface('bed'), surface('table')],
      ['rabbit', surface('rug', -1.6, 'floor'), surface('couch')],
      ['boat', surface('table'), surface('shelf')],
    ] as const) expect(homeScore(kind, preferred)).toBeLessThan(homeScore(kind, other));
  });

  it('puts butterflies on walls, closer to a window or plant', () => {
    const wall = surface('wall', 0, 'wall');
    expect(homeScore('butterfly', { ...wall, natureDistance: 0.2 })).toBeLessThan(homeScore('butterfly', { ...wall, natureDistance: 2 }));
    expect(homeScore('butterfly', surface('table'))).toBe(Infinity);
  });

  it('keeps fish and whales in the air', () => {
    for (const kind of ['fish', 'whale'] as const) expect(homeScore(kind, surface('table'))).toBe(Infinity);
  });

  it('falls back to the existing nearby habitat and avoids crowding', () => {
    const couch = surface('couch');
    expect(preferredHome('boat', couch)).toBe(false);
    expect(homeScore('boat', couch, false)).toBeLessThan(Infinity);
    expect(homeScore('fox', couch)).toBeLessThan(homeScore('fox', { ...couch, crowding: 3, distance: 2 }));
    const floor = surface('floor', -1.6, 'floor');
    expect(homeScore('boat', floor, false)).toBeLessThan(homeScore('boat', { ...couch, distance: 4 }, false));
  });

  it('changes the chosen furniture when the room changes', () => {
    const choose = (room: HomeSurface[]) => room.reduce((a, b) => homeScore('fox', a) < homeScore('fox', b) ? a : b).label;
    expect(choose([surface('table'), surface('couch')])).toBe('couch');
    expect(choose([surface('table'), surface('floor', -1.6, 'floor')])).toBe('floor');
  });
});
