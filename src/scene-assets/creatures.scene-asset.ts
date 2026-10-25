/**
 * The eight origami creatures as manifest prototypes, so the editor and the
 * model preview can show them. The game builds its own rigs with
 * `buildRig` in the paper colour each level uses.
 */

import { creaturePrototype } from '../game/creature-models.js';

export const creatureCrane = creaturePrototype('crane');
export const creatureFrog = creaturePrototype('frog');
export const creatureFox = creaturePrototype('fox');
export const creatureFish = creaturePrototype('fish');
export const creatureButterfly = creaturePrototype('butterfly');
export const creatureBoat = creaturePrototype('boat');
export const creatureRabbit = creaturePrototype('rabbit');
export const creatureWhale = creaturePrototype('whale');
