export interface Streak {
  count: number;
  saved: number;
}

/** One missed calendar day may be saved in any rolling seven-day window. */
export function streak(solved: readonly number[], today: number): Streak {
  const days = [...new Set(solved.filter((day) => Number.isInteger(day) && day <= today))].sort((a, b) => a - b);
  let count = 0;
  let saved = 0;
  let last = -Infinity;
  let lastSave = -Infinity;
  for (const day of days) {
    const gap = day - last;
    if (gap === 2 && day - 1 - lastSave >= 7) {
      saved++;
      lastSave = day - 1;
    } else if (gap !== 1) {
      count = 0;
      saved = 0;
      lastSave = -Infinity;
    }
    count++;
    last = day;
  }
  const gap = today - last;
  if (gap > 2 || (gap === 2 && today - 1 - lastSave < 7)) return { count: 0, saved: 0 };
  if (gap === 2) saved++;
  return { count, saved };
}
