// Test-only bridge so the fold tests can check game levels without DOM code.
import { dailyLevel, LEVELS } from '../game/levels.js';
import { DAILY_FOLDS } from '../game/daily.js';

export { LEVELS };
export const DAILY = DAILY_FOLDS.map((_, i) => dailyLevel(i));
