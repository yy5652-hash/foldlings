/** Achievement badges and their thresholds, in display order. */

export interface AchievementStats {
  solves: number;
  perfects: number;
  worldsDone: number;
  flawlessWorlds: number;
  streak: number;
  kinds: number;
  zoo: number;
  palmRides: number;
  waves: number;
}

export interface Achievement {
  id: string;
  title: string;
  how: string;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first-fold', title: 'First fold', how: 'Solve any level' },
  { id: 'perfect', title: 'Perfect', how: 'Solve a level at par with no hint' },
  { id: 'perfect-10', title: 'Ten perfects', how: 'Earn three stars on 10 levels' },
  { id: 'world', title: 'World complete', how: 'Solve all ten levels of a world' },
  { id: 'worlds-3', title: 'Explorer', how: 'Complete three worlds' },
  { id: 'flawless', title: 'Flawless', how: 'Three stars on every level of a world' },
  { id: 'streak-3', title: 'Three days', how: 'Keep a 3-day Daily Fold streak' },
  { id: 'streak-7', title: 'A whole week', how: 'Keep a 7-day Daily Fold streak' },
  { id: 'album', title: 'Full album', how: 'Fold all eight kinds of creature' },
  { id: 'zoo-25', title: 'Paper zoo', how: 'Fold 25 creatures' },
  { id: 'palm', title: 'Hand perch', how: 'Let a creature ride on your palm' },
  { id: 'wave', title: 'Hello there', how: 'Wave at your zoo' },
];

const thresholds: Record<string, [keyof AchievementStats, number]> = {
  'first-fold': ['solves', 1],
  perfect: ['perfects', 1],
  'perfect-10': ['perfects', 10],
  world: ['worldsDone', 1],
  'worlds-3': ['worldsDone', 3],
  flawless: ['flawlessWorlds', 1],
  'streak-3': ['streak', 3],
  'streak-7': ['streak', 7],
  album: ['kinds', 8],
  'zoo-25': ['zoo', 25],
  palm: ['palmRides', 1],
  wave: ['waves', 1],
};

export function earnedIds(s: AchievementStats): string[] {
  return ACHIEVEMENTS.filter(({ id }) => {
    const [stat, minimum] = thresholds[id];
    return s[stat] >= minimum;
  }).map(({ id }) => id);
}

export function newlyEarned(s: AchievementStats, already: readonly string[]): string[] {
  return earnedIds(s).filter((id) => !already.includes(id));
}
