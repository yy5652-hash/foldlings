import { defineAssets } from '@iwsdk/core';
import {
  creatureBoat,
  creatureButterfly,
  creatureCrane,
  creatureFish,
  creatureFox,
  creatureFrog,
  creatureRabbit,
  creatureWhale,
} from './scene-assets/creatures.scene-asset.js';

// Everything in Foldlings is generated in code; there are no files to load.
// The creature prototypes are listed so the editor can preview them.
export default defineAssets({
  creature_crane: creatureCrane,
  creature_frog: creatureFrog,
  creature_fox: creatureFox,
  creature_fish: creatureFish,
  creature_butterfly: creatureButterfly,
  creature_boat: creatureBoat,
  creature_rabbit: creatureRabbit,
  creature_whale: creatureWhale,
});
