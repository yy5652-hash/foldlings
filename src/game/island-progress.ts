import { LEVELS, PER_WORLD, WORLDS } from './levels.js';

/** Renderer-independent campaign state for the miniature world island. */
export interface IslandProgress {
  solved: number;
  litFraction: number;
  unlocked: boolean;
  nextLevelIndex: number;
}

/** `unlockedWorlds` is explicit: parade history is not an unlock list. */
export function islandProgress(
  worldIndex: number,
  solvedIds: readonly string[],
  unlockedWorlds: readonly number[],
): IslandProgress {
  if (!Number.isInteger(worldIndex) || worldIndex < 0 || worldIndex >= WORLDS.length) {
    throw new RangeError(`Invalid island world: ${worldIndex}`);
  }
  const first = worldIndex * PER_WORLD;
  let solved = 0;
  let nextLevelIndex = -1;
  for (let slot = 0; slot < PER_WORLD; slot++) {
    const index = first + slot;
    if (solvedIds.includes(LEVELS[index].id)) solved++;
    else if (nextLevelIndex < 0) nextLevelIndex = index;
  }
  return {
    solved,
    litFraction: solved / PER_WORLD,
    unlocked: unlockedWorlds.includes(worldIndex),
    nextLevelIndex: nextLevelIndex < 0 ? first : nextLevelIndex,
  };
}
